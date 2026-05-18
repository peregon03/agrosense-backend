/**
 * OWASP A07:2021 – Identification and Authentication Failures
 *
 * Contraseña segura: mínimo 8 caracteres, al menos una mayúscula,
 * una minúscula y un dígito. Esto se aplica solo al registro;
 * el login acepta cualquier formato para no bloquear cuentas existentes.
 */

import { z } from "zod";

const strongPassword = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(100)
  .regex(/[A-Z]/, "Debe contener al menos una letra mayúscula")
  .regex(/[a-z]/, "Debe contener al menos una letra minúscula")
  .regex(/[0-9]/, "Debe contener al menos un número");

export const registerSchema = z.object({
  first_name: z.string().min(1).max(80),
  last_name:  z.string().min(1).max(80),
  email:      z.string().email().max(120),
  password:   strongPassword,
});

export const loginSchema = z.object({
  email:    z.string().email().max(120),
  password: z.string().min(1).max(100),
});
