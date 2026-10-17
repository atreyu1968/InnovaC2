import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, CheckCircle2, History, Lock, RefreshCw, ShieldCheck, UserCheck } from 'lucide-react';
import {
  UserRole,
  useListSchoolYears, getListSchoolYearsQueryKey,
  useOpenSchoolYear, useCloseSchoolYear,
  useGetSchoolYearReview, getGetSchoolYearReviewQueryKey,
  useValidateSchoolYearClosure, getValidateSchoolYearClosureQueryKey,
  useGetSchoolYearHistory, getGetSchoolYearHistoryQueryKey,
  useGetCurrentCatalog, getGetCurrentCatalogQueryKey,
  getGetDashboardSummaryQueryKey, getGetCurrentPicPlanQueryKey, getListActivitiesQueryKey,
  getListDocumentsQueryKey, getListCurrentIndicatorsQueryKey, getListUsersQueryKey,
} from '@workspace/api-client-react';
import type { SchoolYear, SchoolYearAccount, SchoolYearSource, UserRole as UserRoleValue } from '@workspace/api-client-react';
import { discardCourseCache } from '@/lib/course-cache';

const roleNames: Record<UserRoleValue, string> = {
  admin_tecnico: 'Administración técnica',
  c2_innovacion: 'Coordinación C2 de innovación',
  equipo_directivo: 'Equipo directivo',
  coordinacion_red: 'Coordinación de red',
  jefatura_departamento: 'Jefatura de departamento',
  profesorado: 'Profesorado',
  consulta_c1: 'Consulta C1',
  consulta_auditora: 'Consulta auditora',
};

const sourceNames: Record<string, string> = {
  pic_plan: 'Plan PIC', pic_plans: 'Plan PIC', pic_snapshot: 'Instantánea PIC', pic_snapshots: 'Instantáneas PIC',
  pic_submission: 'Registro de entrega PIC', pic_submissions: 'Registros de entrega PIC',
  activity: 'Actuación', activities: 'Actuaciones', indicator: 'Indicador', indicators: 'Indicadores',
  indicator_observation: 'Observación de indicador', indicator_observations: 'Observaciones de indicadores',
  document: 'Documento (metadatos)', documents: 'Documentos (metadatos)', document_versions: 'Versiones de documento',
  information_requests: 'Solicitudes de información', assignments: 'Asignaciones del curso', school_year_assignments: 'Asignaciones del curso',
  information_responses: 'Respuestas de información', course_accounts: 'Personal y acceso al cierre',
  role_permissions: 'Permisos de los roles al cierre', pic_catalogs: 'Catálogo de referencia',
  pic_dafo: 'Análisis DAFO', pic_projects: 'Proyectos', pic_action_selections: 'Acciones seleccionadas',
  pic_indicator_targets: 'Metas de indicadores', pic_custom_actions: 'Acciones propias', pic_ods_links: 'Vínculos ODS',
  pic_ciclope_members: 'Integrantes CICLOPE', pic_calendar_meetings: 'Calendario de reuniones',
  pic_submission_records: 'Registros de entrega PIC', activity_versions: 'Versiones de actuaciones',
  activity_sources: 'Fuentes de actuaciones', activity_people: 'Participantes',
  activity_indicator_links: 'Vínculos de indicadores', document_access_grants: 'Accesos documentales al cierre',
  evidences: 'Evidencias', evidence_links: 'Vínculos de evidencias',
};

function messageFor(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'No se ha podido completar la solicitud. Inténtalo de nuevo.';
}
function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Sin fecha';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}
function nextLabel(label: string | undefined) {
  const m = label?.match(/^(\d{4})-(\d{4})$/);
  if (!m) return '';
  return `${Number(m[2])}-${Number(m[2]) + 1}`;
}
function labelProblem(label: string, previous: string | undefined) {
  const m = label.match(/^(\d{4})-(\d{4})$/);
  if (!m) return 'Usa el formato AAAA-AAAA, por ejemplo 2025-2026.';
  if (Number(m[2]) !== Number(m[1]) + 1) return 'Los años deben ser consecutivos.';
  const p = previous?.match(/^(\d{4})-(\d{4})$/);
  if (p && Number(m[1]) !== Number(p[2])) return `Debe comenzar en ${p[2]}, a continuación de ${previous}.`;
  return '';
}

