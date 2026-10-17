import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetSoftwareProductQueryKey, getGetSoftwareProductsQueryKey, useCreateSoftwareRecord } from '@workspace/api-client-react';
import type { SoftwareEvidence, SoftwareRecord, SoftwareRecordInput } from '@workspace/api-client-react';
import { errorText, isRevisionConflict } from '../spaces/spaces-utils';
import { EvidencePicker } from './EvidencePicker';
import { kindOptions, outcomeOptions } from './products-utils';

type Draft = Omit<SoftwareRecordInput, 'expectedRevision' | 'supersedesId'> & { supersedesId: string };
const today = () => new Date().toISOString().slice(0, 10);

/** Append-only record. Revision captured when the form opens; a stale base is rejected by the server. */
export function RecordForm({ productId, productRevision, manualRecords, evidenceOptions, onClose, onSaved, onDirtyChange, onRefetch }: {
  productId: string; productRevision: number; manualRecords: SoftwareRecord[]; evidenceOptions: SoftwareEvidence[];
  onClose: () => void; onSaved: () => void; onDirtyChange: (d: boolean) => void; onRefetch: () => void;
}) {
  const client = useQueryClient();
  const create = useCreateSoftwareRecord();
  const [initial] = useState<Draft>(() => ({ kind: 'manual', title: '', version: '', occurredOn: today(), details: '', outcome: 'no_aplica', evidenceVersionIds: [], supersedesId: '' }));
  const [draft, setDraft] = useState<Draft>(initial);
  const [baseRevision, setBaseRevision] = useState(productRevision);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const dirtyRef = useRef(onDirtyChange); dirtyRef.current = onDirtyChange;
  useEffect(() => { dirtyRef.current(dirty); }, [dirty]);
  useEffect(() => () => dirtyRef.current(false), []);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));
  const p = 'form-record';

  const submit = (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (!draft.title.trim() || !draft.details.trim() || !draft.occurredOn) { setError({ text: 'Título, fecha y detalle son obligatorios.', conflict: false }); return; }
    create.mutate({ productId, data: { ...draft, title: draft.title.trim(), version: draft.version.trim(), supersedesId: draft.supersedesId || null, expectedRevision: baseRevision } }, {
      onSuccess: detail => {
        client.setQueryData(getGetSoftwareProductQueryKey(productId), detail);
        client.invalidateQueries({ queryKey: getGetSoftwareProductsQueryKey() });
        dirtyRef.current(false); onSaved();
      },
      onError: err => setError({ text: errorText(err), conflict: isRevisionConflict(err) }),
    });
  };

  return <form className="products-form panel p-4" onSubmit={submit} data-testid={p} noValidate>
    <div className="is-wide flex flex-wrap items-center gap-2"><h4 className="text-sm font-bold text-[#174f49]">Nuevo registro (no se puede editar después)</h4><span className="products-mono ml-auto" data-testid={`${p}-base-revision`}>Base: revisión {baseRevision}</span></div>
    <label className="products-field">Tipo<select value={draft.kind} onChange={e => set('kind', e.target.value as Draft['kind'])} data-testid={`${p}-select-kind`}>{kindOptions.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
    <label className="products-field">Resultado<select value={draft.outcome} onChange={e => set('outcome', e.target.value as Draft['outcome'])} data-testid={`${p}-select-outcome`}>{outcomeOptions.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
    <label className="products-field is-wide">Título *<input value={draft.title} maxLength={200} onChange={e => set('title', e.target.value)} data-testid={`${p}-input-title`} /></label>
    <label className="products-field">Versión<input value={draft.version} maxLength={100} onChange={e => set('version', e.target.value)} data-testid={`${p}-input-version`} /></label>
    <label className="products-field">Fecha *<input type="date" value={draft.occurredOn} onChange={e => set('occurredOn', e.target.value)} data-testid={`${p}-input-date`} /></label>
    <label className="products-field is-wide">Detalle *<textarea value={draft.details} maxLength={6000} onChange={e => set('details', e.target.value)} data-testid={`${p}-input-details`} /></label>
    <label className="products-field is-wide">Corrige a (opcional; el registro anterior se conserva)<select value={draft.supersedesId} onChange={e => set('supersedesId', e.target.value)} data-testid={`${p}-select-supersedes`}>
      <option value="">No corrige ningún registro</option>
      {manualRecords.map(r => <option key={r.id} value={r.id}>{r.occurredOn} · {r.title}</option>)}
    </select></label>
    <div className="is-wide"><p className="products-field mb-1">Evidencias</p><EvidencePicker options={evidenceOptions} value={draft.evidenceVersionIds} onChange={ids => set('evidenceVersionIds', ids)} testPrefix={p} /></div>
    {error && <div className="products-error is-wide" role="alert" data-testid={`${p}-error`}>{error.text}
      {error.conflict && <div className="mt-2 flex flex-wrap items-center gap-2"><span>El producto cambió desde que abriste este formulario.</span>
        <button type="button" className="quiet-action" onClick={onRefetch} data-testid={`${p}-button-review-latest`}>Revisar versión actual</button>
        <button type="button" className="primary-action" onClick={() => { setBaseRevision(productRevision); setError(null); }} disabled={productRevision === baseRevision} data-testid={`${p}-button-adopt-revision`}>Mantener mi registro sobre la revisión {productRevision}</button></div>}
    </div>}
    <div className="is-wide flex flex-wrap justify-end gap-2">
      <button type="button" className="quiet-action" onClick={onClose} disabled={create.isPending} data-testid={`${p}-button-cancel`}>Cancelar</button>
      <button type="submit" className="primary-action" disabled={create.isPending} data-testid={`${p}-button-save`}>{create.isPending ? 'Guardando…' : 'Añadir registro'}</button>
    </div>
  </form>;
}
