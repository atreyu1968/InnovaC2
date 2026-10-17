import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, CalendarClock, CheckCircle2, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import {
  useGetCiclope, getGetCiclopeQueryKey, useUpdateCiclopePolicy, getListCiclopeVersionsQueryKey, useActCiclopeTask, CiclopeTaskActionInputAction,
} from '@workspace/api-client-react';
import type { User, CiclopeOverview, CiclopeMeeting, CiclopeTask, CiclopeTaskActionInputAction as TaskActionValue } from '@workspace/api-client-react';
import { Alert, Head, fmt, messageFor, personName, stateNames, stateTone } from './ciclope/shared';
import { MeetingEditor } from './ciclope/MeetingEditor';
import { MeetingDetail } from './ciclope/MeetingDetail';

export function CiclopePage({ user }: { user: User }) {
  const client = useQueryClient();
  const overview = useGetCiclope({ query: { queryKey: getGetCiclopeQueryKey(), refetchOnMount: 'always', retry: false } });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | 'new-c1' | 'edit' | null>(null);
  const refresh = async (meetingId?: string) => {
    await client.invalidateQueries({ queryKey: getGetCiclopeQueryKey() });
    if (meetingId) await client.invalidateQueries({ queryKey: getListCiclopeVersionsQueryKey(meetingId) });
  };

  if (overview.isLoading) return <div className="space-y-4">{[1, 2, 3].map(n => <div key={n} className="skeleton h-24" />)}</div>;
  if (overview.isError) {
    const status = (overview.error as { status?: number } | null)?.status;
    return <Alert kind={status === 409 ? 'info' : 'error'} testId="status-ciclope-error">
      {status === 409 ? 'No hay un curso académico activo. CICLOPE estará disponible cuando se abra un curso.' : messageFor(overview.error)}
      <button className="ml-2 font-bold underline" onClick={() => overview.refetch()} data-testid="button-retry-ciclope">Reintentar</button></Alert>;
  }
  const data = overview.data;
  if (!data) return <Alert kind="info">Sin datos de CICLOPE.</Alert>;
  const selected = data.meetings.find(m => m.id === selectedId) ?? null;

  return <div className="fade-up space-y-6">
    <Summary data={data} onRefresh={() => overview.refetch()} fetching={overview.isFetching} />
    <div className="grid items-start gap-5 xl:grid-cols-[1fr_1fr]">
      <PolicyPanel data={data} onDone={() => refresh()} />
      <NoticesPanel data={data} />
    </div>
    <MeetingsPanel data={data} selectedId={selectedId} onSelect={id => { setSelectedId(id); setEditing(null); }}
      onCreate={kind => { setSelectedId(null); setEditing(kind); }} />
    {editing && (editing !== 'edit' || selected) && <MeetingEditor key={`${editing}-${selected?.id}-${selected?.revision}`} data={data}
      meeting={editing === 'edit' ? selected : null} preset={editing === 'new-c1' ? 'c1' : editing === 'new' ? 'ciclope' : null}
      onCancel={() => setEditing(null)} onSaved={async m => { setEditing(null); setSelectedId(m.id); await refresh(m.id); }} onConflict={() => refresh(selected?.id)} />}
    {selected && editing !== 'edit' && <MeetingDetail key={selected.id} data={data} meeting={selected} user={user} onEdit={() => setEditing('edit')} onDone={() => refresh(selected.id)} />}
    <TasksPanel data={data} user={user} onDone={() => refresh()} />
  </div>;
}

