// Test-only deterministic adapter for the router/HTTP suite. Shared PostgreSQL
// admission is exercised by test-ai-provider-check-shared.mjs, never this fake.
type Usage = { starts: number[]; active: boolean };
export class AIProviderCheckLimitsUnavailable extends Error {}
export class AIProviderCheckLimits {
  private users = new Map<string, Usage>();
  private centers = new Map<string, Usage>();
  async acquire(identity: { userId: string; centerId: string }) {
    const now = Date.now();
    for (const [entries, window] of [[this.users, 60_000], [this.centers, 300_000]] as const) {
      for (const [key, usage] of entries) {
        usage.starts = usage.starts.filter(start => start + window > now);
        if (!usage.active && !usage.starts.length) entries.delete(key);
      }
    }
    const user = this.users.get(identity.userId) ?? { starts: [], active: false };
    const center = this.centers.get(identity.centerId) ?? { starts: [], active: false };
    const wait = Math.max(user.starts.length ? user.starts[0]! + 60_000 - now : 0,
      center.starts.length >= 3 ? center.starts[0]! + 300_000 - now : 0);
    const active = user.active || center.active;
    if (active || wait > 0) {
      const retryAfterSeconds = Math.max(1, Math.ceil(wait / 1000));
      return { allowed: false as const, retryAfterSeconds,
        message: `${active ? "Ya hay una comprobación en curso." : "Límite alcanzado."} Espera ${retryAfterSeconds} segundos.` };
    }
    user.starts.push(now);
    center.starts.push(now);
    user.active = center.active = true;
    this.users.set(identity.userId, user);
    this.centers.set(identity.centerId, center);
    return { allowed: true as const, signal: new AbortController().signal, deadline: Infinity,
      release: async () => { user.active = center.active = false; } };
  }
}
