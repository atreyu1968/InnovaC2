import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileCheck2,
  FileText,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  UserRole,
  getExportPicDocxQueryKey,
  getExportPicLaycosQueryKey,
  getExportPicPdfQueryKey,
  getGetPicSnapshotQueryKey,
  getGetPicSubmissionEvidenceQueryKey,
  getGetCurrentPicPlanQueryKey,
  getGetCurrentCatalogQueryKey,
  getListPicSnapshotsQueryKey,
  getGetPicSubmissionQueryKey,
  getValidatePicPlanQueryKey,
  useCreateCurrentPicPlan,
  useCreatePicSnapshot,
  useExportPicDocx,
  useExportPicLaycos,
  useExportPicPdf,
  useGetCurrentCatalog,
  useGetCurrentPicPlan,
  useGetPicSnapshot,
  useGetPicSubmission,
  useGetPicSubmissionEvidence,
  useListPicSnapshots,
  useRecordPicSubmission,
  useSavePicPlan,
  useValidatePicPlan,
} from "@workspace/api-client-react";
import type {
  PicActionSelection,
  PicCatalog,
  PicCiclopeMember,
  PicCustomAction,
  PicDafoCategory,
  PicDafoEntry,
  PicIndicatorTarget,
  PicOdsLink,
  PicPlan,
  PicPlanContent,
  PicProjectInput,
  User,
} from "@workspace/api-client-react";

const QUADRANTS = [
  ["debilidades", "Debilidades"],
  ["fortalezas", "Fortalezas"],
  ["amenazas", "Amenazas"],
  ["oportunidades", "Oportunidades"],
] as const;
type Quadrant = (typeof QUADRANTS)[number][0];

const ONLINE_CHANNELS = [
  "Web del centro",
  "Redes sociales",
  "Aula virtual",
  "Boletín interno",
  "Otros",
];
const OFFLINE_CHANNELS = [
  "Tablón",
  "Claustro y departamentos",
  "Prensa local",
  "Jornadas y ferias",
  "Otros",
];
const PROJECT_PROMOTERS: PicProjectInput["promoter"][] = [
  "Erasmus+",
  "Ministerio",
  "CaixaBank Dualiza",
  "DGFPERE-Canarias",
  "Propio del centro",
  "Otro",
];

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operación.";
}

function isoToday() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function base64FromBytes(bytes: Uint8Array) {
  let binary = "";
  const step = 0x8000;
  for (let start = 0; start < bytes.length; start += step) {
    binary += String.fromCharCode(...bytes.subarray(start, start + step));
  }
  return btoa(binary);
}

