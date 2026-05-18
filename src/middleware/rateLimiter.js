/**
 * OWASP A04:2021 – Insecure Design
 * OWASP A07:2021 – Identification and Authentication Failures
 *
 * Rate limiting para prevenir ataques de fuerza bruta y abuso de API.
 */

import rateLimit from "express-rate-limit";

const rateLimitResponse = (req, res) => {
  res.status(429).json({
    message: "Demasiadas solicitudes. Intenta de nuevo más tarde.",
  });
};

/**
 * Límite estricto para endpoints de autenticación (login, registro, reset).
 * 10 intentos por IP cada 15 minutos.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitResponse,
  skipSuccessfulRequests: false,
});

/**
 * Límite para reenvío de código OTP.
 * 5 intentos por IP cada 15 minutos.
 */
export const resendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitResponse,
});

/**
 * Límite general para la API (endpoints autenticados).
 * 300 solicitudes por IP cada 15 minutos.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitResponse,
});

/**
 * Límite para ingesta de datos de dispositivos ESP32.
 * 120 solicitudes por IP por minuto (1 lectura cada 30 s = 2/min, con margen amplio).
 */
export const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitResponse,
});
