import { Router } from "express";
import PDFDocument from "pdfkit";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { checkSensorAccess } from "../middleware/sensorAccess.js";

const router = Router();

// ── Paleta de colores ─────────────────────────────────────────────────────────

const C = {
  green:      "#1B5E20",
  greenMid:   "#2E7D32",
  greenPale:  "#F1F8E9",
  humidity:   "#1565C0",
  temperature:"#BF360C",
  grid:       "#E0E0E0",
  text:       "#212121",
  muted:      "#9E9E9E",
  warnLow:    "#E65100",
  warnHigh:   "#B71C1C",
};

// ── Utilidades de datos ───────────────────────────────────────────────────────

function calcStats(values) {
  if (!values.length) return { min: 0, max: 0, avg: 0, count: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return { min, max, avg: parseFloat(avg.toFixed(2)), count: values.length };
}

function trend(values) {
  if (values.length < 6) return "Sin tendencia clara (pocos datos)";
  const half = Math.floor(values.length / 2);
  const first  = values.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const second = values.slice(half).reduce((a, b) => a + b, 0) / (values.length - half);
  const diff = second - first;
  if (Math.abs(diff) < 0.5) return "Estable";
  return diff > 0
    ? `Tendencia ascendente (+${diff.toFixed(1)})`
    : `Tendencia descendente (${diff.toFixed(1)})`;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("es-CO", {
      day: "2-digit", month: "long", year: "numeric"
    });
  } catch { return iso.slice(0, 10); }
}

// ── Dibujo de gráfica de línea con PDFKit ─────────────────────────────────────

function drawLineChart(doc, readings, field, ox, oy, w, h, title, color, unit) {
  const raw = readings.map(r => parseFloat(r[field])).filter(v => !isNaN(v));
  if (raw.length < 2) return;

  const minV  = Math.min(...raw);
  const maxV  = Math.max(...raw);
  const range = (maxV - minV) || 1;
  const lo    = minV - range * 0.12;
  const hi    = maxV + range * 0.12;
  const span  = hi - lo;

  // ── Barra de título dentro de la caja ──────────────────────────────────────
  const titleH = 22;
  doc.rect(ox, oy, w, titleH).fillColor(color).fillOpacity(0.18).fill();
  doc.fillOpacity(1);
  doc.rect(ox, oy, 4, titleH).fillColor(color).fill();
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.text)
     .text(title, ox + 10, oy + 7, { width: w - 14 });

  // ── Área del gráfico debajo del título ─────────────────────────────────────
  const chartOy = oy + titleH;
  const chartH  = h - titleH;

  doc.rect(ox, chartOy, w, chartH).fillColor(C.greenPale).fill();
  doc.rect(ox, oy, w, h).strokeColor(C.grid).lineWidth(0.5).stroke();

  // ── Cuadrícula y etiquetas del eje Y ───────────────────────────────────────
  doc.font("Helvetica").fontSize(6.5);
  for (let i = 0; i <= 4; i++) {
    const gy = chartOy + chartH - (i / 4) * chartH;
    const gv = lo + (i / 4) * span;
    doc.moveTo(ox, gy).lineTo(ox + w, gy)
       .strokeColor(C.grid).lineWidth(0.5).stroke();
    doc.fillColor(C.muted)
       .text(`${gv.toFixed(1)}${unit}`, ox - 38, gy - 4, { width: 35, align: "right" });
  }

  // ── Línea y área sombreada ─────────────────────────────────────────────────
  doc.save().rect(ox, chartOy, w, chartH).clip();

  const pts = raw.map((v, i) => ({
    x: ox + (i / (raw.length - 1)) * w,
    y: chartOy + chartH - ((v - lo) / span) * chartH
  }));

  doc.moveTo(pts[0].x, chartOy + chartH);
  pts.forEach(p => doc.lineTo(p.x, p.y));
  doc.lineTo(pts[pts.length - 1].x, chartOy + chartH)
     .closePath().fillColor(color).fillOpacity(0.1).fill();
  doc.fillOpacity(1);

  doc.moveTo(pts[0].x, pts[0].y);
  pts.slice(1).forEach(p => doc.lineTo(p.x, p.y));
  doc.strokeColor(color).lineWidth(1.5).stroke();

  doc.restore();

  // ── Etiquetas min / max ────────────────────────────────────────────────────
  const iMin = raw.indexOf(minV);
  const iMax = raw.indexOf(maxV);
  doc.font("Helvetica").fontSize(6);
  doc.fillColor(C.warnHigh)
     .text(`${minV.toFixed(1)}${unit}`, pts[iMin].x - 13, pts[iMin].y + 3,  { width: 28, align: "center" });
  doc.fillColor(C.greenMid)
     .text(`${maxV.toFixed(1)}${unit}`, pts[iMax].x - 13, pts[iMax].y - 11, { width: 28, align: "center" });
}

