import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Archive, ArrowDownToLine, CalendarDays, Check, CheckCircle2, Clipboard,
  FileCheck2, FileText, LockKeyhole, RefreshCw, Save, ShieldCheck, Sparkles,
} from "lucide-react";
import {
  getGetCurrentPicPlanQueryKey, getGetPicFollowupQueryKey, getListPicFollowupsQueryKey,
  getListPicFollowupDeliveriesQueryKey, getExportPicFollowupLaycosQueryKey,
  getExportPicFollowupDocumentQueryKey, useCreatePicFollowupSnapshot,
  useExportPicFollowupDocument, useExportPicFollowupLaycos, useGetCurrentPicPlan,
  useGetPicFollowup, useListPicFollowupDeliveries, useListPicFollowups,
  useRecordPicFollowupDelivery, useSavePicFollowup,
} from "@workspace/api-client-react";
import type {
  PicCertificationCheck, PicCertificationCheckStatus, PicFollowupAction, PicFollowupContent,
  PicFollowupDelivery, PicFollowupReport, PicFollowupSnapshot, PicFollowupType, User,
} from "@workspace/api-client-react";
import { hasCoordinationAccess } from "../lib/role-access";
import "./PicFollowupPage.css";
import { SectionHeader } from "./SectionHeader";

const REPORTS: { type: PicFollowupType; short: string; title: string; section: string; copy: string }[] = [
  { type: "primer_trimestre", short: "T1", title: "Primer trimestre", section: "11", copy: "Seguimiento trimestral · apartado 11" },
  { type: "segundo_trimestre", short: "T2", title: "Segundo trimestre", section: "12", copy: "Seguimiento trimestral · apartado 12" },
  { type: "tercer_trimestre", short: "T3", title: "Tercer trimestre", section: "13", copy: "Seguimiento trimestral · apartado 13" },
  { type: "memoria_final", short: "MF", title: "Memoria final", section: "14", copy: "Cierre del curso · apartado 14" },
  { type: "justificacion", short: "JC", title: "Justificación", section: "—", copy: "Archivo de justificación y certificación" },
];
const CHECKS: { key: keyof PicFollowupContent["certification"]; label: string }[] = [
  { key: "c1Attendance85", label: "Asistencia C1 igual o superior al 85 %" },
  { key: "planPresented", label: "Plan PIC presentado" },
  { key: "quarterlyReportsOnTime", label: "Informes trimestrales en plazo" },
  { key: "finalMemoryOnTime", label: "Memoria final en plazo" },
  { key: "certificationRequested", label: "Certificación solicitada" },
];
const CHECK_STATES: { value: PicCertificationCheckStatus; label: string }[] = [
  { value: "sin_verificar", label: "Sin verificar" },
  { value: "confirmado_por_persona", label: "Confirmado por persona" },
  { value: "no_acreditado", label: "No acreditado" },
];
const SOURCE_LABEL: Record<string, string> = {
  actuacion: "Actuación validada", evidencia: "Evidencia validada", acta_ciclope: "Acta CICLOPE validada",
  agenda_c1: "Agenda C1 recibida / planificada", acuerdo: "Acuerdo CICLOPE",
  indicador: "Observación de indicador validada",
};
const STATUS_LABEL: Record<string, string> = {
  no_iniciada: "No iniciada", en_curso: "En curso", completada: "Completada", descartada: "Descartada",
};
function blankCheck(): PicCertificationCheck { return { status: "sin_verificar", observation: "", sourceIds: [] }; }
function emptyContent(): PicFollowupContent {
  return {
    actions: [], activitiesNarrative: "", incidents: "", adjustments: "", transferredDate: null,
    positiveAspects: "", difficulties: "", unmetObjectivesExplanation: "", improvements: "",
    centerMemoryDate: null, sources: [], annexes: [],
    certification: {
      c1Attendance85: blankCheck(), planPresented: blankCheck(), quarterlyReportsOnTime: blankCheck(),
      finalMemoryOnTime: blankCheck(), certificationRequested: blankCheck(), personConfirmedAttendanceSummary: "",
    },
  };
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "No se pudo completar la operación."; }
function errorStatus(error: unknown) { return (error as { status?: number } | null)?.status; }
function dateToday() {
  const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 10);
}
function downloadFile(file: { filename: string; mediaType: string; contentBase64: string }) {
  const decoded = atob(file.contentBase64);
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename; anchor.click(); URL.revokeObjectURL(url);
}
function actionRows(old: PicFollowupAction[], selected: { code: string }[]): PicFollowupAction[] {
  return selected.map(({ code }) => old.find(item => item.actionCode === code) ?? { actionCode: code, status: "no_iniciada", note: "" });
}

