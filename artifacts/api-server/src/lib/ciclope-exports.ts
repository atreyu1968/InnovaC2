import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, link, unlink } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./storage";

export async function exportCiclopeDocument(
  meeting: { id: string; revision: number; state: string; data: Record<string, unknown> },
  kind: string, format: string, year: string,
): Promise<Buffer> {
  const directory = path.join(dataDirectory, "ciclope-generated", meeting.id);
  const destination = path.join(directory, `r${meeting.revision}-${kind}.${format}`);
  try { return await readFile(destination); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const d = meeting.data;
  const lines = [
    `INNOVA-C2 · Curso ${year} · ${d.kind === "red_c1" ? "Red C1-C2" : "CICLOPE"}`,
    `${kind === "acta" ? "Acta" : "Convocatoria"} · ${d.title}`,
    `Estado: ${meeting.state} · Revisión ${meeting.revision}`,
    meeting.state === "acta_validada" ? "Acta validada por intervención humana registrada." : "Documento de trabajo: no acredita aprobación ni asistencia.",
    `Inicio: ${d.startsAt} · Final: ${d.endsAt}`, `Lugar/enlace: ${d.location}`, `Objeto: ${d.purpose}`,
    "Composición y asistencia",
    ...(d.participants as { userId: string; name?: string; email?: string; professionalFamily?: string | null; formalRole: string; appointedOn: string | null; attendance: string }[]).map(p => `${p.name ?? p.userId} · ${p.email ?? ""} · ${p.professionalFamily ?? "ámbito de centro"} · ${p.formalRole} · participación: ${p.appointedOn ?? "no acreditada"} · asistencia: ${p.attendance}`),
    "Orden del día", ...(d.agenda as string[]).map((x, i) => `${i + 1}. ${x}`),
    ...(kind === "acta" ? ["Desarrollo e incidencias", String(d.notes), "Acuerdos, responsables y plazos",
      ...(d.agreements as { title: string; responsibleUserId: string; responsibleName?: string; dueDate: string }[]).map(a => `${a.title} · Responsable: ${a.responsibleName ?? a.responsibleUserId} · Plazo: ${a.dueDate}`)] : []),
    "Adjuntos documentales (versiones fijadas)",
    ...((d.pinnedAttachments ?? []) as { title: string; version: number; sha256: string }[]).map(p => `${p.title} · versión ${p.version} · SHA-256 ${p.sha256}`),
    `Fuente inmutable: ${meeting.id} · revisión ${meeting.revision}`,
  ];
  const bytes = format === "docx" ? await Packer.toBuffer(new Document({
    sections: [{ children: lines.map(text => new Paragraph({ children: [new TextRun(text)] })) }],
  })) : await new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 45 }), chunks: Buffer[] = [];
    pdf.on("data", chunk => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
    for (const line of lines) pdf.fontSize(10).text(line).moveDown(.5);
    pdf.end();
  });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    try { await link(temporary, destination); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } finally { await unlink(temporary).catch(() => undefined); }
  return readFile(destination);
}