// ── Caja de estadísticas ──────────────────────────────────────────────────────

function drawStatBox(doc, x, y, w, h, title, stats, unit, color) {
  doc.rect(x, y, w, h).fillColor(C.greenPale).fill();
  doc.rect(x, y, w, h).strokeColor(C.grid).lineWidth(0.5).stroke();
  doc.rect(x, y, w, 3).fillColor(color).fill();

  doc.font("Helvetica").fontSize(7.5).fillColor(C.muted)
     .text(title, x + 10, y + 10);

  const cw = w / 3;
  [
    { label: "Mínimo",   val: `${stats.min.toFixed(1)}${unit}` },
    { label: "Promedio", val: `${stats.avg}${unit}` },
    { label: "Máximo",   val: `${stats.max.toFixed(1)}${unit}` },
  ].forEach((s, i) => {
    const sx = x + i * cw;
    doc.font("Helvetica-Bold").fontSize(13).fillColor(color)
       .text(s.val, sx, y + 24, { width: cw, align: "center" });
    doc.font("Helvetica").fontSize(7).fillColor(C.muted)
       .text(s.label, sx, y + 43, { width: cw, align: "center" });
  });

  doc.font("Helvetica").fontSize(7).fillColor(C.muted)
     .text(`${stats.count} registros`, x + 10, y + h - 14);
}

// ── Generación de insights con Claude ────────────────────────────────────────

async function generateInsights(sensor, humStats, tempStats, from, to, count) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const prompt =
`Eres un experto en monitoreo ambiental y producción biológica. Analizas datos de sensores IoT para sistemas de producción muy variados: cultivos agrícolas tradicionales, hongos, insectos (como mosca soldado negra), acuaponía, biodigestores, invernaderos y más. Tu análisis debe ser versátil y no asumir el tipo de producción a menos que el nombre del sensor lo indique claramente.

Analiza los siguientes datos ambientales y redacta un informe ejecutivo conciso en español.

Sensor: ${sensor.name}
Ubicación: ${sensor.location || "No especificada"}
Período analizado: ${from} al ${to}
Total de registros: ${count}

HUMEDAD DEL AIRE
  Mínima: ${humStats.min.toFixed(1)}%  |  Promedio: ${humStats.avg}%  |  Máxima: ${humStats.max.toFixed(1)}%
  Tendencia: ${humStats.trend}

TEMPERATURA AMBIENTE
  Mínima: ${tempStats.min.toFixed(1)}°C  |  Promedio: ${tempStats.avg}°C  |  Máxima: ${tempStats.max.toFixed(1)}°C
  Tendencia: ${tempStats.trend}

Considera:
- Si las condiciones son estables y dentro de rangos óptimos generales, indícalo positivamente.
- Si hay variaciones extremas o tendencias preocupantes, señálalas con criterio técnico.
- Las recomendaciones deben ser accionables y aplicables al contexto inferido del sensor.
- No uses términos específicos de un solo tipo de cultivo si el nombre del sensor no lo sugiere.

Responde EXACTAMENTE con este formato (sin asteriscos, sin markdown, sin símbolos extra):

INSIGHTS:
1. [observación clave 1]
2. [observación clave 2]
3. [observación clave 3]

RECOMENDACIONES:
1. [acción concreta 1]
2. [acción concreta 2]`;

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }]
    });
    return msg.content[0].text.trim();
  } catch (err) {
    console.error("[REPORT AI]", err.message);
    return null;
  }
}

