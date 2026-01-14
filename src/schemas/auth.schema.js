import { z } from "zod";

export const registerSchema = z.object({
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  email: z.string().email().max(120),
  password: z.string().min(6).max(100),
});

export const loginSchema = z.object({
  email: z.string().email().max(120),
  password: z.string().min(6).max(100),
});
