type PasswordResetEmail = {
  to: string;
  resetUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: PasswordResetEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Resend password reset email is not configured.");
  }

  const endpoint =
    process.env.NODE_ENV === "test" && process.env.RESEND_API_BASE_URL
      ? process.env.RESEND_API_BASE_URL
      : "https://api.resend.com/emails";
  const safeUrl = escapeHtml(resetUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Restablece tu contraseña de INNOVA-C2",
      text: [
        "Has solicitado restablecer tu contraseña de INNOVA-C2.",
        `Usa este enlace en los próximos 30 minutos: ${resetUrl}`,
        "Si no solicitaste este cambio, puedes ignorar este correo.",
      ].join("\n\n"),
      html: `<p>Has solicitado restablecer tu contraseña de INNOVA-C2.</p><p><a href="${safeUrl}">Establecer una contraseña nueva</a></p><p>El enlace caduca en 30 minutos y solo se puede usar una vez.</p><p>Si no solicitaste este cambio, puedes ignorar este correo.</p>`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend rejected the password reset email (${response.status}).`);
  }
}
