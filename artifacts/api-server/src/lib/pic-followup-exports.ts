import PDFDocument from "pdfkit";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { PicFollowupContent, PicFollowupType, LaycosField } from "@workspace/api-zod";

const REPORT_TITLES: Record<PicFollowupType, string> = {
  primer_trimestre: "Seguimiento del primer trimestre",
  segundo_trimestre: "Seguimiento del segundo trimestre",
  tercer_trimestre: "Seguimiento del tercer trimestre",
  memoria_final: "Memoria final",
  justificacion: "Expediente interno de justificación y certificación",
};

const ACTION_STATES: Record<string, string> = {
  no_iniciada: "No iniciada",
  en_curso: "En curso",
  completada: "Completada",
  descartada: "Descartada",
};

const CHECK_STATES: Record<string, string> = {
  sin_verificar: "Sin verificar",
  confirmado_por_persona: "Confirmado por persona",
  no_acreditado: "No acreditado",
};

function printable(value: string | null | undefined): string {
  return value?.trim() || "Sin información registrada.";
}

export function createPicFollowupLaycosFields(
  reportType: PicFollowupType,
  content: PicFollowupContent,
  schoolYear: string,
  snapshotVersion: number,
): LaycosField[] {
  if (reportType === "justificacion") return [];
  const section = reportType === "memoria_final"
    ? 14
    : reportType === "primer_trimestre" ? 11
      : reportType === "segundo_trimestre" ? 12 : 13;
  const fields: LaycosField[] = [];
  const source = `PIC · curso ${schoolYear} · instantánea inmutable v${snapshotVersion}`;
  const add = (label: string, value: string | null | undefined, certainty: LaycosField["certainty"] = "pendiente_validacion") => {
    const clean = value?.trim() ?? "";
    fields.push({
      section,
      label,
      value: clean,
      certainty: clean ? certainty : "sin_informacion",
      source,
    });
  };

  if (section < 14) {
    for (const action of content.actions) {
      const title = action.actionTitle ? ` · ${action.actionTitle}` : "";
      add(`Acción ${action.actionCode}${title} · estado`, ACTION_STATES[action.status] ?? action.status);
      add(`Acción ${action.actionCode} · observación`, action.note);
    }
    add("Actuaciones desarrolladas durante el trimestre", content.activitiesNarrative);
    add("Incidencias detectadas", content.incidents);
    add("Ajustes propuestos al plan de acción", content.adjustments);
    if (reportType === "tercer_trimestre") {
      add("Fecha de traslado del resumen a CCP o ETA", content.transferredDate);
    }
  } else {
    add("Aspectos positivos del plan de acción", content.positiveAspects);
    add("Aspectos negativos y dificultades encontradas", content.difficulties);
    add("Objetivos no alcanzados: explicación y puntualizaciones", content.unmetObjectivesExplanation);
    add("Propuestas de mejora para el curso siguiente", content.improvements);
    add("Fecha de incorporación a la memoria final del centro", content.centerMemoryDate);
  }

  if (content.sources.length) {
    for (const sourceRef of content.sources) {
      add(
        `Fuente reutilizada · ${sourceRef.type} · ${sourceRef.label ?? sourceRef.id}`,
        `${sourceRef.status ?? "referencia del expediente"}${sourceRef.note ? ` · ${sourceRef.note}` : ""}`,
        "pendiente_validacion",
      );
    }
  }
  if (content.annexes.length) {
    for (const annex of content.annexes) {
      add(`Anexo · ${annex.title}`, `${annex.fileName ?? "archivo del expediente"} · SHA-256 ${annex.sha256 ?? "sin huella"}`);
    }
  }
  return fields;
}

type ExportMeta = {
  reportType: PicFollowupType;
  centerName: string;
  schoolYear: string;
  version: number;
  revision: number;
  reason: string;
  sourceHash: string;
  validation: { complete: boolean; warnings: string[] };
};

