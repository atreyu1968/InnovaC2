type PasswordResetEmail = {
  to: string;
  resetUrl: string;
};

type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  purpose: "password reset" | "password change notification";
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function sendTransactionalEmail({
  to,
  subject,
  text,
  html,
  purpose,
}: TransactionalEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error(`Resend ${purpose} email is not configured.`);
  }

  const endpoint =
    process.env.NODE_ENV === "test" && process.env.RESEND_API_BASE_URL
      ? process.env.RESEND_API_BASE_URL
      : "https://api.resend.com/emails";
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
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend rejected the ${purpose} email (${response.status}).`);
  }
}

export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: PasswordResetEmail): Promise<void> {
  const safeUrl = escapeHtml(resetUrl);
  await sendTransactionalEmail({
    to,
    subject: "Restablece tu contraseña de INNOVA-C2",
    text: [
      "Has solicitado restablecer tu contraseña de INNOVA-C2.",
      `Usa este enlace en los próximos 30 minutos: ${resetUrl}`,
      "Si no solicitaste este cambio, puedes ignorar este correo.",
    ].join("\n\n"),
    html: `<p>Has solicitado restablecer tu contraseña de INNOVA-C2.</p><p><a href="${safeUrl}">Establecer una contraseña nueva</a></p><p>El enlace caduca en 30 minutos y solo se puede usar una vez.</p><p>Si no solicitaste este cambio, puedes ignorar este correo.</p>`,
    purpose: "password reset",
  });
}

export async function sendPasswordChangeNoticeEmail(to: string): Promise<void> {
  const message =
    "La contraseña de tu cuenta de INNOVA-C2 se ha cambiado. Si no realizaste este cambio, ponte en contacto con el administrador de tu organización.";
  await sendTransactionalEmail({
    to,
    subject: "Se cambió la contraseña de tu cuenta de INNOVA-C2",
    text: message,
    html: `<p>${message}</p>`,
    purpose: "password change notification",
  });
}
