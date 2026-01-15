import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import sensorRoutes from "./routes/sensorRoutes.js";
import ingestRoutes from "./routes/ingestRoutes.js";

import { errorHandler } from "./middleware/error.middleware.js";
import { testDb } from "./db.js";

const app = express();

app.use(cors());
app.use(express.json());

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
app.use("/api/sensors", sensorRoutes);
app.use("/api/ingest", ingestRoutes);


app.use(errorHandler);

const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
