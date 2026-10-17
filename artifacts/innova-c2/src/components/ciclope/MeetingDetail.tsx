import { useState, type ReactNode } from 'react';
import type { PinnedAttachment } from './shared';
import { CalendarClock, Download, History } from 'lucide-react';
import { CiclopeMeetingRecording } from './CiclopeMeetingRecording';
import {
  useActCiclopeMeeting, useListCiclopeVersions, getListCiclopeVersionsQueryKey, exportCiclopeMeeting, CiclopeActionInputAction,
  useListDocuments, getListDocumentsQueryKey,
} from '@workspace/api-client-react';
import type { User, CiclopeOverview, CiclopeMeeting, CiclopeActionInputAction as ActionValue } from '@workspace/api-client-react';
import { Alert, AttachmentRow, Head, attendanceNames, fmt, messageFor, parseContribution, personName, saveBlob, stateNames, stateTone } from './shared';
export function MeetingDetail({ data, meeting, user, onEdit, onDone }: { data: CiclopeOverview; meeting: CiclopeMeeting; user: User; onEdit: () => void; onDone: () => Promise<void> }) {
  const act = useActCiclopeMeeting();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const d = meeting.data;
  const name = (id: string | null, snap?: string | null) => personName(data, id, snap);
  const ended = new Date(d.endsAt).getTime() <= Date.now();
  const isC1 = d.kind === 'red_c1';
  const c1Ready = !!d.externalSender.trim() && !!d.location.trim() && d.participants.length > 0 && d.agenda.length > 0;
  const isValidator = data.canApprove && (user.role === 'admin_tecnico' || d.validatorUserIds.includes(user.id));
  const policy = data.policy;
  const approvedCurrent = meeting.approvedPolicyRevision === policy.revision;
  const run = (action: ActionValue, label: string, withText = false) => {
    setMsg(null);
    act.mutate({ meetingId: meeting.id, data: { expectedRevision: meeting.revision, action, ...(withText && text.trim() ? { text: text.trim() } : {}) } }, {
      onSuccess: async () => { setMsg({ kind: 'success', text: `${label}: hecho.` }); if (withText) setText(''); await onDone(); },
      onError: async e => { setMsg({ kind: 'error', text: messageFor(e) }); await onDone(); },
    });
  };
  const A = CiclopeActionInputAction;
  const btn = (action: ActionValue, label: string, opts: { withText?: boolean; danger?: boolean; disabled?: boolean } = {}) =>
    <button className={`${opts.danger ? 'quiet-action !text-[#9b4337]' : 'primary-action'} disabled:opacity-50`} disabled={act.isPending || opts.disabled} onClick={() => run(action, label, opts.withText)} data-testid={`button-action-${action}`}>{label}</button>;

  return <section className="panel overflow-hidden" data-testid={`panel-meeting-${meeting.id}`}>
    <Head eyebrow={`${d.kind === 'ciclope' ? 'Sesión CICLOPE' : 'Red C1 · agenda externa'} · revisión ${meeting.revision}`} title={d.title} icon={<CalendarClock size={18} />}
      action={<span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${stateTone[meeting.state]}`} data-testid="status-meeting-state">{stateNames[meeting.state]}</span>} />
    <div className="grid gap-6 p-5 md:p-6 xl:grid-cols-[1.3fr_1fr]">
      <div className="space-y-4 text-xs text-[#34444a]">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Def k="Inicio" v={fmt(d.startsAt)} /><Def k="Fin" v={fmt(d.endsAt)} /><Def k="Lugar" v={d.location || 'Sin indicar'} />
          <Def k="Presidencia" v={name(d.chairUserId)} /><Def k="Secretaría" v={name(d.secretaryUserId)} />
          <Def k="Validación del acta" v={d.validatorUserIds.map(id => name(id)).join(', ') || 'Sin asignar'} />
          <Def k="Refrendo" v={isC1 ? 'No aplicable: convocatoria externa recibida' : meeting.approvedPolicyRevision !== null && (meeting.state !== 'programada' || approvedCurrent) ? `Aprobado (política rev. ${meeting.approvedPolicyRevision})` : meeting.state !== 'programada' ? 'Sin refrendo registrado' : meeting.approvalRequested ? 'Solicitado, pendiente' : policy.requireInstitutionalApproval ? 'No solicitado (exigido)' : 'No exigido'} />
          {d.kind === 'red_c1' && <><Def k="Remitente" v={d.externalSender || 'Sin indicar'} /><Def k="Comprobaciones" v={`LAYCOS ${d.externalChecks.laycos} · cuestionario ${d.externalChecks.questionnaire} · constitución ${d.externalChecks.constituted}`} /></>}
          
        </dl>
        <Block title="Finalidad"><p className="whitespace-pre-wrap">{d.purpose}</p></Block>
        <Block title="Orden del día">{d.agenda.length ? <ol className="list-decimal space-y-1 pl-5">{d.agenda.map((a, i) => <li key={i}>{a}</li>)}</ol> : <p className="text-[#77817c]">Sin puntos.</p>}</Block>
        <Block title="Aportaciones de miembros">{meeting.contributions.length ? <ul className="space-y-1">{meeting.contributions.map((c, i) => { const pc = parseContribution(data, c); return <li key={i} className="rounded-md bg-[#f7f5ef] px-2.5 py-1.5" data-testid={`text-contribution-${i}`}>{pc.author && <span className="font-bold">{pc.author}: </span>}{pc.text}</li>; })}</ul> : <p className="text-[#77817c]">Sin aportaciones.</p>}</Block>
        <Block title="Composición y asistencia">{d.participants.length ? <ul className="divide-y divide-[#eee9df]">{d.participants.map(p => <li key={p.userId} className="flex flex-wrap justify-between gap-2 py-1.5"><span><strong>{name(p.userId, p.name)}</strong> · {p.formalRole}{p.appointedOn ? ` · nombrado/a ${p.appointedOn}` : ''}</span><span className="text-[#5f6e69]">{attendanceNames[p.attendance]}</span></li>)}</ul> : <p className="text-[#77817c]">Sin participantes.</p>}</Block>
        <Block title="Documentación adjunta"><DetailAttachments ids={d.attachmentIds} pinned={d.pinnedAttachments} /></Block>
         <Block title="Notas / acta"><p className="whitespace-pre-wrap">{d.notes || 'Sin notas.'}</p></Block>
         {meeting.transcription && <Block title="Transcripción de la reunión"><p className="whitespace-pre-wrap">{meeting.transcription.text}</p><p className="mt-2 text-[10px] text-[#6b7774]">Origen: {meeting.transcription.source === 'in_person' ? 'presencial' : meeting.transcription.source === 'online' ? 'online' : 'archivo subido'} · Procesada {new Date(meeting.transcription.completedAt).toLocaleString()} · El audio original se eliminó tras procesarlo.</p></Block>}
        <Block title="Acuerdos">{d.agreements.length ? <ul className="space-y-1">{d.agreements.map((a, i) => <li key={i}>{a.title} · <span className="text-[#5f6e69]">{name(a.responsibleUserId, a.responsibleName)} · vence {a.dueDate}</span></li>)}</ul> : <p className="text-[#77817c]">Sin acuerdos.</p>}</Block>
      </div>
      <div className="space-y-4">
        <div className="space-y-2 rounded-lg border border-[#eee9df] bg-[#fbfaf5] p-4"><p className="eyebrow">Acciones</p>
          <textarea className="field min-h-[70px] text-xs" maxLength={5000} placeholder="Texto opcional: aportación, motivo de cancelación o comentario de la acción" value={text} onChange={e => setText(e.target.value)} data-testid="input-action-text" />
          <div className="flex flex-wrap gap-2">
            {meeting.state === 'programada' && <button className="primary-action disabled:opacity-50" disabled={act.isPending || !text.trim()} onClick={() => run(A.aportar, 'Aportación al orden del día', true)} data-testid="button-action-aportar">Aportar al orden del día</button>}
            {data.canManage && ['programada', 'celebrada', 'acta_borrador'].includes(meeting.state) && <button className="quiet-action" onClick={onEdit} data-testid="button-edit-meeting">Editar</button>}
            {data.canManage && !isC1 && meeting.state === 'programada' && policy.requireInstitutionalApproval && !meeting.approvalRequested && btn(A.solicitar_refrendo, 'Solicitar refrendo')}
            {data.canApprove && !isC1 && meeting.state === 'programada' && meeting.approvalRequested && !approvedCurrent && btn(A.aprobar_convocatoria, 'Aprobar convocatoria (dirección)')}
            {data.canManage && meeting.state === 'programada' && (isC1 ? btn(A.convocar, 'Registrar convocatoria recibida', { disabled: !c1Ready }) : btn(A.convocar, 'Convocar (aviso interno)', { disabled: !policy.authorizedInternalChannel || (policy.requireInstitutionalApproval && !approvedCurrent) }))}
            {data.canManage && meeting.state === 'convocada' && btn(A.celebrar, 'Marcar como celebrada', { disabled: !ended })}
            {data.canManage && meeting.state === 'celebrada' && btn(A.preparar_acta, 'Preparar borrador de acta', { withText: true })}
            {isValidator && meeting.state === 'acta_borrador' && btn(A.validar_acta, 'Validar acta')}
            {data.canManage && ['programada', 'convocada'].includes(meeting.state) && btn(A.cancelar, 'Cancelar reunión', { withText: true, danger: true, disabled: !text.trim() })}
          </div>
          {data.canManage && isC1 && meeting.state === 'programada' && !c1Ready && <p className="text-[10px] text-[#9b4337]">Para registrar la convocatoria recibida: remitente, lugar o enlace, participantes y orden del día.</p>}
          {data.canManage && ['celebrada', 'acta_borrador'].includes(meeting.state) && <CiclopeMeetingRecording meetingId={meeting.id} meetingTitle={d.title} meetingStartsAt={d.startsAt} currentNotes={d.notes} onDone={onDone} />}
          {data.canManage && !isC1 && meeting.state === 'programada' && !policy.authorizedInternalChannel && <p className="text-[10px] text-[#9b4337]">Para convocar, la política debe autorizar el canal interno.</p>}
          {data.canManage && meeting.state === 'convocada' && !ended && <p className="text-[10px] text-[#77817c]">Solo puede marcarse como celebrada cuando haya pasado su hora de fin.</p>}
          {data.canManage && ['programada', 'convocada'].includes(meeting.state) && <p className="text-[10px] text-[#77817c]">La cancelación exige indicar el motivo en el campo de texto.</p>}
          {meeting.state === 'acta_borrador' && !isValidator && <p className="text-[10px] text-[#77817c]">La validación corresponde a las personas designadas como validadoras.</p>}
          {msg && <Alert kind={msg.kind} testId="status-action">{msg.text}</Alert>}
        </div>
        <VersionsPanel meeting={meeting} />
      </div>
    </div>
  </section>;
}
function Def({ k, v }: { k: string; v: string }) { return <div><dt className="text-[11px] text-[#7c8580]">{k}</dt><dd className="mt-0.5 font-semibold">{v}</dd></div>; }
function Block({ title, children }: { title: string; children: ReactNode }) { return <div><p className="eyebrow mb-1.5">{title}</p>{children}</div>; }

function VersionsPanel({ meeting }: { meeting: CiclopeMeeting }) {
  const versions = useListCiclopeVersions(meeting.id, { query: { queryKey: getListCiclopeVersionsQueryKey(meeting.id), refetchOnMount: 'always' } });
  const [rev, setRev] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const list = [...(versions.data ?? [])].sort((a, b) => b.revision - a.revision);
  const chosen = list.find(v => v.revision === rev) ?? list[0];
  const download = async (doc: 'convocatoria' | 'acta', format: 'docx' | 'pdf') => {
    if (!chosen) return;
    setBusy(`${doc}-${format}`); setError('');
    try {
      saveBlob(await exportCiclopeMeeting(meeting.id, doc, chosen.revision, format, { responseType: 'blob' }), `CICLOPE-${doc}-${meeting.id}-r${chosen.revision}.${format}`);
    } catch (e) { setError(messageFor(e)); } finally { setBusy(''); }
  };
  return <div className="space-y-2 rounded-lg border border-[#eee9df] p-4" data-testid="panel-versions"><p className="eyebrow flex items-center gap-1.5"><History size={13} />Historial inmutable</p>
    {versions.isLoading ? <div className="skeleton h-10" /> : versions.isError ? <Alert kind="error">{messageFor(versions.error)} <button className="ml-1 font-bold underline" onClick={() => versions.refetch()}>Reintentar</button></Alert> : !list.length ? <p className="text-xs text-[#77817c]">Sin versiones.</p> : <>
      <select className="field text-xs" value={chosen?.revision ?? ''} onChange={e => setRev(Number(e.target.value))} data-testid="select-version">{list.map(v => <option key={v.id} value={v.revision}>Rev. {v.revision} · {stateNames[v.content.state]} · {fmt(v.createdAt)}</option>)}</select>
      {chosen && <p className="text-[10px] text-[#6f7974]">Creada por {chosen.createdBy} · {chosen.content.data.agreements.length} acuerdo(s) · {chosen.content.data.participants.length} participante(s)</p>}
      <div className="grid grid-cols-2 gap-2">{(['convocatoria', 'acta'] as const).flatMap(doc => (['docx', 'pdf'] as const).map(f => <button key={doc + f} className="quiet-action flex items-center justify-center gap-1.5 text-xs disabled:opacity-50" disabled={!!busy} onClick={() => download(doc, f)} data-testid={`button-export-${doc}-${f}`}><Download size={12} />{busy === `${doc}-${f}` ? 'Generando…' : `${doc === 'acta' ? 'Acta' : 'Convocatoria'} ${f.toUpperCase()}`}</button>))}</div>
      {error && <Alert kind="error">{error}</Alert>}</>}
  </div>;
}

function DetailAttachments({ ids, pinned }: { ids: string[]; pinned?: PinnedAttachment[] }) {
  const docs = useListDocuments({ query: { queryKey: getListDocumentsQueryKey(), enabled: ids.length > 0 } });
  if (!ids.length) return <p className="text-[#77817c]">Sin adjuntos.</p>;
  if (docs.isLoading) return <div className="skeleton h-10" />;
  return <ul className="space-y-2">{ids.map(id => <AttachmentRow key={id} id={id} doc={docs.data?.find(d => d.id === id)} pinned={pinned?.find(p => p.documentId === id)} />)}</ul>;
}