function reportTextSections(type: PicFollowupType, content: PicFollowupContent) {
  const result: { heading: string; lines: string[] }[] = [];
  if (type.startsWith("primer_") || type === "segundo_trimestre" || type === "tercer_trimestre") {
    result.push({
      heading: "Estado de las acciones del PIC",
      lines: content.actions.map((action) =>
        `${action.actionCode}${action.actionTitle ? ` · ${action.actionTitle}` : ""}: ${ACTION_STATES[action.status] ?? action.status}${action.note ? ` — ${action.note}` : ""}`,
      ),
    });
    result.push({ heading: "Actuaciones desarrolladas durante el trimestre", lines: [printable(content.activitiesNarrative)] });
    result.push({ heading: "Incidencias detectadas", lines: [printable(content.incidents)] });
    result.push({ heading: "Ajustes propuestos al plan de acción", lines: [printable(content.adjustments)] });
    if (type === "tercer_trimestre") {
      result.push({ heading: "Fecha de traslado a CCP o ETA", lines: [printable(content.transferredDate)] });
    }
  } else {
    result.push({ heading: "Aspectos positivos del plan de acción", lines: [printable(content.positiveAspects)] });
    result.push({ heading: "Aspectos negativos y dificultades encontradas", lines: [printable(content.difficulties)] });
    result.push({ heading: "Objetivos no alcanzados: explicación y puntualizaciones", lines: [printable(content.unmetObjectivesExplanation)] });
    result.push({ heading: "Propuestas de mejora para el curso siguiente", lines: [printable(content.improvements)] });
    result.push({ heading: "Fecha de incorporación a la memoria final del centro", lines: [printable(content.centerMemoryDate)] });
    if (type === "justificacion") {
      const check = content.certification;
      result.push({
        heading: "Comprobaciones manuales para el expediente",
        lines: [
          `Asistencia a sesiones C1 ≥ 85 %: ${CHECK_STATES[check.c1Attendance85.status]}${check.c1Attendance85.observation ? ` — ${check.c1Attendance85.observation}` : ""}`,
          `PIC presentado: ${CHECK_STATES[check.planPresented.status]}${check.planPresented.observation ? ` — ${check.planPresented.observation}` : ""}`,
          `Seguimientos trimestrales en plazo: ${CHECK_STATES[check.quarterlyReportsOnTime.status]}${check.quarterlyReportsOnTime.observation ? ` — ${check.quarterlyReportsOnTime.observation}` : ""}`,
          `Memoria final en plazo: ${CHECK_STATES[check.finalMemoryOnTime.status]}${check.finalMemoryOnTime.observation ? ` — ${check.finalMemoryOnTime.observation}` : ""}`,
          `Solicitud de certificación: ${CHECK_STATES[check.certificationRequested.status]}${check.certificationRequested.observation ? ` — ${check.certificationRequested.observation}` : ""}`,
          `Resumen de asistencia consignado por una persona: ${printable(check.personConfirmedAttendanceSummary)}`,
        ],
      });
    }
  }
  result.push({
    heading: "Fuentes reutilizadas",
    lines: content.sources.length
      ? content.sources.map((ref) => `${ref.type}: ${ref.label ?? ref.id} · ${ref.status ?? "referencia"}${ref.note ? ` — ${ref.note}` : ""}`)
      : ["Sin fuentes vinculadas."],
  });
  result.push({
    heading: "Anexos del expediente",
    lines: content.annexes.length
      ? content.annexes.map((annex) => `${annex.title} · ${annex.fileName ?? "archivo"} · SHA-256 ${annex.sha256 ?? "sin huella"}${annex.description ? ` — ${annex.description}` : ""}`)
      : ["Sin anexos vinculados."],
  });
  return result;
}

function humanControlNotice(meta: ExportMeta) {
  const base = [
    "Documento generado desde una instantánea de INNOVA-C2.",
    "La transcripción y presentación en Laycos son manuales. Este archivo no se ha enviado ni presentado.",
  ];
  if (!meta.validation.complete) base.push("La instantánea conserva campos incompletos o pendientes de revisión.");
  if (meta.reportType === "justificacion") {
    base.push("Este expediente interno no emite certificados oficiales, no acredita automáticamente asistencia y no calcula ni asigna pagos u horas certificadas.");
  }
  return base.join(" ");
}