function Alert({ kind, children, testId }: { kind: 'error' | 'success' | 'warning' | 'info'; children: ReactNode; testId?: string }) {
  const styles = {
    error: 'border-[#e8c4bd] bg-[#fbf0ed] text-[#8f3b2f]',
    success: 'border-[#c3e0d3] bg-[#edf7f2] text-[#2c6b55]',
    warning: 'border-[#ead7b3] bg-[#fbf5e8] text-[#7c5a1f]',
    info: 'border-[#d6e3e0] bg-[#f1f6f5] text-[#3d5853]',
  }[kind];
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed ${styles}`} data-testid={testId}>{children}</div>;
}
function SectionHead({ eyebrow, title, icon, action }: { eyebrow: string; title: string; icon: ReactNode; action?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee9df] px-5 py-4 md:px-6">
    <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#eaf1eb] text-[#347b69]">{icon}</span><div><p className="eyebrow">{eyebrow}</p><h2 className="mt-0.5 font-[var(--app-font-serif)] text-base font-bold">{title}</h2></div></div>
    {action}
  </div>;
}

export function SchoolYearsPage() {
  const client = useQueryClient();
  const years = useListSchoolYears({ query: { queryKey: getListSchoolYearsQueryKey(), refetchOnMount: 'always', refetchInterval: 60_000 } });
  const sorted = useMemo(() => [...(years.data ?? [])].sort((a, b) => b.label.localeCompare(a.label)), [years.data]);
  const active = sorted.find(y => y.active && !y.closedAt) ?? null;
  const latest = sorted[0];
  const closed = sorted.filter(y => !!y.closedAt);

  const invalidateAll = async () => {
    await discardCourseCache(client, [
      getGetDashboardSummaryQueryKey(), getGetCurrentPicPlanQueryKey(),
      getListActivitiesQueryKey(), getListDocumentsQueryKey(), getListCurrentIndicatorsQueryKey(),
    ]);
    await Promise.all([
      getListSchoolYearsQueryKey(), getGetSchoolYearReviewQueryKey(), getGetDashboardSummaryQueryKey(), getGetCurrentPicPlanQueryKey(),
      getListActivitiesQueryKey(), getListDocumentsQueryKey(), getListCurrentIndicatorsQueryKey(), getListUsersQueryKey(),
    ].map(queryKey => client.invalidateQueries({ queryKey })));
    // Remaining per-plan / per-year caches (validations, snapshots, histories) are refreshed too.
    await client.invalidateQueries();
  };

  return <div className="fade-up space-y-6">
    <div><p className="eyebrow">Ciclo del curso académico</p><p className="mt-1 max-w-3xl text-sm leading-relaxed text-[#5f6e69]">Cierra el curso vigente cuando esté listo y abre el siguiente de forma deliberada. El expediente de cada curso cerrado se conserva como una instantánea inmutable de solo lectura.</p></div>

    <section className="panel overflow-hidden">
      <SectionHead eyebrow="Estado" title="Cursos del centro" icon={<Archive size={18} />} action={<button className="quiet-action flex items-center gap-2" onClick={() => years.refetch()} disabled={years.isFetching} data-testid="button-refresh-years"><RefreshCw size={14} className={years.isFetching ? 'animate-spin' : ''} />Actualizar</button>} />
      {years.isLoading ? <div className="space-y-3 p-5">{[1, 2].map(n => <div key={n} className="skeleton h-12" />)}</div>
        : years.isError ? <div className="p-5"><Alert kind="error" testId="status-years-error">{messageFor(years.error)} <button className="ml-2 font-bold underline" onClick={() => years.refetch()} data-testid="button-retry-years">Reintentar</button></Alert></div>
        : sorted.length ? <ul className="divide-y divide-[#eee9df]">{sorted.map(y => <li key={y.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 md:px-6" data-testid={`row-year-${y.id}`}>
          <div><p className="font-[var(--app-font-serif)] text-sm font-bold text-[#34444a]" data-testid={`text-year-label-${y.id}`}>{y.label}</p><p className="mt-0.5 text-[11px] text-[#7b8580]">{y.closedAt ? `Cerrado el ${formatDateTime(y.closedAt)}${y.closeReason ? ` · ${y.closeReason}` : ''}` : `Revisión ${y.revision}`}</p></div>
          <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${y.closedAt ? 'bg-[#efede6] text-[#6c716d]' : 'bg-[#e7f1eb] text-[#31745e]'}`} data-testid={`status-year-${y.id}`}>{y.closedAt ? 'Cerrado' : y.active ? 'Activo' : 'Inactivo'}</span>
        </li>)}</ul>
        : <div className="p-5"><Alert kind="info">No hay cursos registrados.</Alert></div>}
    </section>

    {!years.isLoading && !years.isError && <div className="grid items-start gap-5 xl:grid-cols-2">
      {active ? <CloseYearPanel key={`${active.id}-${active.revision}`} year={active} onDone={invalidateAll} />
        : <section className="panel p-5 md:p-6"><p className="eyebrow">Cierre de curso</p><p className="mt-2 text-sm text-[#5f6e69]" data-testid="text-no-active-year">No hay ningún curso activo que cerrar.</p></section>}
      {latest && latest.closedAt ? <OpenYearPanel key={`${latest.id}-${latest.revision}`} previous={latest} onDone={invalidateAll} />
        : <section className="panel p-5 md:p-6"><div className="flex items-center gap-2"><Lock size={15} className="text-[#7b8580]" /><p className="eyebrow">Apertura de curso</p></div><p className="mt-2 text-sm leading-relaxed text-[#5f6e69]" data-testid="text-open-blocked">Solo se puede abrir un curso nuevo después de cerrar {latest ? `el curso ${latest.label}` : 'el último curso'}.</p></section>}
    </div>}

    {!years.isLoading && !years.isError && <HistoryPanel closed={closed} />}
  </div>;
}

