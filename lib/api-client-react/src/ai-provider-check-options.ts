/**
 * A diagnostic may consume provider quota even when it fails. Keep retries
 * disabled, including when QueryClient or a caller supplies a retry policy.
 * Orval applies this only to the saved-provider diagnostic mutation.
 */
export function aiProviderCheckOptions<T extends object>(options: T) {
  return { ...options, retry: false as const };
}
