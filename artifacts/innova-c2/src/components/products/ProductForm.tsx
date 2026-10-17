import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSoftwareProduct, getGetSoftwareProductQueryKey, getGetSoftwareProductsQueryKey, useCreateSoftwareProduct, useUpdateSoftwareProduct } from '@workspace/api-client-react';
import type { SoftwareOverview, SoftwareProduct } from '@workspace/api-client-react';
import { ConflictReview } from '../spaces/ConflictReview';
import { errorText, isRevisionConflict } from '../spaces/spaces-utils';
import { EvidencePicker } from './EvidencePicker';
import { diffRows, draftFromProduct, draftToInput, emptyDraft, localProblems, requiresEvidence, statusOptions, type ProductDraft } from './products-utils';

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`products-field ${wide ? 'is-wide' : ''}`}>{label}{children}</label>;
}

/** Create (product undefined) or revision-protected edit. Base revision is captured once at open time. */
export function ProductForm({ product, overview, onClose, onSaved, onDirtyChange }: { product?: SoftwareProduct; overview: SoftwareOverview; onClose: () => void; onSaved: (p: SoftwareProduct) => void; onDirtyChange: (dirty: boolean) => void }) {
  const client = useQueryClient();
  const create = useCreateSoftwareProduct();
  const update = useUpdateSoftwareProduct();
  const initial = useMemo(() => (product ? draftFromProduct(product) : emptyDraft()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<ProductDraft>(initial);
  const [baseRevision, setBaseRevision] = useState(product?.revision ?? 0);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || baseRevision !== (product?.revision ?? 0);
  const dirtyRef = useRef(onDirtyChange); dirtyRef.current = onDirtyChange;
  useEffect(() => { dirtyRef.current(dirty); }, [dirty]);
  useEffect(() => () => dirtyRef.current(false), []);
  const set = <K extends keyof ProductDraft>(k: K, v: ProductDraft[K]) => setDraft(d => ({ ...d, [k]: v }));
  const pending = create.isPending || update.isPending;
  const prefix = product ? `form-product-${product.id}` : 'form-product-new';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = localProblems(draft); setProblems(p); setError(null);
    if (p.length) return;
    const data = draftToInput(draft, baseRevision);
    const fail = (err: unknown) => setError({ text: errorText(err), conflict: isRevisionConflict(err) });
    const done = (saved: SoftwareProduct) => {
      client.invalidateQueries({ queryKey: getGetSoftwareProductsQueryKey() });
      client.invalidateQueries({ queryKey: getGetSoftwareProductQueryKey(saved.id) });
      dirtyRef.current(false);
      onSaved(saved);
    };
    if (product) update.mutate({ productId: product.id, data }, { onSuccess: done, onError: fail });
    else create.mutate({ data }, { onSuccess: done, onError: fail });
  };

  const loadLatest = async () => {
    if (!product) return null;
    const latest = await getSoftwareProduct(product.id);
    client.setQueryData(getGetSoftwareProductQueryKey(product.id), latest);
    return { revision: latest.product.revision, rows: diffRows(draftFromProduct(latest.product), draft) };
  };

  return <form className="products-form panel p-4" onSubmit={submit} data-testid={prefix} noValidate>
    <div className="is-wide flex flex-wrap items-center gap-2">
      <h3 className="text-base font-bold text-[#174f49]">{product ? `Editar ${product.name}` : 'Nuevo producto propio'}</h3>
      <span className="products-mono ml-auto" data-testid={`${prefix}-base-revision`}>{product ? `Base: revisión ${baseRevision}` : 'Producto nuevo · revisión 0'}</span>
    </div>
    <fieldset className="is-wide"><legend>Identidad</legend>
      <Field label="Nombre *"><input value={draft.name} maxLength={160} onChange={e => set('name', e.target.value)} data-testid={`${prefix}-input-name`} /></Field>
      <Field label="Finalidad"><textarea value={draft.purpose} maxLength={4000} onChange={e => set('purpose', e.target.value)} data-testid={`${prefix}-input-purpose`} /></Field>
      <Field label="Destinatarios"><textarea value={draft.audience} maxLength={2000} onChange={e => set('audience', e.target.value)} data-testid={`${prefix}-input-audience`} /></Field>
      <Field label="Módulos"><textarea value={draft.modules} maxLength={4000} onChange={e => set('modules', e.target.value)} data-testid={`${prefix}-input-modules`} /></Field>
    </fieldset>
    <fieldset><legend>Desarrollo</legend>
      <Field label="Responsable"><select value={draft.responsibleUserId} onChange={e => set('responsibleUserId', e.target.value)} data-testid={`${prefix}-select-responsible`}>
        <option value="">Sin asignar</option>
        {draft.responsibleUserId && !overview.staff.some(s => s.id === draft.responsibleUserId) && <option value={draft.responsibleUserId}>{product?.responsibleName ?? 'Persona no disponible'}</option>}
        {overview.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></Field>
      <Field label="Fecha de inicio"><input type="date" value={draft.startedOn} onChange={e => set('startedOn', e.target.value)} data-testid={`${prefix}-input-started-on`} /></Field>
      <Field label="Versión actual"><input value={draft.currentVersion} maxLength={100} onChange={e => set('currentVersion', e.target.value)} data-testid={`${prefix}-input-version`} /></Field>
      <Field label="Estado"><select value={draft.status} onChange={e => set('status', e.target.value as ProductDraft['status'])} data-testid={`${prefix}-select-status`}>
        {statusOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select></Field>
      <Field label="Repositorio (https, opcional)"><input type="url" value={draft.repositoryUrl} maxLength={800} placeholder="https://" onChange={e => set('repositoryUrl', e.target.value)} data-testid={`${prefix}-input-repository`} /></Field>
    </fieldset>
    <fieldset><legend>Implantación y resultados</legend>
      <Field label="Centro de implantación"><input value={draft.implementationCenter} maxLength={500} onChange={e => set('implementationCenter', e.target.value)} data-testid={`${prefix}-input-impl-center`} /></Field>
      <Field label="Fecha de implantación confirmada"><input type="date" value={draft.implementationDate} onChange={e => set('implementationDate', e.target.value)} data-testid={`${prefix}-input-impl-date`} /></Field>
      <Field label="Resultados"><textarea value={draft.results} maxLength={5000} onChange={e => set('results', e.target.value)} data-testid={`${prefix}-input-results`} /></Field>
      <Field label="Resultados confirmados el"><input type="date" value={draft.resultsConfirmedOn} onChange={e => set('resultsConfirmedOn', e.target.value)} data-testid={`${prefix}-input-results-date`} /></Field>
    </fieldset>
    <fieldset className="is-wide"><legend>Aprobación y seguridad</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2"><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={draft.approvalConfirmed} onChange={e => set('approvalConfirmed', e.target.checked)} data-testid={`${prefix}-checkbox-approval`} />Aprobación confirmada por escrito</label>
          <Field label="Fecha de aprobación"><input type="date" value={draft.approvalDate} onChange={e => set('approvalDate', e.target.value)} data-testid={`${prefix}-input-approval-date`} /></Field></div>
        <div className="grid gap-2"><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={draft.securityReviewed} onChange={e => set('securityReviewed', e.target.checked)} data-testid={`${prefix}-checkbox-security`} />Revisión de seguridad realizada</label>
          <Field label="Fecha de revisión de seguridad"><input type="date" value={draft.securityDate} onChange={e => set('securityDate', e.target.value)} data-testid={`${prefix}-input-security-date`} /></Field></div>
      </div>
      <p className="text-[11px] text-[#5f6b66]">Marca estas casillas solo si existe constancia documental. Resultados, aprobación y seguridad requieren fecha y evidencia existente.</p>
    </fieldset>
    <fieldset className="is-wide"><legend>Evidencias de la biblioteca</legend>
      {requiresEvidence(draft.status) && <p className="text-[11px] font-semibold text-[#7a4a1c]">Este estado exige al menos una evidencia aprobada.</p>}
      <EvidencePicker options={overview.evidenceOptions} value={draft.evidenceVersionIds} onChange={ids => set('evidenceVersionIds', ids)} testPrefix={prefix} />
    </fieldset>
    {problems.length > 0 && <ul className="products-problems is-wide list-disc pl-6" data-testid={`${prefix}-local-problems`}>{problems.map(p => <li key={p}>{p}</li>)}</ul>}
    {error && !error.conflict && <p className="products-error is-wide" role="alert" data-testid={`${prefix}-error`}>{error.text}</p>}
    {error?.conflict && product && <ConflictReview testPrefix={prefix} load={loadLatest} onAdopt={rev => { setBaseRevision(rev); setError(null); }} />}
    <div className="is-wide flex flex-wrap justify-end gap-2">
      <button type="button" className="quiet-action" onClick={onClose} disabled={pending} data-testid={`${prefix}-button-cancel`}>Cancelar</button>
      <button type="submit" className="primary-action" disabled={pending || (!dirty && !!product)} data-testid={`${prefix}-button-save`}>{pending ? 'Guardando…' : product ? 'Guardar cambios' : 'Crear producto'}</button>
    </div>
  </form>;
}
