import type { QueryClient } from "@tanstack/react-query";

// Invalidation alone retains successful data when the next response is 404.
// Active-course aliases must lose their old identity on a course transition.
export async function discardCourseCache(client: QueryClient, keys: readonly (readonly unknown[])[]) {
  await Promise.all(keys.map(queryKey => client.cancelQueries({ queryKey })));
  for (const queryKey of keys) client.removeQueries({ queryKey });
}
