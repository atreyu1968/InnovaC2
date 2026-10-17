import PDFDocument from "pdfkit";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type {
  LaycosField,
  PicPlanContent,
  PicPlanValidation,
} from "@workspace/api-zod";
import type { OfficialPicCatalog } from "./pic-plan-validation";

const SECTION_TITLES: Record<number, string> = {
  1: "Datos de la persona coordinadora",
  2: "Datos del centro",
  3: "Diagnóstico DAFO",
  4: "Proyectos de innovación en el centro",
  5: "Aula de Tecnología Aplicada (ATECA)",
  6: "Objetivos y acciones",
  7: "ODS vinculados a los objetivos",
  8: "Composición de la unidad CICLOPE",
  9: "Calendario de reuniones",
  10: "Difusión",
};

const formatValue = (value: string | number | boolean | null | undefined) => {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value);
};

export function createLaycosExport(
  content: PicPlanContent,
  catalog: OfficialPicCatalog,
  centerName: string,
  schoolYear: string,
): LaycosField[] {
  const fields: LaycosField[] = [];
  const source = `PIC_Innovacion_Centro_26-27.docx · catálogo ${catalog.version} · centro ${centerName} · curso ${schoolYear}`;
  const add = (section: number, label: string, value: unknown) => {
    const text = formatValue(value as string | number | boolean | null | undefined);
    fields.push({
      section,
      label,
      value: text,
      certainty: text ? "confirmado" : "sin_informacion",
      source,
    });
  };

  add(1, "Red preasignada", "Innovación");
  add(1, "Perfil de coordinación", content.coordinator.profile);
  add(1, "Nombre", content.coordinator.firstName);
  add(1, "Apellidos", content.coordinator.lastName);
  add(1, "Correo electrónico corporativo", content.coordinator.corporateEmail);
  add(1, "Teléfono de contacto", content.coordinator.phone);

  add(2, "Centro educativo", centerName);
  add(2, "Familia profesional de coordinación", content.center.professionalFamily);
  add(2, "Niveles impartidos", content.center.levels.join(", "));
  add(2, "N.º de grupos de enseñanzas profesionales", content.center.groupCount);
  if (content.center.familyProfiles !== undefined) {
    add(2, "N.º de familias profesionales del centro", content.center.familyProfiles.length);
    content.center.familyProfiles.forEach((family, index) => {
      add(2, `Familia ${index + 1} · nombre`, family.professionalFamily);
      add(2, `Familia ${index + 1} · niveles impartidos`, family.levels.join(", "));
      add(2, `Familia ${index + 1} · número de grupos`, family.groupCount);
    });
  }

  for (const quadrant of ["debilidades", "fortalezas", "amenazas", "oportunidades"] as const) {
    const entries = content.dafo.filter((entry) => entry.quadrant === quadrant);
    if (!entries.length) add(3, `DAFO · ${quadrant}`, "");
    entries.forEach((entry, index) => {
      add(3, `DAFO · ${quadrant} · situación ${index + 1}`, `${entry.category}: ${entry.situation}${entry.customDetail ? ` — ${entry.customDetail}` : ""}`);
    });
  }

  add(4, "¿Se desarrolla algún proyecto de innovación?", content.projectsInCenter);
  const includedProjects = content.projectsInCenter
    ? content.projects.filter((project) => project.includedInPic)
    : [];
  includedProjects.forEach((project, index) => {
    add(4, `Proyecto ${index + 1} · convocatoria o promotor`, project.promoter);
    add(4, `Proyecto ${index + 1} · nombre`, project.name);
    add(4, `Proyecto ${index + 1} · el centro es coordinador`, project.centerCoordinates);
    add(4, `Proyecto ${index + 1} · familia profesional`, project.coordinatingFamily);
    add(4, `Proyecto ${index + 1} · persona coordinadora`, project.coordinatorName);
    add(4, `Proyecto ${index + 1} · correo`, project.coordinatorEmail);
  });
  if (content.projectsInCenter && content.projects.length > includedProjects.length) {
    add(4, "Proyectos del inventario interno no incluidos en el PIC", content.projects.length - includedProjects.length);
  }

  add(5, "¿Dispone de ATECA o está en implantación?", content.ateca.available);
  add(5, "Aula ATECA de referencia", content.ateca.referenceCenter);

  const actionByCode = new Map(
    catalog.objetivos.flatMap((objective) =>
      objective.acciones.map((action) => [
        action.codigo,
        { objective, action },
      ] as const),
    ),
  );
  for (const objective of catalog.objetivos) {
    const objectiveSelections = content.selectedActions.filter(
      (selection) => selection.objectiveCode === objective.codigo,
    );
    add(6, `Objetivo ${objective.codigo}`, objective.titulo);
    for (const selection of objectiveSelections) {
      const matched = actionByCode.get(selection.actionCode);
      add(6, `Acción ${selection.actionCode}`, matched?.action.titulo ?? selection.actionCode);
      const indicators = new Map(
        matched?.action.indicadores.map((indicator) => [indicator.id, indicator]) ?? [],
      );
      for (const target of selection.indicators) {
        const label = indicators.get(target.indicatorId)?.descripcion ?? target.indicatorId;
        add(6, `${target.indicatorId} · ${label} · unidad`, target.unit);
        add(6, `${target.indicatorId} · meta`, target.targetValue);
        add(6, `${target.indicatorId} · riesgo`, target.riskValue);
      }
    }
  }
  content.customActions.forEach((action, index) => {
    add(6, `Acción propia ${index + 1} · objetivo`, action.objectiveCode);
    add(6, `Acción propia ${index + 1} · acción`, action.title);
    add(6, `Acción propia ${index + 1} · indicador`, action.indicatorLabel);
    add(6, `Acción propia ${index + 1} · unidad`, action.unit);
    add(6, `Acción propia ${index + 1} · meta`, action.targetValue);
    add(6, `Acción propia ${index + 1} · riesgo`, action.riskValue);
  });

  for (const agenda of ["ods_2030", "ods_canarios"] as const) {
    const title = agenda === "ods_2030" ? "ODS 2030" : "ODS canarios";
    const links = content.odsLinks.filter((link) => link.agenda === agenda);
    if (!links.length) add(7, title, "");
    for (const link of links) {
      add(7, title, `${link.odsCode} · objetivos PIC ${link.objectiveCodes.join(", ")}`);
    }
  }

  content.ciclopeMembers.forEach((member, index) => {
    add(8, `CICLOPE · integrante ${index + 1} · nombre`, member.name);
    add(8, `CICLOPE · integrante ${index + 1} · cargo`, member.role);
    add(8, `CICLOPE · integrante ${index + 1} · familia profesional`, member.professionalFamily);
  });
  if (!content.ciclopeMembers.length) add(8, "Composición de la unidad CICLOPE", "");

  content.calendar.redMeetingDates.forEach((date, index) =>
    add(9, `Reunión de la Red de Innovación ${index + 1}`, date),
  );
  content.calendar.ciclopeMeetingDates.forEach((date, index) =>
    add(9, `Reunión CICLOPE ${index + 1}`, date),
  );
  add(9, "Observaciones sobre el calendario", content.calendar.notes);

  add(10, "Canales de difusión en línea", content.diffusion.onlineChannels.join(", "));
  add(10, "Canales de difusión fuera de línea", content.diffusion.offlineChannels.join(", "));
  return fields;
}