function Summary({ data, onRefresh, fetching }: { data: CiclopeOverview; onRefresh: () => void; fetching: boolean }) {
  const ciclope = data.meetings.filter(m => m.data.kind === 'ciclope' && m.state !== 'cancelada');
  const held = ciclope.filter(m => ['celebrada', 'acta_borrador', 'acta_validada'].includes(m.state)).length;
  return <section className="panel min-w-0 p-5 md:p-6" data-testid="panel-ciclope-status">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="eyebrow">Estado de la comisión · curso {data.schoolYearLabel}</p>
        <p className="mt-1 text-xs text-[#68746e]">{data.canManage ? 'Gestión C2 / administración' : data.canApprove ? 'Refrendo de dirección' : 'Vista de persona convocada: solo reuniones a las que estás invitada/o.'}</p></div>
      <button className="flex items-center gap-2 quiet-action flex items-center gap-2" onClick={onRefresh} disabled={fetching} data-testid="button-refresh-ciclope"><RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />Actualizar</button>
    </div>
    <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[#eee9df] pt-4 sm:grid-cols-4">
      <Stat label="Sesiones CICLOPE (activas)" value={`${ciclope.length} / ${data.minimumMeetings}`} testId="stat-ciclope-count" />
      <Stat label="Celebradas" value={String(held)} testId="stat-ciclope-held" />
      <Stat label="Reuniones red C1" value={String(data.meetings.filter(m => m.data.kind === 'red_c1').length)} testId="stat-c1-count" />
      <Stat label="Tareas abiertas" value={String(data.tasks.filter(t => !t.completedAt).length)} testId="stat-open-tasks" />
    </div>
    {ciclope.length < data.minimumMeetings && <p className="mt-3 text-[11px] text-[#8a5a1c]">Faltan {data.minimumMeetings - ciclope.length} sesión(es) CICLOPE distintas para el mínimo del programa. Las reuniones de red C1 no computan.</p>}
  </section>;
}
function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return <div className="min-w-0"><p className="text-[10px] uppercase tracking-wider text-[#7b8580]">{label}</p><p className="mt-1 font-[var(--app-font-serif)] text-xl font-bold text-[#26383d]" data-testid={testId}>{value}</p></div>;
}