function downloadBase64(filename: string, mimeType: string, value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function emptyProject(): PicProjectInput {
  return {
    promoter: "Propio del centro",
    name: "",
    centerCoordinates: false,
    coordinatingFamily: "",
    coordinatorName: "",
    coordinatorEmail: "",
    includedInPic: false,
  };
}

function unitForIndicator(type: string) {
  if (type === "booleano") return "Sí/No";
  if (type === "porcentaje") return "%";
  if (type === "escala_1_5") return "escala 1-5";
  if (type === "numero") return "número";
  return "";
}

function numericFieldValue(value: number | boolean | null): string | number {
  return typeof value === "number" ? value : "";
}

function SectionHeading({
  number,
  title,
  help,
}: {
  number: number;
  title: string;
  help?: string;
}) {
  return (
    <div className="mb-5 border-b border-[#eee9df] pb-4">
      <p className="eyebrow">Apartado {number} · PIC 2026–2027</p>
      <h2 className="mt-1 font-[var(--app-font-serif)] text-xl font-bold text-[#26363c]">
        {title}
      </h2>
      {help && <p className="mt-2 max-w-4xl text-xs leading-relaxed text-[#69766f]">{help}</p>}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs font-semibold text-[#43534d]">
      {label}
      <input
        className="field mt-1.5 text-sm font-normal"
        type={type}
        value={value}
        placeholder={placeholder}
        min={type === "number" ? 0 : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-semibold text-[#43534d]">
      {label}
      <select className="field mt-1.5 text-sm font-normal" value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        <option value="">Selecciona…</option>
        {values.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  );
}

function CheckList({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold text-[#43534d]">{label}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option} className="flex items-start gap-2 rounded-md border border-[#eee9df] bg-white px-3 py-2.5 text-xs text-[#4b5a54]">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#347b69]"
              checked={value.includes(option)}
              onChange={(event) => onChange(
                event.currentTarget.checked
                  ? [...value, option]
                  : value.filter((item) => item !== option),
              )}
            />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PicPlanPage({ user }: { user: User }) {
  const client = useQueryClient();
  const current = useGetCurrentPicPlan({
    query: {
      queryKey: getGetCurrentPicPlanQueryKey(),
      retry: false,
      refetchOnMount: "always",
    },
  });
  const catalogQuery = useGetCurrentCatalog({
    query: {
      queryKey: getGetCurrentCatalogQueryKey(),
      refetchOnMount: "always",
    },
  });
  const createPlan = useCreateCurrentPicPlan();
  const savePlan = useSavePicPlan();
  const [content, setContent] = useState<PicPlanContent | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [validationVisible, setValidationVisible] = useState(false);
  const [validatedRevision, setValidatedRevision] = useState<number | null>(null);
  const [snapshotReason, setSnapshotReason] = useState("Cierre interno del PIC");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [submissionDate, setSubmissionDate] = useState(isoToday());
  const [externalIdentifier, setExternalIdentifier] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [submissionMessage, setSubmissionMessage] = useState("");
  const [laycosOpen, setLaycosOpen] = useState(false);

  const plan = current.data as PicPlan | undefined;
  const catalog = catalogQuery.data as PicCatalog | undefined;
  const planId = plan?.id ?? "";
  const dirty = useMemo(
    () => Boolean(plan && content && JSON.stringify(content) !== JSON.stringify(plan.content)),
    [content, plan],
  );
  const validation = useValidatePicPlan(planId || "not-created", {
    query: { queryKey: getValidatePicPlanQueryKey(planId || "not-created"), enabled: false, retry: false },
  });
  const snapshots = useListPicSnapshots(planId || "not-created", {
    query: { queryKey: getListPicSnapshotsQueryKey(planId || "not-created"), enabled: Boolean(planId), refetchOnMount: "always" },
  });
  const snapshotDetail = useGetPicSnapshot(planId || "not-created", selectedSnapshotId || "not-selected", {
    query: { queryKey: getGetPicSnapshotQueryKey(planId || "not-created", selectedSnapshotId || "not-selected"), enabled: Boolean(planId && selectedSnapshotId), retry: false },
  });
  const submission = useGetPicSubmission(planId || "not-created", {
    query: { queryKey: getGetPicSubmissionQueryKey(planId || "not-created"), enabled: Boolean(planId), retry: false, refetchOnMount: "always" },
  });
  const submissionEvidence = useGetPicSubmissionEvidence(
    planId || "not-created",
    submission.data?.id ?? "not-submitted",
    { query: { queryKey: getGetPicSubmissionEvidenceQueryKey(planId || "not-created", submission.data?.id ?? "not-submitted"), enabled: false, retry: false } },
  );
  const laycosExport = useExportPicLaycos(planId || "not-created", {
    query: { queryKey: getExportPicLaycosQueryKey(planId || "not-created"), enabled: false, retry: false },
  });
  const docxExport = useExportPicDocx(planId || "not-created", {
    query: { queryKey: getExportPicDocxQueryKey(planId || "not-created"), enabled: false, retry: false },
  });
  const pdfExport = useExportPicPdf(planId || "not-created", {
    query: { queryKey: getExportPicPdfQueryKey(planId || "not-created"), enabled: false, retry: false },
  });
  const createSnapshot = useCreatePicSnapshot();
  const recordSubmission = useRecordPicSubmission();

  useEffect(() => {
    if (plan) setContent(plan.content);
  }, [plan?.id, plan?.revision]);

  const patch = (updater: (current: PicPlanContent) => PicPlanContent) => {
    setContent((previous) => previous ? updater(previous) : previous);
    setSaveMessage("");
    setSaveError("");
    setValidationVisible(false);
    setValidatedRevision(null);
  };

  const createDraft = () => {
    setSaveError("");
    createPlan.mutate(undefined, {
      onSuccess: async (created) => {
        client.setQueryData(getGetCurrentPicPlanQueryKey(), created);
        setContent(created.content);
        await catalogQuery.refetch();
      },
      onError: (error) => setSaveError(errorText(error)),
    });
  };

  const save = () => {
    if (!plan || !content) return;
    setSaveError("");
    setSaveMessage("");
    savePlan.mutate(
      { planId: plan.id, data: { expectedRevision: plan.revision, content } },
      {
        onSuccess: async (saved) => {
          client.setQueryData(getGetCurrentPicPlanQueryKey(), saved);
          setContent(saved.content);
          setSaveMessage(`Borrador guardado · revisión ${saved.revision}.`);
          setValidationVisible(false);
          setValidatedRevision(null);
          await client.invalidateQueries({ queryKey: getListPicSnapshotsQueryKey(saved.id) });
          await client.invalidateQueries({ queryKey: getValidatePicPlanQueryKey(saved.id) });
        },
        onError: (error) => setSaveError(errorText(error)),
      },
    );
  };

  const runValidation = async () => {
    if (!plan || dirty) return;
    setValidationVisible(true);
    const result = await validation.refetch();
    setValidatedRevision(result.data ? plan.revision : null);
  };

  const makeSnapshot = () => {
    if (!plan || dirty || validatedRevision !== plan.revision || !validation.data?.valid) return;
    createSnapshot.mutate(
      { planId: plan.id, data: { reason: snapshotReason } },
      {
        onSuccess: async (result) => {
          setSelectedSnapshotId(result.snapshotId);
          setSaveMessage(`Versión inmutable ${result.version} creada.`);
          await Promise.all([
            client.invalidateQueries({ queryKey: getListPicSnapshotsQueryKey(plan.id) }),
            current.refetch(),
          ]);
        },
        onError: (error) => setSaveError(errorText(error)),
      },
    );
  };

  const submitToLaycos = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!plan || !evidenceFile) return;
    const selectedSnapshot =
      snapshots.data?.find((item) => item.id === selectedSnapshotId) ??
      snapshots.data?.[0];
    if (!selectedSnapshot) {
      setSaveError("Crea primero una versión inmutable y validada del PIC.");
      return;
    }
    if (evidenceFile.size > 1024 * 1024) {
      setSaveError("El justificante debe ocupar 1 MiB como máximo.");
      return;
    }
    const encoded = base64FromBytes(new Uint8Array(await evidenceFile.arrayBuffer()));
    recordSubmission.mutate(
      {
        planId: plan.id,
        data: {
          snapshotId: selectedSnapshot.id,
          submissionDate,
          externalIdentifier: externalIdentifier.trim() || null,
          evidenceFileName: evidenceFile.name,
          evidenceMimeType: evidenceFile.type as "application/pdf" | "image/png" | "image/jpeg",
          evidenceFileBase64: encoded,
        },
      },
      {
        onSuccess: async (result) => {
          setSubmissionMessage(`Presentación manual registrada · ${result.submissionDate} · justificante ${result.evidenceSha256.slice(0, 12)}…`);
          setEvidenceFile(null);
          await Promise.all([submission.refetch(), current.refetch()]);
        },
        onError: (error) => setSaveError(errorText(error)),
      },
    );
  };

  const toggleAction = (objectiveCode: string, actionCode: string, checked: boolean) => {
    if (!catalog) return;
    const action = catalog.objetivos
      .find((objective) => objective.codigo === objectiveCode)
      ?.acciones.find((item) => item.codigo === actionCode);
    if (!action) return;
    patch((currentContent) => {
      const selected = currentContent.selectedActions.filter(
        (item) => item.actionCode !== actionCode,
      );
      if (checked) {
        const initial: PicActionSelection = {
          objectiveCode,
          actionCode,
          indicators: action.indicadores.map((indicator) => ({
            indicatorId: indicator.id,
            actionCode,
            unit: unitForIndicator(indicator.tipo),
            targetValue: null,
            riskValue: null,
          })),
        };
        selected.push(initial);
      }
      return { ...currentContent, selectedActions: selected };
    });
  };

  const changeIndicator = (
    actionCode: string,
    indicatorId: string,
    key: "unit" | "targetValue" | "riskValue",
    value: string | number | boolean | null,
  ) => {
    patch((currentContent) => ({
      ...currentContent,
      selectedActions: currentContent.selectedActions.map((selection) =>
        selection.actionCode !== actionCode
          ? selection
          : {
              ...selection,
              indicators: selection.indicators.map((indicator) =>
                indicator.indicatorId !== indicatorId
                  ? indicator
                  : { ...indicator, [key]: value },
              ),
            },
      ),
    }));
  };

  if (user.role !== UserRole.c2_innovacion) {
    return (
      <section className="panel p-6">
        <div className="flex gap-3"><ShieldAlert className="text-amber-700" /><div><h2 className="font-bold">Acceso restringido</h2><p className="mt-1 text-sm text-[#68746e]">La edición del PIC está reservada a la Coordinación C2.</p></div></div>
      </section>
    );
  }

  if (current.isLoading || catalogQuery.isLoading) {
    return <div className="panel p-8 text-sm text-[#68746e]">Cargando el plan y el catálogo oficial…</div>;
  }
  if (!catalog) {
    return <section className="panel p-6"><h2 className="font-bold">No se pudo cargar el catálogo oficial</h2><p className="mt-2 text-sm text-[#68746e]">{errorText(catalogQuery.error)}</p></section>;
  }
  if (!plan) {
    return (
      <section className="fade-up max-w-3xl">
        <div className="panel p-6 md:p-8">
          <p className="eyebrow">Plan de Innovación del Centro · {catalog.version}</p>
          <h2 className="mt-2 font-[var(--app-font-serif)] text-2xl font-bold">Crear el borrador PIC</h2>
          <p className="mt-3 text-sm leading-relaxed text-[#68746e]">Se creará un borrador para el centro y curso activos. No se inventan datos institucionales ni se envía nada a Laycos.</p>
          {current.error && <p className="mt-4 rounded-md bg-amber-50 p-3 text-xs text-amber-900">{errorText(current.error)}</p>}
          {saveError && <p className="mt-4 rounded-md bg-red-50 p-3 text-xs text-red-800">{saveError}</p>}
          <button className="primary-action mt-5" onClick={createDraft} disabled={createPlan.isPending} data-testid="button-create-pic-plan">
            {createPlan.isPending ? "Creando…" : "Crear borrador"}
          </button>
        </div>
      </section>
    );
  }
  if (!content) return <div className="panel p-8 text-sm text-[#68746e]">Preparando el formulario…</div>;

  const familyOptions = catalog.familias_profesionales;
  const setCoordinator = (key: keyof PicPlanContent["coordinator"], value: string) =>
    patch((valueNow) => ({ ...valueNow, coordinator: { ...valueNow.coordinator, [key]: value } }));
  const setCenter = (key: "professionalFamily" | "groupCount" | "levels", value: string | number | string[]) =>
    patch((valueNow) => ({ ...valueNow, center: { ...valueNow.center, [key]: value } }));
  const classPanel = "panel scroll-mt-24 p-5 md:p-7";

  return (
    <div className="fade-up space-y-5">
      <section className="panel flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div>
          <p className="eyebrow">PIC · curso {plan.schoolYear} · revisión {plan.revision}</p>
          <h2 className="mt-1 font-[var(--app-font-serif)] text-xl font-bold text-[#25363b]">{plan.centerName}</h2>
          <p className="mt-1 text-xs text-[#6e7974]">Catálogo {plan.catalogVersion} · Estado: {plan.status === "submitted" ? "presentado manualmente" : plan.status === "internally_complete" ? "versión interna cerrada" : "borrador"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="secondary-action" onClick={() => current.refetch()} aria-label="Recargar PIC"><RefreshCw size={15} /> Recargar</button>
          <button className="primary-action inline-flex items-center gap-2" onClick={save} disabled={!dirty || savePlan.isPending} data-testid="button-save-pic">
            <Save size={15} /> {savePlan.isPending ? "Guardando…" : dirty ? "Guardar cambios" : "Guardado"}
          </button>
        </div>
      </section>

      {plan.catalogVersion !== catalog.version && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
          Este borrador conserva el catálogo {plan.catalogVersion}. Hay una versión vigente {catalog.version}; revisa las diferencias antes de trasladar el plan. No se cambia automáticamente una versión histórica.
        </div>
      )}
      {saveError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{saveError}</div>}
      {saveMessage && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">{saveMessage}</div>}
      {dirty && <p className="text-xs font-semibold text-amber-800">Hay cambios sin guardar. Guarda antes de validar, crear snapshots o exportar.</p>}

      <div className="grid gap-5 xl:grid-cols-[210px_minmax(0,1fr)]">
        <nav className="panel h-fit p-3 xl:sticky xl:top-[84px]" aria-label="Apartados del PIC">
          <p className="eyebrow px-2 pb-2">Apartados 1–10</p>
          <div className="grid grid-cols-2 gap-1 xl:grid-cols-1">
            {[
              "Coordinación", "Centro", "DAFO", "Proyectos", "ATECA",
              "Objetivos y acciones", "ODS", "CICLOPE", "Calendario", "Difusión",
            ].map((label, index) => (
              <a key={label} className="rounded-md px-2.5 py-2 text-[11px] font-semibold text-[#52615a] hover:bg-[#eef3ed] hover:text-[#347b69]" href={`#pic-section-${index + 1}`}>
                <span className="mr-2 font-mono text-[#347b69]">{index + 1}.</span>{label}
              </a>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-5">
          <section id="pic-section-1" className={classPanel}>
            <SectionHeading number={1} title="Datos de la persona coordinadora" />
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField label="Perfil de coordinación" value={content.coordinator.profile} values={["C2", "C1"]} onChange={(value) => setCoordinator("profile", value)} />
              <SelectField label="Familia profesional" value={content.coordinator.professionalFamily} values={familyOptions} onChange={(value) => setCoordinator("professionalFamily", value)} />
              <TextField label="Nombre" value={content.coordinator.firstName} onChange={(value) => setCoordinator("firstName", value)} />
              <TextField label="Apellidos" value={content.coordinator.lastName} onChange={(value) => setCoordinator("lastName", value)} />
              <TextField label="Correo electrónico corporativo" value={content.coordinator.corporateEmail} onChange={(value) => setCoordinator("corporateEmail", value)} type="email" />
              <TextField label="Teléfono de contacto" value={content.coordinator.phone} onChange={(value) => setCoordinator("phone", value)} />
            </div>
          </section>

          <section id="pic-section-2" className={classPanel}>
            <SectionHeading number={2} title="Datos del centro" help="El nombre del centro y el curso activo proceden de la configuración institucional y no se duplican en este formulario." />
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField label="Familia profesional de coordinación" value={content.center.professionalFamily} values={familyOptions} onChange={(value) => setCenter("professionalFamily", value)} />
              <TextField label="N.º de grupos de enseñanzas profesionales" type="number" value={content.center.groupCount} onChange={(value) => setCenter("groupCount", value === "" ? 0 : Number(value))} />
            </div>
            <div className="mt-5"><CheckList label="Niveles impartidos" options={["FP Básica", "Grado Medio", "Grado Superior", "Cursos de especialización", "Ofertas parciales (Grados A, B, C, D)"]} value={content.center.levels} onChange={(value) => setCenter("levels", value)} /></div>
          </section>

          <section id="pic-section-3" className={classPanel}>
            <SectionHeading number={3} title="Diagnóstico DAFO" help="Selecciona entre 1 y 3 situaciones oficiales por cuadrante. Las líneas de acción del apartado 6 deben responder a este diagnóstico." />
            <div className="space-y-5">
              {QUADRANTS.map(([quadrant, label]) => {
                const rows = content.dafo.filter((entry) => entry.quadrant === quadrant);
                const categories = (catalog.dafo_categorias[quadrant] ?? []) as PicDafoCategory[];
                return (
                  <fieldset key={quadrant} className="rounded-lg border border-[#e9e4d9] p-4">
                    <legend className="px-2 text-sm font-bold capitalize text-[#35464b]">{label} · {rows.length}/3</legend>
                    <div className="space-y-3">
                      {rows.map((entry, index) => {
                        const category = categories.find((item) => item.categoria === entry.category);
                        const options = category?.opciones ?? [];
                        const isOther = entry.situation.toLocaleLowerCase("es").startsWith("otra situación");
                        const update = (changes: Partial<PicDafoEntry>) =>
                          patch((value) => {
                            let position = -1;
                            const next = value.dafo.map((item) => {
                              if (item.quadrant !== quadrant) return item;
                              position += 1;
                              return position === index ? { ...item, ...changes } : item;
                            });
                            return { ...value, dafo: next };
                          });
                        return (
                          <div key={`${quadrant}-${index}`} className="grid gap-3 rounded-md bg-[#faf9f5] p-3 md:grid-cols-[1fr_1.4fr_auto]">
                            <SelectField label="Categoría" value={entry.category} values={categories.map((item) => item.categoria)} onChange={(value) => {
                              const nextCategory = categories.find((item) => item.categoria === value);
                              update({ category: value, situation: nextCategory?.opciones[0] ?? "", customDetail: "" });
                            }} />
                            <div>
                              <SelectField label="Situación detectada" value={entry.situation} values={options} onChange={(value) => update({ situation: value, customDetail: "" })} />
                              {isOther && <TextField label="Especifica la situación" value={entry.customDetail ?? ""} onChange={(value) => update({ customDetail: value })} />}
                            </div>
                            <button type="button" className="secondary-action self-end !px-3" onClick={() => patch((value) => ({ ...value, dafo: value.dafo.filter((item, itemIndex) => !(item.quadrant === quadrant && itemIndex === value.dafo.findIndex((candidate) => candidate === entry))) }))} aria-label={`Eliminar situación ${index + 1} de ${label}`}><Trash2 size={15} /></button>
                          </div>
                        );
                      })}
                    </div>
                    {rows.length < 3 && (
                      <button type="button" className="secondary-action mt-3" onClick={() => {
                        const firstCategory = categories[0];
                        if (!firstCategory) return;
                        const newEntry: PicDafoEntry = {
                          quadrant: quadrant as Quadrant,
                          category: firstCategory.categoria,
                          situation: firstCategory.opciones[0] ?? "",
                        };
                        patch((value) => ({ ...value, dafo: [...value.dafo, newEntry] }));
                      }}><Plus size={14} /> Añadir situación</button>
                    )}
                  </fieldset>
                );
              })}
            </div>
          </section>

          <section id="pic-section-4" className={classPanel}>
            <SectionHeading number={4} title="Proyectos de innovación" help="El inventario interno no tiene límite. Marca explícitamente hasta seis proyectos para incorporarlos a este formulario PIC." />
            <SelectField label="¿Se desarrolla algún proyecto de innovación en el centro durante 2026–2027?" value={content.projectsInCenter ? "Sí" : "No"} values={["Sí", "No"]} onChange={(answer) => patch((value) => ({ ...value, projectsInCenter: answer === "Sí", projects: answer === "No" ? value.projects.map((project) => ({ ...project, includedInPic: false })) : value.projects }))} />
            {content.projectsInCenter && <>
            <div className="mt-4 space-y-4">
              {content.projects.map((project, index) => (
                <article key={index} className="rounded-lg border border-[#e9e4d9] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-[#394a4d]">Proyecto del inventario · {index + 1}</h3>
                    <label className="flex items-center gap-2 text-xs font-semibold text-[#4b5c53]"><input type="checkbox" className="accent-[#347b69]" checked={project.includedInPic} onChange={(event) => patch((value) => ({ ...value, projects: value.projects.map((item, itemIndex) => itemIndex === index ? { ...item, includedInPic: event.currentTarget.checked } : item) }))} />Incluir en el PIC</label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <SelectField label="Convocatoria o promotor" value={project.promoter} values={PROJECT_PROMOTERS} onChange={(promoter) => patch((value) => ({ ...value, projects: value.projects.map((item, itemIndex) => itemIndex === index ? { ...item, promoter: promoter as PicProjectInput["promoter"] } : item) }))} />
                    <TextField label="Nombre del proyecto" value={project.name} onChange={(name) => patch((value) => ({ ...value, projects: value.projects.map((item, itemIndex) => itemIndex === index ? { ...item, name } : item) }))} />
                    <SelectField label="Familia profesional que coordina" value={project.coordinatingFamily} values={familyOptions} onChange={(coordinatingFamily) => patch((value) => ({ ...value, projects: value.projects.map((item, itemIndex) => itemIndex === index ? { ...item, coordinatingFamily } : item) }))} />
                    <TextField label="Nombre y apellidos de coordinación" value={project.coordinatorName} onChange={(coordinatorName) => patch((value) => ({ ...value, projects: value.projects.map((item, itemIndex) => itemIndex === index ? { ...item, coordinatorName } : item) }))} />
                    <TextField label="Correo corporativo de coordinación" type="email" value={project.coordinatorEmail} onChange={(coordinatorEmail) => patch((value) => ({ ...value, projects: value.projects.map((item, itemIndex) => itemIndex === index ? { ...item, coordinatorEmail } : item) }))} />
                    <label className="flex items-center gap-2 self-end rounded-md border border-[#eee9df] px-3 py-3 text-xs font-semibold text-[#43534d]"><input type="checkbox" className="accent-[#347b69]" checked={project.centerCoordinates} onChange={(event) => patch((value) => ({ ...value, projects: value.projects.map((item, itemIndex) => itemIndex === index ? { ...item, centerCoordinates: event.currentTarget.checked } : item) }))} />El centro coordina el proyecto</label>
                  </div>
                  <button className="secondary-action mt-3" type="button" onClick={() => patch((value) => ({ ...value, projects: value.projects.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={14} /> Eliminar del inventario</button>
                </article>
              ))}
            </div>
            <button className="secondary-action mt-4" type="button" onClick={() => patch((value) => ({ ...value, projects: [...value.projects, emptyProject()] }))}><Plus size={14} /> Añadir proyecto al inventario</button>
            <p className="mt-2 text-[11px] text-[#78827c]">{content.projects.filter((project) => project.includedInPic).length}/6 seleccionados para el PIC · {content.projects.length} en el inventario interno</p>
            </>}
          </section>

          <section id="pic-section-5" className={classPanel}>
            <SectionHeading number={5} title="Aula de Tecnología Aplicada (ATECA)" />
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField label="¿Dispone el centro de ATECA o está en implantación?" value={content.ateca.available ? "Sí" : "No"} values={["Sí", "No"]} onChange={(value) => patch((currentContent) => ({ ...currentContent, ateca: { ...currentContent.ateca, available: value === "Sí" } }))} />
              {!content.ateca.available && <TextField label="Aula ATECA de referencia prevista" value={content.ateca.referenceCenter} onChange={(referenceCenter) => patch((value) => ({ ...value, ateca: { ...value.ateca, referenceCenter } }))} />}
            </div>
          </section>

          <section id="pic-section-6" className={classPanel}>
            <SectionHeading number={6} title="Objetivos, acciones e indicadores" help="Selecciona al menos una acción por objetivo. Las acciones 1.1 y 1.2 son obligatorias. Solo se editan meta y riesgo; el valor «logrado» queda reservado al seguimiento." />
            <div className="space-y-3">
              {catalog.objetivos.map((objective) => (
                <details key={objective.codigo} className="rounded-lg border border-[#e9e4d9] bg-[#fffefa]" open={objective.codigo === "1"}>
                  <summary className="cursor-pointer list-none p-4">
                    <span className="font-mono text-xs font-bold text-[#347b69]">Objetivo {objective.codigo}</span>
                    <span className="ml-2 text-sm font-bold text-[#35464b]">{objective.titulo}</span>
                    <span className="ml-2 text-[10px] text-[#78827c]">· {content.selectedActions.filter((item) => item.objectiveCode === objective.codigo).length} acciones seleccionadas</span>
                  </summary>
                  <div className="space-y-3 border-t border-[#eee9df] bg-[#faf9f5] p-3 md:p-4">
                    {objective.acciones.map((action) => {
                      const selected = content.selectedActions.find((item) => item.actionCode === action.codigo);
                      return (
                        <article key={action.codigo} className="rounded-md border border-[#e8e3d9] bg-white p-3">
                          <label className="flex items-start gap-2.5 text-xs">
                            <input type="checkbox" className="mt-0.5 accent-[#347b69]" checked={Boolean(selected)} onChange={(event) => toggleAction(objective.codigo, action.codigo, event.currentTarget.checked)} />
                            <span className="flex-1 leading-relaxed"><span className="mr-2 font-mono font-bold text-[#347b69]">{action.codigo}</span><span className="font-semibold text-[#39494d]">{action.titulo}</span>{action.obligatoria && <span className="ml-2 rounded bg-amber-50 px-1.5 py-1 text-[9px] font-bold uppercase text-amber-800">Obligatoria</span>}</span>
                          </label>
                          {selected && action.indicadores.length > 0 && (
                            <div className="mt-3 space-y-3 border-t border-[#eee9df] pt-3">
                              {action.indicadores.map((indicator) => {
                                const target = selected.indicators.find((item) => item.indicatorId === indicator.id);
                                if (!target) return null;
                                const boolean = indicator.tipo === "booleano";
                                return (
                                  <div key={indicator.id} className="grid gap-3 rounded-md bg-[#faf9f5] p-3 md:grid-cols-[1fr_120px_1fr_1fr]">
                                    <div><p className="font-mono text-[10px] font-bold text-[#347b69]">{indicator.id}</p><p className="mt-1 text-xs leading-relaxed text-[#45554f]">{indicator.descripcion}</p>{indicator.minimo_normativo !== null && <p className="mt-1 text-[10px] text-[#84653e]">Mínimo normativo: {indicator.minimo_normativo}</p>}</div>
                                    <TextField label="Unidad" value={target.unit} onChange={(unit) => changeIndicator(action.codigo, indicator.id, "unit", unit)} />
                                    {boolean ? (
                                      <>
                                        <SelectField label="Meta" value={target.targetValue === null ? "" : target.targetValue ? "Sí" : "No"} values={["Sí", "No"]} onChange={(value) => changeIndicator(action.codigo, indicator.id, "targetValue", value === "Sí")} />
                                        <SelectField label="Riesgo" value={target.riskValue === null ? "" : target.riskValue ? "Sí" : "No"} values={["Sí", "No"]} onChange={(value) => changeIndicator(action.codigo, indicator.id, "riskValue", value === "Sí")} />
                                      </>
                                    ) : (
                                      <>
                                        <TextField label="Valor meta" type="number" value={numericFieldValue(target.targetValue)} onChange={(value) => changeIndicator(action.codigo, indicator.id, "targetValue", value === "" ? null : Number(value))} />
                                        <TextField label="Valor de riesgo" type="number" value={numericFieldValue(target.riskValue)} onChange={(value) => changeIndicator(action.codigo, indicator.id, "riskValue", value === "" ? null : Number(value))} />
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
            <div className="mt-6 rounded-lg border border-dashed border-[#cfc8b9] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold">Otras acciones propuestas por el centro</h3><p className="mt-1 text-[11px] text-[#78827c]">Máximo tres acciones propias.</p></div><button className="secondary-action" type="button" disabled={content.customActions.length >= 3} onClick={() => patch((value) => ({ ...value, customActions: [...value.customActions, { objectiveCode: "1", title: "", indicatorLabel: "", unit: "número", targetValue: null, riskValue: null }] }))}><Plus size={14} /> Añadir acción</button></div>
              <div className="mt-3 space-y-3">
                {content.customActions.map((action, index) => (
                  <div key={index} className="grid gap-3 rounded-md bg-[#faf9f5] p-3 md:grid-cols-2">
                    <SelectField label="Objetivo" value={action.objectiveCode} values={catalog.objetivos.map((objective) => `${objective.codigo} · ${objective.titulo}`)} onChange={(value) => patch((currentContent) => ({ ...currentContent, customActions: currentContent.customActions.map((item, itemIndex) => itemIndex === index ? { ...item, objectiveCode: value.split(" · ")[0] } : item) }))} />
                    <TextField label="Acción propuesta" value={action.title} onChange={(title) => patch((currentContent) => ({ ...currentContent, customActions: currentContent.customActions.map((item, itemIndex) => itemIndex === index ? { ...item, title } : item) }))} />
                    <TextField label="Indicador" value={action.indicatorLabel} onChange={(indicatorLabel) => patch((currentContent) => ({ ...currentContent, customActions: currentContent.customActions.map((item, itemIndex) => itemIndex === index ? { ...item, indicatorLabel } : item) }))} />
                    <TextField label="Unidad" value={action.unit} onChange={(unit) => patch((currentContent) => ({ ...currentContent, customActions: currentContent.customActions.map((item, itemIndex) => itemIndex === index ? { ...item, unit } : item) }))} />
                    <TextField label="Meta" type="number" value={numericFieldValue(action.targetValue)} onChange={(value) => patch((currentContent) => ({ ...currentContent, customActions: currentContent.customActions.map((item, itemIndex) => itemIndex === index ? { ...item, targetValue: value === "" ? null : Number(value) } : item) }))} />
                    <TextField label="Riesgo" type="number" value={numericFieldValue(action.riskValue)} onChange={(value) => patch((currentContent) => ({ ...currentContent, customActions: currentContent.customActions.map((item, itemIndex) => itemIndex === index ? { ...item, riskValue: value === "" ? null : Number(value) } : item) }))} />
                    <button className="secondary-action md:col-span-2" type="button" onClick={() => patch((currentContent) => ({ ...currentContent, customActions: currentContent.customActions.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={14} /> Eliminar acción propia</button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="pic-section-7" className={classPanel}>
            <SectionHeading number={7} title="ODS vinculados a los objetivos" help="La vinculación se declara una sola vez para el plan. Asocia cada ODS con uno o varios objetivos PIC." />
            <div className="space-y-3">
              {content.odsLinks.map((link, index) => {
                const available = link.agenda === "ods_2030" ? catalog.ods_2030 : catalog.ods_canarios;
                return (
                  <div key={index} className="rounded-md bg-[#faf9f5] p-3">
                    <div className="grid gap-3 md:grid-cols-[160px_1fr_auto]">
                      <SelectField label="Agenda" value={link.agenda} values={["ods_2030", "ods_canarios"]} onChange={(agenda) => patch((value) => ({ ...value, odsLinks: value.odsLinks.map((item, itemIndex) => itemIndex === index ? { ...item, agenda: agenda as PicOdsLink["agenda"], odsCode: (agenda === "ods_2030" ? catalog.ods_2030 : catalog.ods_canarios)[0] ?? "" } : item) }))} />
                      <SelectField label={link.agenda === "ods_2030" ? "ODS 2030" : "ODS canario"} value={link.odsCode} values={available} onChange={(odsCode) => patch((value) => ({ ...value, odsLinks: value.odsLinks.map((item, itemIndex) => itemIndex === index ? { ...item, odsCode } : item) }))} />
                      <button className="secondary-action self-end !px-3" type="button" aria-label="Eliminar vinculación ODS" onClick={() => patch((value) => ({ ...value, odsLinks: value.odsLinks.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={14} /></button>
                    </div>
                    <div className="mt-3"><CheckList label="Objetivos PIC vinculados" options={catalog.objetivos.map((objective) => `${objective.codigo} · ${objective.titulo}`)} value={link.objectiveCodes.map((code) => catalog.objetivos.find((objective) => objective.codigo === code)?.codigo ?? code).map((code) => `${code} · ${catalog.objetivos.find((objective) => objective.codigo === code)?.titulo ?? ""}`)} onChange={(selected) => patch((value) => ({ ...value, odsLinks: value.odsLinks.map((item, itemIndex) => itemIndex === index ? { ...item, objectiveCodes: selected.map((entry) => entry.split(" · ")[0]) } : item) }))} /></div>
                  </div>
                );
              })}
            </div>
            <button className="secondary-action mt-3" type="button" onClick={() => patch((value) => ({ ...value, odsLinks: [...value.odsLinks, { agenda: "ods_2030", odsCode: catalog.ods_2030[0] ?? "", objectiveCodes: [] }] }))}><Plus size={14} /> Añadir vinculación ODS</button>
          </section>

          <section id="pic-section-8" className={classPanel}>
            <SectionHeading number={8} title="Composición de la unidad CICLOPE" help="Incluye, como mínimo, las coordinaciones de las redes implantadas, FP Dual y una representación del equipo directivo." />
            <div className="space-y-3">
              {content.ciclopeMembers.map((member, index) => (
                <div key={index} className="grid gap-3 rounded-md bg-[#faf9f5] p-3 md:grid-cols-[1fr_1.4fr_1fr_auto]">
                  <TextField label="Nombre y apellidos" value={member.name} onChange={(name) => patch((value) => ({ ...value, ciclopeMembers: value.ciclopeMembers.map((item, itemIndex) => itemIndex === index ? { ...item, name } : item) }))} />
                  <SelectField label="Cargo · Anexo IV" value={member.role} values={catalog.cargos_ciclope} onChange={(role) => patch((value) => ({ ...value, ciclopeMembers: value.ciclopeMembers.map((item, itemIndex) => itemIndex === index ? { ...item, role } : item) }))} />
                  <SelectField label="Familia profesional · Anexo I" value={member.professionalFamily} values={familyOptions} onChange={(professionalFamily) => patch((value) => ({ ...value, ciclopeMembers: value.ciclopeMembers.map((item, itemIndex) => itemIndex === index ? { ...item, professionalFamily } : item) }))} />
                  <button className="secondary-action self-end !px-3" aria-label="Eliminar integrante" type="button" onClick={() => patch((value) => ({ ...value, ciclopeMembers: value.ciclopeMembers.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            <button className="secondary-action mt-3" type="button" onClick={() => {
              const member: PicCiclopeMember = { name: "", role: catalog.cargos_ciclope[0] ?? "", professionalFamily: "" };
              patch((value) => ({ ...value, ciclopeMembers: [...value.ciclopeMembers, member] }));
            }}><Plus size={14} /> Añadir integrante CICLOPE</button>
          </section>

          <section id="pic-section-9" className={classPanel}>
            <SectionHeading number={9} title="Calendario de reuniones" help="Programa reuniones de la Red de Innovación y, al menos, cuatro encuentros CICLOPE durante el curso." />
            <DateList label="Reuniones de la Red de Innovación" values={content.calendar.redMeetingDates} onChange={(redMeetingDates) => patch((value) => ({ ...value, calendar: { ...value.calendar, redMeetingDates } }))} />
            <DateList label={`Reuniones CICLOPE · mínimo ${catalog.reglas.reuniones_CICLOPE_minimo}`} values={content.calendar.ciclopeMeetingDates} onChange={(ciclopeMeetingDates) => patch((value) => ({ ...value, calendar: { ...value.calendar, ciclopeMeetingDates } }))} />
            <label className="mt-4 block text-xs font-semibold text-[#43534d]">Observaciones sobre el calendario<textarea className="field mt-1.5 min-h-20 text-sm font-normal" value={content.calendar.notes} onChange={(event) => patch((value) => ({ ...value, calendar: { ...value.calendar, notes: event.currentTarget.value } }))} /></label>
          </section>

          <section id="pic-section-10" className={classPanel}>
            <SectionHeading number={10} title="Difusión" />
            <div className="grid gap-5 md:grid-cols-2">
              <CheckList label="Canales de difusión en línea" options={ONLINE_CHANNELS} value={content.diffusion.onlineChannels} onChange={(onlineChannels) => patch((value) => ({ ...value, diffusion: { ...value.diffusion, onlineChannels } }))} />
              <CheckList label="Canales de difusión fuera de línea" options={OFFLINE_CHANNELS} value={content.diffusion.offlineChannels} onChange={(offlineChannels) => patch((value) => ({ ...value, diffusion: { ...value.diffusion, offlineChannels } }))} />
            </div>
          </section>

          <section className="panel p-5 md:p-7">
            <SectionHeading number={6} title="Validación, versiones y presentación manual" help="La validación no envía el PIC. Cada snapshot queda congelado; la presentación en Laycos se registra solo después de subir el justificante." />
            <div className="flex flex-wrap gap-2">
              <button className="secondary-action" type="button" onClick={runValidation} disabled={dirty || validation.isFetching}><ShieldAlert size={15} />{validation.isFetching ? "Validando…" : "Validar plan"}</button>
              <button className="secondary-action" type="button" disabled={dirty} onClick={async () => { setLaycosOpen(true); await laycosExport.refetch(); }}><FileText size={15} />Preparar campos Laycos</button>
              <button className="secondary-action" type="button" disabled={dirty || docxExport.isFetching} onClick={async () => { const result = await docxExport.refetch(); if (result.data) downloadBase64(result.data.filename, result.data.mediaType, result.data.contentBase64); }}><Download size={15} />Descargar DOCX</button>
              <button className="secondary-action" type="button" disabled={dirty || pdfExport.isFetching} onClick={async () => { const result = await pdfExport.refetch(); if (result.data) downloadBase64(result.data.filename, result.data.mediaType, result.data.contentBase64); }}><Download size={15} />Descargar PDF</button>
            </div>
            {validationVisible && validation.data && (
              <div className={`mt-4 rounded-lg border p-4 ${validation.data.valid ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                <p className="text-sm font-bold">{validation.data.valid ? "El plan supera las reglas bloqueantes." : `${validation.data.errorsCount} errores bloquean el cierre.`} {validation.data.warningsCount > 0 && `${validation.data.warningsCount} avisos.`}</p>
                <ul className="mt-3 space-y-2">{validation.data.issues.map((issue, index) => <li key={`${issue.code}-${index}`} className={`text-xs leading-relaxed ${issue.severity === "error" ? "text-red-800" : "text-amber-900"}`}><span className="font-bold">Apartado {issue.section} · {issue.severity === "error" ? "Error" : "Aviso"}:</span> {issue.message}</li>)}</ul>
              </div>
            )}
            {validation.isError && <p className="mt-3 text-xs text-red-800">{errorText(validation.error)}</p>}

            <div className="mt-5 grid gap-4 rounded-lg bg-[#f8f6f0] p-4 md:grid-cols-[1fr_auto] md:items-end">
              <TextField label="Motivo del snapshot interno" value={snapshotReason} onChange={setSnapshotReason} />
              <button className="primary-action inline-flex items-center justify-center gap-2" type="button" disabled={dirty || validatedRevision !== plan.revision || !validation.data?.valid || createSnapshot.isPending} onClick={makeSnapshot}><FileCheck2 size={15} />{createSnapshot.isPending ? "Guardando versión…" : "Crear snapshot validado"}</button>
            </div>
            {snapshots.data && snapshots.data.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-bold">Versiones inmutables</h3>
                <div className="mt-2 divide-y divide-[#eee9df] rounded-lg border border-[#eee9df]">
                  {snapshots.data.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-3 text-xs">
                      <button type="button" className="font-bold text-[#347b69] underline" onClick={() => setSelectedSnapshotId(item.id)}>Versión {item.version}</button>
                      <span className="text-[#78827c]">rev. {item.planRevision} · {new Date(item.createdAt).toLocaleString("es-ES")}</span>
                      <span className="flex-1 text-[#59675f]">{item.reason}</span>
                      <code className="text-[9px] text-[#8a918b]">{item.sourceHash.slice(0, 12)}…</code>
                    </div>
                  ))}
                </div>
                {snapshotDetail.data && <p className="mt-2 text-[11px] text-[#68746e]">Versión {snapshotDetail.data.version} recuperada: {snapshotDetail.data.content.selectedActions.length} acciones oficiales y {snapshotDetail.data.content.dafo.length} entradas DAFO.</p>}
              </div>
            )}

            <form onSubmit={submitToLaycos} className="mt-6 space-y-3 border-t border-[#eee9df] pt-5">
              <h3 className="text-sm font-bold text-[#35464b]">Registrar presentación manual en Laycos</h3>
              <p className="text-[11px] leading-relaxed text-[#6e7974]">No hay integración con Laycos. Este registro solo se crea cuando la persona usuaria confirma la presentación y adjunta su justificante PDF, PNG o JPG (máximo 1 MiB).</p>
              <div className="grid gap-3 md:grid-cols-3">
                <TextField label="Fecha de presentación" type="date" value={submissionDate} onChange={setSubmissionDate} />
                <TextField label="Referencia o identificador de Laycos (opcional)" value={externalIdentifier} onChange={setExternalIdentifier} />
                <label className="block text-xs font-semibold text-[#43534d]">Justificante de presentación<input className="field mt-1.5 text-xs font-normal" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(event) => setEvidenceFile(event.currentTarget.files?.[0] ?? null)} /></label>
              </div>
              {evidenceFile && <p className="text-[11px] text-[#56665e]">Archivo: {evidenceFile.name} · {(evidenceFile.size / 1024).toFixed(0)} KiB</p>}
              <button type="submit" className="secondary-action" disabled={!evidenceFile || !snapshots.data?.length || recordSubmission.isPending}><FileCheck2 size={15} />{recordSubmission.isPending ? "Registrando…" : "Confirmar presentación y guardar justificante"}</button>
              {submissionMessage && <p role="status" className="text-xs text-emerald-800">{submissionMessage}</p>}
              {submission.data && <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#56665e]"><span>Presentado: {submission.data.submissionDate} · justificante {submission.data.evidenceFileName} · SHA-256 {submission.data.evidenceSha256.slice(0, 12)}…</span><button type="button" className="text-[#347b69] underline" onClick={async () => { const result = await submissionEvidence.refetch(); if (result.data) downloadBase64(result.data.filename, result.data.mediaType, result.data.contentBase64); }}><Download size={13} className="mr-1 inline" />Descargar justificante</button></div>}
            </form>

            {laycosOpen && (
              <div className="mt-6 border-t border-[#eee9df] pt-5">
                <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">Campos para cumplimentar en Laycos · apartados 1–10</h3><button className="text-xs text-[#347b69] underline" onClick={() => setLaycosOpen(false)}>Cerrar</button></div>
                {laycosExport.isFetching ? <p className="mt-3 text-xs text-[#6e7974]">Preparando campos…</p> : laycosExport.data ? <div className="mt-3 max-h-[560px] overflow-auto rounded-lg border border-[#eee9df]">{laycosExport.data.fields.map((field, index) => <div key={`${field.section}-${field.label}-${index}`} className="grid gap-2 border-b border-[#eee9df] p-3 md:grid-cols-[48px_1fr_1.2fr_auto]"><span className="font-mono text-[10px] font-bold text-[#347b69]">{field.section}</span><span className="text-[11px] font-semibold text-[#43534d]">{field.label}</span><span className="break-words text-[11px] text-[#5d6a63]">{field.value || "Sin información"}</span><button className="text-[10px] font-bold text-[#347b69] underline" type="button" disabled={!field.value} onClick={() => navigator.clipboard.writeText(field.value)}>Copiar</button></div>)}</div> : <p className="mt-3 text-xs text-red-800">{errorText(laycosExport.error)}</p>}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function DateList({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="mt-4 rounded-lg border border-[#e9e4d9] p-4">
      <legend className="px-2 text-xs font-bold text-[#43534d]">{label} · {values.length}</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {values.map((value, index) => (
          <div key={`${index}-${value}`} className="flex items-end gap-2">
            <TextField label={`Fecha ${index + 1}`} type="date" value={value} onChange={(next) => onChange(values.map((item, itemIndex) => itemIndex === index ? next : item))} />
            <button className="secondary-action !px-3" type="button" aria-label={`Eliminar fecha ${index + 1}`} onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <button className="secondary-action mt-3" type="button" onClick={() => onChange([...values, isoToday()])}><Plus size={14} /> Añadir fecha</button>
    </fieldset>
  );
}
