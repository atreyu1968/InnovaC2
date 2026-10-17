import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { hasCoordinationAccess } from "../lib/role-access";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity as ActivityIcon, AlertCircle, ArrowDownToLine, Check, ChevronDown,
  ClipboardCheck, FilePlus2, FileText, Link2, Plus, RefreshCw, Search,
  ShieldCheck, Upload, X,
} from "lucide-react";
import {
  UserRole, addDocumentVersion as postDocumentVersion, getListActivitiesQueryKey, getListCurrentIndicatorsQueryKey,
  getListDocumentsQueryKey, getListInformationRequestsQueryKey,
  getListStaffOptionsQueryKey, getGetDocumentQueryKey,
  useAddDocumentVersion, useApproveDocument, useConfirmActivity,
  useCreateActivity, useCreateIndicatorObservation,
  useCreateInformationRequest, useDiscardActivity, useDownloadDocumentVersion,
  useGetDocument, useLinkDocumentEvidence, useListActivities,
  useListCurrentIndicators, useListDocuments, useListInformationRequests,
  useListStaffOptions, useRespondToInformationRequest, useSetDocumentAccess,
  useUpdateActivity, useUploadDocument, useValidateActivity,
  useValidateInformationResponse, useRescanDocumentVersion,
} from "@workspace/api-client-react";
import type {
  Activity, CreateActivityInput, CreateIndicatorObservationInput,
  Document as PicDocument, IndicatorSummary, InformationRequest, User,
} from "@workspace/api-client-react";
import "./ActivitiesPhaseTwo.css";

type Pane = "actuaciones" | "documentos" | "solicitudes" | "indicadores";
type ActivityDraft = {
  title: string; description: string; activityDate: string;
  professionalFamily: string; sourceLabel: string; indicatorCodes: string;
  responsibleUserId: string;
};

const operationalRoles = [
  UserRole.admin_tecnico,
  UserRole.c2_innovacion, UserRole.profesorado, UserRole.jefatura_departamento,
  UserRole.coordinacion_red, UserRole.equipo_directivo,
];
const roleIsC2 = (user: User) => hasCoordinationAccess(user.role);
const readableDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(value))
  : "Sin fecha";
const errorMessage = (error: unknown) => error instanceof Error
  ? error.message : "No se ha podido completar la operación.";
const activityStatus: Record<string, string> = {
  pendiente_responsable: "Pendiente de confirmación",
  pendiente_c2: "Pendiente de revisión C2",
  validada: "Validada", descartada: "Descartada",
};
const documentStatus: Record<string, string> = {
  pendiente_revision: "Pendiente de revisión", aprobado: "Aprobado", archivado: "Archivado",
};
const scanLabel: Record<string, string> = {
  limpio: "Escaneo limpio", infectado: "Amenaza detectada",
  no_configurado: "Escaneo no configurado", no_disponible: "Escaneo no disponible",
};
const requestStatus: Record<string, string> = {
  solicitada: "Solicitada", respondida: "Respondida", validada: "Validada", cerrada: "Cerrada",
};
const emptyDraft = (user: User): ActivityDraft => ({
  title: "", description: "", activityDate: "",
  professionalFamily: user.professionalFamily ?? "", sourceLabel: "",
  indicatorCodes: "", responsibleUserId: user.id,
});

