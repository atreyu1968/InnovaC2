import type { ReactNode } from 'react';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { downloadDocumentVersion } from '@workspace/api-client-react';
import type { CiclopeOverview, Document } from '@workspace/api-client-react';

export const stateNames: Record<string, string> = {
  programada: 'Programada', convocada: 'Convocada', celebrada: 'Celebrada',
  acta_borrador: 'Acta en borrador', acta_validada: 'Acta validada', cancelada: 'Cancelada',
};
export const stateTone: Record<string, string> = {
  programada: 'bg-[#eef2ec] text-[#4d6159]', convocada: 'bg-[#e3f0f0] text-[#2f6d6d]', celebrada: 'bg-[#e7f1eb] text-[#31745e]',
  acta_borrador: 'bg-[#fbf5e8] text-[#7c5a1f]', acta_validada: 'bg-[#263c42] text-white', cancelada: 'bg-[#efede6] text-[#8a8f8a]',
};
export const attendanceNames: Record<string, string> = { pendiente: 'Pendiente', presente: 'Presente', ausente: 'Ausente', excusada: 'Excusada' };

export function messageFor(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  if (status === 409) return 'Otra persona ha modificado este registro (conflicto de revisión). Se han recargado los datos actuales; revisa y repite la acción.';
  if (error instanceof Error) return error.message;
  return 'No se ha podido completar la solicitud. Inténtalo de nuevo.';
}
export function fmt(value: string | null | undefined) {
  if (!value) return 'Sin fecha';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string) { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); }

export function Alert({ kind, children, testId }: { kind: 'error' | 'success' | 'warning' | 'info'; children: ReactNode; testId?: string }) {
  const styles = { error: 'border-[#e8c4bd] bg-[#fbf0ed] text-[#8f3b2f]', success: 'border-[#c3e0d3] bg-[#edf7f2] text-[#2c6b55]', warning: 'border-[#ead7b3] bg-[#fbf5e8] text-[#7c5a1f]', info: 'border-[#d6e3e0] bg-[#f1f6f5] text-[#3d5853]' }[kind];
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed ${styles}`} data-testid={testId}>{children}</div>;
}
export function Head({ eyebrow, title, icon, action }: { eyebrow: string; title: string; icon: ReactNode; action?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee9df] px-5 py-4 md:px-6">
    <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#eaf1eb] text-[#347b69]">{icon}</span><div><p className="eyebrow">{eyebrow}</p><h2 className="mt-0.5 font-[var(--app-font-serif)] text-base font-bold">{title}</h2></div></div>{action}</div>;
}
export function Label({ text, children }: { text: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#405057]">{text}</span>{children}</label>;
}

export function personName(data: CiclopeOverview, id: string | null | undefined, snapshot?: string | null) {
  if (snapshot) return snapshot;
  if (!id) return 'Sin asignar';
  return data.people.find(p => p.id === id)?.name ?? 'Persona no visible';
}
const uuidPrefix = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):\s?([\s\S]*)$/i;
export function parseContribution(data: CiclopeOverview, raw: string) {
  const m = raw.match(uuidPrefix);
  return m ? { author: personName(data, m[1]), text: m[2] } : { author: null, text: raw };
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function isAttachable(d: Document) { return d.status === 'aprobado' && d.accessScope === 'center' && d.scanStatus === 'limpio'; }

export type PinnedAttachment = { documentId: string; title: string; version: number; originalName: string; sizeBytes: number; sha256: string };
export function AttachmentRow({ id, doc, pinned, onRemove }: { id: string; doc: Document | undefined; pinned?: PinnedAttachment; onRemove?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    if (!doc && !pinned) return;
    setBusy(true); setError('');
    try { saveBlob(await downloadDocumentVersion(id, pinned?.version ?? doc!.currentVersion, { responseType: 'blob' }), pinned?.originalName ?? doc!.latestFileName); }
    catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };
  return <li className="rounded-lg border border-[#eee9df] bg-[#fffefa] px-3 py-2" data-testid={`row-attachment-${id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">{pinned ? <><p className="truncate text-xs font-bold text-[#34444a]">{pinned.title}</p><p className="text-[10px] text-[#7b8580]">{pinned.originalName} · versión fijada {pinned.version} · {(pinned.sizeBytes / 1024).toFixed(1)} KB</p><p className="break-all font-mono text-[9px]">SHA-256 {pinned.sha256}</p></> : doc ? <><p className="truncate text-xs font-bold text-[#34444a]">{doc.title}</p>
        <p className="text-[10px] text-[#7b8580]">{doc.latestFileName} · v{doc.currentVersion} · {doc.category} · {(doc.sizeBytes / 1024).toFixed(1)} KB · análisis {doc.scanStatus}</p></>
        : <p className="text-[11px] text-[#7b8580]">Documento no visible para tu cuenta ({id.slice(0, 8)}).</p>}</div>
      <div className="flex gap-1.5">
        {(doc || pinned) && <button type="button" className="quiet-action flex items-center gap-1 !px-2 !py-1 text-xs" disabled={busy} onClick={download} data-testid={`button-download-attachment-${id}`}><Download size={12} />{busy ? 'Descargando…' : 'Descargar'}</button>}
        {onRemove && <button type="button" className="quiet-action !px-2 !py-1 text-xs" onClick={onRemove} data-testid={`button-remove-attachment-${id}`}>Quitar</button>}
      </div>
    </div>
    {error && <p className="mt-1 text-[10px] text-[#9b4337]">{error}</p>}
  </li>;
}
