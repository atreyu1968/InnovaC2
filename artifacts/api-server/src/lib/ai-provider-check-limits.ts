import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

type Identity = { userId: string; centerId: string };
type Admission =
  | { allowed: true; signal: AbortSignal; deadline: number; release: () => Promise<void> }
  | { allowed: false; retryAfterSeconds: number; message: string };

export class AIProviderCheckLimitsUnavailable extends Error {
  readonly status = 503;
  constructor() {
    super("No se pueden verificar los límites de IA. No se ha iniciado la comprobación. Inténtalo más tarde.");
  }
}

function denied(seconds: number, active: boolean): Admission {
  const retryAfterSeconds = Math.max(1, Math.ceil(seconds));
  return {
    allowed: false, retryAfterSeconds,
    message: active
      ? `Ya hay una comprobación de IA en curso para tu usuario o centro. Espera a que termine y al menos ${retryAfterSeconds} segundos antes de reintentarlo.`
      : `Se ha alcanzado el límite de comprobaciones de IA (una por usuario cada minuto y tres por centro cada cinco minutos). Espera ${retryAfterSeconds} segundos antes de reintentarlo.`,
  };
}

/**
 * PostgreSQL is the clock and the shared quota store. Session advisory locks on
 * BOTH identities stay pinned to a dedicated connection until all HTTP work ends.
 * A live lock never expires. After connection/process loss the durable reservation
 * quarantines the identities for 60s, longer than the 25s outgoing deadline.
 * No heartbeat/TTL alone can safely fence a paused but still live process.
 */
export class AIProviderCheckLimits {
  async acquire(identity: Identity): Promise<Admission> {
    const controller = new AbortController();
    // Start the outgoing deadline before any await; a paused admission cannot
    // resume after quarantine and dispatch new model calls.
    const deadline = Date.now() + 25_000;
    const timer = setTimeout(() => controller.abort(), 25_000);
    timer.unref();
    const connect = () => pool.connect();
    let client: Awaited<ReturnType<typeof connect>>;
    try { client = await pool.connect(); }
    catch { clearTimeout(timer); throw new AIProviderCheckLimitsUnavailable(); }
    const keys: string[] = [];
    let broken = false;
    let disposed = false;
    const onError = () => { broken = true; controller.abort(); };
    client.on("error", onError);
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      controller.abort();
      try {
        if (!broken) {
          for (const key of keys) {
            await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
          }
        }
      } catch { broken = true; }
      finally {
        client.release(broken);
        client.removeListener("error", onError);
      }
    };
    let inTransaction = false;
    try {
      for (const key of [
        `ai-provider-check:user:${identity.userId}`,
        `ai-provider-check:center:${identity.centerId}`,
      ].sort()) {
        const result = await client.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key],
        );
        if (!result.rows[0].locked) {
          await dispose();
          return denied(1, true);
        }
        keys.push(key);
      }
      await client.query("BEGIN");
      inTransaction = true;
      await client.query("SET LOCAL statement_timeout = '5s'");
      // Bounded retention; no settings, secrets, prompts or provider results.
      await client.query(`DELETE FROM ai_provider_check_usage
        WHERE started_at <= clock_timestamp() - interval '5 minutes'
          AND (reserved_until IS NULL OR reserved_until <= clock_timestamp())`);
      const result = await client.query(`
        WITH moment AS (SELECT clock_timestamp() AS now)
        SELECT
          COALESCE(max(EXTRACT(EPOCH FROM (reserved_until - moment.now)))
            FILTER (WHERE reserved_until > moment.now), 0) AS active_wait,
          COALESCE(max(EXTRACT(EPOCH FROM (started_at + interval '1 minute' - moment.now)))
            FILTER (WHERE user_id = $1 AND started_at > moment.now - interval '1 minute'), 0) AS user_wait,
          count(*) FILTER (WHERE center_id = $2 AND started_at > moment.now - interval '5 minutes') AS center_count,
          COALESCE(EXTRACT(EPOCH FROM (
            min(started_at) FILTER (WHERE center_id = $2 AND started_at > moment.now - interval '5 minutes')
            + interval '5 minutes' - (SELECT now FROM moment))), 0) AS center_wait
        FROM ai_provider_check_usage CROSS JOIN moment
        WHERE user_id = $1 OR center_id = $2`, [identity.userId, identity.centerId]);
      const row = result.rows[0];
      const wait = Math.max(Number(row.active_wait), Number(row.user_wait),
        Number(row.center_count) >= 3 ? Number(row.center_wait) : 0);
      if (wait > 0) {
        await client.query("COMMIT");
        inTransaction = false;
        await dispose();
        return denied(wait, Number(row.active_wait) > 0);
      }
      if (controller.signal.aborted || Date.now() >= deadline || broken) {
        throw new AIProviderCheckLimitsUnavailable();
      }
      const id = randomUUID();
      await client.query(`INSERT INTO ai_provider_check_usage
        (id, user_id, center_id, started_at, reserved_until)
        VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp() + interval '60 seconds')`,
      [id, identity.userId, identity.centerId]);
      await client.query("COMMIT");
      inTransaction = false;
      let released = false;
      return {
        allowed: true, signal: controller.signal, deadline,
        release: async () => {
          if (released) return;
          released = true;
          try {
            // Failed calls still count. A broken connection leaves quarantine in
            // place; do not reconnect merely to clear a possibly live reservation.
            if (!broken) {
              await client.query("UPDATE ai_provider_check_usage SET reserved_until = NULL WHERE id = $1", [id]);
            }
          } finally { await dispose(); }
        },
      };
    } catch {
      if (inTransaction && !broken) {
        try { await client.query("ROLLBACK"); } catch { broken = true; }
      }
      await dispose();
      throw new AIProviderCheckLimitsUnavailable();
    }
  }
}