function PolicyPanel({ data, onDone }: { data: CiclopeOverview; onDone: () => Promise<void> }) {
  const update = useUpdateCiclopePolicy();
  const [approval, setApproval] = useState(data.policy.requireInstitutionalApproval);
  const [channel, setChannel] = useState(data.policy.authorizedInternalChannel);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const dirty = approval !== data.policy.requireInstitutionalApproval || channel !== data.policy.authorizedInternalChannel;
  const save = () => {
    setMsg(null);
    update.mutate({ data: { expectedRevision: data.policy.revision, requireInstitutionalApproval: approval, authorizedInternalChannel: channel } }, {
      onSuccess: async () => { setMsg({ kind: 'success', text: 'Política institucional guardada.' }); await onDone(); },
      onError: async e => { setMsg({ kind: 'error', text: messageFor(e) }); await onDone(); setApproval(data.policy.requireInstitutionalApproval); setChannel(data.policy.authorizedInternalChannel); },
    });
  };
  return <section className="panel overflow-hidden" data-testid="panel-ciclope-policy">
    <Head eyebrow={`Política institucional · revisión ${data.policy.revision}`} title="Refrendo y canal de convocatoria" icon={<ShieldCheck size={18} />} />
    <div className="space-y-3 p-5 md:p-6">
      <label className="flex items-start gap-2.5 text-xs text-[#405057]"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#347b69]" checked={approval} disabled={!data.canApprove} onChange={e => setApproval(e.target.checked)} data-testid="checkbox-policy-approval" /><span><strong>Exigir refrendo de dirección</strong> antes de convocar.</span></label>
      <label className="flex items-start gap-2.5 text-xs text-[#405057]"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#347b69]" checked={channel} disabled={!data.canApprove} onChange={e => setChannel(e.target.checked)} data-testid="checkbox-policy-channel" /><span><strong>Canal interno autorizado:</strong> las convocatorias se publican como avisos dentro de INNOVA-C2. No se envía correo electrónico (fase 3B pendiente).</span></label>
      {!data.canApprove && <p className="text-[11px] text-[#77817c]">Solo administración o equipo directivo pueden modificar esta política.</p>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {data.canApprove && <button className="primary-action disabled:opacity-50" disabled={!dirty || update.isPending} onClick={save} data-testid="button-save-policy">{update.isPending ? 'Guardando…' : 'Guardar política'}</button>}
    </div>
  </section>;
}

function NoticesPanel({ data }: { data: CiclopeOverview }) {
  const titleFor = (id: string) => data.meetings.find(m => m.id === id)?.data.title ?? 'Reunión no visible';
  return <section className="panel overflow-hidden" data-testid="panel-ciclope-notices">
    <Head eyebrow="Avisos internos" title="Convocatorias y recordatorios" icon={<Bell size={18} />} />
    <div className="p-5 md:p-6">{data.notices.length ? <ul className="max-h-[260px] space-y-2 overflow-y-auto">{data.notices.map(n => <li key={n.id} className="rounded-lg border border-[#eee9df] bg-[#fffefa] px-3 py-2" data-testid={`row-notice-${n.id}`}><p className="text-xs font-bold text-[#34444a]">{n.title}</p><p className="mt-0.5 text-[10px] text-[#7b8580]">{fmt(n.createdAt)} · {titleFor(n.meetingId)}</p></li>)}</ul>
      : <p className="text-sm text-[#5f6e69]" data-testid="text-no-notices">No tienes avisos internos. Solo se muestran en la aplicación; no se envían correos.</p>}</div>
  </section>;
}

function overlaps(meetings: CiclopeMeeting[]) {
  const ids = new Set<string>();
  const active = meetings.filter(m => m.state !== 'cancelada');
  for (const a of active) for (const b of active) if (a.id < b.id && new Date(a.data.startsAt) < new Date(b.data.endsAt) && new Date(b.data.startsAt) < new Date(a.data.endsAt)) { ids.add(a.id); ids.add(b.id); }
  return ids;
}

function MeetingsPanel({ data, selectedId, onSelect, onCreate }: { data: CiclopeOverview; selectedId: string | null; onSelect: (id: string) => void; onCreate: (k: 'new' | 'new-c1') => void }) {
  const clash = useMemo(() => overlaps(data.meetings), [data.meetings]);
  const sorted = [...data.meetings].sort((a, b) => a.data.startsAt.localeCompare(b.data.startsAt));
  const list = (kind: 'ciclope' | 'red_c1') => {
    const items = sorted.filter(m => m.data.kind === kind);
    if (!items.length) return <p className="px-1 text-xs text-[#77817c]">{kind === 'ciclope' ? 'Sin sesiones CICLOPE visibles.' : 'Sin reuniones de red C1 visibles.'}</p>;
    return <ol className="space-y-2">{items.map((m, i) => <li key={m.id}><button onClick={() => onSelect(m.id)} className={`w-full rounded-lg border px-3.5 py-3 text-left transition-colors ${selectedId === m.id ? 'border-[#347b69] bg-[#f3f8f5]' : 'border-[#eee9df] bg-[#fffefa] hover:border-[#bcd4c8]'}`} data-testid={`button-meeting-${m.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-bold text-[#34444a]">{kind === 'ciclope' ? `Sesión ${i + 1} · ` : ''}{m.data.title}</span><span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${stateTone[m.state]}`}>{stateNames[m.state]}</span></div>
      <p className="mt-1 text-[11px] text-[#6f7974]">{fmt(m.data.startsAt)} – {new Date(m.data.endsAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · rev. {m.revision}</p>
      {clash.has(m.id) && <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-[#9b4337]"><AlertTriangle size={12} />Se solapa con otra reunión</p>}
    </button></li>)}</ol>;
  };
  return <section className="panel overflow-hidden" data-testid="panel-ciclope-meetings">
    <Head eyebrow="Calendario" title="Reuniones del curso" icon={<CalendarClock size={18} />} action={data.canManage && <div className="flex flex-wrap gap-2">
      <button className="primary-action flex items-center gap-1.5" onClick={() => onCreate('new')} data-testid="button-new-meeting"><Plus size={14} />Nueva reunión</button>
      <button className="quiet-action" onClick={() => onCreate('new-c1')} data-testid="button-prefill-c1">Precargar red C1 (21/10/2026)</button></div>} />
    <div className="grid gap-6 p-5 md:grid-cols-[1.4fr_1fr] md:p-6">
      <div><p className="eyebrow mb-2">Sesiones CICLOPE · mínimo {data.minimumMeetings}</p>{list('ciclope')}</div>
      <div><p className="eyebrow mb-2">Agenda externa · red C1</p>{list('red_c1')}<p className="mt-2 text-[10px] text-[#77817c]">Reuniones convocadas por la red externa. No computan como sesiones CICLOPE.</p></div>
    </div>
  </section>;
}

function TasksPanel({ data, user, onDone }: { data: CiclopeOverview; user: User; onDone: () => Promise<void> }) {
  const act = useActCiclopeTask();
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const run = (task: CiclopeTask, action: TaskActionValue, label: string) => {
    setMsg(null);
    act.mutate({ taskId: task.id, data: { action } }, { onSuccess: async () => { setMsg({ kind: 'success', text: label }); await onDone(); }, onError: async e => { setMsg({ kind: 'error', text: messageFor(e) }); await onDone(); } });
  };
  const T = CiclopeTaskActionInputAction;
  const name = (id: string) => personName(data, id);
  const meetingTitle = (id: string) => data.meetings.find(m => m.id === id)?.data.title ?? 'Reunión no visible';
  return <section className="panel overflow-hidden" data-testid="panel-ciclope-tasks">
    <Head eyebrow="Seguimiento de acuerdos" title="Tareas derivadas de actas" icon={<Users size={18} />} />
    <div className="space-y-3 p-5 md:p-6">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {!data.tasks.length ? <p className="text-sm text-[#5f6e69]" data-testid="text-no-tasks">No hay tareas visibles. Se generan a partir de los acuerdos de actas validadas.</p> :
        <ul className="divide-y divide-[#eee9df]">{data.tasks.map(t => { const own = t.responsibleUserId === user.id; return <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-3" data-testid={`row-task-${t.id}`}>
          <div className="min-w-0"><p className={`text-xs font-bold ${t.completedAt ? 'text-[#8a8f8a] line-through' : 'text-[#34444a]'}`}>{t.title}</p>
            <p className="mt-0.5 text-[10px] text-[#7b8580]">{name(t.responsibleUserId)} · vence {t.dueDate} · {t.remindersEnabled ? 'recordatorios activos' : 'sin recordatorios'}{t.completedAt ? ` · completada ${fmt(t.completedAt)}` : ''}</p>
            <p className="mt-0.5 font-mono text-[9px] text-[#84908a]">{meetingTitle(t.meetingId)} · versión de acta {t.sourceVersionId}</p></div>
          <div className="flex flex-wrap gap-1.5">
            {own && (t.completedAt ? <button className="quiet-action text-xs" disabled={act.isPending} onClick={() => run(t, T.reabrir, 'Tarea reabierta.')} data-testid={`button-task-reopen-${t.id}`}>Reabrir</button> : <button className="primary-action flex items-center gap-1 text-xs" disabled={act.isPending} onClick={() => run(t, T.completar, 'Tarea completada.')} data-testid={`button-task-complete-${t.id}`}><CheckCircle2 size={12} />Completar</button>)}
            {own && <button className="quiet-action text-xs" disabled={act.isPending} onClick={() => run(t, t.remindersEnabled ? T.desactivar_recordatorios : T.activar_recordatorios, 'Preferencia de recordatorios guardada.')} data-testid={`button-task-reminders-${t.id}`}>{t.remindersEnabled ? 'Desactivar recordatorios' : 'Activar recordatorios'}</button>}
            {data.canManage && !t.completedAt && <button className="quiet-action flex items-center gap-1 text-xs" disabled={act.isPending || !t.remindersEnabled} title={t.remindersEnabled ? 'Aviso interno a la persona responsable' : 'La persona responsable no tiene recordatorios activos'} onClick={() => run(t, T.recordar, 'Recordatorio interno enviado a la persona responsable.')} data-testid={`button-task-remind-${t.id}`}><Bell size={12} />Recordar</button>}
          </div>
        </li>; })}</ul>}
    </div>
  </section>;
}
