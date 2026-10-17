import { useEffect } from 'react';
import type { SoftwareProduct, SoftwareProductInput, SoftwareProductInputStatus, SoftwareRecordInputKind, SoftwareRecordInputOutcome } from '@workspace/api-client-react';
import type { ConflictRow } from '../spaces/ConflictReview';

export const statusOptions: { value: SoftwareProductInputStatus; label: string }[] = [
  { value: 'idea', label: 'Idea' },
  { value: 'analisis', label: 'Análisis' },
  { value: 'desarrollo', label: 'Desarrollo' },
  { value: 'pruebas', label: 'Pruebas' },
  { value: 'piloto', label: 'Piloto' },
  { value: 'implantado', label: 'Implantado' },
  { value: 'mantenimiento', label: 'Mantenimiento' },
];
export const statusText = Object.fromEntries(statusOptions.map(s => [s.value, s.label])) as Record<string, string>;
export const requiresEvidence = (s: string) => s === 'piloto' || s === 'implantado' || s === 'mantenimiento';

export const kindOptions: { value: SoftwareRecordInputKind; label: string }[] = [
  { value: 'entrega', label: 'Entrega' }, { value: 'hito', label: 'Hito' }, { value: 'prueba', label: 'Prueba' },
  { value: 'ticket', label: 'Incidencia' }, { value: 'captura', label: 'Captura' }, { value: 'manual', label: 'Manual' },
];
export const outcomeOptions: { value: SoftwareRecordInputOutcome; label: string }[] = [
  { value: 'pendiente', label: 'Pendiente' }, { value: 'superada', label: 'Superada' }, { value: 'fallida', label: 'Fallida' }, { value: 'no_aplica', label: 'No aplica' },
];
export const kindText = Object.fromEntries(kindOptions.map(s => [s.value, s.label])) as Record<string, string>;
export const outcomeText = Object.fromEntries(outcomeOptions.map(s => [s.value, s.label])) as Record<string, string>;

/** Form shape: identical to SoftwareProductInput minus revision; nullable strings kept as '' while editing. */
export type ProductDraft = Omit<SoftwareProductInput, 'expectedRevision' | 'startedOn' | 'repositoryUrl' | 'implementationDate' | 'resultsConfirmedOn' | 'approvalDate' | 'securityDate' | 'responsibleUserId'> & {
  responsibleUserId: string; startedOn: string; repositoryUrl: string; implementationDate: string; resultsConfirmedOn: string; approvalDate: string; securityDate: string;
};

export const emptyDraft = (): ProductDraft => ({
  name: '', purpose: '', audience: '', modules: '', responsibleUserId: '', startedOn: '', currentVersion: '', status: 'idea', repositoryUrl: '',
  implementationCenter: '', implementationDate: '', results: '', resultsConfirmedOn: '', approvalConfirmed: false, approvalDate: '',
  securityReviewed: false, securityDate: '', evidenceVersionIds: [],
});

export const draftFromProduct = (p: SoftwareProduct): ProductDraft => ({
  name: p.name, purpose: p.purpose, audience: p.audience, modules: p.modules, responsibleUserId: p.responsibleUserId ?? '', startedOn: p.startedOn ?? '',
  currentVersion: p.currentVersion, status: p.status, repositoryUrl: p.repositoryUrl ?? '', implementationCenter: p.implementationCenter,
  implementationDate: p.implementationDate ?? '', results: p.results, resultsConfirmedOn: p.resultsConfirmedOn ?? '', approvalConfirmed: p.approvalConfirmed,
  approvalDate: p.approvalDate ?? '', securityReviewed: p.securityReviewed, securityDate: p.securityDate ?? '', evidenceVersionIds: [...p.evidenceVersionIds],
});

const n = (v: string) => (v.trim() === '' ? null : v.trim());
export const draftToInput = (d: ProductDraft, expectedRevision: number): SoftwareProductInput => ({
  expectedRevision, name: d.name.trim(), purpose: d.purpose, audience: d.audience, modules: d.modules, responsibleUserId: n(d.responsibleUserId),
  startedOn: n(d.startedOn), currentVersion: d.currentVersion.trim(), status: d.status, repositoryUrl: n(d.repositoryUrl),
  implementationCenter: d.implementationCenter, implementationDate: n(d.implementationDate), results: d.results, resultsConfirmedOn: n(d.resultsConfirmedOn),
  approvalConfirmed: d.approvalConfirmed, approvalDate: n(d.approvalDate), securityReviewed: d.securityReviewed, securityDate: n(d.securityDate),
  evidenceVersionIds: [...d.evidenceVersionIds],
});

/** Local checks mirroring server rules, shown before sending; the server remains authoritative. */
export function localProblems(d: ProductDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('El nombre es obligatorio.');
  if (d.status !== 'idea') {
    if (!d.responsibleUserId) out.push('Fuera de la fase de idea hace falta una persona responsable.');
    if (!d.purpose.trim()) out.push('Fuera de la fase de idea hace falta describir la finalidad.');
  }
  if (d.repositoryUrl.trim() && !/^https:\/\//i.test(d.repositoryUrl.trim())) out.push('El repositorio debe ser una dirección https://.');
  if (requiresEvidence(d.status)) {
    if (!d.implementationDate) out.push('Piloto, implantación o mantenimiento requieren fecha de implantación confirmada.');
    if (d.evidenceVersionIds.length === 0) out.push('Piloto, implantación o mantenimiento requieren al menos una evidencia existente.');
  }
  if (d.results.trim() && !d.resultsConfirmedOn) out.push('Los resultados necesitan fecha de confirmación.');
  if (d.approvalConfirmed && !d.approvalDate) out.push('La aprobación necesita fecha.');
  if (d.securityReviewed && !d.securityDate) out.push('La revisión de seguridad necesita fecha.');
  return out;
}

const fieldLabels: Record<keyof ProductDraft, string> = {
  name: 'Nombre', purpose: 'Finalidad', audience: 'Destinatarios', modules: 'Módulos', responsibleUserId: 'Responsable', startedOn: 'Inicio',
  currentVersion: 'Versión', status: 'Estado', repositoryUrl: 'Repositorio', implementationCenter: 'Centro de implantación', implementationDate: 'Fecha de implantación',
  results: 'Resultados', resultsConfirmedOn: 'Resultados confirmados', approvalConfirmed: 'Aprobación', approvalDate: 'Fecha de aprobación',
  securityReviewed: 'Revisión de seguridad', securityDate: 'Fecha de seguridad', evidenceVersionIds: 'Evidencias',
};
const show = (v: unknown) => (Array.isArray(v) ? [...v].sort().join(', ') : typeof v === 'boolean' ? (v ? 'Sí' : 'No') : String(v ?? ''));
export function diffRows(latest: ProductDraft, mine: ProductDraft): ConflictRow[] {
  return (Object.keys(fieldLabels) as (keyof ProductDraft)[]).map(k => ({ label: fieldLabels[k], latest: show(latest[k]), mine: show(mine[k]) }));
}

export function useBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [active]);
}

export const confirmDiscard = () => window.confirm('Hay cambios sin guardar. Si continúas se perderán. ¿Descartar cambios?');

export function safeSummary(summary: string): { key: string; value: string }[] | string {
  try {
    const parsed: unknown = JSON.parse(summary);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value) }));
    }
    return JSON.stringify(parsed);
  } catch { return summary; }
}

export const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 12)}…` : h);
