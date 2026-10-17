import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check, ChevronRight, Mail, Plus, RefreshCw, Send, ShieldCheck } from "lucide-react";
import {
  getGetMailOverviewQueryKey, getGetMailThreadQueryKey, getListDocumentsQueryKey,
  useApproveMailAttachment, useApproveMailDraft, useCreateMailContact, useCreateMailDraft,
  useCreateMailTemplate, useGetMailOverview, useGetMailThread, useListDocuments,
  useQueueMailDraft, useReplyToMailThread, useSubmitMailDraft, useUpdateMailDraft, useUpdateMailThreadAction,
} from "@workspace/api-client-react";

type Classification = "obligatoria" | "organizativa" | "informativa" | "difusion";
type Segment = "direccion" | "jefatura" | "profesorado" | "empresa" | "coordinacion_c1" | "centro" | "familia" | "otro";
const classes: Classification[] = ["obligatoria", "organizativa", "informativa", "difusion"];
const folders = ["todos", "entrada", "revision_humana", "borradores", "programadas", "enviadas", "fallidas_rebotadas", "archivada"] as const;
function explainError(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operación.";
}

export function CommunicationsPage({ userId }: { userId: string }) {
  const client = useQueryClient();
  const overview = useGetMailOverview({ query: { queryKey: getGetMailOverviewQueryKey(), retry: false } });
  const [selected, setSelected] = useState("");
  const detail = useGetMailThread(selected, { query: { queryKey: getGetMailThreadQueryKey(selected), enabled: Boolean(selected), retry: false } });
  const documentList = useListDocuments({ query: { queryKey: getListDocumentsQueryKey(), enabled: true, retry: false } });
  const submit = useSubmitMailDraft();
  const approve = useApproveMailDraft();
  const queue = useQueueMailDraft();
  const threadAction = useUpdateMailThreadAction();
  const attachmentApprove = useApproveMailAttachment();
  const createDraft = useCreateMailDraft();
  const reply = useReplyToMailThread();
  const updateDraft = useUpdateMailDraft();
  const createContact = useCreateMailContact();
  const createTemplate = useCreateMailTemplate();
  const [folder, setFolder] = useState<(typeof folders)[number]>("todos");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [compose, setCompose] = useState(false);
  const [contactForm, setContactForm] = useState(false);
  const [templateForm, setTemplateForm] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [draft, setDraft] = useState<{ subject: string; bodyText: string; classification: Classification }>({ subject: "", bodyText: "", classification: "organizativa" });
  const [contact, setContact] = useState<{ email: string; displayName: string; segment: Segment; professionalFamily: string; institution: string; authorizationNote: string; optOut: boolean; active: boolean }>({ email: "", displayName: "", segment: "profesorado", professionalFamily: "", institution: "", authorizationNote: "", optOut: false, active: true });
  const [template, setTemplate] = useState<{ name: string; subject: string; body: string; classification: Classification }>({ name: "", subject: "", body: "", classification: "organizativa" });
  const [replyText, setReplyText] = useState("");
  const [replyClassification, setReplyClassification] = useState<Classification>("organizativa");
  const [replyAttachments, setReplyAttachments] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string; revision: number; subject: string; bodyText: string; classification: Classification; attachmentDocumentIds: string[] } | null>(null);
  const data = overview.data;
  const threads = useMemo(() => (data?.threads ?? []).filter(t => folder === "todos" || t.folder === folder), [data?.threads, folder]);
  const cleanDocs = (documentList.data ?? []).filter(doc =>
    doc.accessScope === "center" && doc.status === "aprobado" && doc.scanStatus === "limpio");

  async function refresh() {
    await client.invalidateQueries({ queryKey: getGetMailOverviewQueryKey() });
    if (selected) await client.invalidateQueries({ queryKey: getGetMailThreadQueryKey(selected) });
  }
  function runMutation(action: () => void) { setError(""); setNotice(""); action(); }
  function onCreateDraft(event: FormEvent) {
    event.preventDefault();
    runMutation(() => createDraft.mutate({ data: {
      recipientContactIds: selectedContacts, subject: draft.subject, bodyText: draft.bodyText,
      classification: draft.classification, templateId: templateId || null, attachmentDocumentIds: selectedAttachments,
    } }, {
      onSuccess: async result => {
        setCompose(false); setSelectedContacts([]); setSelectedAttachments([]);
        setNotice(`${result.messages.length} borrador(es) guardado(s), uno independiente por destinatario.`);
        await refresh();
      }, onError: e => setError(explainError(e)),
    }));
  }
  function onCreateContact(event: FormEvent) {
    event.preventDefault();
    runMutation(() => createContact.mutate({ data: contact }, {
      onSuccess: async () => { setContactForm(false); setContact({ email: "", displayName: "", segment: "profesorado", professionalFamily: "", institution: "", authorizationNote: "", optOut: false, active: true }); await refresh(); },
      onError: e => setError(explainError(e)),
    }));
  }
  function onCreateTemplate(event: FormEvent) {
    event.preventDefault();
    runMutation(() => createTemplate.mutate({ data: template }, {
      onSuccess: async () => { setTemplateForm(false); setTemplate({ name: "", subject: "", body: "", classification: "organizativa" }); await refresh(); },
      onError: e => setError(explainError(e)),
    }));
  }
  function onReply(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    runMutation(() => reply.mutate({ threadId: selected, data: { bodyText: replyText, classification: replyClassification, attachmentDocumentIds: replyAttachments } }, {
      onSuccess: async () => { setReplyText(""); setReplyAttachments([]); setNotice("Respuesta guardada como borrador en el hilo; todavía no se ha enviado."); await refresh(); },
      onError: e => setError(explainError(e)),
    }));
  }
  function onUpdateDraft(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    runMutation(() => updateDraft.mutate({ messageId: editing.id, data: {
      expectedRevision: editing.revision, subject: editing.subject, bodyText: editing.bodyText,
      classification: editing.classification, attachmentDocumentIds: editing.attachmentDocumentIds,
    } }, {
      onSuccess: async () => { setEditing(null); setNotice("Borrador actualizado."); await refresh(); },
      onError: e => setError(explainError(e)),
    }));
  }
  if (overview.isLoading) return <section className="panel p-8" aria-busy="true">Cargando bandeja…</section>;
  if (overview.isError || !data) return <section className="panel p-8"><h1 className="text-xl font-bold">Comunicaciones</h1><p className="mt-2 text-sm">No se pudo cargar la bandeja. {explainError(overview.error)}</p><button className="quiet-action mt-4" onClick={() => overview.refetch()}>Reintentar</button></section>;

  return <main className="fade-up space-y-5" data-testid="communications-page">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="eyebrow">Curso activo · {data.yearLabel}</p><h1 className="text-2xl font-bold text-[#20393b]">Comunicaciones institucionales</h1><p className="mt-1 max-w-2xl text-sm text-[#637475]">Contactos y conversaciones autorizadas. Cada destinatario recibe un mensaje individual y los envíos necesitan revisión humana.</p></div>
      {data.canManage && <div className="flex flex-wrap gap-2">
        <button className="quiet-action" onClick={() => setContactForm(v => !v)}><Plus size={16} /> Contacto</button>
        <button className="quiet-action" onClick={() => setTemplateForm(v => !v)}><Plus size={16} /> Plantilla</button>
        <button className="primary-action" onClick={() => setCompose(v => !v)}><Mail size={16} /> Nuevo borrador</button>
      </div>}
    </header>
    {!data.provider.keyConfigured && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status"><ShieldCheck className="mr-2 inline" size={16} />Resend no tiene una clave privada configurada en el servidor. Puedes guardar borradores; la cola no enviará mensajes.</div>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{notice}</div>}
    {data.canManage && contactForm && <form onSubmit={onCreateContact} className="panel grid gap-3 p-5 md:grid-cols-2">
      <h2 className="font-bold md:col-span-2">Contacto autorizado para este curso</h2>
      <input required type="email" maxLength={254} placeholder="Correo institucional" value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} />
      <input required maxLength={160} placeholder="Nombre" value={contact.displayName} onChange={e => setContact({ ...contact, displayName: e.target.value })} />
      <select value={contact.segment} onChange={e => setContact({ ...contact, segment: e.target.value as Segment })}>{["direccion","jefatura","profesorado","empresa","coordinacion_c1","centro","familia","otro"].map(x => <option key={x}>{x}</option>)}</select>
      <input maxLength={160} placeholder="Familia profesional (opcional)" value={contact.professionalFamily} onChange={e => setContact({ ...contact, professionalFamily: e.target.value })} />
      <input maxLength={200} placeholder="Centro o institución (opcional)" value={contact.institution} onChange={e => setContact({ ...contact, institution: e.target.value })} />
      <input required minLength={4} maxLength={1000} placeholder="Base institucional y autorización" value={contact.authorizationNote} onChange={e => setContact({ ...contact, authorizationNote: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={contact.optOut} onChange={e => setContact({ ...contact, optOut: e.target.checked })} /> No acepta mensajes no obligatorios</label>
      <button className="primary-action md:col-span-2" disabled={createContact.isPending}>Guardar contacto</button>
    </form>}
    {data.canManage && templateForm && <form onSubmit={onCreateTemplate} className="panel grid gap-3 p-5">
      <h2 className="font-bold">Nueva plantilla del curso</h2>
      <input required maxLength={120} placeholder="Nombre de la plantilla" value={template.name} onChange={e => setTemplate({ ...template, name: e.target.value })} />
      <input required maxLength={250} placeholder="Asunto" value={template.subject} onChange={e => setTemplate({ ...template, subject: e.target.value })} />
      <textarea required maxLength={20000} rows={5} placeholder="Texto sin formato HTML" value={template.body} onChange={e => setTemplate({ ...template, body: e.target.value })} />
      <select value={template.classification} onChange={e => setTemplate({ ...template, classification: e.target.value as Classification })}>{classes.map(x => <option key={x}>{x}</option>)}</select>
      <button className="primary-action" disabled={createTemplate.isPending}>Guardar plantilla</button>
    </form>}
    {data.canManage && compose && <form onSubmit={onCreateDraft} className="panel grid gap-3 p-5">
      <h2 className="font-bold">Borrador individual por destinatario</h2>
      <label className="text-sm font-semibold">Contactos (máximo 50)</label>
      <div className="max-h-36 overflow-auto rounded-lg border p-2">{data.contacts.filter(c => c.active).map(c => <label key={c.id} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={selectedContacts.includes(c.id)} onChange={e => setSelectedContacts(v => e.target.checked ? [...v, c.id] : v.filter(id => id !== c.id))} />{c.displayName} · {c.email}</label>)}</div>
      <select value={templateId} onChange={e => { const id=e.target.value; setTemplateId(id); const t=data.templates.find(x=>x.id===id); if(t) setDraft({subject:t.subject,bodyText:t.body,classification:t.classification}); }}>
        <option value="">Sin plantilla</option>{data.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <input required maxLength={250} placeholder="Asunto" value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} />
      <textarea required maxLength={20000} rows={7} placeholder="Mensaje en texto plano" value={draft.bodyText} onChange={e => setDraft({ ...draft, bodyText: e.target.value })} />
      <select value={draft.classification} onChange={e => setDraft({ ...draft, classification: e.target.value as Classification })}>{classes.map(x => <option key={x}>{x}</option>)}</select>
      <label className="text-sm font-semibold">Evidencias documentales limpias y aprobadas</label>
      <div className="max-h-32 overflow-auto rounded-lg border p-2">{cleanDocs.map(doc => <label key={doc.id} className="flex gap-2 py-1 text-sm"><input type="checkbox" checked={selectedAttachments.includes(doc.id)} onChange={e => setSelectedAttachments(v => e.target.checked ? [...v, doc.id] : v.filter(id => id !== doc.id))} />{doc.title}</label>)}{!cleanDocs.length && <p className="text-xs text-slate-500">No hay documentos compartidos aprobados disponibles.</p>}</div>
      <button className="primary-action" disabled={createDraft.isPending || selectedContacts.length === 0 || selectedContacts.length > 50}><Send size={15} />Guardar borrador(es), no enviar</button>
    </form>}

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.3fr)]">
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-4"><h2 className="font-bold">Bandeja</h2><button className="quiet-action" onClick={() => { void refresh(); }} aria-label="Actualizar"><RefreshCw size={15} /></button></div>
        <div className="flex gap-1 overflow-x-auto border-b p-2">{folders.map(f => <button key={f} onClick={() => setFolder(f)} className={`rounded-full px-3 py-1 text-xs ${folder===f?"bg-[#0b8e89] text-white":"bg-slate-100 text-slate-700"}`}>{f.replaceAll("_"," ")}</button>)}</div>
        <ul className="divide-y">{threads.map(t => <li key={t.id}><button onClick={() => { setError(""); setSelected(t.id); }} className={`w-full p-4 text-left hover:bg-teal-50 ${selected===t.id?"bg-teal-50":""}`}>
          <span className="flex items-center justify-between gap-2"><strong className="truncate text-sm">{t.contactName}</strong><span className="text-[10px] text-slate-500">{new Date(t.updatedAt).toLocaleDateString()}</span></span>
          <span className="mt-1 block truncate text-sm font-medium">{t.subject}</span><span className="mt-1 block truncate text-xs text-slate-600">{t.preview}</span>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px]">{t.folder.replaceAll("_"," ")} · {t.lastStatus}</span>
        </button></li>)}</ul>
        {!threads.length && <p className="p-6 text-sm text-slate-500">No hay conversaciones en esta carpeta.</p>}
      </section>
      <section className="panel min-h-96 p-5">
        {!selected && <div className="grid min-h-72 place-items-center text-center text-sm text-slate-500"><div><Mail size={24} className="mx-auto mb-3" />Selecciona una conversación para consultar su historial.</div></div>}
        {selected && detail.isLoading && <p>Cargando conversación…</p>}
        {selected && detail.data && <div>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4"><div><p className="text-xs text-slate-500">{detail.data.thread.contactName} · {detail.data.thread.contactEmail}</p><h2 className="mt-1 text-xl font-bold">{detail.data.thread.subject}</h2></div>
            {data.canManage && <button className="quiet-action" onClick={() => runMutation(() => threadAction.mutate({ threadId: selected, data: { action: detail.data!.thread.folder==="archivada"?"recuperar":"archivar" } }, { onSuccess: () => refresh(), onError: e => setError(explainError(e)) }))}><Archive size={15} />{detail.data.thread.folder==="archivada"?"Recuperar":"Archivar"}</button>}
          </div>
          <div className="mt-4 space-y-3">{detail.data.messages.map(message => <article key={message.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap justify-between gap-2"><span className="text-xs font-semibold">{message.direction==="entrante"?(message.senderName??message.sender):"INNOVA-C2"} · {new Date(message.createdAt).toLocaleString()}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px]">{message.status}</span></div>
            <h3 className="mt-2 text-sm font-semibold">{message.subject}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{message.bodyText}</p>
            {message.attachments.map((a:any) => <div key={a.id ?? a.documentId ?? a.filename} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
              <span>{a.filename} · {a.status}</span>
              {typeof a.id==="string" && a.status==="limpio" && !a.reviewedAt && data.canManage && <button className="quiet-action" onClick={() => attachmentApprove.mutate({attachmentId:a.id},{onSuccess:()=>refresh(),onError:e=>setError(explainError(e))})}><Check size={14}/>Aprobar adjunto</button>}
              {typeof a.id==="string" && a.status==="limpio" && a.reviewedAt && <a className="text-teal-800 underline" href={`${import.meta.env.BASE_URL.replace(/\/$/,"")}/api/v1/mail/attachments/${a.id}/download`}>Descargar</a>}
            </div>)}
            {message.status==="borrador" && (message.createdBy===userId || data.canManage) && <div className="mt-3 flex flex-wrap gap-2">
              <button className="quiet-action" onClick={() => setEditing({ id:message.id, revision:message.revision, subject:message.subject, bodyText:message.bodyText, classification:message.classification as Classification, attachmentDocumentIds:message.attachments.flatMap((a:any)=>typeof a.documentId==="string"?[a.documentId]:[]) })}>Editar borrador</button>
              <button className="quiet-action" onClick={() => submit.mutate({messageId:message.id},{onSuccess:()=>refresh(),onError:e=>setError(explainError(e))})}>Enviar a revisión humana</button>
            </div>}
            {message.status==="revision" && data.canApprove && message.createdBy !== userId && <div className="mt-3 flex gap-2"><button className="quiet-action" onClick={() => approve.mutate({messageId:message.id},{onSuccess:()=>refresh(),onError:e=>setError(explainError(e))})}>Aprobar</button></div>}
            {message.status==="aprobado" && data.canManage && <button className="primary-action mt-3" onClick={() => queue.mutate({messageId:message.id,data:{expectedRevision:message.revision}},{onSuccess:()=>refresh(),onError:e=>setError(explainError(e))})}>Poner en cola</button>}
            {message.status==="en_cola" && <p className="mt-2 text-xs text-slate-600">En cola persistente. Este estado no confirma envío ni entrega.</p>}
          </article>)}</div>
          {editing && <form onSubmit={onUpdateDraft} className="mt-4 grid gap-3 rounded-xl border border-teal-300 bg-teal-50/40 p-4">
            <h3 className="font-semibold">Editar borrador</h3><input required maxLength={250} value={editing.subject} onChange={e=>setEditing({...editing,subject:e.target.value})}/>
            <textarea required maxLength={20000} rows={6} value={editing.bodyText} onChange={e=>setEditing({...editing,bodyText:e.target.value})}/>
            <select value={editing.classification} onChange={e=>setEditing({...editing,classification:e.target.value as Classification})}>{classes.map(x=><option key={x}>{x}</option>)}</select>
            <div className="max-h-28 overflow-auto rounded border bg-white p-2">{cleanDocs.map(doc=><label key={doc.id} className="flex gap-2 py-1 text-xs"><input type="checkbox" checked={editing.attachmentDocumentIds.includes(doc.id)} onChange={e=>setEditing({...editing,attachmentDocumentIds:e.target.checked?[...editing.attachmentDocumentIds,doc.id]:editing.attachmentDocumentIds.filter(id=>id!==doc.id)})}/>{doc.title}</label>)}</div>
            <div className="flex gap-2"><button className="primary-action" disabled={updateDraft.isPending}>Guardar cambios</button><button type="button" className="quiet-action" onClick={()=>setEditing(null)}>Cancelar</button></div>
          </form>}
          {data.canManage || detail.data.thread.assignedTo===userId ? detail.data.messages.some(m=>m.direction==="entrante") && <form onSubmit={onReply} className="mt-5 grid gap-3 border-t pt-5">
            <h3 className="font-semibold">Responder en este hilo</h3><textarea required maxLength={20000} rows={5} placeholder="Respuesta en texto plano" value={replyText} onChange={e=>setReplyText(e.target.value)}/>
            <select value={replyClassification} onChange={e=>setReplyClassification(e.target.value as Classification)}>{classes.map(x=><option key={x}>{x}</option>)}</select>
            <div className="max-h-28 overflow-auto rounded border p-2">{cleanDocs.map(doc=><label key={doc.id} className="flex gap-2 py-1 text-xs"><input type="checkbox" checked={replyAttachments.includes(doc.id)} onChange={e=>setReplyAttachments(v=>e.target.checked?[...v,doc.id]:v.filter(id=>id!==doc.id))}/>{doc.title}</label>)}</div>
            <button className="quiet-action" disabled={reply.isPending}>Guardar respuesta como borrador</button>
          </form> : null}
        </div>}
        {selected && detail.isError && <p role="alert">No se pudo abrir el hilo autorizado. {explainError(detail.error)}</p>}
      </section>
    </div>
    <p className="text-xs text-slate-500">La aplicación no presenta lecturas como entrega ni responde automáticamente con IA. Los mensajes entrantes y sus adjuntos pasan por validaciones del servidor.</p>
  </main>;
}