function CloseYearPanel({ year, onDone }: { year: SchoolYear; onDone: () => Promise<void> }) {
  const validation = useValidateSchoolYearClosure(year.id, { query: { queryKey: getValidateSchoolYearClosureQueryKey(year.id), refetchOnMount: 'always' } });
  const close = useCloseSchoolYear();
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const v = validation.data;
  const ready = !!v?.canClose && confirmation === year.label && reason.trim().length >= 10 && !close.isPending && !validation.isFetching;

  const submit = (event: FormEvent) => {
    event.preventDefault(); setError(''); setSuccess('');
    if (!v || !ready) return;
    close.mutate({ yearId: year.id, data: { expectedRevision: v.revision, confirmation, reason: reason.trim() } }, {
      onSuccess: async closedYear => {
        setSuccess(`El curso ${closedYear.label} se ha cerrado y su expediente queda conservado.`);
        setConfirmation(''); setReason('');
        await onDone();
      },
      onError: issue => { setError(messageFor(issue)); validation.refetch(); },
    });
  };

  return <section className="panel overflow-hidden" data-testid="panel-close-year">
    <SectionHead eyebrow="Cierre de curso" title={`Cerrar ${year.label}`} icon={<Lock size={18} />} action={<button className="quiet-action flex items-center gap-2" onClick={() => validation.refetch()} disabled={validation.isFetching} data-testid="button-revalidate-close"><RefreshCw size={14} className={validation.isFetching ? 'animate-spin' : ''} />Comprobar</button>} />
    <div className="space-y-4 p-5 md:p-6">
      {validation.isLoading ? <div className="space-y-2"><div className="skeleton h-10" /><div className="skeleton h-10" /></div>
        : validation.isError ? <Alert kind="error" testId="status-validation-error">{messageFor(validation.error)}</Alert>
        : v && <div className="space-y-2" data-testid="status-close-validation">
          {v.canClose ? <Alert kind="success" testId="status-can-close">Las comprobaciones previas permiten cerrar el curso (revisión {v.revision}).</Alert>
            : <Alert kind="error" testId="status-cannot-close">El curso no se puede cerrar todavía. Resuelve los bloqueos indicados.</Alert>}
          {v.blockers.length > 0 && <div><p className="eyebrow mb-1.5">Bloqueos</p><ul className="space-y-1.5">{v.blockers.map((b, i) => <li key={i} className="flex gap-2 text-xs text-[#8f3b2f]" data-testid={`text-blocker-${i}`}><AlertTriangle size={14} className="mt-0.5 shrink-0" />{b}</li>)}</ul></div>}
          {v.warnings.length > 0 && <div><p className="eyebrow mb-1.5">Avisos</p><ul className="space-y-1.5">{v.warnings.map((w, i) => <li key={i} className="flex gap-2 text-xs text-[#7c5a1f]" data-testid={`text-warning-${i}`}><AlertTriangle size={14} className="mt-0.5 shrink-0" />{w}</li>)}</ul></div>}
        </div>}
      <Alert kind="warning" testId="text-irreversible-warning"><strong>Acción irreversible.</strong> Al cerrar, el curso queda en solo lectura y sus datos se guardan como expediente histórico. No se podrá reabrir.</Alert>
      <form className="space-y-4" onSubmit={submit}>
        <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#405057]">Escribe <span className="font-mono">{year.label}</span> para confirmar</span><input className="field" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" data-testid="input-close-confirmation" /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#405057]">Motivo del cierre</span><textarea className="field min-h-[86px]" value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} data-testid="input-close-reason" /><span className="mt-1 block text-[10px] text-[#77817c]">Mínimo 10 caracteres ({reason.trim().length}/10).</span></label>
        {error && <Alert kind="error" testId="status-close-error">{error}</Alert>}
        {success && <Alert kind="success" testId="status-close-success">{success}</Alert>}
        <button type="submit" className="primary-action w-full !bg-[#9b4337] disabled:cursor-not-allowed disabled:opacity-50" disabled={!ready} data-testid="button-close-year">{close.isPending ? 'Cerrando curso…' : `Cerrar definitivamente ${year.label}`}</button>
      </form>
    </div>
  </section>;
}

