import { useState, type FormEvent } from 'react';
import type { PinnedAttachment } from './shared';
import { FileText, Paperclip } from 'lucide-react';
import {
  useCreateCiclopeMeeting, useUpdateCiclopeMeeting, useListDocuments, getListDocumentsQueryKey, CiclopeParticipantAttendance, useGetCurrentPicPlan, getGetCurrentPicPlanQueryKey,
} from '@workspace/api-client-react';
import type {
  CiclopeOverview, CiclopeMeeting, CiclopeMeetingInput, CiclopePerson, CiclopeParticipant, CiclopeAgreement,
  CiclopeParticipantAttendance as AttendanceValue,
} from '@workspace/api-client-react';
import { Alert, AttachmentRow, Head, Label, attendanceNames, fromLocalInput, isAttachable, messageFor, stateNames, toLocalInput } from './shared';

type CheckValue = 'pendiente' | 'verificado';
const checkNames = { laycos: 'Registro en LAYCOS', questionnaire: 'Cuestionario de la red', constituted: 'CICLOPE constituido' } as const;

function emptyInput(kind: 'ciclope' | 'red_c1'): CiclopeMeetingInput {
  return { expectedRevision: 0, kind, title: '', startsAt: '', endsAt: '', purpose: '', location: '', participants: [], agenda: [], notes: '', agreements: [], chairUserId: null, secretaryUserId: null, validatorUserIds: [], attachmentIds: [], externalSender: '', externalChecks: { laycos: 'pendiente', questionnaire: 'pendiente', constituted: 'pendiente' } };
}

