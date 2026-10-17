import type { ReactNode } from "react";
import { getGetDashboardSummaryQueryKey, useGetDashboardSummary } from "@workspace/api-client-react";
import "./PicFollowupPage.css";

type Props = {
  kicker: string;
  title: string;
  subtitle: string;
  status?: ReactNode;
  action?: ReactNode;
  /** Optional override when the page already has the active course from its own API. */
  schoolYear?: string | null;
  centerName?: string | null;
  testId?: string;
};

/** Shared section hero extracted from the PIC followup page. Active course comes from the real dashboard summary API. */
export function SectionHeader({ kicker, title, subtitle, status, action, schoolYear, centerName, testId = "section-header" }: Props) {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 60_000, enabled: !(schoolYear && centerName) } });
  const year = schoolYear ?? summary.data?.schoolYear ?? null;
  const center = centerName ?? summary.data?.centerName ?? "IES Manuel Martín González";
  return <section className="followup-hero section-header" data-testid={testId}>
    <div className="followup-hero-top"><div className="min-w-0">
      <p className="followup-kicker"><span className="kicker-mark" /> INNOVA-C2 <span className="kicker-divider">/</span> {kicker}</p>
      <h1 data-testid="text-page-title">{title}</h1>
      <p className="followup-subtitle">{subtitle}</p>
    </div>
      <div className="followup-course-stamp" data-testid="status-active-course"><span className="course-stamp-label">CURSO ACTIVO</span>
        {year ? <strong>{year}</strong> : summary.isLoading ? <span className="section-header-skeleton" aria-label="Cargando curso activo" /> : summary.isError ? <strong className="is-empty">Curso no disponible</strong> : <strong className="is-empty">Sin curso activo</strong>}
        <span>{center}</span></div>
    </div>
    {(status || action) && <div className="followup-hero-foot"><span>{status}</span>{action && <div className="section-header-actions">{action}</div>}</div>}
  </section>;
}