type Draft = { selected: boolean; family: string };

function OpenYearPanel({ previous, onDone }: { previous: SchoolYear; onDone: () => Promise<void> }) {
  const [started, setStarted] = useState(false);
  const [success, setSuccess] = useState('');
  return <section className="panel overflow-hidden" data-testid="panel-open-year">
    <SectionHead eyebrow="Apertura de curso" title="Abrir el siguiente curso" icon={<UserCheck size={18} />} />
    <div className="space-y-4 p-5 md:p-6">
      {success && <Alert kind="success" testId="status-open-success">{success}</Alert>}
      {!started ? <>
        <p className="text-sm leading-relaxed text-[#5f6e69]">El curso {previous.label} está cerrado. El nuevo curso empezará vacío: no se copian planes, actuaciones, indicadores ni documentos. Deberás revisar una a una las personas responsables y sus permisos.</p>
        <button className="primary-action" onClick={() => { setSuccess(''); setStarted(true); }} data-testid="button-start-open-year">Preparar apertura</button>
      </> : <OpenYearForm previous={previous} onCancel={() => setStarted(false)} onOpened={async label => { setStarted(false); setSuccess(`Curso ${label} abierto. Empieza sin datos copiados.`); await onDone(); }} />}
    </div>
  </section>;
}

function OpenYearForm({ previous, onCancel, onOpened }: { previous: SchoolYear; onCancel: () => void; onOpened: (label: string) => Promise<void> }) {
  const review = useGetSchoolYearReview({ query: { queryKey: getGetSchoolYearReviewQueryKey(), refetchOnMount: 'always', staleTime: 0 } });
  const catalog = useGetCurrentCatalog({ query: { queryKey: getGetCurrentCatalogQueryKey(), retry: false } });
  const open = useOpenSchoolYear();
  const [label, setLabel] = useState(nextLabel(previous.label));
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const accounts = review.data ?? [];
  const families = catalog.data?.familias_profesionales ?? [];
  const draftFor = (a: SchoolYearAccount): Draft => drafts[a.userId] ?? { selected: false, family: a.professionalFamily ?? '' };
  const update = (a: SchoolYearAccount, patch: Partial<Draft>) => { setReviewed(false); setDrafts(d => ({ ...d, [a.userId]: { ...draftFor(a), ...patch } })); };
  const chosen = accounts.filter(a => draftFor(a).selected);
  const hasC2 = chosen.some(a => a.role === UserRole.c2_innovacion);
  const labelError = labelProblem(label, previous.label);
  const ready = !labelError && chosen.length > 0 && hasC2 && reviewed && !open.isPending && !review.isFetching;

  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (!ready) return;
    open.mutate({ data: {
      label, previousYearId: previous.id, expectedRevision: previous.revision, permissionsReviewed: true,
      assignments: chosen.map(a => ({ userId: a.userId, role: a.role, professionalFamily: draftFor(a).family.trim() || null })),
    } }, {
      onSuccess: async opened => { setDrafts({}); setReviewed(false); await onOpened(opened.label); },
      onError: issue => { setError(messageFor(issue)); review.refetch(); },
    });
  };

  return <form className="space-y-4" onSubmit={submit}>
    <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#405057]">Etiqueta del nuevo curso</span><input className="field" value={label} onChange={e => setLabel(e.target.value.trim())} placeholder="2025-2026" data-testid="input-open-label" />{labelError && <span className="mt-1 block text-[10px] text-[#9b4337]" data-testid="text-label-error">{labelError}</span>}</label>
    <div>
      <div className="mb-2 flex items-center justify-between gap-2"><p className="eyebrow">Responsables del nuevo curso</p><button type="button" className="quiet-action flex items-center gap-1.5 !py-1.5 text-xs" onClick={() => review.refetch()} disabled={review.isFetching} data-testid="button-refresh-review"><RefreshCw size={12} className={review.isFetching ? 'animate-spin' : ''} />Recargar</button></div>
      <p className="mb-2 text-[11px] text-[#77817c]">Selecciona individualmente cada persona. El rol es el de su cuenta actual y no se modifica aquí; la familia profesional puede ajustarse.</p>
      {review.isLoading ? <div className="space-y-2">{[1, 2, 3].map(n => <div key={n} className="skeleton h-11" />)}</div>
        : review.isError ? <Alert kind="error" testId="status-review-error">{messageFor(review.error)} <button type="button" className="ml-2 font-bold underline" onClick={() => review.refetch()} data-testid="button-retry-review">Reintentar</button></Alert>
        : !accounts.length ? <Alert kind="info">No hay cuentas disponibles para asignar.</Alert>
        : <ul className="max-h-[360px] divide-y divide-[#eee9df] overflow-y-auto rounded-lg border border-[#eee9df]">{accounts.map(a => { const d = draftFor(a); return <li key={a.userId} className={`grid gap-2 px-3 py-2.5 sm:grid-cols-[auto_1fr_1fr] sm:items-center ${d.selected ? 'bg-[#f3f8f5]' : ''}`} data-testid={`row-review-${a.userId}`}>
          <input type="checkbox" className="h-4 w-4 accent-[#347b69]" checked={d.selected} onChange={e => update(a, { selected: e.target.checked })} aria-label={`Asignar a ${a.name}`} data-testid={`checkbox-assign-${a.userId}`} />
          <div className="min-w-0"><p className="truncate text-xs font-bold text-[#34444a]">{a.name}</p><p className="text-[10px] text-[#7b8580]" data-testid={`text-review-role-${a.userId}`}>{roleNames[a.role]}{a.assigned ? ' · asignada en el curso cerrado' : ''}</p></div>
          <select className="field !min-h-[34px] !py-1.5 text-xs" value={d.family} disabled={!d.selected} onChange={e => update(a, { family: e.target.value })} data-testid={`select-review-family-${a.userId}`}>
            <option value="">Sin familia profesional</option>
            {[...new Set([...(d.family ? [d.family] : []), ...families])].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </li>; })}</ul>}
      <p className="mt-2 text-[11px] text-[#5f6e69]" data-testid="text-selected-count">{chosen.length} persona(s) seleccionada(s).</p>
      {chosen.length > 0 && !hasC2 && <div className="mt-2"><Alert kind="warning" testId="text-missing-c2">Debe asignarse al menos una persona con rol de Coordinación C2 de innovación.</Alert></div>}
    </div>
    <label className="flex items-start gap-2.5 rounded-lg border border-[#e5dfd2] bg-[#f7f5ef] p-3 text-xs text-[#405057]">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#347b69]" checked={reviewed} disabled={!chosen.length} onChange={e => setReviewed(e.target.checked)} data-testid="checkbox-permissions-reviewed" />
      <span><ShieldCheck size={13} className="mr-1 inline" />He revisado las personas responsables, sus roles y familias profesionales, y confirmo los permisos del nuevo curso. El curso empezará vacío.</span>
    </label>
    {error && <Alert kind="error" testId="status-open-error">{error}</Alert>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" className="primary-action disabled:cursor-not-allowed disabled:opacity-50" disabled={!ready} data-testid="button-open-year">{open.isPending ? 'Abriendo curso…' : `Abrir curso ${label || ''}`}</button>
      <button type="button" className="quiet-action" onClick={onCancel} disabled={open.isPending} data-testid="button-cancel-open">Cancelar</button>
    </div>
  </form>;
}

function HistoryPanel({ closed }: { closed: SchoolYear[] }) {
  const [yearId, setYearId] = useState('');
  const [filter, setFilter] = useState('');
  const history = useGetSchoolYearHistory(yearId, { query: { queryKey: getGetSchoolYearHistoryQueryKey(yearId), enabled: !!yearId } });
  const groups = useMemo(() => {
    const map = new Map<string, SchoolYearSource[]>();
    for (const s of history.data?.sources ?? []) map.set(s.source, [...(map.get(s.source) ?? []), s]);
    return [...map.entries()];
  }, [history.data]);
  const visible = filter ? groups.filter(([s]) => s === filter) : groups;

  return <section className="panel overflow-hidden" data-testid="panel-history">
    <SectionHead eyebrow="Expediente histórico" title="Consultar un curso cerrado" icon={<History size={18} />} />
    <div className="space-y-4 p-5 md:p-6">
      <Alert kind="info">Consulta de solo lectura. Estos registros pertenecen a un curso cerrado y no cuentan como logros ni datos del curso actual.</Alert>
      {!closed.length ? <p className="text-sm text-[#5f6e69]" data-testid="text-no-history">Todavía no hay cursos cerrados.</p> : <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#405057]">Curso</span><select className="field" value={yearId} onChange={e => { setYearId(e.target.value); setFilter(''); }} data-testid="select-history-year"><option value="">Selecciona un curso cerrado</option>{closed.map(y => <option key={y.id} value={y.id}>{y.label}</option>)}</select></label>
        {history.data && <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#405057]">Tipo de registro</span><select className="field" value={filter} onChange={e => setFilter(e.target.value)} data-testid="select-history-source"><option value="">Todos ({history.data.sources.length})</option>{groups.map(([s, list]) => <option key={s} value={s}>{sourceNames[s] ?? s} ({list.length})</option>)}</select></label>}
      </div>}
      {yearId && (history.isLoading ? <div className="space-y-2">{[1, 2, 3].map(n => <div key={n} className="skeleton h-14" />)}</div>
        : history.isError ? <Alert kind="error" testId="status-history-error">{messageFor(history.error)} <button className="ml-2 font-bold underline" onClick={() => history.refetch()} data-testid="button-retry-history">Reintentar</button></Alert>
        : history.data && <div className="space-y-4">
          <div className="rounded-lg bg-[#263c42] p-4 text-white"><p className="eyebrow text-[#9bc7b5]">Instantánea inmutable</p><p className="mt-1 font-[var(--app-font-serif)] text-lg font-bold" data-testid="text-history-label">Curso {history.data.label}</p><p className="mt-1 text-[11px] text-[#c4d1ce]">Cerrado el {formatDateTime(history.data.closedAt)} · ID {history.data.schoolYearId}</p><p className="mt-1 break-all font-mono text-[10px] text-[#a6b8b3]" data-testid="text-history-hash">Huella: {history.data.sourceHash}</p></div>
          {!visible.length ? <p className="text-sm text-[#5f6e69]">El expediente no contiene registros.</p> : visible.map(([source, list]) => <div key={source} data-testid={`group-history-${source}`}>
            <p className="eyebrow mb-2">{sourceNames[source] ?? source} · {list.length}</p>
            <div className="space-y-2">{list.map(item => <details key={`${item.source}-${item.id}`} className="rounded-lg border border-[#eee9df] bg-[#fffefa]" data-testid={`record-history-${item.source}-${item.id}`}>
              <summary className="cursor-pointer px-3.5 py-2.5 text-xs"><span className="font-bold text-[#34444a]">{recordTitle(item)}</span><span className="ml-2 font-mono text-[10px] text-[#84908a]">{item.source} · {item.id}</span></summary>
              <div className="border-t border-[#eee9df] px-3.5 py-3"><DataView value={item.data} depth={0} /></div>
            </details>)}</div>
          </div>)}
        </div>)}
    </div>
  </section>;
}

function recordTitle(item: SchoolYearSource) {
  const d = item.data ?? {};
  for (const k of ['title', 'titulo', 'name', 'nombre', 'label', 'indicator_code', 'indicatorCode', 'code', 'latestFileName', 'original_name', 'originalName']) {
    const v = d[k];
    if (typeof v === 'string' && v.trim()) return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  return sourceNames[item.source] ?? item.source;
}

const fieldNames: Record<string, string> = {
  title: 'Título', description: 'Descripción', status: 'Estado', revision: 'Revisión', createdAt: 'Creado', updatedAt: 'Actualizado',
  professionalFamily: 'Familia profesional', activityDate: 'Fecha', informationStatus: 'Información', indicatorCodes: 'Indicadores',
  sourceLabels: 'Fuentes', evidenceCount: 'Evidencias', category: 'Categoría', accessScope: 'Ámbito de acceso', latestFileName: 'Archivo',
  latestMediaType: 'Tipo', sizeBytes: 'Tamaño (bytes)', sha256: 'SHA-256', scanStatus: 'Análisis', currentVersion: 'Versión',
  catalogVersion: 'Versión del catálogo', schoolYear: 'Curso', centerName: 'Centro', indicatorCode: 'Indicador', period: 'Periodo',
  value: 'Valor', method: 'Método', formula: 'Fórmula', assessment: 'Valoración', content: 'Contenido', role: 'Rol', userId: 'Usuario',
};

function DataView({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-[#9aa29e]">Sin dato</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Sí' : 'No'}</span>;
  if (typeof value === 'number') return <span>{value}</span>;
  if (typeof value === 'string') return <span className="whitespace-pre-wrap break-words">{/^\d{4}-\d{2}-\d{2}T/.test(value) ? formatDateTime(value) : value}</span>;
  if (depth > 5) return <span className="font-mono text-[10px] text-[#84908a]">[estructura anidada]</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-[#9aa29e]">Ninguno</span>;
    if (value.every(v => typeof v !== 'object' || v === null)) return <span className="break-words">{value.map(v => String(v ?? '')).join(', ')}</span>;
    return <ol className="space-y-2">{value.map((v, i) => <li key={i} className="rounded-md border border-[#eee9df] bg-[#faf8f2] p-2"><DataView value={v} depth={depth + 1} /></li>)}</ol>;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return <span className="text-[#9aa29e]">Sin datos</span>;
    return <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[minmax(110px,180px)_1fr]">{entries.map(([k, v]) => <div key={k} className="contents"><dt className="text-[11px] text-[#7c8580]">{fieldNames[k] ?? k}</dt><dd className="min-w-0 text-[#34444a]"><DataView value={v} depth={depth + 1} /></dd></div>)}</dl>;
  }
  return <span>{String(value)}</span>;
}
