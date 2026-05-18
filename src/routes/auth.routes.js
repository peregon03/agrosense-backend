/**
 * OWASP A07:2021 – Identification and Authentication Failures
 * OWASP A04:2021 – Insecure Design
 *
 * Rate limiting específico por endpoint de autenticación para prevenir
 * ataques de fuerza bruta, credential stuffing y abuso de OTP.
 */

import { Router } from "express";
import {
  login,
  register,
  verifyEmail,
  forgotPassword,
  resetPassword,
  resendCode,
} from "../controllers/auth.controller.js";
import { authLimiter, resendCodeLimiter } from "../middleware/rateLimiter.js";

const router = Router();

router.post("/register",        authLimiter,        register);
router.post("/login",           authLimiter,        login);
router.post("/verify-email",    authLimiter,        verifyEmail);
router.post("/forgot-password", authLimiter,        forgotPassword);
router.post("/reset-password",  authLimiter,        resetPassword);
router.post("/resend-code",     resendCodeLimiter,  resendCode);

export default router;
