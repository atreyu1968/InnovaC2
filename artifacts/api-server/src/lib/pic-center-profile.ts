import type { PicPlanContent } from "@workspace/api-zod";

/** No migration is inferred for legacy center-wide counts or immutable snapshots. */
export function withDerivedCenterTotals(content: PicPlanContent): PicPlanContent {
  const rows = content.center.familyProfiles;
  if (rows === undefined) return content;
  return {
    ...content,
    center: {
      ...content.center,
      groupCount: rows.reduce((sum, row) => sum + row.groupCount, 0),
      levels: [...new Set(rows.flatMap(row => row.levels))],
    },
  };
}