export function PicFollowupPage({ user }: { user: User }) {
  const client = useQueryClient();
  const planQuery = useGetCurrentPicPlan({ query: { queryKey: getGetCurrentPicPlanQueryKey(), retry: false, refetchOnMount: "always" } });
  const planId = planQuery.data?.id ?? "";
  const workspace = useListPicFollowups(planId || "no-plan", {
    query: { queryKey: getListPicFollowupsQueryKey(planId || "no-plan"), enabled: Boolean(planId), refetchOnMount: "always" },
  });
  const [reportType, setReportType] = useState<PicFollowupType>("primer_trimestre");
  const detail = useGetPicFollowup(planId || "no-plan", reportType, {
    query: { queryKey: getGetPicFollowupQueryKey(planId || "no-plan", reportType), enabled: Boolean(planId), retry: false, refetchOnMount: "always" },
  });
  const deliveries = useListPicFollowupDeliveries(planId || "no-plan", reportType, {
    query: { queryKey: getListPicFollowupDeliveriesQueryKey(planId || "no-plan", reportType), enabled: Boolean(planId), refetchOnMount: "always" },
  });
  const saveDraft = useSavePicFollowup();
  const freeze = useCreatePicFollowupSnapshot();
  const recordDelivery = useRecordPicFollowupDelivery();
  const [content, setContent] = useState<PicFollowupContent>(emptyContent());
  const [reason, setReason] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(dateToday());
  const [proofDocumentId, setProofDocumentId] = useState("");
  const [deliveryIdentifier, setDeliveryIdentifier] = useState("");
  const [deliveryConfirmation, setDeliveryConfirmation] = useState("");
  const [personConfirmed, setPersonConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const initKey = useRef("");
  const report = detail.data?.report;
  const sources = workspace.data?.sources ?? [];
  const documents = workspace.data?.annexDocuments ?? [];
  const actions = workspace.data?.selectedActions ?? [];
  const missingReport = detail.isError && errorStatus(detail.error) === 404;
  const currentContent = useMemo(() => ({ ...content, actions: actionRows(content.actions, actions) }), [content, actions]);
  const dirty = report
    ? JSON.stringify(currentContent) !== JSON.stringify(report.content)
    : JSON.stringify(currentContent) !== JSON.stringify(emptyContent());
  const selectedSnapshot = detail.data?.snapshots.find(item => item.id === selectedSnapshotId) ?? detail.data?.snapshots[0];
  const snapshotId = selectedSnapshot?.id ?? "no-snapshot";
  const laycos = useExportPicFollowupLaycos(planId || "no-plan", reportType, snapshotId, {
    query: { queryKey: getExportPicFollowupLaycosQueryKey(planId || "no-plan", reportType, snapshotId), enabled: false, retry: false },
  });
  const docx = useExportPicFollowupDocument(planId || "no-plan", reportType, snapshotId, "docx", {
    query: { queryKey: getExportPicFollowupDocumentQueryKey(planId || "no-plan", reportType, snapshotId, "docx"), enabled: false, retry: false },
  });
  const pdf = useExportPicFollowupDocument(planId || "no-plan", reportType, snapshotId, "pdf", {
    query: { queryKey: getExportPicFollowupDocumentQueryKey(planId || "no-plan", reportType, snapshotId, "pdf"), enabled: false, retry: false },
  });

  useEffect(() => {
    const key = `${reportType}:${report?.id ?? "new"}:${report?.revision ?? 0}`;
    if (initKey.current === key) return;
    initKey.current = key;
    const initial = report?.content ?? emptyContent();
    setContent({ ...initial, actions: actionRows(initial.actions, actions) });
    setProblem(""); setNotice("");
  }, [reportType, report?.id, report?.revision]);

  const patch = (updater: (value: PicFollowupContent) => PicFollowupContent) => {
    setContent(value => updater({ ...value, actions: actionRows(value.actions, actions) }));
    setProblem(""); setNotice("");
  };
  const save = () => {
    if (!planId || !workspace.data) return;
    setProblem(""); setNotice("");
    saveDraft.mutate({ planId, reportType, data: { expectedRevision: report?.revision ?? 0, content: currentContent } }, {
      onSuccess: async (saved: PicFollowupReport) => {
        client.setQueryData(getGetPicFollowupQueryKey(planId, reportType), (old: typeof detail.data) => ({
          ...(old ?? { snapshots: [], deliveries: [] }), report: saved,
        }));
        setContent(saved.content);
        setNotice(`Borrador guardado · revisión ${saved.revision}.`);
        await Promise.all([client.invalidateQueries({ queryKey: getListPicFollowupsQueryKey(planId) }), detail.refetch()]);
      },
      onError: error => setProblem(errorStatus(error) === 409
        ? "La revisión cambió en otra sesión. Recarga el borrador antes de guardar; tus cambios locales no se han enviado."
        : errorMessage(error)),
    });
  };
  const createSnapshot = () => {
    if (!planId || !report || dirty || reason.trim().length < 4) return;
    freeze.mutate({ planId, reportType, data: { expectedRevision: report.revision, reason: reason.trim() } }, {
      onSuccess: async frozen => {
        setSelectedSnapshotId(frozen.id);
        setNotice(`Versión inmutable ${frozen.version} creada · revisión ${frozen.reportRevision}.`);
        setReason("");
        await Promise.all([detail.refetch(), client.invalidateQueries({ queryKey: getListPicFollowupsQueryKey(planId) })]);
      },
      onError: error => setProblem(errorStatus(error) === 409
        ? "El borrador cambió antes de congelarse. Recarga y vuelve a revisar la revisión."
        : errorMessage(error)),
    });
  };
  const exportFile = async (format: "docx" | "pdf") => {
    if (!selectedSnapshot) return;
    setProblem(""); setNotice("");
    const result = await (format === "docx" ? docx.refetch() : pdf.refetch());
    if (result.data) { downloadFile(result.data); setNotice(`${format.toUpperCase()} generado desde la versión inmutable ${selectedSnapshot.version}.`); }
    else setProblem(errorMessage(result.error));
  };
  const copyLaycos = async () => {
    if (!selectedSnapshot) return;
    setProblem(""); setNotice("");
    const result = await laycos.refetch();
    if (!result.data) { setProblem(errorMessage(result.error)); return; }
    if (!result.data.fields.length) { setNotice(result.data.notice); return; }
    try {
      await navigator.clipboard.writeText(result.data.fields.map(field => `${field.label}\n${field.value}`).join("\n\n"));
      setNotice(result.data.notice);
    } catch { setProblem("El navegador no ha permitido copiar. Revisa los permisos del portapapeles e inténtalo de nuevo."); }
  };
  const submitDelivery = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSnapshot || !proofDocumentId || !personConfirmed || deliveryConfirmation.trim().length < 15) return;
    setProblem(""); setNotice("");
    recordDelivery.mutate({
      planId, reportType,
      data: { snapshotId: selectedSnapshot.id, deliveryDate, externalIdentifier: deliveryIdentifier.trim() || null, proofDocumentId, confirmation: deliveryConfirmation.trim(), personConfirmed: true },
    }, {
      onSuccess: async saved => {
        setNotice(`Entrega manual registrada por ${saved.recordedByName} el ${saved.deliveryDate}. Esto no indica lectura ni aprobación de Laycos.`);
        setDeliveryConfirmation(""); setPersonConfirmed(false); setDeliveryIdentifier("");
        await Promise.all([deliveries.refetch(), detail.refetch(), client.invalidateQueries({ queryKey: getListPicFollowupsQueryKey(planId) })]);
      },
      onError: error => setProblem(errorMessage(error)),
    });
  };

  if (!hasCoordinationAccess(user.role)) return <section className="panel p-6"><div className="flex gap-3"><ShieldCheck className="text-[#347b69]" /><div><h2 className="font-bold">Acceso restringido</h2><p className="mt-1 text-sm text-[#68746e]">El seguimiento del PIC está reservado a perfiles de coordinación autorizados.</p></div></div></section>;
  if (planQuery.isLoading) return <div className="space-y-4" aria-label="Cargando curso actual"><div className="skeleton h-40" /><div className="skeleton h-16" /><div className="skeleton h-64" /></div>;
  if (planQuery.isError && errorStatus(planQuery.error) !== 404) return <ErrorCard message={errorMessage(planQuery.error)} onRetry={() => planQuery.refetch()} />;
  if (!planQuery.data) return <div className="fade-up space-y-5"><SectionHeader kicker="Evidencia reutilizable" title="Seguimiento del curso" subtitle="Del plan a la memoria, sin volver a capturar lo que ya está validado." status={<><LockKeyhole size={13} /> Borradores editables · snapshots inmutables</>} /><div className="panel p-6 md:p-8"><p className="eyebrow">Aún no hay un plan para este curso</p><h2 className="mt-2 font-[var(--app-font-serif)] text-xl font-bold">El seguimiento se enlaza al PIC vigente</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#68746e]">Crea el borrador del plan PIC antes de preparar informes. Así, las acciones y el curso se reutilizan sin volver a introducirlos.</p></div></div>;
  if (workspace.isLoading) return <div className="space-y-4"><div className="skeleton h-32" /><div className="skeleton h-14" /><div className="skeleton h-56" /></div>;
  if (workspace.isError || !workspace.data) return <ErrorCard message={errorMessage(workspace.error)} onRetry={() => workspace.refetch()} />;
  const selectedReport = REPORTS.find(item => item.type === reportType) ?? REPORTS[0];
  const staleDetail = detail.isError && errorStatus(detail.error) === 409;
  return <div className="pic-followup fade-up">
    <SectionHeader kicker="Evidencia reutilizable" title="Seguimiento del curso" subtitle="Del plan a la memoria, sin volver a capturar lo que ya está validado." schoolYear={workspace.data.schoolYear} centerName={workspace.data.centerName}
      status={<><LockKeyhole size={13} /> Borradores editables · snapshots inmutables</>}
      action={<button type="button" className="followup-refresh" onClick={() => { void workspace.refetch(); void detail.refetch(); }} disabled={workspace.isFetching || detail.isFetching} data-testid="button-refresh-followup"><RefreshCw size={14} className={workspace.isFetching || detail.isFetching ? "animate-spin" : ""} /> Actualizar</button>} />
    <nav className="followup-tabs" aria-label="Informes del curso">{REPORTS.map((item, index) => {
      const saved = workspace.data.reports.find(entry => entry.reportType === item.type);
      return <button type="button" key={item.type} aria-current={reportType === item.type ? "page" : undefined} className={`followup-tab ${reportType === item.type ? "active" : ""}`} onClick={() => { setReportType(item.type); setSelectedSnapshotId(""); }} data-testid={`tab-followup-${item.type}`}>
        <span className="tab-index">0{index + 1}</span><span className="tab-short">{item.short}</span><span className="tab-title">{item.title}</span><span className={`tab-dot ${saved ? "saved" : ""}`} title={saved ? `Borrador · revisión ${saved.revision}` : "Sin guardar"} />
      </button>;
    })}</nav>
    <main className="followup-main"><div className="followup-main-grid">
      <section className="followup-editor">
        <div className="followup-section-head"><div className="section-number">{selectedReport.section}</div><div className="min-w-0 flex-1"><p className="eyebrow">{selectedReport.copy}</p><h3>{selectedReport.title}</h3><p className="section-caption">Curso {workspace.data.schoolYear} <span>·</span> {report ? `Revisión ${report.revision}` : "Nuevo borrador"}</p></div>
          <button className="followup-save" onClick={save} disabled={!dirty || saveDraft.isPending || detail.isLoading} data-testid="button-save-followup">{saveDraft.isPending ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}{saveDraft.isPending ? "Guardando…" : dirty ? "Guardar borrador" : "Guardado"}</button>
        </div>
        {problem && <div className={`followup-alert ${staleDetail || problem.toLowerCase().includes("revisión") ? "warning" : "danger"}`} role="alert"><AlertCircle size={16} /><span>{problem}</span><button type="button" onClick={() => { setProblem(""); void detail.refetch(); }} aria-label="Cerrar aviso">×</button></div>}
        {notice && <div className="followup-alert success" role="status"><CheckCircle2 size={16} /><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Cerrar confirmación">×</button></div>}
        {dirty && <p className="followup-unsaved"><span /> Hay cambios sin guardar. Congela una versión únicamente después de guardar.</p>}
        {detail.isError && !missingReport && !staleDetail && <div className="followup-alert warning" role="alert"><AlertCircle size={16} /><span>{errorMessage(detail.error)}</span><button type="button" onClick={() => detail.refetch()}>Reintentar</button></div>}
        {detail.isLoading ? <div className="space-y-3"><div className="skeleton h-28" /><div className="skeleton h-40" /><div className="skeleton h-40" /></div> : <>
          <ActionSection actions={actions} value={currentContent.actions} onChange={next => patch(c => ({ ...c, actions: actionRows(next, actions) }))} />
          <section className="followup-card"><CardHeading index="A" title="Relato de actividades" hint="Registra el trabajo realizado y reutiliza el contexto validado." />
            <TextArea label="Actividades realizadas" value={currentContent.activitiesNarrative} maxLength={16000} onChange={v => patch(c => ({ ...c, activitiesNarrative: v }))} rows={5} />
            <div className="field-grid two"><TextArea label="Incidencias" value={currentContent.incidents} maxLength={12000} onChange={v => patch(c => ({ ...c, incidents: v }))} /><TextArea label="Ajustes realizados o previstos" value={currentContent.adjustments} maxLength={12000} onChange={v => patch(c => ({ ...c, adjustments: v }))} /></div>
            {reportType === "tercer_trimestre" && <DateInput label="Fecha de traslado del informe" value={currentContent.transferredDate ?? ""} onChange={v => patch(c => ({ ...c, transferredDate: v || null }))} />}
          </section>
          {(reportType === "memoria_final" || reportType === "justificacion") && <section className="followup-card"><CardHeading index="B" title={reportType === "memoria_final" ? "Balance del curso" : "Justificación y certificación"} hint="Conclusiones cualitativas; no se calcula ni se muestra una nota de logro." />
            <div className="field-grid two"><TextArea label="Aspectos positivos" value={currentContent.positiveAspects} maxLength={16000} onChange={v => patch(c => ({ ...c, positiveAspects: v }))} /><TextArea label="Dificultades" value={currentContent.difficulties} maxLength={16000} onChange={v => patch(c => ({ ...c, difficulties: v }))} /><TextArea label="Objetivos no alcanzados: explicación" value={currentContent.unmetObjectivesExplanation} maxLength={16000} onChange={v => patch(c => ({ ...c, unmetObjectivesExplanation: v }))} /><TextArea label="Propuestas de mejora" value={currentContent.improvements} maxLength={16000} onChange={v => patch(c => ({ ...c, improvements: v }))} /></div>
            <DateInput label="Fecha de memoria del centro" value={currentContent.centerMemoryDate ?? ""} onChange={v => patch(c => ({ ...c, centerMemoryDate: v || null }))} />
          </section>}
          {reportType === "justificacion" && <CertificationSection content={currentContent} sources={sources} onChange={certification => patch(c => ({ ...c, certification }))} />}
          <SourcesSection sources={sources} selected={currentContent.sources} onChange={next => patch(c => ({ ...c, sources: next }))} />
          <AnnexSection documents={documents} selected={currentContent.annexes} onChange={next => patch(c => ({ ...c, annexes: next }))} />
          <SnapshotSection snapshots={detail.data?.snapshots ?? []} selectedId={selectedSnapshot?.id ?? ""} onSelect={setSelectedSnapshotId} reason={reason} onReason={setReason} onFreeze={createSnapshot} freezePending={freeze.isPending} report={report} dirty={dirty} onExport={exportFile} docxPending={docx.isFetching} pdfPending={pdf.isFetching} onLaycos={copyLaycos} laycosPending={laycos.isFetching} />
          <DeliverySection selectedSnapshot={selectedSnapshot} documents={documents} date={deliveryDate} setDate={setDeliveryDate} proofId={proofDocumentId} setProofId={setProofDocumentId} identifier={deliveryIdentifier} setIdentifier={setDeliveryIdentifier} confirmation={deliveryConfirmation} setConfirmation={setDeliveryConfirmation} checked={personConfirmed} setChecked={setPersonConfirmed} onSubmit={submitDelivery} pending={recordDelivery.isPending} deliveries={deliveries.data ?? []} deliveryLoading={deliveries.isLoading} deliveryError={deliveries.isError ? errorMessage(deliveries.error) : ""} retryDeliveries={() => deliveries.refetch()} />
        </>}
      </section>
      <aside className="followup-rail">
        <div className="rail-card rail-source-card"><div className="rail-heading"><span className="rail-icon"><Sparkles size={16} /></span><div><p className="eyebrow">Reutilización</p><h3>Fuentes disponibles</h3></div></div>
          <p className="rail-intro">Solo se ofrecen fuentes recibidas por el API; no se crean referencias manuales.</p><div className="rail-count"><strong>{sources.length}</strong><span>referencias validadas o recibidas</span></div>
          <div className="rail-source-list">{sources.length ? sources.map(source => <div className="rail-source" key={source.id}><span className={`source-pin source-${source.type}`} /><div><strong>{SOURCE_LABEL[source.type] ?? source.type}</strong><span>{source.label}</span></div></div>) : <p className="rail-empty">Aún no hay fuentes disponibles en el curso.</p>}</div>
          <div className="agenda-note"><CalendarDays size={14} /><p>La agenda C1 solo indica recepción o planificación. No acredita asistencia.</p></div>
        </div>
        <div className="rail-card rail-safe-card"><ShieldCheck size={17} /><p><strong>Control humano, siempre.</strong> La persona coordinadora revisa cada texto y decide qué se guarda, congela y entrega.</p></div>
        <div className="rail-card rail-count-card"><div><span>Acciones del PIC</span><strong>{actions.length.toString().padStart(2, "0")}</strong></div><div className="mini-rule" /><p>Las filas reflejan exactamente las acciones seleccionadas en el plan vigente.</p></div>
      </aside>
    </div></main>
  </div>;
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <section className="panel p-6" role="alert"><div className="flex gap-3"><AlertCircle size={18} className="text-[#a34838]" /><div><h2 className="font-bold">No se pudo cargar el seguimiento</h2><p className="mt-1 text-sm text-[#68746e]">{message}</p><button type="button" className="quiet-action mt-4 inline-flex items-center gap-2" onClick={onRetry}><RefreshCw size={14} /> Reintentar</button></div></div></section>;
}
function CardHeading({ index, title, hint }: { index: string; title: string; hint?: string }) {
  return <header className="followup-card-heading"><span className="card-index">{index}</span><div><h4>{title}</h4>{hint && <p>{hint}</p>}</div></header>;
}
function TextArea({ label, value, onChange, maxLength, rows = 4 }: { label: string; value: string; onChange: (value: string) => void; maxLength: number; rows?: number }) {
  return <label className="followup-field"><span>{label}</span><textarea value={value} maxLength={maxLength} rows={rows} onChange={event => onChange(event.currentTarget.value)} data-testid={`textarea-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} /><small>{value.length.toLocaleString("es")} / {maxLength.toLocaleString("es")}</small></label>;
}
function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="followup-field date-field"><span>{label}</span><input type="date" value={value} onChange={event => onChange(event.currentTarget.value)} /></label>;
}
function ActionSection({ actions, value, onChange }: { actions: { code: string; title: string; objectiveCode: string }[]; value: PicFollowupAction[]; onChange: (next: PicFollowupAction[]) => void }) {
  return <section className="followup-card action-card"><CardHeading index="11–13" title="Acciones del PIC" hint="Se heredan del plan. No se añaden ni quitan acciones desde el seguimiento." />
    {actions.length ? <div className="action-table"><div className="action-table-head"><span>Acción seleccionada</span><span>Estado del periodo</span><span>Nota de seguimiento</span></div>
      {actions.map((action, index) => {
        const row = value.find(item => item.actionCode === action.code);
        return <article className="action-row" key={action.code} data-testid={`row-followup-action-${action.code}`}>
          <div className="action-name"><span className="action-row-index">{String(index + 1).padStart(2, "0")}</span><div><strong>{action.title}</strong><span>{action.objectiveCode} <i>·</i> {action.code}</span></div></div>
          <label className="sr-only" htmlFor={`action-status-${action.code}`}>Estado de {action.title}</label>
          <select id={`action-status-${action.code}`} value={row?.status ?? "no_iniciada"} onChange={event => onChange(value.map(item => item.actionCode === action.code ? { ...item, status: event.currentTarget.value as PicFollowupAction["status"] } : item))} data-testid={`select-action-status-${action.code}`}>{Object.entries(STATUS_LABEL).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select>
          <label className="sr-only" htmlFor={`action-note-${action.code}`}>Nota para {action.title}</label>
          <input id={`action-note-${action.code}`} value={row?.note ?? ""} maxLength={4000} placeholder="Nota breve, cambio o contexto…" onChange={event => onChange(value.map(item => item.actionCode === action.code ? { ...item, note: event.currentTarget.value } : item))} data-testid={`input-action-note-${action.code}`} />
        </article>;
      })}
    </div> : <div className="composed-empty"><Clipboard size={18} /><div><strong>Sin acciones seleccionadas en el PIC</strong><p>La tabla aparecerá cuando el plan vigente tenga acciones seleccionadas.</p></div></div>}
  </section>;
}
type SourceItem = { id: string; type: string; label: string; status: string; sourceDate: string | null; notice: string };
function SourcesSection({ sources, selected, onChange }: { sources: SourceItem[]; selected: PicFollowupContent["sources"]; onChange: (next: PicFollowupContent["sources"]) => void }) {
  const toggle = (source: SourceItem, checked: boolean) => checked
    ? onChange([...selected.filter(item => item.id !== source.id), { id: source.id, type: source.type as PicFollowupContent["sources"][number]["type"], note: "" }])
    : onChange(selected.filter(item => item.id !== source.id));
  return <section className="followup-card"><CardHeading index="C" title="Referencias de origen" hint="Selecciona únicamente fuentes ofrecidas para el curso actual." />
    {sources.length ? <div className="source-pick-list">{sources.map(source => {
      const ref = selected.find(item => item.id === source.id);
      return <article className={`source-pick ${ref ? "is-selected" : ""}`} key={source.id}>
        <label className="source-pick-top"><input type="checkbox" checked={Boolean(ref)} onChange={event => toggle(source, event.currentTarget.checked)} data-testid={`checkbox-source-${source.id}`} /><span className="source-copy"><strong>{SOURCE_LABEL[source.type] ?? source.type}</strong><span>{source.label}</span><small>{source.sourceDate ? new Date(source.sourceDate).toLocaleDateString("es") : "Sin fecha registrada"} · {source.status}</small></span><span className="source-state">{ref ? <><Check size={13} /> Añadida</> : "Añadir"}</span></label>
        {source.notice && <p className="source-notice">{source.notice}</p>}{source.type === "agenda_c1" && <p className="source-notice agenda-caveat">Agenda recibida o planificada: no es un registro de asistencia.</p>}
        {ref && <label className="followup-field source-note"><span>Nota sobre esta referencia</span><input value={ref.note} maxLength={1000} onChange={event => onChange(selected.map(item => item.id === source.id ? { ...item, note: event.currentTarget.value } : item))} placeholder="Contexto breve (opcional)" /></label>}
      </article>;
    })}</div> : <div className="composed-empty"><FileCheck2 size={18} /><div><strong>Fuentes pendientes</strong><p>Cuando haya actividades/evidencias validadas, actas, acuerdos u observaciones, aparecerán aquí.</p></div></div>}
  </section>;
}
type AnnexDocument = { id: string; title: string; fileName: string; sha256: string };
function AnnexSection({ documents, selected, onChange }: { documents: AnnexDocument[]; selected: PicFollowupContent["annexes"]; onChange: (next: PicFollowupContent["annexes"]) => void }) {
  return <section className="followup-card"><CardHeading index="D" title="Anexos del centro y del curso" hint="Los anexos son referencias a documentos existentes; aquí no se suben ni duplican archivos." />
    {documents.length ? <div className="annex-list">{documents.map(doc => {
      const item = selected.find(entry => entry.documentId === doc.id);
      return <article className="annex-row" key={doc.id}><label className="annex-choice"><input type="checkbox" checked={Boolean(item)} onChange={event => onChange(event.currentTarget.checked ? [...selected.filter(entry => entry.documentId !== doc.id), { documentId: doc.id, title: doc.title, description: "" }] : selected.filter(entry => entry.documentId !== doc.id))} data-testid={`checkbox-annex-${doc.id}`} /><FileText size={17} /><span><strong>{doc.title}</strong><small>{doc.fileName}</small></span></label>
        {item && <label className="followup-field annex-description"><span>Descripción del anexo</span><input value={item.description} maxLength={1000} onChange={event => onChange(selected.map(entry => entry.documentId === doc.id ? { ...entry, description: event.currentTarget.value } : entry))} placeholder="Descripción para el informe" /></label>}
      </article>;
    })}</div> : <div className="composed-empty"><FileText size={18} /><div><strong>No hay documentos anexables</strong><p>El catálogo de anexos se nutre de documentos existentes del centro y del curso.</p></div></div>}
  </section>;
}
function CertificationSection({ content, sources, onChange }: { content: PicFollowupContent; sources: SourceItem[]; onChange: (next: PicFollowupContent["certification"]) => void }) {
  const check = (key: keyof PicFollowupContent["certification"]) => content.certification[key] as PicCertificationCheck;
  const change = (key: keyof PicFollowupContent["certification"], updates: Partial<PicCertificationCheck>) => onChange({ ...content.certification, [key]: { ...check(key), ...updates } });
  return <section className="followup-card certification-card"><CardHeading index="E" title="Lista de comprobación manual" hint="Confirmaciones personales. No es certificado oficial, propuesta de pago ni cálculo de logro." />
    <div className="certification-warning"><ShieldCheck size={16} /><p>La interfaz no emite una valoración automática. Confirma cada punto solo tras revisión humana.</p></div>
    <div className="checklist">{CHECKS.map(({ key, label }) => <div className="check-row" key={key}>
      <span>{label}</span><select value={check(key).status} onChange={event => change(key, { status: event.currentTarget.value as PicCertificationCheckStatus })} aria-label={`Confirmación manual: ${label}`} data-testid={`select-certification-${key}`}>{CHECK_STATES.map(state => <option key={state.value} value={state.value}>{state.label}</option>)}</select>
      <label className="sr-only" htmlFor={`cert-observation-${key}`}>Observación: {label}</label><input id={`cert-observation-${key}`} value={check(key).observation} maxLength={3000} placeholder="Observación de la persona" onChange={event => change(key, { observation: event.currentTarget.value })} />
      {check(key).status !== "sin_verificar" && sources.length > 0 && <details className="cert-sources"><summary>Vincular fuentes ({check(key).sourceIds.length})</summary><div>{sources.map(source => <label key={source.id}><input type="checkbox" checked={check(key).sourceIds.includes(source.id)} onChange={event => change(key, { sourceIds: event.currentTarget.checked ? [...check(key).sourceIds, source.id] : check(key).sourceIds.filter(id => id !== source.id) })} />{source.label}</label>)}</div></details>}
    </div>)}</div>
    <TextArea label="Resumen de asistencia confirmado por la persona" value={content.certification.personConfirmedAttendanceSummary} maxLength={2000} onChange={value => onChange({ ...content.certification, personConfirmedAttendanceSummary: value })} />
    <p className="certification-footnote">La agenda C1, si existe, indica planificación o recepción; nunca demuestra asistencia.</p>
  </section>;
}
function SnapshotSection({ snapshots, selectedId, onSelect, reason, onReason, onFreeze, freezePending, report, dirty, onExport, docxPending, pdfPending, onLaycos, laycosPending }: {
  snapshots: PicFollowupSnapshot[]; selectedId: string; onSelect: (id: string) => void; reason: string; onReason: (value: string) => void;
  onFreeze: () => void; freezePending: boolean; report?: PicFollowupReport; dirty: boolean;
  onExport: (format: "docx" | "pdf") => void; docxPending: boolean; pdfPending: boolean; onLaycos: () => void; laycosPending: boolean;
}) {
  const currentId = selectedId || snapshots[0]?.id || "";
  const current = snapshots.find(item => item.id === currentId);
  return <section className="followup-card snapshot-card"><CardHeading index="F" title="Versiones y exportaciones" hint="Cada snapshot es inmutable y conserva revisión y fuentes utilizadas." />
    <div className="snapshot-create"><label className="followup-field"><span>Motivo para congelar esta revisión</span><input value={reason} maxLength={400} onChange={event => onReason(event.currentTarget.value)} placeholder="Ej. Cierre de seguimiento del trimestre" data-testid="input-snapshot-reason" /></label><button type="button" className="freeze-button" disabled={!report || dirty || reason.trim().length < 4 || freezePending} onClick={onFreeze} data-testid="button-create-followup-snapshot">{freezePending ? <RefreshCw size={15} className="animate-spin" /> : <Archive size={15} />}{freezePending ? "Congelando…" : "Crear snapshot"}</button></div>
    {dirty && <p className="snapshot-hint">Guarda primero los cambios para congelar la revisión vigente.</p>}{!report && <p className="snapshot-hint">Guarda el borrador antes de crear su primera versión inmutable.</p>}
    {snapshots.length ? <><label className="followup-field snapshot-select"><span>Exportar versión</span><select value={currentId} onChange={event => onSelect(event.currentTarget.value)}>{snapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>Versión {snapshot.version} · rev. {snapshot.reportRevision} · {new Date(snapshot.createdAt).toLocaleDateString("es")}</option>)}</select></label>
      <div className="snapshot-meta"><span><LockKeyhole size={13} /> Solo lectura</span><span>SHA-256 · {current?.sourceHash.slice(0, 14)}…</span></div>{current?.validation.warnings.map((warning, index) => <p className="snapshot-warning" key={`${warning}-${index}`}><AlertCircle size={13} />{warning}</p>)}
      <div className="export-actions"><button type="button" onClick={() => onExport("docx")} disabled={docxPending} data-testid="button-export-followup-docx"><ArrowDownToLine size={15} />{docxPending ? "Preparando…" : "DOCX"}</button><button type="button" onClick={() => onExport("pdf")} disabled={pdfPending} data-testid="button-export-followup-pdf"><ArrowDownToLine size={15} />{pdfPending ? "Preparando…" : "PDF"}</button><button type="button" onClick={onLaycos} disabled={laycosPending} data-testid="button-copy-followup-laycos"><Clipboard size={15} />{laycosPending ? "Preparando…" : "Copiar a Laycos"}</button></div><p className="export-caveat">La copia para Laycos solo prepara los campos. La persona transcribe y presenta manualmente.</p>
    </> : <div className="composed-empty snapshot-empty"><Archive size={18} /><div><strong>Aún no hay snapshots</strong><p>Las exportaciones y entregas se habilitan desde una versión congelada.</p></div></div>}
  </section>;
}
function DeliverySection({ selectedSnapshot, documents, date, setDate, proofId, setProofId, identifier, setIdentifier, confirmation, setConfirmation, checked, setChecked, onSubmit, pending, deliveries, deliveryLoading, deliveryError, retryDeliveries }: {
  selectedSnapshot?: PicFollowupSnapshot; documents: AnnexDocument[]; date: string; setDate: (value: string) => void;
  proofId: string; setProofId: (value: string) => void; identifier: string; setIdentifier: (value: string) => void;
  confirmation: string; setConfirmation: (value: string) => void; checked: boolean; setChecked: (value: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; pending: boolean; deliveries: PicFollowupDelivery[];
  deliveryLoading: boolean; deliveryError: string; retryDeliveries: () => void;
}) {
  return <section className="followup-card delivery-card"><CardHeading index="G" title="Entrega manual confirmada" hint="La constancia la registra una persona; la plataforma no envía documentación a Laycos." />
    <div className="delivery-disclaimer"><LockKeyhole size={17} /><p><strong>Una entrega no es una aprobación.</strong> El registro no confirma que Laycos haya leído, aceptado o aprobado el informe.</p></div>
    {selectedSnapshot ? <form onSubmit={onSubmit} className="delivery-form">
      <div className="delivery-selected-snapshot"><span>VERSIÓN A ENTREGAR</span><strong>Snapshot {selectedSnapshot.version} · revisión {selectedSnapshot.reportRevision}</strong><small>{selectedSnapshot.reason}</small></div>
      <div className="field-grid two"><DateInput label="Fecha de entrega manual" value={date} onChange={setDate} /><label className="followup-field"><span>Identificador externo (opcional)</span><input value={identifier} maxLength={200} onChange={event => setIdentifier(event.currentTarget.value)} placeholder="Referencia de registro" /></label></div>
      <label className="followup-field"><span>Documento justificante existente <i>· obligatorio</i></span><select value={proofId} onChange={event => setProofId(event.currentTarget.value)} required data-testid="select-delivery-proof"><option value="">Selecciona un documento del centro o del curso</option>{documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title} · {doc.fileName}</option>)}</select></label>
      {!documents.length && <p className="delivery-no-doc">No hay documentos disponibles como justificante. Añade primero el documento al repositorio de centro/curso.</p>}
      <TextArea label="Confirmación de la persona que realizó la entrega" value={confirmation} maxLength={500} onChange={setConfirmation} rows={3} />
      <label className="person-confirm"><input type="checkbox" checked={checked} onChange={event => setChecked(event.currentTarget.checked)} required data-testid="checkbox-person-delivery-confirmation" /><span><strong>Confirmo personalmente</strong> que la entrega de esta versión se realizó fuera de INNOVA-C2 y que el documento indicado acredita esa acción.</span></label>
      <button type="submit" className="record-delivery" disabled={pending || !checked || confirmation.trim().length < 15 || !proofId} data-testid="button-record-followup-delivery">{pending ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}{pending ? "Registrando…" : "Registrar entrega confirmada"}</button>
    </form> : <div className="composed-empty"><LockKeyhole size={18} /><div><strong>Congela una versión antes de registrar la entrega</strong><p>El registro queda asociado a un snapshot inmutable y a un justificante existente.</p></div></div>}
    <div className="delivery-history"><div className="delivery-history-head"><h4>Historial de entregas</h4><span>{deliveries.length} {deliveries.length === 1 ? "registro" : "registros"}</span></div>
      {deliveryLoading ? <div className="skeleton h-16" /> : deliveryError ? <div className="delivery-error" role="alert"><span>{deliveryError}</span><button type="button" onClick={retryDeliveries}>Reintentar</button></div> : deliveries.length ? deliveries.map(item => <article className="delivery-record" key={item.id}><span className="delivery-record-icon"><CheckCircle2 size={15} /></span><div><strong>{item.deliveryDate} · {item.recordedByName}</strong><span>{item.proofDocumentTitle} · {item.proofFileName}</span><small>{item.externalIdentifier ? `Ref. ${item.externalIdentifier} · ` : ""}Entrega manual · sin estado de lectura/aprobación</small></div></article>) : <div className="delivery-empty"><span>Sin entregas registradas</span><small>El historial solo muestra entregas confirmadas por una persona.</small></div>}
    </div>
  </section>;
}