export async function createPicFollowupDocx(
  meta: ExportMeta,
  content: PicFollowupContent,
): Promise<Buffer> {
  const paragraphs = [
    new Paragraph({ text: REPORT_TITLES[meta.reportType].toUpperCase(), heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [
        new TextRun({ text: `${meta.centerName} · Curso ${meta.schoolYear}`, bold: true }),
        new TextRun(` · Revisión ${meta.revision} · Instantánea ${meta.version}`),
      ],
    }),
    new Paragraph({ text: humanControlNotice(meta), style: "IntenseQuote" }),
    new Paragraph({ text: `Motivo de conservación: ${meta.reason}` }),
    new Paragraph({ text: `Huella SHA-256 de la instantánea: ${meta.sourceHash}` }),
    new Paragraph({ text: `Validación de contenido: ${meta.validation.complete ? "completa según los campos revisados" : "incompleta o pendiente"}` }),
  ];
  for (const section of reportTextSections(meta.reportType, content)) {
    paragraphs.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
    for (const line of section.lines) paragraphs.push(new Paragraph({ text: printable(line), bullet: { level: 0 } }));
  }
  if (meta.validation.warnings.length) {
    paragraphs.push(new Paragraph({ text: "Avisos de revisión", heading: HeadingLevel.HEADING_1 }));
    for (const warning of meta.validation.warnings) paragraphs.push(new Paragraph({ text: warning, bullet: { level: 0 } }));
  }
  const doc = new Document({
    creator: "INNOVA-C2",
    title: `${REPORT_TITLES[meta.reportType]} · ${meta.schoolYear}`,
    subject: "Documento para revisión y transcripción manual",
    sections: [{ children: paragraphs }],
  });
  return Packer.toBuffer(doc);
}

export async function createPicFollowupPdf(
  meta: ExportMeta,
  content: PicFollowupContent,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: "A4",
      margins: { top: 48, bottom: 48, left: 52, right: 52 },
      info: {
        Title: `${REPORT_TITLES[meta.reportType]} · ${meta.schoolYear}`,
        Author: "INNOVA-C2",
        Subject: "Documento para revisión y transcripción manual",
      },
    });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("error", reject);
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.font("Helvetica-Bold").fontSize(18).text(REPORT_TITLES[meta.reportType]);
    pdf.moveDown(0.4);
    pdf.font("Helvetica").fontSize(10).text(`${meta.centerName} · Curso ${meta.schoolYear} · Revisión ${meta.revision} · Instantánea ${meta.version}`);
    pdf.moveDown(0.5);
    pdf.font("Helvetica-Bold").fontSize(9).text(humanControlNotice(meta));
    pdf.moveDown(0.35);
    pdf.font("Helvetica").fontSize(8).text(`Motivo de conservación: ${meta.reason}`);
    pdf.text(`Huella SHA-256 de la instantánea: ${meta.sourceHash}`);
    pdf.text(`Validación: ${meta.validation.complete ? "completa según los campos revisados" : "incompleta o pendiente"}`);
    for (const section of reportTextSections(meta.reportType, content)) {
      pdf.moveDown(0.75);
      pdf.font("Helvetica-Bold").fontSize(12).text(section.heading);
      for (const line of section.lines) {
        pdf.moveDown(0.2);
        pdf.font("Helvetica").fontSize(9).text(`• ${printable(line)}`);
      }
    }
    if (meta.validation.warnings.length) {
      pdf.moveDown(0.75);
      pdf.font("Helvetica-Bold").fontSize(12).text("Avisos de revisión");
      for (const warning of meta.validation.warnings) {
        pdf.moveDown(0.2);
        pdf.font("Helvetica").fontSize(9).text(`• ${warning}`);
      }
    }
    pdf.end();
  });
}

export function createPicFollowupJson(meta: ExportMeta, content: PicFollowupContent): Buffer {
  return Buffer.from(JSON.stringify({ metadata: meta, content }, null, 2), "utf8");
}

export function picFollowupTitle(reportType: PicFollowupType): string {
  return REPORT_TITLES[reportType];
}
