/**
 * OWASP A05:2021 – Security Misconfiguration
 *
 * El manejador de errores centralizado no expone stack traces ni detalles
 * internos al cliente en producción. El detalle completo se registra
 * solo en el log del servidor.
 */

export function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV !== "production";

  // Siempre loguear el error completo en el servidor (para monitoreo A09)
  console.error("❌ Server error:", err);

  // Errores de CORS generados en server.js
  if (err.message && err.message.startsWith("CORS:")) {
    return res.status(403).json({ message: err.message });
  }

  const statusCode = err.status || err.statusCode || 500;

  return res.status(statusCode).json({
    message: isDev ? (err.message || "Internal server error") : "Internal server error",
    ...(isDev && err.stack ? { stack: err.stack } : {}),
  });
}
