import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarDays, ChevronLeft, ChevronRight, History, Info, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import {
  UserRole, getLearningSpaces, getGetLearningSpacesQueryKey, getGetSpaceRecordVersionsQueryKey, useGetLearningSpaces, useGetSpaceRecordVersions,
  useInitializeLearningSpaces, useUpdateLearningSpace, useCreateSpaceReservation, useUpdateSpaceReservation,
} from '@workspace/api-client-react';
import type { LearningSpace, LearningSpacesOverview, SpaceReservation, SpaceReservationInput, SpaceReservationInputSpaceKindsItem, SpaceReservationInputStatus, User } from '@workspace/api-client-react';
import { ConflictReview } from './ConflictReview';
import { canaryDayKey, canaryInputToIso, courseBounds, errorText, formatCanary, formatRange, isRevisionConflict, isoToCanaryInput, kindLabel, statusLabel } from './spaces-utils';
import './spaces.css';

const readOnlyRoles: readonly string[] = [UserRole.consulta_c1, UserRole.consulta_auditora];

export function LearningSpacesPage({ user }: { user: User }) {
  const overview = useGetLearningSpaces({ query: { queryKey: getGetLearningSpacesQueryKey(), refetchOnMount: 'always', staleTime: 15_000 } });
  const data = overview.data;
  if (overview.isLoading) return <div className="spaces-page" data-testid="status-spaces-loading">{[1, 2, 3].map(n => <div key={n} className="skeleton h-40" />)}</div>;
  if (overview.isError || !data) return <div className="panel p-6" data-testid="status-spaces-error"><p className="text-sm text-[#9b4337]">{errorText(overview.error)}</p><button className="quiet-action mt-3" onClick={() => overview.refetch()} data-testid="button-retry-spaces">Reintentar</button></div>;
  // Keying by course identity discards every local form/editor when the active course changes.
  return <SpacesWorkspace key={data.schoolYearId} data={data} user={user} refreshing={overview.isFetching} onRefresh={() => overview.refetch()} />;
}

