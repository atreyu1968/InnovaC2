// Ephemeral, in-memory only store for pending meeting audio.
// Raw audio never touches localStorage, IndexedDB, disk or network until the user processes it.
export type AudioSource = "in_person" | "online" | "upload";
export type PendingAudio = { blob: Blob; fileName: string; source: AudioSource };

const pending = new Map<string, PendingAudio>();
const activeStops = new Map<string, () => void>();
const processing = new Set<string>();
const generations = new Map<string, number>();
const listeners = new Set<() => void>();

export const pendingKey = (userId: string, meetingId: string) => `${userId}::${meetingId}`;
export const getPending = (key: string) => pending.get(key) ?? null;
export const pendingGeneration = (key: string) => generations.get(key) ?? 0;
export function setPending(key: string, value: PendingAudio | null, generation?: number) {
  if (generation !== undefined && generation !== pendingGeneration(key)) return;
  if (value) pending.set(key, value); else pending.delete(key);
  emit();
}
export function registerActive(key: string, stop: (() => void) | null) {
  if (stop) activeStops.set(key, stop); else activeStops.delete(key);
  emit();
}
export const isActive = (key: string) => activeStops.has(key);
export const isProcessing = (key: string) => processing.has(key);
export function setProcessing(key: string, value: boolean) {
  if (value) processing.add(key); else processing.delete(key);
  emit();
}
export function hasUserAudio(userId: string) {
  return [...pending.keys(), ...activeStops.keys()].some((key) => key.startsWith(`${userId}::`));
}
export function clearUserAudio(userId: string) {
  for (const key of new Set([...pending.keys(), ...activeStops.keys()])) {
    if (!key.startsWith(`${userId}::`)) continue;
    generations.set(key, pendingGeneration(key) + 1);
    activeStops.get(key)?.();
    activeStops.delete(key);
    pending.delete(key);
  }
  emit();
}
export function stopActive(key: string) { activeStops.get(key)?.(); }
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function emit() { listeners.forEach((fn) => fn()); syncUnloadGuard(); }

let guarded = false;
function onBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "Hay audio de reunión pendiente que solo existe en este navegador.";
  return event.returnValue;
}
function syncUnloadGuard() {
  if (typeof window === "undefined") return;
  const need = pending.size > 0 || activeStops.size > 0;
  if (need && !guarded) { window.addEventListener("beforeunload", onBeforeUnload); guarded = true; }
  if (!need && guarded) { window.removeEventListener("beforeunload", onBeforeUnload); guarded = false; }
}
