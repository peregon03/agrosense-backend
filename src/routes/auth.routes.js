import { Router } from "express";
import {
  login,
  register,
  verifyEmail,
  forgotPassword,
  resetPassword,
  resendCode,
} from "../controllers/auth.controller.js";

const router = Router();

router.post("/register",        register);
router.post("/login",           login);
router.post("/verify-email",    verifyEmail);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password",  resetPassword);
router.post("/resend-code",     resendCode);

export default router;
