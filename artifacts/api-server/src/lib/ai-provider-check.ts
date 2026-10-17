import type { AIProviderConfig } from "./ai-provider";
import { AIHttpError, requestAIJson } from "./ai-http";

/** One second of synthetic 440 Hz PCM. Never reads an upload or a meeting. */
function syntheticAudio(): Blob {
  const samples = 16_000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(samples, 24);
  wav.writeUInt32LE(samples * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(2000 * Math.sin(2 * Math.PI * 440 * i / samples)), 44 + i * 2);
  return new Blob([new Uint8Array(wav)], { type: "audio/wav" });
}

function failure(error: unknown) {
  const kind = error instanceof AIHttpError ? error.kind : "connection";
  const messages = {
    authorization: "El proveedor rechazó la autenticación o los permisos. Revisa la credencial guardada.",
    model: "El proveedor rechazó el modelo, la ruta o los parámetros. Revisa los nombres y la compatibilidad OpenAI del endpoint.",
    format: "El proveedor respondió, pero el formato no es compatible con la aplicación.",
    connection: "No se pudo conectar con el endpoint permitido dentro del plazo de comprobación.",
    provider: "El proveedor no completó la solicitud. Revisa su disponibilidad, límites o cuota.",
  };
  const statuses = {
    authorization: "authorization_error", model: "model_error", format: "format_error",
    connection: "connection_error", provider: "provider_error",
  } as const;
  return { status: statuses[kind], message: messages[kind] };
}

export async function checkAIProvider(config: AIProviderConfig) {
  const transcription = (async () => {
    try {
      const form = new FormData();
      form.set("model", config.transcriptionModel);
      form.set("language", "es");
      form.set("file", syntheticAudio(), "comprobacion-sintetica.wav");
      const result = await requestAIJson(config, "audio/transcriptions", form, 20_000);
      // Silence/tones may legitimately yield an empty transcript.
      if (!result || typeof result !== "object" || typeof (result as { text?: unknown }).text !== "string") {
        throw new AIHttpError("format");
      }
      return { status: "ok" as const, message: "Conexión y acceso al modelo de transcripción correctos; respuesta compatible. No se ha evaluado la precisión." };
    } catch (error) { return failure(error); }
  })();
  const minutes = (async () => {
    try {
      const result = await requestAIJson(config, "chat/completions", JSON.stringify({
        model: config.minutesModel,
        temperature: 0.2,
        messages: [{ role: "user", content: "Prueba técnica con datos ficticios, no es una reunión real: resume en una frase que un equipo imaginario acordó revisar un documento de ejemplo." }],
      }), 20_000);
      const content = (result as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new AIHttpError("format");
      return { status: "ok" as const, message: "Conexión y acceso al modelo de redacción correctos; respuesta compatible. No se ha evaluado la calidad." };
    } catch (error) { return failure(error); }
  })();
  return {
    revision: config.revision,
    checkedAt: new Date().toISOString(),
    transcription: await transcription,
    minutes: await minutes,
    qualityAssessed: false as const,
  };
}
