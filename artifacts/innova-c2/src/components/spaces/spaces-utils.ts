export const CANARY_TZ = 'Atlantic/Canary';

const partsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: CANARY_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function canaryParts(date: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}

/** ISO → "YYYY-MM-DDTHH:mm" in Canary local time (for datetime-local inputs). */
export function isoToCanaryInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = canaryParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}

/** "YYYY-MM-DDTHH:mm" interpreted as Canary local time → ISO UTC. */
export function canaryInputToIso(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = canaryParts(new Date(guess));
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess += asUtc - shown;
  }
  const iso = new Date(guess).toISOString();
  // Reject nonexistent local times at the spring DST jump instead of silently shifting the booking.
  return isoToCanaryInput(iso) === value ? iso : null;
}

/** Canary calendar day key YYYY-MM-DD for an ISO instant. */
export function canaryDayKey(iso: string) {
  return isoToCanaryInput(iso).slice(0, 10);
}

export function formatCanary(iso: string, opts: Intl.DateTimeFormatOptions) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Fecha no válida';
  return new Intl.DateTimeFormat('es-ES', { timeZone: CANARY_TZ, ...opts }).format(d);
}

export function formatRange(startsAt: string, endsAt: string) {
  const sameDay = canaryDayKey(startsAt) === canaryDayKey(endsAt);
  const start = formatCanary(startsAt, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const end = formatCanary(endsAt, sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${start} – ${end}`;
}

/** "2025-2026" → course bounds Sep 1 / Aug 31 as Canary day keys. */
export function courseBounds(label: string) {
  const m = /^(\d{4})-(\d{4})$/.exec(label);
  if (!m) return null;
  return { min: `${m[1]}-09-01`, max: `${m[2]}-08-31` };
}

export function errorStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number') return (error as { status: number }).status;
  return null;
}

function serverMessage(error: unknown): string | null {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') return (data as { error: string }).error;
  }
  return null;
}

/** Server revision conflict (another session saved first), as opposed to overlap or validation 409s. */
export function isRevisionConflict(error: unknown) {
  const msg = serverMessage(error) ?? (error instanceof Error ? error.message : '');
  return errorStatus(error) === 409 && /otra sesi[oó]n/i.test(msg);
}

export function errorText(error: unknown) {
  const msg = serverMessage(error);
  const base = msg ?? (error instanceof Error ? error.message : 'No se ha podido completar la solicitud.');
  return errorStatus(error) === 409 || errorStatus(error) === 400 || errorStatus(error) === 422 ? `${base} Los datos que has escrito se conservan.` : base;
}

export const kindLabel: Record<string, string> = { ateca: 'ATECA', fablab: 'FABLab' };
export const statusLabel: Record<string, string> = { reservada: 'Reservada', realizado: 'Realizado', cancelada: 'Cancelada' };
