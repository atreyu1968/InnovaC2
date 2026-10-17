import { AIProviderCheckLimits } from "../../artifacts/api-server/src/lib/ai-provider-check-limits";
import { checkAIProvider } from "../../artifacts/api-server/src/lib/ai-provider-check";
import { pool } from "@workspace/db";

const limits = new AIProviderCheckLimits();
const reservations = new Map<string, Extract<Awaited<ReturnType<typeof limits.acquire>>, { allowed: true }>>();
process.on("message", async (message: {
  id: string; command: string; userId: string; centerId: string; reservation: string; baseUrl: string;
}) => {
  const reply = (result: unknown) => process.send?.({ id: message.id, result });
  try {
    if (message.command === "release") {
      await reservations.get(message.reservation)?.release();
      reservations.delete(message.reservation);
      reply({ released: true });
      return;
    }
    const admission = await limits.acquire(message);
    if (!admission.allowed) { reply(admission); return; }
    if (message.command === "hold") {
      reservations.set(message.id, admission);
      reply({ allowed: true, reservation: message.id });
      return;
    }
    let result;
    try {
      result = await checkAIProvider({
        mode: "local", baseUrl: message.baseUrl, apiKey: "synthetic-only",
        transcriptionModel: "fake-audio", minutesModel: "fake-minutes", revision: 1,
      }, admission);
    } finally { await admission.release(); }
    reply({ allowed: true, diagnostic: result });
  } catch (error) {
    reply({ error: (error as Error).message, status: (error as { status?: number }).status });
  }
});
process.on("disconnect", () => { void pool.end().finally(() => process.exit()); });
process.send?.({ ready: true });