function createDocumentParagraphs(
  content: PicPlanContent,
  catalog: OfficialPicCatalog,
  centerName: string,
  schoolYear: string,
  revision: number,
  validation: PicPlanValidation,
): Paragraph[] {
  const fields = createLaycosExport(content, catalog, centerName, schoolYear);
  const paragraphs: Paragraph[] = [
    new Paragraph({
      text: "PLAN DE INNOVACIÓN DEL CENTRO (PIC)",
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Red de Innovación · Coordinación C2 · ", bold: true }),
        new TextRun(`${centerName} · Curso ${schoolYear}`),
      ],
    }),
    new Paragraph({
      text: `Catálogo ${catalog.version} · Revisión interna ${revision} · Documento generado para preparar la cumplimentación en Laycos.`,
    }),
    new Paragraph({
      text: "La presentación se realiza manualmente en Laycos. Este documento no se ha enviado a ninguna plataforma externa.",
      style: "IntenseQuote",
    }),
  ];
  for (let section = 1; section <= 10; section += 1) {
    paragraphs.push(
      new Paragraph({
        text: `${section}. ${SECTION_TITLES[section]}`,
        heading: HeadingLevel.HEADING_1,
      }),
    );
    const sectionFields = fields.filter((field) => field.section === section);
    if (!sectionFields.length) {
      paragraphs.push(new Paragraph({ text: "Sin información registrada." }));
      continue;
    }
    for (const field of sectionFields) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${field.label}: `, bold: true }),
            new TextRun(field.value || "Sin información"),
          ],
          bullet: { level: 0 },
        }),
      );
    }
  }
  paragraphs.push(
    new Paragraph({
      text: `Validación: ${validation.errorsCount} errores bloqueantes y ${validation.warningsCount} avisos.`,
      heading: HeadingLevel.HEADING_1,
    }),
  );
  for (const issue of validation.issues) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${issue.severity.toUpperCase()} · apartado ${issue.section}: `, bold: true }),
          new TextRun(issue.message),
        ],
      }),
    );
  }
  return paragraphs;
}

