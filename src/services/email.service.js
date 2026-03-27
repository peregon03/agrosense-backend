import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function buildHtml(title, code, body) {
  return `
    <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px">
      <h2 style="color:#6750A4;margin-bottom:4px">${title}</h2>
      <p style="color:#444">${body}</p>
      <div style="background:#F3EDF7;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
        <span style="font-size:38px;font-weight:bold;letter-spacing:12px;color:#6750A4">${code}</span>
      </div>
      <p style="color:#999;font-size:12px">Este código vence en 15 minutos.<br>
      Si no solicitaste esto, ignora este mensaje.</p>
      <hr style="border:none;border-top:1px solid #eee;margin-top:20px">
      <p style="color:#bbb;font-size:11px;text-align:center">AgroSense — Electroinova</p>
    </div>`;
}

export async function sendVerificationEmail(to, code) {
  await transporter.sendMail({
    from: `"AgroSense" <${process.env.SMTP_USER}>`,
    to,
    subject: "Verifica tu correo — AgroSense",
    text: `Tu código de verificación es: ${code}. Vence en 15 minutos.`,
    html: buildHtml(
      "Verifica tu correo",
      code,
      "Ingresa este código en la aplicación para activar tu cuenta:"
    ),
  });
}

export async function sendPasswordResetEmail(to, code) {
  await transporter.sendMail({
    from: `"AgroSense" <${process.env.SMTP_USER}>`,
    to,
    subject: "Recuperación de contraseña — AgroSense",
    text: `Tu código de recuperación es: ${code}. Vence en 15 minutos.`,
    html: buildHtml(
      "Recuperar contraseña",
      code,
      "Ingresa este código en la aplicación para restablecer tu contraseña:"
    ),
  });
}