function SpacesWorkspace({ data, user, refreshing, onRefresh }: { data: LearningSpacesOverview; user: User; refreshing: boolean; onRefresh: () => void }) {
  const canBook = !readOnlyRoles.includes(user.role);
  const [editing, setEditing] = useState<SpaceReservation | 'new' | null>(null);
  const sorted = useMemo(() => [...data.reservations].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [data.reservations]);
  const active = sorted.filter(r => r.status !== 'cancelada');
  const validatedIds = new Set(data.activities.filter(a => a.status === 'validada').map(a => a.id));
  const linked = new Set(sorted.filter(r => r.status === 'realizado' && r.activityId && validatedIds.has(r.activityId)).map(r => r.activityId)).size;
  const byKind = (k: string) => active.filter(r => r.spaceKinds.includes(k as SpaceReservationInputSpaceKindsItem)).length;
  const openReservation = (next: SpaceReservation | 'new') => {
    if (editing && !window.confirm('Hay un formulario de reserva abierto. ¿Descartar sus cambios y abrir otro?')) return;
    setEditing(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return <div className="spaces-page fade-up" data-testid="page-spaces">
    <div className="spaces-notice" data-testid="text-spaces-disclaimer"><Info size={16} className="mt-0.5 shrink-0" /><span>Curso <strong>{data.schoolYear}</strong>. Horarios mostrados en hora de Canarias (Atlantic/Canary). El horario de referencia es informativo y una reserva no acredita que la actividad se haya realizado: solo «realizado» enlazado a una actuación validada existente la documenta. El FABLab está abierto a todas las familias profesionales durante todo el curso.</span></div>

    {data.spaces.length === 0 ? <EmptySpaces canManage={data.canManage} /> : <section className="spaces-cards" aria-label="Fichas de espacios">
      {[...data.spaces].sort((a, b) => a.kind.localeCompare(b.kind)).map(space => <SpaceCard key={space.id} space={space} canManage={data.canManage} />)}
    </section>}

    <section className="spaces-metrics" aria-label="Resumen de ocupación">
      <Metric value={active.length} label="Reservas no canceladas (ocupación)" testId="metric-spaces-occupancy" />
      <Metric value={byKind('ateca')} label="Con uso de ATECA" testId="metric-spaces-ateca" />
      <Metric value={byKind('fablab')} label="Con uso de FABLab" testId="metric-spaces-fablab" />
      <Metric value={linked} label="Actuaciones visibles aún validadas, sin duplicar ambos espacios" testId="metric-spaces-linked" />
    </section>
    <p className="-mt-3 text-[11px] text-[#6f7974]">Recuentos operativos de ocupación. No son resultados de indicadores ni certificación.</p>

    <WeekCalendar reservations={sorted} />

    {editing && <ReservationForm key={editing === 'new' ? 'new' : editing.id} data={data} user={user} existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

    <ReservationList data={data} reservations={sorted} canBook={canBook} refreshing={refreshing} onRefresh={onRefresh} onNew={() => openReservation('new')} onEdit={openReservation} />
  </div>;
}

function useLatestOverview() {
  const client = useQueryClient();
  return () => client.fetchQuery({ queryKey: getGetLearningSpacesQueryKey(), queryFn: () => getLearningSpaces(), staleTime: 0 });
}

function Metric({ value, label, testId }: { value: number; label: string; testId: string }) {
  return <div className="panel spaces-metric"><strong data-testid={testId}>{value}</strong><span>{label}</span></div>;
}

function EmptySpaces({ canManage }: { canManage: boolean }) {
  const client = useQueryClient();
  const init = useInitializeLearningSpaces();
  const [error, setError] = useState('');
  return <section className="panel p-6 text-center" data-testid="empty-spaces">
    <Building2 className="mx-auto text-[#174f49]" size={30} />
    <h2 className="mt-2 font-[var(--app-font-serif)] text-lg font-bold text-[#174f49]">Fichas de ATECA y FABLab sin crear este curso</h2>
    {canManage ? <>
      <p className="mx-auto mt-1 max-w-lg text-sm text-[#5f6b66]">Inicializa dos fichas en blanco, solo para el curso activo. Ningún contenido se rellena automáticamente.</p>
      {error && <p className="mt-2 text-sm text-[#9b4337]" role="alert">{error}</p>}
      <button className="primary-action mt-4" disabled={init.isPending} data-testid="button-initialize-spaces" onClick={() => { setError(''); init.mutate(undefined, { onSuccess: next => client.setQueryData(getGetLearningSpacesQueryKey(), next), onError: e => setError(errorText(e)) }); }}>{init.isPending ? 'Creando fichas…' : 'Inicializar fichas del curso'}</button>
    </> : <p className="mx-auto mt-1 max-w-lg text-sm text-[#5f6b66]">La coordinación C2 todavía no ha creado las fichas de este curso.</p>}
  </section>;
}

const spaceFields: { key: 'purpose' | 'referenceSchedule' | 'responsibles' | 'resources' | 'services'; label: string; max: number }[] = [
  { key: 'purpose', label: 'Finalidad', max: 3000 },
  { key: 'referenceSchedule', label: 'Horario de referencia (informativo)', max: 1500 },
  { key: 'responsibles', label: 'Responsables', max: 1500 },
  { key: 'resources', label: 'Recursos', max: 4000 },
  { key: 'services', label: 'Servicios', max: 3000 },
];

function SpaceCard({ space, canManage }: { space: LearningSpace; canManage: boolean }) {
  const client = useQueryClient();
  const update = useUpdateLearningSpace();
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [form, setForm] = useState(() => pickSpace(space));
  const [baseRevision, setBaseRevision] = useState(space.revision);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [initial, setInitial] = useState(() => pickSpace(space));
  const loadLatest = useLatestOverview();
  const start = () => { setForm(pickSpace(space)); setInitial(pickSpace(space)); setBaseRevision(space.revision); setError(''); setConflict(false); setEditing(true); };
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const discard = () => { if (dirty && !window.confirm('Hay cambios sin guardar en la ficha. ¿Descartarlos?')) return; setEditing(false); setConflict(false); };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setError(''); setConflict(false);
    update.mutate({ spaceId: space.id, data: { ...form, name: form.name.trim(), expectedRevision: baseRevision } }, {
      onSuccess: saved => {
        client.setQueryData<LearningSpacesOverview>(getGetLearningSpacesQueryKey(), old => old ? { ...old, spaces: old.spaces.map(s => s.id === saved.id ? saved : s) } : old);
        client.invalidateQueries({ queryKey: getGetSpaceRecordVersionsQueryKey(space.id) });
        setEditing(false);
      },
      onError: err => { setError(errorText(err)); setConflict(isRevisionConflict(err)); },
    });
  };
  const fab = space.kind === 'fablab';
  return <article className={`panel space-card ${fab ? 'is-fablab' : ''}`} data-testid={`card-space-${space.kind}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><span className={`space-tag ${fab ? 'is-fablab' : ''}`}>{kindLabel[space.kind]}</span><h3 className="mt-2" data-testid={`text-space-name-${space.kind}`}>{space.name || kindLabel[space.kind]}</h3></div>
      <div className="flex gap-2">
        <button className="quiet-action flex items-center gap-1.5" onClick={() => setHistory(!history)} aria-expanded={history} data-testid={`button-space-history-${space.kind}`}><History size={14} />Historial</button>
        {canManage && !editing && <button className="quiet-action flex items-center gap-1.5" onClick={start} data-testid={`button-edit-space-${space.kind}`}><Pencil size={14} />Editar</button>}
      </div>
    </div>
    {fab && <p className="text-[12px] font-semibold text-[#226d5e]" data-testid="text-fablab-scope">Disponible para todas las familias profesionales durante todo el curso.</p>}
    {editing ? <form className="space-def" onSubmit={submit}>
      <label><span className="spaces-label">Nombre</span><input className="field" required maxLength={160} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid={`input-space-name-${space.kind}`} /></label>
      {spaceFields.map(f => <label key={f.key}><span className="spaces-label">{f.label}</span><textarea className="field" rows={3} maxLength={f.max} value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} data-testid={`input-space-${f.key}-${space.kind}`} /></label>)}
      {error && <p className="text-sm text-[#9b4337]" role="alert" data-testid={`error-space-${space.kind}`}>{error}</p>}
      {conflict && <ConflictReview testPrefix={`space-${space.kind}`} load={async () => {
        const latest = (await loadLatest()).spaces.find(s => s.id === space.id);
        if (!latest) return null;
        return { revision: latest.revision, rows: [{ label: 'Nombre', latest: latest.name, mine: form.name }, ...spaceFields.map(f => ({ label: f.label, latest: latest[f.key], mine: form[f.key] }))] };
      }} onAdopt={rev => { setBaseRevision(rev); setConflict(false); setError(`Base actualizada a la revisión ${rev}. Pulsa Guardar para aplicar tus valores.`); }} />}
      <p className="text-[10px] text-[#8a938e]" data-testid={`text-space-base-revision-${space.kind}`}>Editando sobre la revisión {baseRevision}</p>
      <div className="flex flex-wrap gap-2"><button className="primary-action" disabled={update.isPending} data-testid={`button-save-space-${space.kind}`}>{update.isPending ? 'Guardando…' : 'Guardar ficha'}</button><button type="button" className="quiet-action" onClick={discard} data-testid={`button-cancel-space-${space.kind}`}>Descartar cambios</button></div>
    </form> : <dl className="space-def">
      {spaceFields.map(f => <div key={f.key}><dt>{f.label}</dt><dd className={space[f.key] ? '' : 'is-empty'}>{space[f.key] || 'Sin completar'}</dd></div>)}
    </dl>}
    <p className="text-[10px] text-[#8a938e]">Revisión {space.revision}</p>
    {history && <VersionHistory entityId={space.id} />}
  </article>;
}

function pickSpace(s: LearningSpace) {
  return { name: s.name, purpose: s.purpose, referenceSchedule: s.referenceSchedule, responsibles: s.responsibles, resources: s.resources, services: s.services };
}

const historyLabels: Record<string, string> = {
  name: 'Nombre', purpose: 'Finalidad', referenceSchedule: 'Horario de referencia', responsibles: 'Responsables', resources: 'Recursos', services: 'Servicios',
  title: 'Título', spaceKinds: 'Espacios', startsAt: 'Inicio', endsAt: 'Fin', professionalFamily: 'Familia profesional', groupLabel: 'Grupo', status: 'Estado', activityId: 'Actuación enlazada', notes: 'Notas', kind: 'Tipo',
};

function renderValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if ((key === 'startsAt' || key === 'endsAt') && typeof v === 'string') return formatCanary(v, { dateStyle: 'medium', timeStyle: 'short' });
  if (key === 'spaceKinds' && Array.isArray(v)) return v.map(k => kindLabel[String(k)] ?? String(k)).join(' + ');
  if (key === 'status' && typeof v === 'string') return statusLabel[v] ?? v;
  if (key === 'kind' && typeof v === 'string') return kindLabel[v] ?? v;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function VersionHistory({ entityId }: { entityId: string }) {
  const versions = useGetSpaceRecordVersions(entityId, { query: { queryKey: getGetSpaceRecordVersionsQueryKey(entityId), refetchOnMount: 'always' } });
  return <div className="spaces-history" data-testid={`panel-history-${entityId}`}>
    {versions.isLoading ? <div className="skeleton h-12" /> : versions.isError ? <p className="text-xs text-[#9b4337]">{errorText(versions.error)} <button className="underline" onClick={() => versions.refetch()}>Reintentar</button></p>
      : !versions.data?.length ? <p className="text-xs text-[#6f7974]">Sin versiones registradas.</p>
        : [...versions.data].sort((a, b) => b.revision - a.revision).map(v => {
          let parsed: Record<string, unknown> | null = null;
          try { const p: unknown = JSON.parse(v.summary); if (p && typeof p === 'object' && !Array.isArray(p)) parsed = p as Record<string, unknown>; } catch { parsed = null; }
          return <div key={v.id} className="spaces-history-item" data-testid={`row-version-${v.id}`}>
            <strong>Revisión {v.revision}</strong> · {formatCanary(v.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
            {parsed ? <dl>{Object.entries(parsed).filter(([k]) => k in historyLabels).map(([k, val]) => <div key={k} className="contents"><dt>{historyLabels[k]}</dt><dd>{renderValue(k, val)}</dd></div>)}</dl> : <p className="mt-1 whitespace-pre-wrap">{v.summary}</p>}
          </div>;
        })}
  </div>;
}

function startOfWeek(dayKey: string) {
  const d = new Date(`${dayKey}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

function WeekCalendar({ reservations }: { reservations: SpaceReservation[] }) {
  const todayKey = canaryDayKey(new Date().toISOString());
  const [offset, setOffset] = useState(0);
  const days = useMemo(() => {
    const base = startOfWeek(todayKey);
    base.setUTCDate(base.getUTCDate() + offset * 7);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  }, [todayKey, offset]);
  return <section className="panel p-5" aria-label="Calendario de ocupación" data-testid="calendar-spaces">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div><p className="eyebrow">Calendario de ocupación</p><h2 className="mt-1 flex items-center gap-2 font-[var(--app-font-serif)] text-lg font-bold text-[#174f49]"><CalendarDays size={18} />Semana del {formatCanary(`${days[0]}T12:00:00Z`, { day: 'numeric', month: 'long' })}</h2></div>
      <div className="flex gap-2">
        <button className="quiet-action" onClick={() => setOffset(offset - 1)} aria-label="Semana anterior" data-testid="button-week-prev"><ChevronLeft size={15} /></button>
        <button className="quiet-action" onClick={() => setOffset(0)} data-testid="button-week-today">Hoy</button>
        <button className="quiet-action" onClick={() => setOffset(offset + 1)} aria-label="Semana siguiente" data-testid="button-week-next"><ChevronRight size={15} /></button>
      </div>
    </div>
    <div className="spaces-week">
      {days.map(day => {
        const items = reservations.filter(r => canaryDayKey(r.startsAt) === day);
        return <div key={day} className={`spaces-day ${day === todayKey ? 'is-today' : ''}`} data-testid={`calendar-day-${day}`}>
          <span className="spaces-day-head">{formatCanary(`${day}T12:00:00Z`, { weekday: 'short', day: 'numeric' })}</span>
          {items.length ? items.map(r => <div key={r.id} className={`spaces-slot is-${r.status}`} data-testid={`calendar-slot-${r.id}`}>
            <strong>{formatCanary(r.startsAt, { hour: '2-digit', minute: '2-digit' })}–{formatCanary(r.endsAt, { hour: '2-digit', minute: '2-digit' })}</strong> · {r.spaceKinds.map(k => kindLabel[k]).join(' + ')}
            <div>{r.detailsVisible ? r.title : 'Ocupado'}</div>
          </div>) : <span className="text-[10px] text-[#9aa29d]">Libre</span>}
        </div>;
      })}
    </div>
  </section>;
}

function ReservationList({ data, reservations, canBook, refreshing, onRefresh, onNew, onEdit }: { data: LearningSpacesOverview; reservations: SpaceReservation[]; canBook: boolean; refreshing: boolean; onRefresh: () => void; onNew: () => void; onEdit: (r: SpaceReservation) => void }) {
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [family, setFamily] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const rows = reservations.filter(r => (!kind || r.spaceKinds.includes(kind as SpaceReservationInputSpaceKindsItem)) && (!status || r.status === status) && (!family || r.professionalFamily === family)
    && (!from || canaryDayKey(r.startsAt) >= from) && (!to || canaryDayKey(r.startsAt) <= to));
  const activityTitle = (id: string | null) => id ? data.activities.find(a => a.id === id)?.title ?? 'Actuación enlazada' : null;
  return <section className="panel p-5" aria-label="Reservas">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div><p className="eyebrow">Registro del curso</p><h2 className="mt-1 font-[var(--app-font-serif)] text-lg font-bold text-[#174f49]">Reservas por orden cronológico</h2></div>
      <div className="flex flex-wrap gap-2">
        <button className="quiet-action flex items-center gap-1.5" onClick={onRefresh} disabled={refreshing} data-testid="button-refresh-spaces"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />Actualizar</button>
        {canBook && data.spaces.length > 0 && <button className="primary-action flex items-center gap-1.5" onClick={onNew} data-testid="button-new-reservation"><Plus size={15} />Nueva reserva</button>}
      </div>
    </div>
    {!canBook && <p className="mb-3 text-xs text-[#6f7974]" data-testid="text-spaces-readonly">Tu rol es de consulta: puedes ver la ocupación, pero no crear reservas.</p>}
    <div className="spaces-filters mb-2">
      <label><span className="spaces-label">Espacio</span><select className="field" value={kind} onChange={e => setKind(e.target.value)} data-testid="filter-space-kind"><option value="">Todos</option><option value="ateca">ATECA</option><option value="fablab">FABLab</option></select></label>
      <label><span className="spaces-label">Estado</span><select className="field" value={status} onChange={e => setStatus(e.target.value)} data-testid="filter-space-status"><option value="">Todos</option>{Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label><span className="spaces-label">Familia profesional</span><select className="field" value={family} onChange={e => setFamily(e.target.value)} data-testid="filter-space-family"><option value="">Todas</option>{data.families.map(f => <option key={f} value={f}>{f}</option>)}</select></label>
      <label><span className="spaces-label">Desde</span><input type="date" className="field" value={from} onChange={e => setFrom(e.target.value)} data-testid="filter-space-from" /></label>
      <label><span className="spaces-label">Hasta</span><input type="date" className="field" value={to} onChange={e => setTo(e.target.value)} data-testid="filter-space-to" /></label>
    </div>
    {rows.length === 0 ? <p className="py-8 text-center text-sm text-[#6f7974]" data-testid="empty-reservations">{reservations.length ? 'Ninguna reserva coincide con los filtros.' : 'Todavía no hay reservas en este curso.'}</p>
      : rows.map(r => <div key={r.id} className="spaces-row" data-testid={`row-reservation-${r.id}`}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`spaces-status is-${r.status}`} data-testid={`status-reservation-${r.id}`}>{statusLabel[r.status]}</span>
            {r.spaceKinds.map(k => <span key={k} className={`space-tag ${k === 'fablab' ? 'is-fablab' : ''}`}>{kindLabel[k]}</span>)}
          </div>
          <p className="mt-1.5 text-sm font-bold text-[#34444a]" data-testid={`text-reservation-title-${r.id}`}>{r.detailsVisible ? r.title : 'Ocupado'}</p>
          <p className="text-xs text-[#5f6b66]">{formatRange(r.startsAt, r.endsAt)} · hora de Canarias</p>
          {r.detailsVisible && <p className="mt-1 text-xs text-[#5f6b66]">{r.professionalFamily}{r.groupLabel ? ` · ${r.groupLabel}` : ''}{activityTitle(r.activityId) ? ` · Actuación: ${activityTitle(r.activityId)}` : ''}</p>}
          {r.detailsVisible && r.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-[#6f7974]">{r.notes}</p>}
          {openHistory === r.id && <div className="mt-2"><VersionHistory entityId={r.id} /></div>}
        </div>
        {r.detailsVisible && <div className="flex flex-wrap gap-2">
          <button className="quiet-action flex items-center gap-1.5" onClick={() => setOpenHistory(openHistory === r.id ? null : r.id)} data-testid={`button-reservation-history-${r.id}`}><History size={14} />Historial</button>
          {r.canEdit && <button className="quiet-action flex items-center gap-1.5" onClick={() => onEdit(r)} data-testid={`button-edit-reservation-${r.id}`}><Pencil size={14} />Editar</button>}
        </div>}
      </div>)}
  </section>;
}

type FormState = { title: string; spaceKinds: SpaceReservationInputSpaceKindsItem[]; start: string; end: string; professionalFamily: string; groupLabel: string; status: SpaceReservationInputStatus; activityId: string; notes: string };

function ReservationForm({ data, user, existing, onClose }: { data: LearningSpacesOverview; user: User; existing: SpaceReservation | null; onClose: () => void }) {
  const client = useQueryClient();
  const create = useCreateSpaceReservation();
  const update = useUpdateSpaceReservation();
  const isManager = data.canManage || user.role === UserRole.admin_tecnico || user.role === UserRole.c2_innovacion;
  const [initialForm] = useState<FormState>(() => existing ? {
    title: existing.title, spaceKinds: [...existing.spaceKinds], start: isoToCanaryInput(existing.startsAt), end: isoToCanaryInput(existing.endsAt),
    professionalFamily: existing.professionalFamily, groupLabel: existing.groupLabel, status: existing.status, activityId: existing.activityId ?? '', notes: existing.notes,
  } : { title: '', spaceKinds: [], start: '', end: '', professionalFamily: isManager ? '' : data.actorFamily ?? '', groupLabel: '', status: 'reservada', activityId: '', notes: '' });
  const [form, setForm] = useState<FormState>(initialForm);
  // Revision captured at open time; only replaced by an explicit conflict decision.
  const [baseRevision, setBaseRevision] = useState(existing?.revision ?? 0);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const loadLatest = useLatestOverview();
  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm);
  const close = () => { if (dirty && !window.confirm('Hay cambios sin guardar en la reserva. ¿Descartarlos?')) return; onClose(); };
  const bounds = courseBounds(data.schoolYear);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));
  const startDay = form.start.slice(0, 10);
  const activityOptions = data.activities.filter(a => a.status === 'validada' && a.professionalFamily === form.professionalFamily && (!a.activityDate || a.activityDate.slice(0, 10) === startDay));
  useEffect(() => { if (form.status !== 'realizado' && form.activityId) setForm(f => ({ ...f, activityId: '' })); }, [form.status, form.activityId]);
  const pending = create.isPending || update.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault(); setError(''); setConflict(false);
    const startsAt = canaryInputToIso(form.start); const endsAt = canaryInputToIso(form.end);
    if (!form.spaceKinds.length) return setError('Selecciona al menos un espacio.');
    if (!startsAt || !endsAt) return setError('Indica inicio y fin válidos.');
    const ms = Date.parse(endsAt) - Date.parse(startsAt);
    if (ms <= 0) return setError('El fin debe ser posterior al inicio.');
    if (ms > 24 * 3600_000) return setError('Una reserva no puede superar 24 horas.');
    if (bounds && (form.start.slice(0, 10) < bounds.min || form.end.slice(0, 10) > bounds.max)) return setError(`Las fechas deben estar dentro del curso (${bounds.min} a ${bounds.max}).`);
    if (!isManager && form.professionalFamily !== data.actorFamily) return setError('Solo puedes reservar para tu familia profesional.');
    if (!existing && form.status !== 'reservada') return setError('Las reservas nuevas se crean como «Reservada».');
    if (form.status === 'cancelada' && !form.notes.trim()) return setError('Indica en Notas el motivo de la cancelación.');
    if (form.status === 'realizado' && !form.activityId) return setError('Para marcar «realizado» enlaza una actuación validada existente de la misma familia y día.');
    const payload: SpaceReservationInput = {
      expectedRevision: existing ? baseRevision : 0, title: form.title.trim(), spaceKinds: form.spaceKinds, startsAt, endsAt,
      professionalFamily: form.professionalFamily, groupLabel: form.groupLabel.trim(), status: form.status,
      activityId: form.status === 'realizado' ? form.activityId || null : null, notes: form.notes,
    };
    const done = (saved: SpaceReservation) => {
      client.setQueryData<LearningSpacesOverview>(getGetLearningSpacesQueryKey(), old => old ? { ...old, reservations: existing ? old.reservations.map(r => r.id === saved.id ? saved : r) : [...old.reservations, saved] } : old);
      client.invalidateQueries({ queryKey: getGetLearningSpacesQueryKey() });
      client.invalidateQueries({ queryKey: getGetSpaceRecordVersionsQueryKey(saved.id) });
      onClose();
    };
    const fail = (err: unknown) => { setError(errorText(err)); setConflict(!!existing && isRevisionConflict(err)); };
    if (existing) update.mutate({ reservationId: existing.id, data: payload }, { onSuccess: done, onError: fail });
    else create.mutate({ data: payload }, { onSuccess: done, onError: fail });
  };

  const toggleKind = (k: SpaceReservationInputSpaceKindsItem) => set('spaceKinds', form.spaceKinds.includes(k) ? form.spaceKinds.filter(x => x !== k) : [...form.spaceKinds, k]);
  const field = (id: string, label: string, child: ReactNode, wide = false) => <div className={wide ? 'is-wide' : ''}><label htmlFor={id} className="spaces-label">{label}</label>{child}</div>;

  return <section className="panel p-5" aria-label={existing ? 'Editar reserva' : 'Nueva reserva'} data-testid="form-reservation">
    <div className="mb-4 flex items-start justify-between gap-2"><div><p className="eyebrow">{existing ? `Editar reserva · revisión ${existing.revision}` : 'Nueva reserva'}</p><h2 className="mt-1 font-[var(--app-font-serif)] text-lg font-bold text-[#174f49]">{existing ? existing.title : 'Reservar ATECA, FABLab o ambos'}</h2></div><button className="quiet-action" onClick={close} aria-label="Cerrar formulario" data-testid="button-close-reservation"><X size={15} /></button></div>
    <form className="spaces-form" onSubmit={submit}>
      {field('res-title', 'Título', <input id="res-title" className="field" required maxLength={200} value={form.title} onChange={e => set('title', e.target.value)} data-testid="input-reservation-title" />, true)}
      <fieldset className="is-wide"><legend className="spaces-label">Espacios (uno o ambos en el mismo registro)</legend><div className="flex flex-wrap gap-2">
        {(['ateca', 'fablab'] as const).map(k => <label key={k} className="spaces-check"><input type="checkbox" checked={form.spaceKinds.includes(k)} onChange={() => toggleKind(k)} data-testid={`checkbox-reservation-${k}`} />{kindLabel[k]}</label>)}
      </div></fieldset>
      {field('res-start', 'Inicio (hora de Canarias)', <input id="res-start" type="datetime-local" className="field" required min={bounds ? `${bounds.min}T00:00` : undefined} max={bounds ? `${bounds.max}T23:59` : undefined} value={form.start} onChange={e => set('start', e.target.value)} data-testid="input-reservation-start" />)}
      {field('res-end', 'Fin (hora de Canarias)', <input id="res-end" type="datetime-local" className="field" required min={bounds ? `${bounds.min}T00:00` : undefined} max={bounds ? `${bounds.max}T23:59` : undefined} value={form.end} onChange={e => set('end', e.target.value)} data-testid="input-reservation-end" />)}
      {field('res-family', 'Familia profesional oficial', <select id="res-family" className="field" required value={form.professionalFamily} disabled={!isManager} onChange={e => set('professionalFamily', e.target.value)} data-testid="select-reservation-family"><option value="">Selecciona una familia</option>{(isManager ? data.families : data.actorFamily ? [data.actorFamily] : []).map(f => <option key={f} value={f}>{f}</option>)}</select>)}
      {field('res-group', 'Grupo (agregado, sin nombres de alumnado)', <input id="res-group" className="field" maxLength={160} placeholder="p. ej. 1.º CFGM Electromecánica" value={form.groupLabel} onChange={e => set('groupLabel', e.target.value)} data-testid="input-reservation-group" />)}
      {field('res-status', 'Estado', <select id="res-status" className="field" value={form.status} onChange={e => set('status', e.target.value as SpaceReservationInputStatus)} data-testid="select-reservation-status"><option value="reservada">Reservada</option>{existing && <option value="realizado">Realizado (requiere actuación validada)</option>}{existing && <option value="cancelada">Cancelada (se conserva el registro)</option>}</select>)}
      {form.status === 'realizado' && field('res-activity', 'Actuación validada existente', <><select id="res-activity" className="field" value={form.activityId} onChange={e => set('activityId', e.target.value)} data-testid="select-reservation-activity"><option value="">Selecciona una actuación</option>{activityOptions.map(a => <option key={a.id} value={a.id}>{a.title}{a.activityDate ? ` · ${a.activityDate.slice(0, 10)}` : ''}</option>)}</select>{!activityOptions.length && <span className="mt-1 block text-[11px] text-[#8a5a2b]" data-testid="text-no-activity-options">No hay actuaciones validadas de esta familia en ese día. No se crea ninguna automáticamente.</span>}</>)}
      {field('res-notes', form.status === 'cancelada' ? 'Notas · motivo de la cancelación (obligatorio)' : 'Notas', <><textarea id="res-notes" className="field" rows={3} maxLength={3000} required={form.status === 'cancelada'} aria-required={form.status === 'cancelada'} value={form.notes} onChange={e => set('notes', e.target.value)} data-testid="input-reservation-notes" />{form.status === 'cancelada' && <span className="mt-1 block text-[11px] text-[#6f7974]" data-testid="text-cancel-reason-hint">La cancelación conserva el registro; explica el motivo para la trazabilidad.</span>}{!existing && <span className="mt-1 block text-[11px] text-[#6f7974]">Las reservas nuevas se crean como «Reservada». Podrás marcarla realizada o cancelarla al editarla.</span>}</>, true)}
      {error && <p className="is-wide text-sm text-[#9b4337]" role="alert" data-testid="error-reservation">{error}</p>}
      {conflict && existing && <ConflictReview testPrefix="reservation" load={async () => {
        const latest = (await loadLatest()).reservations.find(r => r.id === existing.id);
        if (!latest) return null;
        const act = (id: string | null) => id ? data.activities.find(a => a.id === id)?.title ?? id : '';
        return { revision: latest.revision, rows: [
          { label: 'Título', latest: latest.title, mine: form.title },
          { label: 'Espacios', latest: latest.spaceKinds.map(k => kindLabel[k]).join(' + '), mine: form.spaceKinds.map(k => kindLabel[k]).join(' + ') },
          { label: 'Inicio', latest: isoToCanaryInput(latest.startsAt).replace('T', ' '), mine: form.start.replace('T', ' ') },
          { label: 'Fin', latest: isoToCanaryInput(latest.endsAt).replace('T', ' '), mine: form.end.replace('T', ' ') },
          { label: 'Familia', latest: latest.professionalFamily, mine: form.professionalFamily },
          { label: 'Grupo', latest: latest.groupLabel, mine: form.groupLabel },
          { label: 'Estado', latest: statusLabel[latest.status], mine: statusLabel[form.status] },
          { label: 'Actuación', latest: act(latest.activityId), mine: act(form.activityId || null) },
          { label: 'Notas', latest: latest.notes, mine: form.notes },
        ] };
      }} onAdopt={rev => { setBaseRevision(rev); setConflict(false); setError(`Base actualizada a la revisión ${rev}. Pulsa Guardar para aplicar tus valores.`); }} />}
      {existing && <p className="is-wide text-[10px] text-[#8a938e]" data-testid="text-reservation-base-revision">Editando sobre la revisión {baseRevision}</p>}
      <div className="is-wide flex flex-wrap gap-2"><button className="primary-action" disabled={pending} data-testid="button-save-reservation">{pending ? 'Guardando…' : existing ? 'Guardar cambios' : 'Crear reserva'}</button><button type="button" className="quiet-action" onClick={close} data-testid="button-cancel-reservation">Cerrar sin guardar</button></div>
    </form>
  </section>;
}