export async function createPicDocx(
  content: PicPlanContent,
  catalog: OfficialPicCatalog,
  centerName: string,
  schoolYear: string,
  revision: number,
  validation: PicPlanValidation,
): Promise<Buffer> {
  const doc = new Document({
    creator: "INNOVA-C2",
    title: `PIC ${centerName} ${schoolYear}`,
    subject: "Documento de preparación para cumplimentar el PIC en Laycos",
    sections: [{ children: createDocumentParagraphs(content, catalog, centerName, schoolYear, revision, validation) }],
  });
  return Packer.toBuffer(doc);
}

export async function createPicPdf(
  content: PicPlanContent,
  catalog: OfficialPicCatalog,
  centerName: string,
  schoolYear: string,
  revision: number,
  validation: PicPlanValidation,
): Promise<Buffer> {
  const fields = createLaycosExport(content, catalog, centerName, schoolYear);
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: "A4",
      margins: { top: 48, bottom: 48, left: 52, right: 52 },
      info: {
        Title: `PIC ${centerName} ${schoolYear}`,
        Author: "INNOVA-C2",
        Subject: "Preparación del Plan de Innovación del Centro",
      },
    });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("error", reject);
    pdf.on("end", () => resolve(Buffer.concat(chunks)));

    pdf.font("Helvetica-Bold").fontSize(18).text("PLAN DE INNOVACIÓN DEL CENTRO (PIC)");
    pdf.moveDown(0.4);
    pdf.font("Helvetica").fontSize(10).text(
      `Red de Innovación · Coordinación C2 · ${centerName} · Curso ${schoolYear}`,
    );
    pdf.text(`Catálogo ${catalog.version} · Revisión interna ${revision}`);
    pdf.moveDown(0.3);
    pdf.font("Helvetica-Bold").fontSize(9).text(
      "DOCUMENTO PARA PREPARAR LA PRESENTACIÓN MANUAL EN LAYCOS. No se ha enviado a ninguna plataforma externa.",
    );
    for (let section = 1; section <= 10; section += 1) {
      pdf.moveDown(0.8);
      pdf.font("Helvetica-Bold").fontSize(13).text(`${section}. ${SECTION_TITLES[section]}`);
      const sectionFields = fields.filter((field) => field.section === section);
      if (!sectionFields.length) {
        pdf.font("Helvetica").fontSize(9).text("Sin información registrada.");
        continue;
      }
      for (const field of sectionFields) {
        pdf.moveDown(0.2);
        pdf.font("Helvetica-Bold").fontSize(9).text(`${field.label}: `, { continued: true });
        pdf.font("Helvetica").text(field.value || "Sin información");
      }
    }
    pdf.addPage();
    pdf.font("Helvetica-Bold").fontSize(13).text("Validación del PIC");
    pdf.moveDown(0.5);
    pdf.font("Helvetica").fontSize(10).text(
      `${validation.errorsCount} errores bloqueantes · ${validation.warningsCount} avisos`,
    );
    for (const issue of validation.issues) {
      pdf.moveDown(0.3);
      pdf.font("Helvetica-Bold").fontSize(9).text(
        `${issue.severity.toUpperCase()} · apartado ${issue.section}: `,
        { continued: true },
      );
      pdf.font("Helvetica").text(issue.message);
    }
    pdf.end();
  });
}