// ── Constructor del PDF (síncrono) ────────────────────────────────────────────

function buildPdf(doc, sensor, readings, from, to, insights) {
  const PW = doc.page.width;
  const PH = doc.page.height;
  const M  = 50;
  const CW = PW - M * 2;

  const now = new Date().toLocaleDateString("es-CO", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });

  // ── Encabezado ─────────────────────────────────────────────────────────────
  doc.rect(0, 0, PW, 82).fillColor(C.green).fill();
  doc.fillColor("white").font("Helvetica-Bold").fontSize(22)
     .text("AgroSense", M, 18);
  doc.font("Helvetica").fontSize(9.5)
     .text("Informe de Sensor", M, 44);
  doc.fontSize(7.5).fillColor("#A5D6A7")
     .text(`Generado: ${now}`, M, 60);

  let y = 102;

  // ── Info del sensor ────────────────────────────────────────────────────────
  doc.rect(M, y, CW, 52).fillColor(C.greenPale).fill();
  doc.rect(M, y, 4, 52).fillColor(C.greenMid).fill();
  doc.font("Helvetica-Bold").fontSize(12).fillColor(C.text)
     .text(sensor.name, M + 12, y + 8);
  doc.font("Helvetica").fontSize(8).fillColor(C.muted)
     .text(`Ubicación: ${sensor.location || "No especificada"}  ·  Dispositivo: ${sensor.device_id}`, M + 12, y + 26);
  doc.text(
    `Período: ${fmtDate(from)} — ${fmtDate(to)}  ·  ${readings.length} registros analizados`,
    M + 12, y + 38
  );
  y += 68;

  // ── Estadísticas ───────────────────────────────────────────────────────────
  const humVals  = readings.map(r => parseFloat(r.air_humidity)).filter(v => !isNaN(v));
  const tempVals = readings.map(r => parseFloat(r.temperature)).filter(v => !isNaN(v));
  const humStats  = calcStats(humVals);
  const tempStats = calcStats(tempVals);

  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.text)
     .text("Resumen estadístico", M, y);
  y += 14;

  const bw = (CW - 12) / 2;
  drawStatBox(doc, M,            y, bw, 68, "Humedad del aire", humStats,  "%",  C.humidity);
  drawStatBox(doc, M + bw + 12,  y, bw, 68, "Temperatura",      tempStats, "°C", C.temperature);
  y += 88;

  // ── Gráficas ───────────────────────────────────────────────────────────────
  if (readings.length >= 4) {
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.text)
       .text("Comportamiento en el tiempo", M, y);
    y += 14;

    const ch = 120;
    drawLineChart(doc, readings, "air_humidity", M + 42, y, CW - 42, ch, "Humedad del aire (%)", C.humidity, "%");
    y += ch + 20;
    drawLineChart(doc, readings, "temperature",  M + 42, y, CW - 42, ch, "Temperatura (°C)",     C.temperature, "°C");
    y += ch + 24;
  }

  // ── Análisis de comportamiento ─────────────────────────────────────────────
  if (y > PH - 130) { doc.addPage(); y = M; }

  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(C.text)
     .text("Análisis de comportamiento", M, y);
  y += 14;

  const obs = [
    `Humedad del aire: ${trend(humVals)}. Rango observado ${humStats.min.toFixed(1)}% – ${humStats.max.toFixed(1)}% (promedio ${humStats.avg}%).`,
    `Temperatura: ${trend(tempVals)}. Rango observado ${tempStats.min.toFixed(1)}°C – ${tempStats.max.toFixed(1)}°C (promedio ${tempStats.avg}°C).`,
  ];
  // Alertas generales por rangos — aplican a múltiples tipos de producción
  if (humStats.min  <  30) obs.push("⚠ Humedad del aire muy baja (< 30%). Puede afectar negativamente procesos biológicos sensibles a la humedad.");
  if (humStats.max  >  95) obs.push("⚠ Humedad del aire muy alta (> 95%). Riesgo de condensación, proliferación de patógenos y estrés en organismos.");
  if (tempStats.max >  40) obs.push("⚠ Temperatura alta (> 40°C) detectada. Puede generar estrés térmico o afectar ciclos biológicos del sistema.");
  if (tempStats.min <   5) obs.push("⚠ Temperatura baja (< 5°C) detectada. Riesgo de inhibición metabólica o daño en organismos sensibles.");

  doc.font("Helvetica").fontSize(8.5).fillColor(C.text);
  for (const line of obs) {
    if (y > PH - 60) { doc.addPage(); y = M; }
    const lh = doc.heightOfString(`• ${line}`, { width: CW - 8 }) + 5;
    doc.text(`• ${line}`, M + 8, y, { width: CW - 8 });
    y += lh;
  }
  y += 12;

  // ── Insights IA ────────────────────────────────────────────────────────────
  if (insights) {
    if (y > PH - 150) { doc.addPage(); y = M; }

    const boxH = doc.heightOfString(insights, { width: CW - 16 }) + 32;
    doc.rect(M, y, CW, 18).fillColor(C.greenMid).fill();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("white")
       .text("  Insights y recomendaciones — Análisis IA", M, y + 5);
    y += 18;

    doc.rect(M, y, CW, boxH - 18).fillColor(C.greenPale).fill();
    doc.rect(M, y, CW, boxH - 18).strokeColor(C.grid).lineWidth(0.5).stroke();
    doc.font("Helvetica").fontSize(8.5).fillColor(C.text)
       .text(insights, M + 8, y + 10, { width: CW - 16 });
    y += boxH;
  }

  // ── Pie de página ──────────────────────────────────────────────────────────
  const fy = PH - 26;
  doc.moveTo(M, fy - 6).lineTo(PW - M, fy - 6)
     .strokeColor(C.grid).lineWidth(0.5).stroke();
  doc.font("Helvetica").fontSize(7).fillColor(C.muted)
     .text("Informe generado automáticamente por AgroSense · Electroinova", M, fy, {
       width: CW, align: "center"
     });
}

