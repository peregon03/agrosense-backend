# Implementación de Seguridad OWASP Top 10 (2021)
## AgroSense Backend — Node.js / Express

---

## Índice

1. [A01 — Broken Access Control](#a01--broken-access-control)
2. [A02 — Cryptographic Failures](#a02--cryptographic-failures)
3. [A03 — Injection](#a03--injection)
4. [A04 — Insecure Design](#a04--insecure-design)
5. [A05 — Security Misconfiguration](#a05--security-misconfiguration)
6. [A06 — Vulnerable and Outdated Components](#a06--vulnerable-and-outdated-components)
7. [A07 — Identification and Authentication Failures](#a07--identification-and-authentication-failures)
8. [A08 — Software and Data Integrity Failures](#a08--software-and-data-integrity-failures)
9. [A09 — Security Logging and Monitoring Failures](#a09--security-logging-and-monitoring-failures)
10. [A10 — Server-Side Request Forgery (SSRF)](#a10--server-side-request-forgery-ssrf)
11. [Variables de entorno requeridas](#variables-de-entorno-requeridas)
12. [Dependencias de seguridad añadidas](#dependencias-de-seguridad-añadidas)

---

## A01 — Broken Access Control

### Descripción
El control de acceso deficiente permite a usuarios no autorizados acceder a recursos o funciones restringidas.

### Vulnerabilidad identificada: Enumeración de usuarios
El endpoint `POST /api/auth/forgot-password` retornaba un código `404` cuando el correo no estaba registrado, lo que permitía a un atacante determinar qué correos electrónicos tienen cuenta en el sistema.

### Corrección aplicada
**Archivo:** `src/controllers/auth.controller.js`

```js
// ANTES — revelaba si el correo existía o no
if (result.rows.length === 0) {
  return res.status(404).json({ message: "No existe una cuenta con ese correo" });
}

// DESPUÉS — respuesta genérica siempre (anti user-enumeration)
if (result.rows.length === 0) {
  return res.json({ email: normalizedEmail });
}
```

### Controles existentes mantenidos
- Verificación de propiedad en todos los endpoints de sensores (`WHERE user_id = $1`)
- Middleware `checkSensorAccess` para sensores compartidos (`can_view_graphs`, `can_control_pump`)
- JWT requerido en todos los endpoints autenticados mediante `requireAuth`

---

## A02 — Cryptographic Failures

### Descripción
Exposición de datos sensibles por fallo en el uso de criptografía o ausencia de ella.

### Corrección aplicada: CORS restringido
**Archivo:** `src/server.js`

La configuración anterior `app.use(cors())` permitía solicitudes desde cualquier origen (`*`), lo que combinado con `credentials: true` representa un riesgo de exposición de tokens.

```js
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:8081"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Permite requests sin Origin (apps móviles nativas, ESP32)
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
```

### Controles existentes mantenidos
- Contraseñas hasheadas con `bcryptjs` (salt rounds: 10)
- Autenticación por JWT firmado con `JWT_SECRET` desde variables de entorno
- API keys de sensores generadas con `crypto.randomBytes(24)` (192 bits de entropía)
- Tokens OTP de 6 dígitos con expiración de 15 minutos

---

## A03 — Injection

### Descripción
Datos no confiables enviados como parte de un comando o consulta, permitiendo inyección SQL, NoSQL, OS, etc.

### Corrección aplicada: Límite de tamaño de payload
**Archivo:** `src/server.js`

```js
// Limita el body a 50 KB para prevenir ataques de payload masivo
app.use(express.json({ limit: "50kb" }));
```

### Controles existentes mantenidos
Todas las consultas a PostgreSQL usan **parámetros posicionales** (`$1, $2, ...`), eliminando por completo el riesgo de SQL injection:

```js
// Ejemplo en auth.controller.js
pool.query("SELECT id FROM users WHERE email = $1", [email]);

// Ejemplo en ingestRoutes.js
pool.query("SELECT s.id FROM sensors s WHERE s.device_id=$1 AND s.api_key=$2", [device_id, api_key]);
```

Validación de esquemas con **Zod** en todos los endpoints de entrada:
- `registerSchema`, `loginSchema` — auth
- `ingestSchema` — ingesta de datos ESP32
- `createSensorSchema`, `thresholdSchema` — gestión de sensores

---

## A04 — Insecure Design

### Descripción
Ausencia de controles de diseño que prevengan el abuso de flujos legítimos, como ataques de fuerza bruta.

### Corrección aplicada: Rate Limiting por niveles
**Archivo nuevo:** `src/middleware/rateLimiter.js`

Se definen cuatro niveles de límite según la criticidad del endpoint:

| Limitador | Límite | Ventana | Endpoints |
|-----------|--------|---------|-----------|
| `authLimiter` | 10 req/IP | 15 min | login, register, verify-email, forgot-password, reset-password |
| `resendCodeLimiter` | 5 req/IP | 15 min | resend-code |
| `apiLimiter` | 300 req/IP | 15 min | /api/sensors, /api/users, /api/alerts, /api/compostaje |
| `ingestLimiter` | 120 req/IP | 1 min | /api/ingest (dispositivos ESP32) |

```js
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ message: "Demasiadas solicitudes. Intenta de nuevo más tarde." }),
});
```

**Archivo:** `src/routes/auth.routes.js` — aplicación del rate limiter por ruta:

```js
router.post("/login",           authLimiter,       login);
router.post("/register",        authLimiter,       register);
router.post("/forgot-password", authLimiter,       forgotPassword);
router.post("/reset-password",  authLimiter,       resetPassword);
router.post("/verify-email",    authLimiter,       verifyEmail);
router.post("/resend-code",     resendCodeLimiter, resendCode);
```

### Controles existentes mantenidos
- Cooldown de 1 minuto entre reenvíos de OTP (capa adicional en BD)
- Anti-spam en alertas: no se repite la misma alerta dentro de 30 minutos
- Expiración automática de sesión de bomba de agua tras 2 minutos

---

## A05 — Security Misconfiguration

### Descripción
Configuraciones inseguras por defecto, incompletas o mal aplicadas en cualquier nivel del stack.

### Corrección aplicada: Helmet — cabeceras HTTP de seguridad
**Archivo:** `src/server.js`

```js
import helmet from "helmet";
app.use(helmet());
```

Helmet configura automáticamente las siguientes cabeceras de respuesta:

| Cabecera | Protección |
|----------|-----------|
| `Content-Security-Policy` | Previene XSS y carga de recursos no autorizados |
| `X-Frame-Options: DENY` | Previene clickjacking |
| `X-Content-Type-Options: nosniff` | Previene MIME-type sniffing |
| `Strict-Transport-Security` | Fuerza HTTPS (HSTS) |
| `Referrer-Policy` | Controla información en el header Referer |
| `X-DNS-Prefetch-Control` | Controla prefetching de DNS |
| `X-Download-Options` | Previene descarga automática en IE |
| `X-Permitted-Cross-Domain-Policies` | Restringe políticas cross-domain |

### Corrección aplicada: Error handler sin exposición de detalles en producción
**Archivo:** `src/middleware/error.middleware.js`

```js
export function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV !== "production";
  console.error("❌ Server error:", err);

  const statusCode = err.status || err.statusCode || 500;
  return res.status(statusCode).json({
    // En producción: solo "Internal server error"
    // En desarrollo: mensaje completo + stack trace
    message: isDev ? (err.message || "Internal server error") : "Internal server error",
    ...(isDev && err.stack ? { stack: err.stack } : {}),
  });
}
```

---

## A06 — Vulnerable and Outdated Components

### Descripción
Uso de componentes con vulnerabilidades conocidas o sin soporte activo.

### Estado del proyecto
Las dependencias directas están en versiones recientes y mantenidas activamente:

| Paquete | Versión | Estado |
|---------|---------|--------|
| `express` | ^5.2.1 | Activo |
| `bcryptjs` | ^3.0.3 | Activo |
| `jsonwebtoken` | ^9.0.3 | Activo |
| `zod` | ^4.3.5 | Activo |
| `helmet` | ^8.1.0 | Activo |
| `express-rate-limit` | ^7.5.1 | Activo |

### Vulnerabilidades auditadas (npm audit)
Las 6 vulnerabilidades detectadas por `npm audit` corresponden a sub-dependencias transitivas de `nodemon` (devDependency — no se ejecuta en producción) y versiones internas de express ya contempladas en su roadmap de parches. Ninguna afecta directamente el código de la aplicación en producción.

---

## A07 — Identification and Authentication Failures

### Descripción
Debilidades en los mecanismos de autenticación que permiten comprometer contraseñas, tokens o sesiones.

### Corrección aplicada: Política de contraseña segura
**Archivo:** `src/schemas/auth.schema.js`

```js
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
  password:   strongPassword,   // política fuerte solo en registro
});

export const loginSchema = z.object({
  email:    z.string().email().max(120),
  password: z.string().min(1).max(100),  // login no bloquea cuentas existentes
});
```

### Controles existentes mantenidos
- Tokens JWT con expiración configurable (`JWT_EXPIRES_IN`, default `7d`)
- Tokens OTP de verificación/reset con expiración de 15 minutos
- Invalidación de tokens OTP anteriores al generar uno nuevo
- Respuesta idéntica ante credenciales incorrectas (`Invalid credentials`) sin revelar si el email existe
- Email de verificación obligatorio antes del primer login

---

## A08 — Software and Data Integrity Failures

### Descripción
Código o infraestructura que no protege contra violaciones de integridad (actualizaciones sin firma, deserialización insegura).

### Estado del proyecto
- No se utiliza deserialización de objetos arbitrarios
- No se ejecutan pipelines CI/CD automáticos sin revisión
- Las API keys de sensores se generan server-side con `crypto.randomBytes` y nunca se aceptan definidas por el cliente

---

## A09 — Security Logging and Monitoring Failures

### Descripción
Ausencia de registros de seguridad que impide detectar brechas y responder a incidentes.

### Corrección aplicada: HTTP request logging con Morgan
**Archivo:** `src/server.js`

```js
import morgan from "morgan";

app.use(morgan("[:date[iso]] :method :url :status :res[content-length] - :response-time ms"));
```

Ejemplo de salida en consola:
```
[2026-05-18T14:32:01.123Z] POST /api/auth/login 401 45 - 12.34 ms
[2026-05-18T14:32:15.456Z] GET /api/sensors 200 1842 - 8.21 ms
[2026-05-18T14:33:00.789Z] POST /api/ingest 201 15 - 5.67 ms
```

### Controles existentes mantenidos
- Tabla `sensor_action_logs` con historial de acciones por sensor
- Endpoint `GET /api/sensors/:id/logs` para auditoria por propietario
- Logging de errores de servidor en `errorHandler`
- Logging de errores de envío de emails en auth controller

---

## A10 — Server-Side Request Forgery (SSRF)

### Descripción
El servidor realiza solicitudes a destinos controlados por el atacante.

### Estado del proyecto
No aplica. El backend de AgroSense no realiza solicitudes HTTP salientes a URLs proporcionadas por el usuario. Las únicas salidas son:
- Envío de emails via SMTP (destino fijo en variables de entorno)
- Consultas a PostgreSQL (conexión fija en `DATABASE_URL`)

---

## Variables de entorno requeridas

```env
# Servidor
NODE_ENV=production
PORT=3000

# Base de datos
DATABASE_URL=postgres://user:pass@host:5432/agrosense

# Autenticación
JWT_SECRET=<secreto-de-al-menos-32-caracteres>
JWT_EXPIRES_IN=7d

# CORS — orígenes permitidos (separados por coma)
ALLOWED_ORIGINS=https://tu-dominio.com

# Email (SMTP)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=<contraseña-smtp>
```

---

## Dependencias de seguridad añadidas

| Paquete | Versión | Propósito | OWASP |
|---------|---------|-----------|-------|
| `helmet` | ^8.1.0 | Cabeceras HTTP de seguridad | A05 |
| `express-rate-limit` | ^7.5.1 | Rate limiting por IP | A04, A07 |
| `morgan` | ^1.10.1 | Logging de requests HTTP | A09 |

```bash
npm install helmet express-rate-limit morgan
```

---

*Documentación generada para AgroSense — Electroinova*
*Fecha: Mayo 2026*
