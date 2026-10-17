type Usage = { starts: number[]; active: boolean };
type Identity = { userId: string; centerId: string };
type Admission =
  | { allowed: true; release: () => void }
  | { allowed: false; retryAfterSeconds: number; message: string };

const USER_WINDOW_MS = 60_000;
const CENTER_WINDOW_MS = 5 * 60_000;
const CENTER_MAX_CHECKS = 3;

/**
 * Process-wide, not session-wide: one diagnostic per user/minute and three per
 * center/five minutes, with no overlapping diagnostics for either identity.
 * A diagnostic includes both model calls, even if the provider rejects them.
 * State is intentionally ephemeral; multiple API replicas need a shared store.
 */
export class AIProviderCheckLimits {
  private readonly users = new Map<string, Usage>();
  private readonly centers = new Map<string, Usage>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  acquire(identity: Identity): Admission {
    const now = this.now();
    this.prune(this.users, USER_WINDOW_MS, now);
    this.prune(this.centers, CENTER_WINDOW_MS, now);
    const user = this.users.get(identity.userId) ?? { starts: [], active: false };
    const center = this.centers.get(identity.centerId) ?? { starts: [], active: false };
    const userWait = user.starts.length ? user.starts[0] + USER_WINDOW_MS - now : 0;
    const centerWait = center.starts.length >= CENTER_MAX_CHECKS
      ? center.starts[0] + CENTER_WINDOW_MS - now : 0;
    const retryAfterSeconds = Math.max(1, Math.ceil(Math.max(userWait, centerWait) / 1000));

    if (user.active || center.active) {
      return {
        allowed: false,
        retryAfterSeconds,
        message: `Ya hay una comprobación de IA en curso para tu usuario o centro. Espera a que termine y al menos ${retryAfterSeconds} segundos antes de reintentarlo.`,
      };
    }
    if (userWait > 0 || centerWait > 0) {
      return {
        allowed: false,
        retryAfterSeconds,
        message: `Se ha alcanzado el límite de comprobaciones de IA (una por usuario cada minuto y tres por centro cada cinco minutos). Espera ${retryAfterSeconds} segundos antes de reintentarlo.`,
      };
    }

    // Synchronous reservation: no await between inspecting and marking both keys.
    user.starts.push(now);
    center.starts.push(now);
    user.active = center.active = true;
    this.users.set(identity.userId, user);
    this.centers.set(identity.centerId, center);
    return {
      allowed: true,
      release: () => { user.active = center.active = false; },
    };
  }

  private prune(entries: Map<string, Usage>, windowMs: number, now: number): void {
    for (const [key, usage] of entries) {
      usage.starts = usage.starts.filter(start => start + windowMs > now);
      // Never expire a live reservation, even if a request outlasts its window.
      if (!usage.active && usage.starts.length === 0) entries.delete(key);
    }
  }
}