function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  return <span className={`p2-pill p2-pill-${tone}`}>{children}</span>;
}
function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" | "success" }) {
  return <div className={`p2-notice p2-notice-${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}
function SectionTitle({ overline, title, detail, action }: {
  overline: string; title: string; detail: string; action?: ReactNode;
}) {
  return <div className="p2-section-head"><div><p className="p2-overline">{overline}</p><h2>{title}</h2><p className="p2-section-detail">{detail}</p></div>{action}</div>;
}

export function ActivitiesPhaseTwo({ user }: { user: User }) {
  const client = useQueryClient();
  const c2 = roleIsC2(user);
  const canOperate = operationalRoles.some(role => role === user.role);
  const activitiesQuery = useListActivities({ query: { queryKey: getListActivitiesQueryKey(), enabled: canOperate, refetchOnMount: "always" } });
  const documentsQuery = useListDocuments({ query: { queryKey: getListDocumentsQueryKey(), enabled: canOperate, refetchOnMount: "always", refetchInterval: 30_000 } });
  const requestsQuery = useListInformationRequests({ query: { queryKey: getListInformationRequestsQueryKey(), enabled: canOperate, refetchOnMount: "always" } });
  const indicatorsQuery = useListCurrentIndicators({ query: { queryKey: getListCurrentIndicatorsQueryKey(), enabled: c2, refetchOnMount: "always" } });
  const staffQuery = useListStaffOptions({ query: { queryKey: getListStaffOptionsQueryKey(), enabled: c2, refetchOnMount: "always" } });

  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();
  const confirmActivity = useConfirmActivity();
  const validateActivity = useValidateActivity();
  const discardActivity = useDiscardActivity();
  const uploadDocument = useUploadDocument();
  const addVersion = useAddDocumentVersion({
    mutation: {
      mutationFn: ({ documentId, data }) => postDocumentVersion(documentId, data, {
        headers: data instanceof File ? { "X-File-Name": encodeURIComponent(data.name) } : {},
      }),
    },
  });
  const approveDocument = useApproveDocument();
  const rescanDocument = useRescanDocumentVersion();
  const setDocumentAccess = useSetDocumentAccess();
  const linkEvidence = useLinkDocumentEvidence();
  const createRequest = useCreateInformationRequest();
  const respondRequest = useRespondToInformationRequest();
  const validateResponse = useValidateInformationResponse();
  const createObservation = useCreateIndicatorObservation();

  const [pane, setPane] = useState<Pane>("actuaciones");
  const [activityFormOpen, setActivityFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Activity | null>(null);
  const [draft, setDraft] = useState<ActivityDraft>(() => emptyDraft(user));
  const [selectedActivity, setSelectedActivity] = useState("");
  const [selectedDocument, setSelectedDocument] = useState("");
  const [downloadVersion, setDownloadVersion] = useState(1);
  const [selectedRequest, setSelectedRequest] = useState("");
  const [selectedIndicator, setSelectedIndicator] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const activities = activitiesQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const requests = requestsQuery.data ?? [];
  const indicators = indicatorsQuery.data ?? [];
  const staff = staffQuery.data ?? [];
  const currentDocument = documents.find(item => item.id === selectedDocument);
  const currentRequest = requests.find(item => item.id === selectedRequest);
  const currentIndicator = indicators.find(item => item.code === selectedIndicator);
  const detail = useGetDocument(selectedDocument || "not-selected", {
    query: { queryKey: getGetDocumentQueryKey(selectedDocument || "not-selected"), enabled: Boolean(selectedDocument), retry: false, refetchInterval: 30_000 },
  });
  const download = useDownloadDocumentVersion(selectedDocument || "not-selected", downloadVersion, {
    query: {
      queryKey: ["download-document-version", selectedDocument, downloadVersion],
      enabled: false, retry: false,
    },
  });

  const visibleActivities = useMemo(() => activities.filter(item => !search ||
    `${item.title} ${item.description} ${item.professionalFamily} ${item.indicatorCodes.join(" ")}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))), [activities, search]);
  const visibleDocuments = useMemo(() => documents.filter(item => !search ||
    `${item.title} ${item.category} ${item.latestFileName} ${item.professionalFamily ?? ""}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))), [documents, search]);
  const visibleRequests = useMemo(() => requests.filter(item => !search ||
    `${item.reason} ${item.requestedFields.join(" ")} ${item.subjectId}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))), [requests, search]);
  const visibleIndicators = useMemo(() => indicators.filter(item => !search ||
    `${item.code} ${item.description} ${item.actionCode}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))), [indicators, search]);

  const refresh = async (...keys: (readonly unknown[])[]) => {
    await Promise.all(keys.map(queryKey => client.invalidateQueries({ queryKey })));
  };
  const fail = (issue: unknown) => { setError(errorMessage(issue)); setNotice(""); };
  const succeed = (message: string) => { setNotice(message); setError(""); };
  const openNewActivity = () => {
    setActivityFormOpen(true);
    setEditing(null); setDraft(emptyDraft(user)); setError(""); setNotice("");
    document.getElementById("p2-activity-title")?.focus();
  };
  const openEditActivity = (activity: Activity) => {
    setActivityFormOpen(true);
    setEditing(activity);
    setDraft({
      title: activity.title, description: activity.description,
      activityDate: activity.activityDate?.slice(0, 10) ?? "",
      professionalFamily: activity.professionalFamily,
      sourceLabel: activity.sourceLabels[0] ?? "",
      indicatorCodes: activity.indicatorCodes.join(", "),
      responsibleUserId: activity.responsibleUserId,
    });
    setError(""); setNotice("");
  };
  const submitActivity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setNotice("");
    const codes = draft.indicatorCodes.split(",").map(code => code.trim()).filter(Boolean);
    if (editing) {
      updateActivity.mutate({
        activityId: editing.id,
        data: {
          expectedRevision: editing.revision, title: draft.title.trim(),
          description: draft.description.trim(), activityDate: draft.activityDate || null,
          professionalFamily: draft.professionalFamily.trim(), indicatorCodes: codes,
        },
      }, {
        onSuccess: async () => {
          await refresh(getListActivitiesQueryKey());
          setEditing(null); setActivityFormOpen(false); succeed("Actuación actualizada.");
        }, onError: fail,
      });
      return;
    }
    const data: CreateActivityInput = {
      title: draft.title.trim(), description: draft.description.trim(),
      activityDate: draft.activityDate || null,
      professionalFamily: draft.professionalFamily.trim(),
      sourceLabel: draft.sourceLabel.trim(), indicatorCodes: codes,
      responsibleUserId: draft.responsibleUserId || user.id,
    };
    createActivity.mutate({ data }, {
      onSuccess: async result => {
        await refresh(getListActivitiesQueryKey());
        setDraft(emptyDraft(user)); setEditing(null); setActivityFormOpen(false);
        succeed(result.duplicate ? "La actuación coincide con un registro existente; se ha comprobado la respuesta del servidor." : "Actuación registrada.");
      }, onError: fail,
    });
  };

  const runActivityAction = (activity: Activity, action: "confirm" | "validate" | "discard", informationStatus?: "confirmada" | "sin_informacion" | "no_realizada") => {
    setError(""); setNotice("");
    const onSuccess = async () => {
      await refresh(getListActivitiesQueryKey(), getListCurrentIndicatorsQueryKey());
      succeed(action === "validate" ? "Actuación validada." : action === "discard" ? "Actuación retirada del seguimiento." : "Estado de información confirmado.");
    };
    if (action === "confirm") confirmActivity.mutate({ activityId: activity.id, data: { expectedRevision: activity.revision, informationStatus: informationStatus ?? "confirmada" } }, { onSuccess, onError: fail });
    if (action === "validate") validateActivity.mutate({ activityId: activity.id, data: { expectedRevision: activity.revision } }, { onSuccess, onError: fail });
    if (action === "discard") {
      if (!window.confirm(`¿Retirar «${activity.title}»? Se conservará su historial.`)) return;
      discardActivity.mutate({ activityId: activity.id, data: { expectedRevision: activity.revision } }, { onSuccess, onError: fail });
    }
  };

  const submitUpload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setNotice("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) { setError("Selecciona un archivo válido."); return; }
    const activityId = String(form.get("activityId") ?? "");
    const family = String(form.get("family") ?? "").trim();
    uploadDocument.mutate({
      data: file,
      params: {
        title: String(form.get("title") ?? "").trim(),
        category: String(form.get("category") ?? "evidencia") as "evidencia" | "acta" | "informe" | "producto" | "otro",
        professionalFamily: family || undefined,
        accessScope: String(form.get("accessScope") ?? "restricted") as "family" | "center" | "restricted",
        activityId: activityId || undefined,
        fileName: file.name,
      },
    }, {
      onSuccess: async created => {
        await refresh(getListDocumentsQueryKey(), getListActivitiesQueryKey(), getListCurrentIndicatorsQueryKey());
        setSelectedDocument(created.id); setDownloadVersion(created.currentVersion); formElement.reset(); succeed("Documento privado registrado y enviado a control antivirus.");
      }, onError: fail,
    });
  };
  const submitVersion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedDocument) return;
    const formElement = event.currentTarget;
    const file = new FormData(formElement).get("versionFile");
    if (!(file instanceof File) || !file.size) { setError("Selecciona la nueva versión."); return; }
    addVersion.mutate({ documentId: selectedDocument, data: file }, {
      onSuccess: async updated => {
        await refresh(getListDocumentsQueryKey(), getGetDocumentQueryKey(selectedDocument));
        setDownloadVersion(updated.currentVersion); formElement.reset(); succeed("Nueva versión inmutable registrada; pendiente de control antivirus.");
      }, onError: fail,
    });
  };
  const handleDownload = async () => {
    setError(""); setNotice("");
    const versionInfo = detail.data?.versions.find(item => item.version === downloadVersion);
    if (!versionInfo || versionInfo.scanStatus !== "limpio") {
      setError("Solo se pueden descargar versiones con escaneo antivirus limpio.");
      return;
    }
    const result = await download.refetch();
    if (result.error || !(result.data instanceof Blob)) { fail(result.error ?? new Error("No se ha recibido el archivo.")); return; }
    const url = URL.createObjectURL(result.data);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = versionInfo.originalName; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Descarga iniciada · versión ${downloadVersion}.`);
  };
  const handleApprove = (document: PicDocument) => {
    if (document.scanStatus !== "limpio") return;
    approveDocument.mutate({ documentId: document.id, data: { expectedRevision: document.revision } }, {
      onSuccess: async () => { await refresh(getListDocumentsQueryKey(), getListActivitiesQueryKey(), getListCurrentIndicatorsQueryKey()); succeed("Documento aprobado."); },
      onError: fail,
    });
  };
  const handleRescan = (document: PicDocument, version: number) => {
    rescanDocument.mutate({
      documentId: document.id, version, data: { expectedRevision: document.revision },
    }, {
      onSuccess: async () => {
        await refresh(getListDocumentsQueryKey(), getGetDocumentQueryKey(document.id),
          getListActivitiesQueryKey(), getListCurrentIndicatorsQueryKey());
        succeed(`Análisis registrado para la versión ${version}. Solo un resultado limpio permite descargar y solicitar aprobación.`);
      },
      onError: async (issue) => {
        await refresh(getListDocumentsQueryKey(), getGetDocumentQueryKey(document.id));
        fail(issue);
      },
    });
  };
  const handleLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedDocument) return;
    const data = new FormData(event.currentTarget);
    const activityId = String(data.get("activityId") ?? "");
    if (!activityId) { setError("Selecciona una actuación para vincular la evidencia."); return; }
    linkEvidence.mutate({
      documentId: selectedDocument,
      data: {
        activityId,
        indicatorCode: String(data.get("indicatorCode") ?? "") || null,
        note: String(data.get("note") ?? "").trim() || undefined,
      },
    }, {
      onSuccess: async () => { await refresh(getListDocumentsQueryKey(), getListActivitiesQueryKey(), getListCurrentIndicatorsQueryKey()); succeed("Evidencia vinculada a la actuación."); },
      onError: fail,
    });
  };
  const handleAccess = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedDocument || !c2) return;
    const data = new FormData(event.currentTarget);
    setDocumentAccess.mutate({
      documentId: selectedDocument,
      data: { userId: String(data.get("userId")), granted: String(data.get("granted")) === "true" },
    }, { onSuccess: async () => { await refresh(getListDocumentsQueryKey()); succeed("Acceso restringido actualizado."); }, onError: fail });
  };

  const submitRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setNotice("");
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const fields = String(data.get("requestedFields") ?? "").split("\n").map(value => value.trim()).filter(Boolean);
    createRequest.mutate({
      data: {
        recipientUserId: String(data.get("recipientUserId")),
        subjectType: "activity", subjectId: String(data.get("subjectId")),
        requestedFields: fields, reason: String(data.get("reason") ?? "").trim(),
        dueAt: String(data.get("dueAt") ?? "") ? `${String(data.get("dueAt"))}T23:59:59.000Z` : null,
      },
    }, {
      onSuccess: async () => { await refresh(getListInformationRequestsQueryKey()); formElement.reset(); succeed("Solicitud registrada para el destinatario dentro de la aplicación."); },
      onError: fail,
    });
  };
  const submitResponse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentRequest) return;
    const data = new FormData(event.currentTarget);
    const mode = String(data.get("responseStatus")) as "respondida" | "sin_informacion" | "no_realizada";
    const answers = Object.fromEntries(currentRequest.requestedFields.map((field, index) => [field, String(data.get(`answer-${index}`) ?? "").trim()]));
    respondRequest.mutate({
      requestId: currentRequest.id,
      data: { responseStatus: mode, answers: mode === "respondida" ? answers : {}, comment: String(data.get("comment") ?? "").trim() },
    }, { onSuccess: async () => { await refresh(getListInformationRequestsQueryKey()); succeed("Respuesta registrada."); }, onError: fail });
  };
  const handleValidateResponse = (request: InformationRequest) => {
    validateResponse.mutate({ requestId: request.id, data: { expectedRevision: request.revision } }, {
      onSuccess: async () => { await refresh(getListInformationRequestsQueryKey(), getListActivitiesQueryKey(), getListCurrentIndicatorsQueryKey()); succeed("Respuesta validada y aplicada."); },
      onError: fail,
    });
  };
  const submitObservation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentIndicator) return;
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const chosenEvidence = Array.from(data.getAll("evidenceIds")).map(String);
    const input: CreateIndicatorObservationInput = {
      period: String(data.get("period")).trim(),
      evidenceIds: chosenEvidence,
    };
    if ((currentIndicator.type === "booleano" || currentIndicator.type === "porcentaje") && chosenEvidence.length === 0) {
      setError("Las observaciones booleanas y porcentajes requieren al menos una evidencia aprobada.");
      return;
    }
    if (currentIndicator.type === "booleano") input.value = String(data.get("value")) === "true";
    else if (currentIndicator.type === "porcentaje") {
      input.numerator = Number(data.get("numerator"));
      input.denominator = Number(data.get("denominator"));
    } else input.value = Number(data.get("value"));
    createObservation.mutate({ indicatorCode: currentIndicator.code, data: input }, {
      onSuccess: async () => { await refresh(getListCurrentIndicatorsQueryKey()); formElement.reset(); succeed("Observación registrada para revisión C2."); },
      onError: fail,
    });
  };

  const queryLoading = pane === "actuaciones" ? activitiesQuery.isLoading
    : pane === "documentos" ? documentsQuery.isLoading
    : pane === "solicitudes" ? requestsQuery.isLoading : indicatorsQuery.isLoading;
  const currentError = pane === "actuaciones" ? activitiesQuery.isError
    : pane === "documentos" ? documentsQuery.isError
    : pane === "solicitudes" ? requestsQuery.isError : indicatorsQuery.isError;
  const retryCurrent = () => {
    if (pane === "actuaciones") void activitiesQuery.refetch();
    else if (pane === "documentos") void documentsQuery.refetch();
    else if (pane === "solicitudes") void requestsQuery.refetch();
    else void indicatorsQuery.refetch();
  };
  const queryIssue = pane === "actuaciones" ? activitiesQuery.error
    : pane === "documentos" ? documentsQuery.error
    : pane === "solicitudes" ? requestsQuery.error : indicatorsQuery.error;
  if (!canOperate) return <section className="p2-panel p-6"><Notice tone="info">Esta vista de seguimiento está disponible para C2, jefaturas, coordinación y profesorado.</Notice></section>;

  return <div className="p2-page fade-up">
    <header className="p2-intro">
      <div><p className="p2-overline">Fase 2 · seguimiento del PIC</p><h1>Actuaciones y evidencias</h1><p>Registra lo realizado, conserva su trazabilidad y reúne la documentación que permite revisar cada indicador.</p></div>
      <div className="p2-intro-meta"><span className="p2-meta-mark"><ClipboardCheck size={18} /></span><span><strong>Curso activo</strong><small>Registro del centro · revisión por roles</small></span></div>
    </header>

    <div className="p2-alert-stack">{error && <Notice tone="error"><AlertCircle size={16} />{error}<button onClick={() => setError("")} aria-label="Cerrar aviso"><X size={14} /></button></Notice>}{notice && <Notice tone="success"><Check size={16} />{notice}</Notice>}</div>
    <nav className="p2-tabs" aria-label="Secciones de seguimiento">
      {([
        ["actuaciones", "Actuaciones", activities.length],
        ["documentos", "Documentos", documents.length],
        ["solicitudes", "Solicitudes", requests.length],
        ["indicadores", "Indicadores", c2 ? indicators.length : null],
      ] as const).map(([id, label, amount]) => <button key={id} className={pane === id ? "is-current" : ""} onClick={() => { setPane(id); setSearch(""); }} aria-current={pane === id ? "page" : undefined} data-testid={`tab-${id}`}><span>{label}</span>{amount !== null && <small>{amount}</small>}</button>)}
    </nav>

    {pane === "actuaciones" && <section className="p2-workspace">
      <div className="p2-panel p2-main-list">
        <SectionTitle overline="Registro del curso" title="Actuaciones" detail="Captura y sigue actividades reales vinculadas con las acciones del PIC." action={<button type="button" className="p2-primary" onClick={openNewActivity} data-testid="button-new-activity"><Plus size={15} />Nueva actuación</button>} />
        <div className="p2-list-tools"><label className="p2-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por título, familia o indicador" aria-label="Buscar actuaciones" data-testid="input-activity-search" /></label><button className="p2-icon-button" onClick={() => void activitiesQuery.refetch()} disabled={activitiesQuery.isFetching} aria-label="Actualizar actuaciones" data-testid="button-refresh-activities"><RefreshCw size={15} className={activitiesQuery.isFetching ? "p2-spin" : ""} /></button></div>
        {activityFormOpen ? <form className="p2-form p2-activity-form" onSubmit={submitActivity}>
          <div className="p2-form-heading"><div><span className="p2-overline">{editing ? `Edición · revisión ${editing.revision}` : "Nueva captura"}</span><h3>{editing ? "Corregir actuación" : "Registrar actuación"}</h3></div><button type="button" className="p2-icon-button" onClick={() => { setEditing(null); setDraft(emptyDraft(user)); }} aria-label="Cerrar formulario"><X size={16} /></button></div>
          <label>Título<input id="p2-activity-title" className="field" required minLength={1} maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>Descripción de la actuación<textarea className="field" required rows={3} maxLength={4000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          <div className="p2-form-grid"><label>Fecha<input className="field" type="date" value={draft.activityDate} onChange={e => setDraft({ ...draft, activityDate: e.target.value })} /></label><label>Familia profesional<input className="field" required maxLength={120} value={draft.professionalFamily} readOnly={!c2 && Boolean(user.professionalFamily)} onChange={e => setDraft({ ...draft, professionalFamily: e.target.value })} /></label></div>
          {!editing && c2 && <label>Persona responsable<select className="field" value={draft.responsibleUserId} onChange={e => setDraft({ ...draft, responsibleUserId: e.target.value })}><option value={user.id}>{user.name} · yo</option>{staff.filter(person => person.id !== user.id).map(person => <option key={person.id} value={person.id}>{person.name} · {person.professionalFamily ?? person.role}</option>)}</select></label>}
          {!editing && <label>Fuente o procedencia de la información<input className="field" required maxLength={200} placeholder="Ej.: reunión de departamento, memoria de proyecto…" value={draft.sourceLabel} onChange={e => setDraft({ ...draft, sourceLabel: e.target.value })} /></label>}
          <label>Códigos de indicadores relacionados <span className="p2-label-hint">Separados por comas; pueden revisarse después.</span><input className="field" value={draft.indicatorCodes} onChange={e => setDraft({ ...draft, indicatorCodes: e.target.value })} /></label>
          <div className="p2-form-actions"><button type="button" className="p2-secondary" onClick={() => { setActivityFormOpen(false); setEditing(null); setDraft(emptyDraft(user)); }}>Cancelar</button><button className="p2-primary" disabled={createActivity.isPending || updateActivity.isPending} data-testid="button-save-activity">{createActivity.isPending || updateActivity.isPending ? "Guardando…" : editing ? "Guardar cambios" : "Registrar actuación"}</button></div>
        </form> : null}
        {queryLoading ? <div className="p2-skeleton-list" aria-label="Cargando actuaciones">{[1, 2, 3].map(n => <div className="p2-skeleton-row" key={n} />)}</div>
          : currentError ? <div className="p2-empty"><AlertCircle size={20} /><strong>No se ha podido cargar el registro</strong><p>{errorMessage(queryIssue)}</p><button className="p2-secondary" onClick={retryCurrent}>Reintentar</button></div>
          : visibleActivities.length ? <div className="p2-activity-list">{visibleActivities.map(item => <article className={`p2-activity-row ${selectedActivity === item.id ? "is-selected" : ""}`} key={item.id} data-testid={`activity-${item.id}`}>
            <button className="p2-row-main" onClick={() => setSelectedActivity(selectedActivity === item.id ? "" : item.id)} aria-expanded={selectedActivity === item.id}>
              <span className="p2-date-block"><strong>{item.activityDate ? new Date(item.activityDate).getDate().toString().padStart(2, "0") : "—"}</strong><small>{item.activityDate ? new Intl.DateTimeFormat("es-ES", { month: "short" }).format(new Date(item.activityDate)) : "Fecha"}</small></span>
              <span className="p2-row-copy"><span className="p2-row-title">{item.title}</span><span className="p2-row-sub">{item.professionalFamily} · {item.sourceLabels.join(", ") || "Procedencia sin detalle"}</span><span className="p2-row-tags">{item.indicatorCodes.map(code => <i key={code}>{code}</i>)}{item.evidenceCount > 0 && <i className="p2-evidence-count"><FileText size={11} />{item.evidenceCount} evidencias</i>}</span></span>
              <span className="p2-row-state"><StatusPill tone={item.status === "validada" ? "good" : item.status === "descartada" ? "bad" : "warn"}>{activityStatus[item.status] ?? item.status}</StatusPill><ChevronDown size={15} /></span>
            </button>
            {selectedActivity === item.id && <div className="p2-row-detail"><p>{item.description}</p><div className="p2-detail-meta"><span>Fecha: {readableDate(item.activityDate)}</span><span>Información: {item.informationStatus === "sin_informacion" ? "Sin información" : item.informationStatus === "no_realizada" ? "No realizada" : item.informationStatus === "confirmada" ? "Confirmada" : "En revisión"}</span><span>Revisión {item.revision}</span></div>
              <div className="p2-inline-actions">
                {item.status !== "validada" && item.status !== "descartada" && <>
                  <button className="p2-secondary" onClick={() => openEditActivity(item)} data-testid={`button-edit-activity-${item.id}`}>Editar</button>
                  {item.status === "pendiente_responsable" && item.responsibleUserId === user.id && <><button className="p2-secondary" onClick={() => runActivityAction(item, "confirm", "sin_informacion")} data-testid={`button-no-information-${item.id}`}>Confirmar: sin información</button><button className="p2-secondary" onClick={() => runActivityAction(item, "confirm", "no_realizada")} data-testid={`button-not-realized-${item.id}`}>Confirmar: no realizada</button><button className="p2-primary" onClick={() => runActivityAction(item, "confirm", "confirmada")} data-testid={`button-confirm-activity-${item.id}`}>Confirmar actuación</button></>}
                  {c2 && item.status === "pendiente_c2" && <button className="p2-primary" onClick={() => runActivityAction(item, "validate")} data-testid={`button-validate-activity-${item.id}`}>Validar actuación</button>}
                  {c2 && <button className="p2-text-action" onClick={() => runActivityAction(item, "discard")} data-testid={`button-discard-activity-${item.id}`}>Retirar</button>}
                </>}
                <button className="p2-secondary" onClick={() => { setPane("documentos"); setSelectedActivity(item.id); }}>Adjuntar evidencia</button>
              </div>
            </div>}
          </article>)}</div>
          : <div className="p2-empty"><ActivityIcon size={22} /><strong>{search ? "No hay coincidencias" : "Todavía no hay actuaciones"}</strong><p>{search ? "Ajusta la búsqueda para revisar otros registros." : "Registra una actividad del curso para iniciar su seguimiento."}</p>{!search && <button className="p2-primary" onClick={openNewActivity}><Plus size={15} />Registrar actuación</button>}</div>}
      </div>
      <aside className="p2-side-stack">
        <div className="p2-panel p2-side-note"><span className="p2-note-icon"><ShieldCheck size={17} /></span><div><p className="p2-overline">Trazabilidad</p><h3>Registro verificable</h3><p>Las revisiones quedan asociadas a la actuación. Una validación C2 requiere evidencias adecuadas y queda sujeta a los permisos del servidor.</p></div></div>
        <div className="p2-panel p2-side-stat"><p className="p2-overline">En esta vista</p><strong>{activities.length}</strong><span>actuaciones visibles en tu ámbito</span><div className="p2-stat-rule" /><small>{activities.filter(a => a.status === "pendiente_c2").length} pendientes de revisión C2</small></div>
      </aside>
    </section>}

    {pane === "documentos" && <section className="p2-docs-layout">
      <div className="p2-panel p2-main-list"><SectionTitle overline="Archivo probatorio" title="Documentos" detail="Los archivos se escanean antes de su aprobación y descarga." />
        <div className="p2-list-tools"><label className="p2-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar documentos" aria-label="Buscar documentos" /></label><button className="p2-icon-button" onClick={() => void documentsQuery.refetch()} disabled={documentsQuery.isFetching} aria-label="Actualizar documentos"><RefreshCw size={15} /></button></div>
        {queryLoading ? <div className="p2-skeleton-list">{[1, 2, 3].map(n => <div className="p2-skeleton-row" key={n} />)}</div> : currentError ? <div className="p2-empty"><AlertCircle size={20} /><strong>No se pudo cargar la documentación</strong><p>{errorMessage(queryIssue)}</p><button className="p2-secondary" onClick={retryCurrent}>Reintentar</button></div> : visibleDocuments.length ? <div className="p2-document-list">{visibleDocuments.map(doc => <button key={doc.id} className={`p2-document-row ${selectedDocument === doc.id ? "is-selected" : ""}`} onClick={() => { setSelectedDocument(doc.id); setDownloadVersion(doc.currentVersion); setError(""); }} data-testid={`document-${doc.id}`}><span className="p2-file-mark"><FileText size={17} /></span><span className="p2-row-copy"><strong className="p2-row-title">{doc.title}</strong><span className="p2-row-sub">{doc.latestFileName} · v{doc.currentVersion} · {doc.category}</span></span><span className="p2-document-status"><StatusPill tone={doc.scanStatus === "limpio" ? "good" : doc.scanStatus === "infectado" ? "bad" : "warn"}>{scanLabel[doc.scanStatus] ?? doc.scanStatus}</StatusPill><small>{documentStatus[doc.status] ?? doc.status}</small></span></button>)}</div> : <div className="p2-empty"><FileText size={22} /><strong>Sin documentos visibles</strong><p>Sube un documento desde el formulario para iniciar su control y conservación.</p></div>}
        <form className="p2-form p2-upload-form" onSubmit={submitUpload}>
          <div className="p2-form-heading"><div><span className="p2-overline">Nueva evidencia</span><h3>Adjuntar documento privado</h3></div><Upload size={18} /></div>
          <div className="p2-form-grid"><label>Título<input className="field" name="title" required maxLength={200} /></label><label>Tipo<select className="field" name="category" defaultValue="evidencia"><option value="evidencia">Evidencia</option><option value="acta">Acta</option><option value="informe">Informe</option><option value="producto">Producto</option><option value="otro">Otro</option></select></label></div>
          <div className="p2-form-grid"><label>Familia profesional<input className="field" name="family" defaultValue={user.professionalFamily ?? ""} readOnly={!c2 && Boolean(user.professionalFamily)} required /></label><label>Ámbito de acceso<select className="field" name="accessScope" defaultValue="restricted"><option value="restricted">Restringido</option><option value="family">Familia</option><option value="center">Centro</option></select></label></div>
          <label>Actuación relacionada<select className="field" name="activityId" defaultValue={selectedActivity}><option value="">Sin vincular</option>{activities.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>Archivo<input className="field p2-file-input" type="file" name="file" required /></label>
          <p className="p2-helper">El acceso restringido es la opción inicial. La aprobación y la descarga permanecen bloqueadas hasta que el análisis indique «Escaneo limpio».</p>
          <button className="p2-primary" disabled={uploadDocument.isPending} data-testid="button-upload-document"><FilePlus2 size={15} />{uploadDocument.isPending ? "Subiendo y analizando…" : "Subir documento"}</button>
        </form>
      </div>
      <aside className="p2-panel p2-document-detail">
        {currentDocument ? <>
          <SectionTitle overline="Ficha documental" title={currentDocument.title} detail={`${currentDocument.latestFileName} · ${currentDocument.sizeBytes.toLocaleString("es-ES")} bytes`} />
          <div className="p2-scan-banner"><ShieldCheck size={17} /><div><strong>{scanLabel[currentDocument.scanStatus] ?? currentDocument.scanStatus}</strong><p>{currentDocument.scanStatus === "limpio" ? "El control antivirus permite continuar con los permisos API." : "Sin escaneo limpio no se puede aprobar ni descargar el archivo."}</p></div></div>
          <div className="p2-detail-grid"><span>Estado</span><strong>{documentStatus[currentDocument.status] ?? currentDocument.status}</strong><span>Acceso</span><strong>{currentDocument.accessScope === "restricted" ? "Restringido" : currentDocument.accessScope === "family" ? "Familia" : "Centro"}</strong><span>Familia</span><strong>{currentDocument.professionalFamily ?? "No especificada"}</strong><span>Huella SHA-256</span><code>{currentDocument.sha256}</code></div>
          <div className="p2-document-actions">
            {detail.data?.versions.find(item => item.version === downloadVersion)?.scanStatus === "limpio" ? <button className="p2-secondary" onClick={() => void handleDownload()} disabled={download.isFetching} data-testid="button-download-document"><ArrowDownToLine size={15} />{download.isFetching ? "Preparando…" : `Descargar versión ${downloadVersion}`}</button> : <button className="p2-secondary" disabled title="Disponible tras un escaneo limpio"><ArrowDownToLine size={15} />Descarga bloqueada</button>}
            {c2 && <button className="p2-primary" onClick={() => handleApprove(currentDocument)} disabled={approveDocument.isPending || currentDocument.scanStatus !== "limpio" || currentDocument.status === "aprobado"} data-testid="button-approve-document"><Check size={15} />{currentDocument.status === "aprobado" ? "Aprobado" : "Aprobar documento"}</button>}
          </div>
          {detail.isLoading ? <div className="p2-skeleton-row" /> : detail.isError ? <Notice tone="error">No se pudo cargar el historial de versiones. <button onClick={() => void detail.refetch()}>Reintentar</button></Notice> : <div className="p2-versions"><h3>Versiones conservadas</h3>{detail.data?.versions.map(version => <div key={version.version}>
            <button type="button" className={`p2-version-row p2-version-select ${downloadVersion === version.version ? "is-selected" : ""}`} onClick={() => setDownloadVersion(version.version)} disabled={version.scanStatus !== "limpio"} title={version.scanStatus === "limpio" ? "Seleccionar versión" : "No disponible hasta que el escaneo sea limpio"}><span><strong>Versión {version.version}</strong><small>{version.originalName} · {readableDate(version.createdAt)}</small></span><StatusPill tone={version.scanStatus === "limpio" ? "good" : "warn"}>{scanLabel[version.scanStatus] ?? version.scanStatus}</StatusPill></button>
            {version.scanStatus !== "limpio" && (c2 || currentDocument.createdBy === user.id) && <button type="button" className="p2-secondary" disabled={rescanDocument.isPending} onClick={() => handleRescan(currentDocument, version.version)} data-testid={`button-rescan-version-${version.version}`}><RefreshCw size={14} />{rescanDocument.isPending ? "Analizando…" : `Reanalizar versión ${version.version}`}</button>}
          </div>)}</div>}
          <form className="p2-compact-form" onSubmit={submitVersion}><label>Añadir versión<input className="field" type="file" name="versionFile" required /></label><p className="p2-helper">Se conserva el historial; se reutiliza el nombre del archivo actual si no se envía otro.</p><button className="p2-secondary" disabled={addVersion.isPending} data-testid="button-add-version">{addVersion.isPending ? "Subiendo…" : "Añadir versión"}</button></form>
          {currentDocument.accessScope !== "center" && c2 && <form className="p2-compact-form" onSubmit={handleAccess}><h3>Compartir acceso</h3><label>Persona<select className="field" name="userId" required defaultValue=""><option value="" disabled>Seleccionar personal…</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name} · {person.professionalFamily ?? "Sin familia"}</option>)}</select></label><label>Permiso<select className="field" name="granted" defaultValue="true"><option value="true">Conceder acceso</option><option value="false">Revocar acceso</option></select></label><button className="p2-secondary" disabled={setDocumentAccess.isPending} data-testid="button-set-document-access">{setDocumentAccess.isPending ? "Aplicando…" : "Actualizar acceso"}</button></form>}
          <form className="p2-compact-form" onSubmit={handleLink}><h3>Vincular evidencia</h3><label>Actuación<select className="field" name="activityId" required defaultValue=""><option value="" disabled>Seleccionar actuación…</option>{activities.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>Indicador<input className="field" name="indicatorCode" placeholder="Código (opcional)" /></label><label>Nota<input className="field" name="note" maxLength={500} /></label><button className="p2-secondary" disabled={linkEvidence.isPending} data-testid="button-link-evidence"><Link2 size={14} />{linkEvidence.isPending ? "Vinculando…" : "Vincular documento"}</button></form>
        </> : <div className="p2-empty p2-detail-empty"><FileText size={24} /><strong>Selecciona un documento</strong><p>Consulta el estado del control antivirus, sus versiones y las operaciones disponibles.</p></div>}
      </aside>
    </section>}

    {pane === "solicitudes" && <section className="p2-requests-layout">
      <div className="p2-panel p2-main-list"><SectionTitle overline="Recogida de información" title="Solicitudes" detail="Distingue la falta de datos de una actividad que no llegó a realizarse." />
        <div className="p2-list-tools"><label className="p2-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar solicitudes" aria-label="Buscar solicitudes" /></label><button className="p2-icon-button" onClick={() => void requestsQuery.refetch()} disabled={requestsQuery.isFetching} aria-label="Actualizar solicitudes"><RefreshCw size={15} /></button></div>
        {queryLoading ? <div className="p2-skeleton-list">{[1, 2].map(n => <div className="p2-skeleton-row" key={n} />)}</div> : currentError ? <div className="p2-empty"><AlertCircle size={20} /><strong>Error al cargar las solicitudes</strong><p>{errorMessage(queryIssue)}</p><button className="p2-secondary" onClick={retryCurrent}>Reintentar</button></div> : visibleRequests.length ? <div className="p2-request-list">{visibleRequests.map(request => <button className={`p2-request-row ${selectedRequest === request.id ? "is-selected" : ""}`} key={request.id} onClick={() => setSelectedRequest(request.id)} data-testid={`request-${request.id}`}><span className="p2-request-mark"><ClipboardCheck size={16} /></span><span className="p2-row-copy"><strong className="p2-row-title">{request.reason}</strong><span className="p2-row-sub">{request.requestedFields.length} campos · Vence {readableDate(request.dueAt)}</span><span className="p2-row-sub">{request.latestResponseStatus === "sin_informacion" ? "Respuesta: Sin información" : request.latestResponseStatus === "no_realizada" ? "Respuesta: No realizada" : request.latestResponseStatus === "respondida" ? "Respuesta recibida" : "Sin respuesta"}</span></span><StatusPill tone={request.status === "validada" ? "good" : request.status === "solicitada" ? "warn" : "neutral"}>{requestStatus[request.status] ?? request.status}</StatusPill></button>)}</div> : <div className="p2-empty"><ClipboardCheck size={22} /><strong>Sin solicitudes en tu ámbito</strong><p>Las solicitudes asignadas o visibles para C2 aparecerán aquí.</p></div>}
      </div>
      <aside className="p2-panel p2-request-panel">
        {c2 && <form className="p2-form" onSubmit={submitRequest}><div className="p2-form-heading"><div><span className="p2-overline">Coordinación C2</span><h3>Solicitar información</h3></div></div>
          <label>Actuación<select className="field" name="subjectId" required defaultValue=""><option value="" disabled>Selecciona una actuación…</option>{activities.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>Persona destinataria<select className="field" name="recipientUserId" required defaultValue=""><option value="" disabled>Selecciona personal…</option>{staff.map(person => <option key={person.id} value={person.id}>{person.name} · {person.professionalFamily ?? person.role}</option>)}</select></label>
          <label>Datos solicitados <span className="p2-label-hint">Un dato por línea</span><textarea className="field" name="requestedFields" rows={3} required placeholder={"Fecha de realización\nParticipantes"} /></label>
          <label>Motivo<textarea className="field" name="reason" rows={2} required maxLength={1000} /></label>
          <label>Fecha límite<input className="field" name="dueAt" type="date" /></label>
          <button className="p2-primary" disabled={createRequest.isPending} data-testid="button-create-request">{createRequest.isPending ? "Enviando…" : "Enviar solicitud"}</button>
        </form>}
        {currentRequest ? <div className="p2-response-box"><div className="p2-form-heading"><div><span className="p2-overline">Detalle de solicitud</span><h3>Respuesta y validación</h3></div></div>
          <p className="p2-request-reason">{currentRequest.reason}</p><ul className="p2-fields-list">{currentRequest.requestedFields.map(field => <li key={field}>{field}</li>)}</ul>
          {currentRequest.latestResponseStatus && <div className="p2-response-status"><strong>Estado declarado:</strong> {currentRequest.latestResponseStatus === "sin_informacion" ? "Sin información" : currentRequest.latestResponseStatus === "no_realizada" ? "No realizada" : "Respondida"}{currentRequest.latestComment && <p>{currentRequest.latestComment}</p>}</div>}
          {(currentRequest.recipientUserId === user.id || user.role === UserRole.admin_tecnico) && currentRequest.status === "solicitada" && <form className="p2-compact-form" onSubmit={submitResponse}>
            {currentRequest.recipientUserId !== user.id && <Notice>Intervención de administración técnica: la respuesta quedará registrada con tu identidad, no con la de la persona destinataria.</Notice>}
            <label>Estado de la respuesta<select className="field" name="responseStatus" defaultValue="respondida"><option value="respondida">Información respondida</option><option value="sin_informacion">Sin información</option><option value="no_realizada">No realizada</option></select></label>{currentRequest.requestedFields.map((field, index) => <label key={field}>{field}<textarea className="field" name={`answer-${index}`} rows={2} /></label>)}<label>Comentario<input className="field" name="comment" maxLength={1000} /></label><button className="p2-primary" disabled={respondRequest.isPending} data-testid="button-respond-request">{respondRequest.isPending ? "Guardando…" : "Enviar respuesta"}</button>
          </form>}
          {c2 && currentRequest.status === "respondida" && <button className="p2-primary p2-validate-response" onClick={() => handleValidateResponse(currentRequest)} disabled={validateResponse.isPending} data-testid="button-validate-response">{validateResponse.isPending ? "Validando…" : "Validar respuesta"}</button>}
        </div> : !c2 && <div className="p2-empty p2-detail-empty"><ClipboardCheck size={22} /><strong>Selecciona una solicitud</strong><p>Los datos solicitados y el formulario de respuesta aparecerán aquí.</p></div>}
      </aside>
    </section>}

    {pane === "indicadores" && <section className="p2-indicators-layout">
      {!c2 ? <div className="p2-panel p-5"><Notice>La consulta y el registro de observaciones de indicadores están reservados a Coordinación C2.</Notice></div> : <>
        <div className="p2-panel p2-main-list"><SectionTitle overline="Lectura del PIC" title="Indicadores vigentes" detail="Consulta valores y registra observaciones con sus evidencias aprobadas." />
          <div className="p2-indicator-caveat"><AlertCircle size={17} /><p><strong>Conteo operativo, no cálculo normativo definitivo.</strong> Las cifras derivadas cuentan actuaciones vinculadas con evidencia aprobada. El método oficial del catálogo está pendiente de validación C2.</p></div>
          {queryLoading ? <div className="p2-skeleton-list">{[1, 2, 3].map(n => <div className="p2-skeleton-row" key={n} />)}</div> : currentError ? <div className="p2-empty"><strong>No se han podido cargar los indicadores</strong><p>{errorMessage(queryIssue)}</p><button className="p2-secondary" onClick={retryCurrent}>Reintentar</button></div> : visibleIndicators.length ? <div className="p2-indicator-list">{visibleIndicators.map(indicator => <button key={indicator.code} className={`p2-indicator-row ${selectedIndicator === indicator.code ? "is-selected" : ""}`} onClick={() => setSelectedIndicator(indicator.code)} data-testid={`indicator-${indicator.code}`}><span className="p2-indicator-code">{indicator.code}</span><span className="p2-row-copy"><strong className="p2-row-title">{indicator.description}</strong><span className="p2-row-sub">Acción {indicator.actionCode} · {indicator.type}</span><span className="p2-row-sub">Conteo operativo: {indicator.activityCount} actuaciones vinculadas con evidencia aprobada · {indicator.evidenceCount} documentos</span></span><span className="p2-indicator-value">{indicator.currentValue === null ? "Sin información" : typeof indicator.currentValue === "boolean" ? indicator.currentValue ? "Sí" : "No" : `${indicator.currentValue}${indicator.type === "porcentaje" ? "%" : ""}`}</span></button>)}</div> : <div className="p2-empty"><ActivityIcon size={22} /><strong>No hay indicadores vigentes</strong><p>Los indicadores seleccionados en el PIC aparecerán aquí cuando estén disponibles.</p></div>}
        </div>
        <aside className="p2-panel p2-observation-panel">{currentIndicator ? <>
          <SectionTitle overline={`Observación · ${currentIndicator.code}`} title="Registrar seguimiento" detail={currentIndicator.description} />
          <div className="p2-method-note"><strong>Nota de método del catálogo</strong><p>{currentIndicator.methodNote}</p></div>
          <div className="p2-indicator-facts"><span>Objetivo</span><strong>{currentIndicator.target === null ? "Sin información" : String(currentIndicator.target)}</strong><span>Riesgo</span><strong>{currentIndicator.risk === null ? "Sin información" : String(currentIndicator.risk)}</strong><span>Conteo operativo</span><strong>{currentIndicator.activityCount} actuaciones con evidencia aprobada</strong></div>
          <form className="p2-form p2-compact-form" onSubmit={submitObservation}>
            <label>Periodo<input className="field" name="period" required maxLength={40} placeholder="Ej.: 2026-2027 / trimestre 1" /></label>
            {currentIndicator.type === "booleano" ? <label>Valor<select className="field" name="value" defaultValue="true"><option value="true">Sí</option><option value="false">No</option></select></label> : currentIndicator.type === "porcentaje" ? <div className="p2-form-grid"><label>Numerador<input className="field" name="numerator" type="number" min="0" required /></label><label>Denominador<input className="field" name="denominator" type="number" min="1" required /></label></div> : <label>Valor numérico<input className="field" name="value" type="number" required /></label>}
            <fieldset className="p2-evidence-picker"><legend>Evidencias aprobadas</legend>{documents.filter(doc => doc.status === "aprobado" && doc.scanStatus === "limpio").length ? documents.filter(doc => doc.status === "aprobado" && doc.scanStatus === "limpio").map(doc => <label key={doc.id}><input type="checkbox" name="evidenceIds" value={doc.id} />{doc.title}<small>v{doc.currentVersion}</small></label>) : <p>No hay documentos con aprobación y escaneo limpio disponibles.</p>}</fieldset>
            {(currentIndicator.type === "booleano" || currentIndicator.type === "porcentaje") && documents.every(doc => doc.status !== "aprobado" || doc.scanStatus !== "limpio") && <Notice tone="info">Para indicadores booleanos y porcentajes, registra primero evidencia aprobada y limpia.</Notice>}
            <button className="p2-primary" disabled={createObservation.isPending || ((currentIndicator.type === "booleano" || currentIndicator.type === "porcentaje") && documents.every(doc => doc.status !== "aprobado" || doc.scanStatus !== "limpio"))} data-testid="button-create-observation">{createObservation.isPending ? "Registrando…" : "Registrar observación"}</button>
          </form>
          {currentIndicator.latestObservation && <div className="p2-last-observation"><span className="p2-overline">Última observación · {currentIndicator.latestObservation.period}</span><strong>{typeof currentIndicator.latestObservation.value === "boolean" ? currentIndicator.latestObservation.value ? "Sí" : "No" : currentIndicator.latestObservation.value}</strong><small>Revisión {currentIndicator.latestObservation.revision} · {currentIndicator.latestObservation.sourceActivityCount} actuaciones vinculadas con evidencia aprobada</small></div>}
        </> : <div className="p2-empty p2-detail-empty"><ActivityIcon size={23} /><strong>Selecciona un indicador</strong><p>Se mostrará el método disponible y el formulario de observación.</p></div>}</aside>
      </>}
    </section>}
  </div>;
}