// ── Ruta GET /:id/report ──────────────────────────────────────────────────────

router.get("/:id/report", requireAuth, async (req, res) => {
  try {
    const sensorId = parseInt(req.params.id);
    if (isNaN(sensorId)) return res.status(400).json({ error: "ID inválido" });

    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "Se requieren los parámetros 'from' y 'to' (YYYY-MM-DD)" });
    }

    const access = await checkSensorAccess(sensorId, req.user.id, "can_view_graphs");
    if (!access.authorized) {
      return res.status(403).json({ error: "Sin acceso a este sensor" });
    }

    const { rows: sRows } = await pool.query("SELECT * FROM sensors WHERE id = $1", [sensorId]);
    if (!sRows.length) return res.status(404).json({ error: "Sensor no encontrado" });
    const sensor = sRows[0];

    const { rows: readings } = await pool.query(
      `SELECT air_humidity, temperature, created_at
       FROM sensor_readings
       WHERE sensor_id = $1
         AND created_at >= $2::date
         AND created_at <  ($3::date + interval '1 day')
       ORDER BY created_at ASC
       LIMIT 2000`,
      [sensorId, from, to]
    );

    // Calcular stats para IA ANTES de abrir el stream del PDF
    const humVals  = readings.map(r => parseFloat(r.air_humidity)).filter(v => !isNaN(v));
    const tempVals = readings.map(r => parseFloat(r.temperature)).filter(v => !isNaN(v));
    const humStats  = { ...calcStats(humVals),  trend: trend(humVals) };
    const tempStats = { ...calcStats(tempVals), trend: trend(tempVals) };
    const insights  = await generateInsights(sensor, humStats, tempStats, from, to, readings.length);

    // Stream del PDF
    const safeName = sensor.name.replace(/[^a-zA-Z0-9_\-]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="informe_${safeName}_${from}_${to}.pdf"`
    );

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.pipe(res);
    buildPdf(doc, sensor, readings, from, to, insights);
    doc.end();

  } catch (err) {
    console.error("[REPORT]", err);
    if (!res.headersSent) res.status(500).json({ error: "Error generando el informe" });
  }
});

export default router;