export function MeetingEditor({ data, meeting, preset, onCancel, onSaved, onConflict }: { data: CiclopeOverview; meeting: CiclopeMeeting | null; preset: 'ciclope' | 'c1' | null; onCancel: () => void; onSaved: (m: CiclopeMeeting) => Promise<void>; onConflict: () => Promise<void> }) {
  const create = useCreateCiclopeMeeting();
  const update = useUpdateCiclopeMeeting();
  const [form, setForm] = useState<CiclopeMeetingInput>(() => {
    if (meeting) return { ...meeting.data, expectedRevision: meeting.revision };
    if (preset === 'c1') return { ...emptyInput('red_c1'), title: 'Reunión de red C1', startsAt: '2026-10-21T10:15:00.000Z', endsAt: '2026-10-21T11:15:00.000Z', externalSender: 'Aurelio Fernández (CIFP Gran Sur)' };
    return emptyInput('ciclope');
  });
  const [error, setError] = useState('');
  const metaLocked = !!meeting && meeting.state !== 'programada';
  const set = <K extends keyof CiclopeMeetingInput>(k: K, v: CiclopeMeetingInput[K]) => setForm(f => ({ ...f, [k]: v }));
  const pending = create.isPending || update.isPending;
  const people = data.people;
  const plan = useGetCurrentPicPlan({ query: { queryKey: getGetCurrentPicPlanQueryKey(), enabled: data.canManage, retry: false } });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!form.startsAt || !form.endsAt || new Date(form.endsAt) <= new Date(form.startsAt)) { setError('La hora de fin debe ser posterior al inicio.'); return; }
    if (form.agreements.some(a => !a.responsibleUserId)) { setError('Cada acuerdo necesita una persona responsable.'); return; }
    const payload: CiclopeMeetingInput = { ...form, agenda: form.agenda.map(a => a.trim()).filter(Boolean), expectedRevision: meeting ? meeting.revision : 0 };
    const opts = { onSuccess: (m: CiclopeMeeting) => onSaved(m), onError: async (err: unknown) => { setError(messageFor(err)); await onConflict(); } };
    if (meeting) update.mutate({ meetingId: meeting.id, data: payload }, opts); else create.mutate({ data: payload }, opts);
  };
  return <section className="panel overflow-hidden" data-testid="panel-meeting-editor">
    <Head eyebrow={meeting ? `Editar · revisión ${meeting.revision} · ${stateNames[meeting.state]}` : 'Nueva reunión'} title={form.title || 'Reunión sin título'} icon={<FileText size={18} />} />
    <form className="space-y-5 p-5 md:p-6" onSubmit={submit}>
      {preset === 'c1' && <Alert kind="info">Datos externos precargados: 21/10/2026, 11:15 hora canaria (10:15 UTC), 60 minutos, remitente Aurelio Fernández (CIFP Gran Sur). Comprobaciones y asistencia quedan pendientes. No se incluye enlace de videoconferencia: añade lugar o enlace solo si lo ha facilitado la red.</Alert>}
      {metaLocked && <Alert kind="warning">La reunión ya no está programada: los metadatos están bloqueados. Tras celebrarse, solo se pueden modificar notas, asistencia y acuerdos (lo comprueba el servidor).</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        <Label text="Tipo"><select className="field" value={form.kind} disabled={!!meeting} onChange={e => set('kind', e.target.value as CiclopeMeetingInput['kind'])} data-testid="select-meeting-kind"><option value="ciclope">Sesión CICLOPE</option><option value="red_c1">Red C1 (convocatoria externa recibida)</option></select></Label>
        <Label text="Título"><input className="field" required minLength={3} maxLength={250} value={form.title} disabled={metaLocked} onChange={e => set('title', e.target.value)} data-testid="input-meeting-title" /></Label>
        <Label text="Inicio"><input type="datetime-local" className="field" required value={form.startsAt ? toLocalInput(form.startsAt) : ''} disabled={metaLocked} onChange={e => set('startsAt', fromLocalInput(e.target.value))} data-testid="input-meeting-start" /></Label>
        <Label text="Fin"><input type="datetime-local" className="field" required value={form.endsAt ? toLocalInput(form.endsAt) : ''} disabled={metaLocked} onChange={e => set('endsAt', fromLocalInput(e.target.value))} data-testid="input-meeting-end" /></Label>
        <Label text="Lugar o enlace"><input className="field" maxLength={2000} value={form.location} disabled={metaLocked} onChange={e => set('location', e.target.value)} data-testid="input-meeting-location" /></Label>
        {form.kind === 'red_c1' && <Label text="Remitente externo"><input className="field" maxLength={500} value={form.externalSender} disabled={metaLocked} onChange={e => set('externalSender', e.target.value)} data-testid="input-meeting-sender" /></Label>}
      </div>
      <Label text="Finalidad"><textarea className="field min-h-[70px]" required minLength={3} maxLength={5000} value={form.purpose} disabled={metaLocked} onChange={e => set('purpose', e.target.value)} data-testid="input-meeting-purpose" /></Label>
      {form.kind === 'red_c1' && <div><p className="eyebrow mb-2">Comprobaciones externas</p><div className="grid gap-3 sm:grid-cols-3">{(Object.keys(checkNames) as (keyof typeof checkNames)[]).map(k => <Label key={k} text={checkNames[k]}>
        <select className="field" value={form.externalChecks[k]} disabled={metaLocked} onChange={e => set('externalChecks', { ...form.externalChecks, [k]: e.target.value as CheckValue })} data-testid={`select-check-${k}`}><option value="pendiente">Pendiente</option><option value="verificado">Verificado</option></select></Label>)}</div>
        <p className="mt-1 text-[10px] text-[#77817c]">Marca como verificado solo lo que se haya comprobado. Editable mientras la reunión esté programada.</p></div>}
      {form.kind === 'ciclope' && <>
        <div className="grid gap-4 md:grid-cols-2">
          <Label text="Presidencia"><PersonSelect people={people} value={form.chairUserId} disabled={metaLocked} onChange={v => set('chairUserId', v)} testId="select-chair" /></Label>
          <Label text="Secretaría"><PersonSelect people={people} value={form.secretaryUserId} disabled={metaLocked} onChange={v => set('secretaryUserId', v)} testId="select-secretary" /></Label>
        </div>
        <div><p className="eyebrow mb-2">Validación humana competente del acta</p><div className="flex flex-wrap gap-2">{people.map(p => { const on = form.validatorUserIds.includes(p.id); return <label key={p.id} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] ${on ? 'border-[#347b69] bg-[#f3f8f5]' : 'border-[#e5dfd2]'}`}><input type="checkbox" className="accent-[#347b69]" checked={on} disabled={metaLocked} onChange={e => set('validatorUserIds', e.target.checked ? [...form.validatorUserIds, p.id] : form.validatorUserIds.filter(x => x !== p.id))} data-testid={`checkbox-validator-${p.id}`} />{p.name}</label>; })}</div></div>
      </>}
      <ParticipantsEditor people={people} value={form.participants} metaLocked={metaLocked} onChange={v => set('participants', v)} />
      <ListEditor label="Orden del día" value={form.agenda} disabled={metaLocked} onChange={v => set('agenda', v)} />
      {!metaLocked && <div className="flex flex-wrap gap-2">
        <button type="button" className="quiet-action text-xs" disabled={!data.tasks.some(t => !t.completedAt)} onClick={() => set('agenda', [...new Set([...form.agenda, ...data.tasks.filter(t => !t.completedAt).map(t => `Seguimiento del acuerdo: ${t.title}`)])])}>Incorporar acuerdos pendientes</button>
        <button type="button" className="quiet-action text-xs" disabled={!plan.data?.content.selectedActions.length} onClick={() => set('agenda', [...new Set([...form.agenda, ...(plan.data?.content.selectedActions ?? []).map(a => `Seguimiento de la acción PIC ${a.actionCode}`)])])}>Incorporar acciones del PIC vigente</button>
        <p className="w-full text-[10px] text-[#77817c]">Son propuestas para revisar: no acreditan cumplimiento ni sustituyen las aportaciones de las personas participantes.</p>
      </div>}
      <AttachmentsPicker value={form.attachmentIds} pinned={metaLocked ? form.pinnedAttachments : undefined} disabled={metaLocked} onChange={v => set('attachmentIds', v)} />
      <Label text="Notas / borrador manual del acta"><textarea className="field min-h-[120px]" maxLength={50000} value={form.notes} onChange={e => set('notes', e.target.value)} data-testid="input-meeting-notes" /></Label>
      <p className="text-[10px] text-[#77817c]">La redacción asistida por IA no está disponible hasta la fase 6. El acta se redacta manualmente.</p>
      <AgreementsEditor people={people} value={form.agreements} onChange={v => set('agreements', v)} />
      {error && <Alert kind="error" testId="status-meeting-error">{error}</Alert>}
      <div className="flex flex-wrap gap-2"><button type="submit" className="primary-action disabled:opacity-50" disabled={pending} data-testid="button-save-meeting">{pending ? 'Guardando…' : meeting ? 'Guardar cambios' : 'Crear reunión'}</button><button type="button" className="quiet-action" onClick={onCancel} data-testid="button-cancel-meeting">Cancelar</button></div>
    </form>
  </section>;
}

function PersonSelect({ people, value, onChange, disabled, testId }: { people: CiclopePerson[]; value: string | null; onChange: (v: string | null) => void; disabled?: boolean; testId: string }) {
  return <select className="field" value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value || null)} data-testid={testId}><option value="">Sin asignar</option>{people.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}</select>;
}

function ParticipantsEditor({ people, value, metaLocked, onChange }: { people: CiclopePerson[]; value: CiclopeParticipant[]; metaLocked: boolean; onChange: (v: CiclopeParticipant[]) => void }) {
  const patch = (i: number, p: Partial<CiclopeParticipant>) => onChange(value.map((x, j) => j === i ? { ...x, ...p } : x));
  const free = people.filter(p => !value.some(v => v.userId === p.id));
  return <div><p className="eyebrow mb-2">Composición, nombramientos y asistencia</p>
    {value.length ? <div className="space-y-2">{value.map((p, i) => { const live = people.find(x => x.id === p.userId); return <div key={p.userId} className="grid gap-2 rounded-lg border border-[#eee9df] p-2.5 md:grid-cols-[1.2fr_1.2fr_.9fr_.9fr_auto] md:items-end" data-testid={`row-participant-${p.userId}`}>
      <div className="min-w-0"><p className="truncate text-xs font-bold text-[#34444a]">{p.name ?? live?.name ?? 'Persona no visible'}</p><p className="truncate text-[10px] text-[#7b8580]">{p.email ?? live?.email ?? ''}{(p.professionalFamily ?? live?.professionalFamily) ? ` · ${p.professionalFamily ?? live?.professionalFamily}` : ''}</p></div>
      <Label text="Cargo formal"><input className="field !py-1.5 text-xs" required maxLength={180} value={p.formalRole} disabled={metaLocked} onChange={e => patch(i, { formalRole: e.target.value })} data-testid={`input-role-${p.userId}`} /></Label>
      <Label text="Fecha de nombramiento anual"><input type="date" className="field !py-1.5 text-xs" value={p.appointedOn ?? ''} disabled={metaLocked} onChange={e => patch(i, { appointedOn: e.target.value || null })} data-testid={`input-appointed-${p.userId}`} /></Label>
      <Label text="Asistencia"><select className="field !py-1.5 text-xs" value={p.attendance} onChange={e => patch(i, { attendance: e.target.value as AttendanceValue })} data-testid={`select-attendance-${p.userId}`}>{Object.values(CiclopeParticipantAttendance).map(a => <option key={a} value={a}>{attendanceNames[a]}</option>)}</select></Label>
      <button type="button" className="quiet-action !px-2 !py-1 text-xs" disabled={metaLocked} onClick={() => onChange(value.filter((_, j) => j !== i))} data-testid={`button-remove-participant-${p.userId}`}>Quitar</button>
    </div>; })}</div> : <p className="text-xs text-[#77817c]">Sin participantes. Añade personas convocadas.</p>}
    {!metaLocked && free.length > 0 && <select className="field mt-2" value="" onChange={e => e.target.value && onChange([...value, { userId: e.target.value, formalRole: '', appointedOn: null, attendance: 'pendiente' }])} data-testid="select-add-participant"><option value="">Añadir participante…</option>{free.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}</select>}
  </div>;
}

function ListEditor({ label, value, disabled, onChange }: { label: string; value: string[]; disabled: boolean; onChange: (v: string[]) => void }) {
  return <div><p className="eyebrow mb-2">{label}</p><ol className="space-y-2">{value.map((a, i) => <li key={i} className="flex gap-2"><span className="pt-2 text-xs font-bold text-[#7b8580]">{i + 1}.</span><input className="field" maxLength={2000} value={a} disabled={disabled} onChange={e => onChange(value.map((x, j) => j === i ? e.target.value : x))} data-testid={`input-agenda-${i}`} /><button type="button" className="quiet-action !px-2 text-xs" disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))} data-testid={`button-remove-agenda-${i}`}>Quitar</button></li>)}</ol>
    {!disabled && <button type="button" className="quiet-action mt-2 text-xs" onClick={() => onChange([...value, ''])} data-testid="button-add-agenda">Añadir punto</button>}</div>;
}

function AttachmentsPicker({ value, disabled, pinned, onChange }: { value: string[]; disabled: boolean; pinned?: PinnedAttachment[]; onChange: (v: string[]) => void }) {
  const docs = useListDocuments({ query: { queryKey: getListDocumentsQueryKey() } });
  const all = docs.data ?? [];
  const eligible = all.filter(d => isAttachable(d) && !value.includes(d.id));
  return <div data-testid="section-attachments"><p className="eyebrow mb-2 flex items-center gap-1.5"><Paperclip size={12} />Documentación adjunta</p>
    {value.length ? <ul className="space-y-2">{value.map(id => <AttachmentRow key={id} id={id} doc={all.find(d => d.id === id)} pinned={pinned?.find(p => p.documentId === id)} onRemove={disabled ? undefined : () => onChange(value.filter(x => x !== id))} />)}</ul> : <p className="text-xs text-[#77817c]">Sin adjuntos.</p>}
    {!disabled && (docs.isLoading ? <div className="skeleton mt-2 h-10" /> : docs.isError ? <div className="mt-2"><Alert kind="error">{messageFor(docs.error)} <button type="button" className="ml-1 font-bold underline" onClick={() => docs.refetch()}>Reintentar</button></Alert></div>
      : <><select className="field mt-2" value="" disabled={value.length >= 30 || !eligible.length} onChange={e => e.target.value && onChange([...value, e.target.value])} data-testid="select-add-attachment"><option value="">{eligible.length ? 'Añadir documento del curso…' : 'No hay documentos elegibles'}</option>{eligible.map(d => <option key={d.id} value={d.id}>{d.title} · {d.latestFileName} (v{d.currentVersion})</option>)}</select>
        <p className="mt-1 text-[10px] text-[#77817c]">Solo documentos del curso activo aprobados, compartidos con el centro y con versión vigente analizada como limpia. Máximo 30.</p></>)}
  </div>;
}

function AgreementsEditor({ people, value, onChange }: { people: CiclopePerson[]; value: CiclopeAgreement[]; onChange: (v: CiclopeAgreement[]) => void }) {
  const patch = (i: number, p: Partial<CiclopeAgreement>) => onChange(value.map((x, j) => j === i ? { ...x, ...p } : x));
  return <div><p className="eyebrow mb-2">Acuerdos</p>
    <div className="space-y-2">{value.map((a, i) => <div key={i} className="grid gap-2 rounded-lg border border-[#eee9df] p-2.5 md:grid-cols-[2fr_1.2fr_.9fr_auto] md:items-end" data-testid={`row-agreement-${i}`}>
      <Label text="Acuerdo"><input className="field !py-1.5 text-xs" required maxLength={1500} value={a.title} onChange={e => patch(i, { title: e.target.value })} data-testid={`input-agreement-title-${i}`} /></Label>
      <Label text="Responsable"><select className="field !py-1.5 text-xs" required value={a.responsibleUserId} onChange={e => patch(i, { responsibleUserId: e.target.value, responsibleName: undefined })} data-testid={`select-agreement-owner-${i}`}><option value="">{a.responsibleName ?? 'Selecciona…'}</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Label>
      <Label text="Fecha límite"><input type="date" className="field !py-1.5 text-xs" required value={a.dueDate} onChange={e => patch(i, { dueDate: e.target.value })} data-testid={`input-agreement-due-${i}`} /></Label>
      <button type="button" className="quiet-action !px-2 !py-1 text-xs" onClick={() => onChange(value.filter((_, j) => j !== i))} data-testid={`button-remove-agreement-${i}`}>Quitar</button>
    </div>)}</div>
    <button type="button" className="quiet-action mt-2 text-xs" onClick={() => onChange([...value, { title: '', responsibleUserId: '', dueDate: '', remindersEnabled: false }])} data-testid="button-add-agreement">Añadir acuerdo</button>
    <p className="mt-1 text-[10px] text-[#77817c]">Las tareas derivadas empiezan sin recordatorios. Solo la persona responsable puede activarlos desde sus tareas.</p>
  </div>;
}
