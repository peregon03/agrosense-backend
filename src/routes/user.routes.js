import { Router } from "express";
import { me, updateProfile, changePassword } from "../controllers/user.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/me",           requireAuth, me);
router.put("/me",           requireAuth, updateProfile);
router.put("/me/password",  requireAuth, changePassword);

export default router;
