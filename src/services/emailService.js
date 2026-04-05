import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST || "smtp.gmail.com",
  port:   parseInt(process.env.EMAIL_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const METRIC_LABEL = {
  temperature:   "Temperatura",
  air_humidity:  "Humedad del aire",
  soil_humidity: "Humedad del suelo",
};

/**
 * Envía un email de alerta al usuario.
 * Si EMAIL_USER / EMAIL_PASS no están configurados en .env, no hace nada.
 */
export async function sendAlertEmail({ to, sensorName, metric, value, threshold, direction }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;

  const label    = METRIC_LABEL[metric] ?? metric;
  const unit     = metric === "temperature" ? "°C" : "%";
  const dirLabel = direction === "above" ? "superó el máximo" : "bajó del mínimo";

  await transporter.sendMail({
    from:    `"AgroSense" <${process.env.EMAIL_USER}>`,
    to,
    subject: `⚠️ Alerta AgroSense — ${sensorName}`,
    text:    `${label} del sensor "${sensorName}" ${dirLabel}.\nValor: ${value}${unit} | Límite: ${threshold}${unit}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #eee;border-radius:8px">
        <h2 style="color:#e53935;margin-top:0">⚠️ Alerta AgroSense</h2>
        <p style="font-size:16px"><b>${sensorName}</b></p>
        <p>${label} <b>${dirLabel}</b></p>
        <table style="border-collapse:collapse;width:100%">
          <tr>
            <td style="padding:6px 12px;background:#fff3e0">Valor medido</td>
            <td style="padding:6px 12px;background:#fff3e0;font-weight:bold">${value}${unit}</td>
          </tr>
          <tr>
            <td style="padding:6px 12px">Límite configurado</td>
            <td style="padding:6px 12px;font-weight:bold">${threshold}${unit}</td>
          </tr>
        </table>
        <p style="color:#9e9e9e;font-size:12px;margin-top:24px">AgroSense — Sistema de monitoreo agrícola</p>
      </div>
    `,
  });
}
