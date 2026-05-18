import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";

dotenv.config();

import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import shareRoutes from "./routes/shareRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import sensorRoutes from "./routes/sensorRoutes.js";
import ingestRoutes from "./routes/ingestRoutes.js";
import alertRoutes from "./routes/alertRoutes.js";
import pumpRoutes from "./routes/pumpRoutes.js";
import composRoutes from "./routes/compostaje.js";

import { errorHandler } from "./middleware/error.middleware.js";
import { apiLimiter, ingestLimiter } from "./middleware/rateLimiter.js";
import { testDb } from "./db.js";

const app = express();

// ── OWASP A05:2021 – Security Misconfiguration ────────────────────────────────
// Helmet configura cabeceras HTTP de seguridad automáticamente:
// Content-Security-Policy, X-Frame-Options, X-Content-Type-Options,
// Strict-Transport-Security (HSTS), Referrer-Policy, etc.
app.use(helmet());

// ── OWASP A02:2021 – Cryptographic Failures ───────────────────────────────────
// CORS restringido a orígenes conocidos; en producción se define ALLOWED_ORIGINS
// en variables de entorno. Wildcard (*) está prohibido cuando hay credenciales.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:8081"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Permite solicitudes sin origin (apps móviles nativas, Postman, ESP32)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origen no permitido — ${origin}`));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ── OWASP A09:2021 – Security Logging and Monitoring Failures ─────────────────
// Morgan registra cada solicitud HTTP con método, ruta, status y tiempo de respuesta.
app.use(morgan("[:date[iso]] :method :url :status :res[content-length] - :response-time ms"));

// ── OWASP A03:2021 – Injection ────────────────────────────────────────────────
// Limita el tamaño del cuerpo JSON para prevenir ataques de payload masivo.
app.use(express.json({ limit: "50kb" }));

// ── OWASP A04:2021 – Insecure Design ─────────────────────────────────────────
// Rate limiting general aplicado a todos los endpoints de API autenticados.
app.use("/api/sensors",    apiLimiter);
app.use("/api/users",      apiLimiter);
app.use("/api/alerts",     apiLimiter);
app.use("/api/compostaje", apiLimiter);
// Rate limiting específico para ingesta de dispositivos ESP32.
app.use("/api/ingest",     ingestLimiter);

// ─────────────────────────────────────────────────────────────────────────────

app.get("/health", async (req, res, next) => {
  try {
    const now = await testDb();
    res.json({ ok: true, db_time: now });
  } catch (e) {
    next(e);
  }
});

app.get("/", (req, res) => {
  res.send("AgroSense Backend OK. Usa /health");
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/sensors", shareRoutes);
app.use("/api/sensors", reportRoutes);
app.use("/api/sensors", sensorRoutes);
app.use("/api/sensors", pumpRoutes);
app.use("/api/ingest", ingestRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/compostaje", composRoutes);

app.use(errorHandler);

const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
});
