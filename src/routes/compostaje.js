import express from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { pool } from "../db.js";

const router = express.Router();

// POST /api/compostaje/medidas — registrar nueva medida
router.post("/medidas", requireAuth, async (req, res, next) => {
  try {
    const { modulo, lote_tipo, lote_proveedor } = req.body;

    if (modulo == null || !lote_tipo || lote_proveedor == null)
      return res.status(400).json({ message: "Módulo, lote tipo y lote proveedor son requeridos" });
    if (!["A", "B"].includes(lote_tipo))
      return res.status(400).json({ message: "Lote tipo debe ser A o B" });
    if (!Number.isInteger(Number(modulo)) || Number(modulo) <= 0)
      return res.status(400).json({ message: "Módulo debe ser un número entero positivo" });
    if (!Number.isInteger(Number(lote_proveedor)) || Number(lote_proveedor) <= 0)
      return res.status(400).json({ message: "Lote proveedor debe ser un número entero positivo" });

    const { rows } = await pool.query(
      `INSERT INTO medidas_compostaje (user_id, modulo, lote_tipo, lote_proveedor)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, modulo, lote_tipo, lote_proveedor]
    );

    res.status(201).json({ message: "Medida registrada", medida: rows[0] });
  } catch (e) {
    next(e);
  }
});

// GET /api/compostaje/medidas — listar medidas del usuario
router.get("/medidas", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM medidas_compostaje
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ medidas: rows });
  } catch (e) {
    next(e);
  }
});

export default router;
