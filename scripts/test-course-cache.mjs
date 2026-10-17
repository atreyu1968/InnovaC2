import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { discardCourseCache } from "../artifacts/innova-c2/src/lib/course-cache.ts";
const require = createRequire(import.meta.url);
const { QueryClient } = require(require.resolve("@tanstack/react-query", {
  paths: [new URL("../artifacts/innova-c2", import.meta.url).pathname],
}));
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const pic = ["/api/v1/plans/current"];
const activities = ["/api/v1/activities"];
const history = ["/api/v1/school-years/closed-id/history"];
client.setQueryData(pic, { id: "old-plan", schoolYear: "2099-2100" });
client.setQueryData([...activities, { page: 1 }], [{ id: "old-achievement" }]);
client.setQueryData(history, { sourceHash: "immutable" });
// Reproduce React Query's important behavior: invalidate does not clear old data.
await client.invalidateQueries({ queryKey: pic });
await assert.rejects(client.fetchQuery({ queryKey: pic, queryFn: () => Promise.reject(new Error("404")) }));
assert.equal(client.getQueryData(pic).id, "old-plan");
await discardCourseCache(client, [pic, activities]);
assert.equal(client.getQueryData(pic), undefined);
assert.equal(client.getQueryData([...activities, { page: 1 }]), undefined);
assert.deepEqual(client.getQueryData(history), { sourceHash: "immutable" });
await assert.rejects(client.fetchQuery({ queryKey: pic, queryFn: () => Promise.reject(new Error("404")) }));
assert.equal(client.getQueryData(pic), undefined, "A missing new-course PIC must never show the old plan");
client.clear();
console.log("PASS: course transition removes stale active-course data, including parameterized lists, and preserves immutable history.");
