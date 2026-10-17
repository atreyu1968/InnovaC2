import { useState } from 'react';
import { AlertTriangle, ExternalLink, History, Pencil, Plus, RefreshCw } from 'lucide-react';
import { getGetSoftwareProductQueryKey, useGetSoftwareProduct } from '@workspace/api-client-react';
import type { SoftwareOverview, SoftwareProduct, SoftwareRecord } from '@workspace/api-client-react';
import { errorText } from '../spaces/spaces-utils';
import { EvidenceList } from './EvidencePicker';
import { ProductForm } from './ProductForm';
import { RecordForm } from './RecordForm';
import { confirmDiscard, kindText, outcomeText, safeSummary, statusText } from './products-utils';

type Tab = 'ficha' | 'registros' | 'historial';

export function ProductDetail({ productId, overview, dirty, setDirty }: { productId: string; overview: SoftwareOverview; dirty: { product: boolean; record: boolean }; setDirty: (k: 'product' | 'record', v: boolean) => void }) {
  const q = useGetSoftwareProduct(productId, { query: { enabled: !!productId, queryKey: getGetSoftwareProductQueryKey(productId), refetchOnMount: 'always' } });
  const [tab, setTab] = useState<Tab>('ficha');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const canManage = overview.canManage;

  if (q.isLoading) return <div className="grid gap-3" data-testid="status-product-loading"><div className="skeleton h-10" /><div className="skeleton h-48" /></div>;
  if (q.isError || !q.data) return <div className="panel p-5" data-testid="status-product-error"><p className="text-sm text-[#9b4337]">{errorText(q.error)}</p><button className="quiet-action mt-3" onClick={() => q.refetch()} data-testid="button-retry-product">Reintentar</button></div>;
  const { product, records, history } = q.data;
  const switchTab = (t: Tab) => { if ((dirty.product || dirty.record) && !confirmDiscard()) return; setEditing(false); setAdding(false); setTab(t); };
  const supersededIds = new Set(records.map(r => r.supersedesId).filter(Boolean) as string[]);

  return <section className="grid gap-3" data-testid={`detail-product-${product.id}`}>
    <div className="panel flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0"><h3 className="text-lg font-bold text-[#174f49]" data-testid="text-product-name">{product.name}</h3>
        <p className="products-mono" data-testid="text-product-revision">revisión {product.revision}{product.productKey ? ` · clave ${product.productKey}` : ''}</p></div>
      <span className={`product-status is-${product.status}`} data-testid="status-product">{statusText[product.status]}</span>
      <button className="quiet-action ml-auto flex items-center gap-1.5" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh-product"><RefreshCw size={14} className={q.isFetching ? 'animate-spin' : ''} />Actualizar</button>
    </div>
    {product.evidenceIssues.length > 0 && <div className="products-problems" data-testid="status-product-evidence-issues"><p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} />Evidencias con incidencias</p><ul className="list-disc pl-5">{product.evidenceIssues.map(i => <li key={i}>{i}</li>)}</ul></div>}
    <div className="products-tabs" role="tablist">
      {(['ficha', 'registros', 'historial'] as Tab[]).map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-active' : ''} onClick={() => switchTab(t)} data-testid={`tab-product-${t}`}>{t === 'ficha' ? 'Ficha' : t === 'registros' ? `Registros (${records.length})` : `Historial (${history.length})`}</button>)}
    </div>

    {tab === 'ficha' && (editing
      ? <ProductForm key={`edit-${product.id}`} product={product} overview={overview} onDirtyChange={v => setDirty('product', v)}
          onClose={() => { if (dirty.product && !confirmDiscard()) return; setDirty('product', false); setEditing(false); }} onSaved={() => setEditing(false)} />
      : <div className="panel p-4">
          {canManage ? <button className="quiet-action mb-3 flex items-center gap-1.5" onClick={() => setEditing(true)} data-testid="button-edit-product"><Pencil size={14} />Editar ficha</button>
            : <p className="mb-3 text-xs text-[#5f6b66]" data-testid="status-product-readonly">Consulta en modo lectura. Solo C2 de innovación o administración pueden editar.</p>}
          <ProductFacts product={product} />
        </div>)}

    {tab === 'registros' && <div className="grid gap-3">
      <p className="text-xs text-[#5f6b66]">Los registros son inmutables. Una corrección crea un registro nuevo que apunta al anterior. Las entregas importadas del manifiesto instalado son metadatos técnicos: no acreditan implantación ni revisión de seguridad.</p>
      {canManage && !adding && <button className="primary-action w-fit flex items-center gap-1.5" onClick={() => setAdding(true)} data-testid="button-add-record"><Plus size={14} />Añadir registro</button>}
      {adding && <RecordForm key={`rec-${product.id}`} productId={product.id} productRevision={product.revision} manualRecords={records.filter(r => r.source === 'manual')} evidenceOptions={overview.evidenceOptions}
        onDirtyChange={v => setDirty('record', v)} onRefetch={() => q.refetch()}
        onSaved={() => { setDirty('record', false); setAdding(false); }}
        onClose={() => { if (dirty.record && !confirmDiscard()) return; setDirty('record', false); setAdding(false); }} />}
      {records.length === 0 ? <div className="panel p-5 text-sm text-[#5f6b66]" data-testid="status-records-empty">Todavía no hay registros para este producto.</div>
        : [...records].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.revision - a.revision).map(r => <RecordItem key={r.id} r={r} superseded={supersededIds.has(r.id)} records={records} />)}
    </div>}

    {tab === 'historial' && <div className="grid gap-2" data-testid="list-product-history">
      {history.length === 0 ? <div className="panel p-5 text-sm text-[#5f6b66]" data-testid="status-history-empty">Sin versiones registradas.</div>
        : [...history].sort((a, b) => b.revision - a.revision).map(h => { const s = safeSummary(h.summary); return <div key={h.id} className="products-record" data-testid={`history-version-${h.id}`}>
          <p className="flex items-center gap-1.5 text-xs font-bold text-[#174f49]"><History size={13} />Revisión {h.revision} · {new Date(h.createdAt).toLocaleString('es-ES')}</p>
          {typeof s === 'string' ? <p className="products-mono">{s}</p> : <dl className="products-def">{s.map(x => <div key={x.key} className="contents"><dt>{x.key}</dt><dd className="products-mono">{x.value}</dd></div>)}</dl>}
        </div>; })}
    </div>}
  </section>;
}

function Def({ label, value, id }: { label: string; value: string | null | undefined; id: string }) {
  return <><dt>{label}</dt><dd className={value ? '' : 'is-empty'} data-testid={`text-product-${id}`}>{value || 'Sin indicar'}</dd></>;
}

function ProductFacts({ product: p }: { product: SoftwareProduct }) {
  const safeRepo = p.repositoryUrl && /^https:\/\//i.test(p.repositoryUrl) ? p.repositoryUrl : null;
  return <dl className="products-def">
    <Def label="Finalidad" value={p.purpose} id="purpose" /><Def label="Destinatarios" value={p.audience} id="audience" /><Def label="Módulos" value={p.modules} id="modules" />
    <Def label="Responsable" value={p.responsibleName} id="responsible" /><Def label="Inicio" value={p.startedOn} id="started-on" /><Def label="Versión" value={p.currentVersion} id="version" />
    <dt>Repositorio</dt><dd className={safeRepo ? '' : 'is-empty'} data-testid="text-product-repository">{safeRepo ? <a href={safeRepo} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline" data-testid="link-product-repository">{safeRepo}<ExternalLink size={12} /></a> : 'Sin indicar'}</dd>
    <Def label="Centro de implantación" value={p.implementationCenter} id="impl-center" /><Def label="Implantación confirmada" value={p.implementationDate} id="impl-date" />
    <Def label="Resultados" value={p.results} id="results" /><Def label="Resultados confirmados" value={p.resultsConfirmedOn} id="results-date" />
    <Def label="Aprobación" value={p.approvalConfirmed ? `Confirmada${p.approvalDate ? ` el ${p.approvalDate}` : ''}` : 'Sin constancia'} id="approval" />
    <Def label="Seguridad" value={p.securityReviewed ? `Revisada${p.securityDate ? ` el ${p.securityDate}` : ''}` : 'Sin revisión registrada'} id="security" />
    <dt>Evidencias</dt><dd><EvidenceList items={p.evidence} testPrefix="product" /></dd>
  </dl>;
}

function RecordItem({ r, superseded, records }: { r: SoftwareRecord; superseded: boolean; records: SoftwareRecord[] }) {
  const target = r.supersedesId ? records.find(x => x.id === r.supersedesId) : null;
  return <article className={`products-record ${superseded ? 'is-superseded' : ''}`} data-testid={`record-${r.id}`}>
    <div className="flex flex-wrap items-center gap-2">
      <span className={`product-source is-${r.source}`} data-testid={`status-record-source-${r.id}`}>{r.source === 'installed_manifest' ? 'Manifiesto instalado · técnico' : 'Manual'}</span>
      <span className="text-[11px] font-bold text-[#174f49]">{kindText[r.kind]}</span>
      <span className="text-[11px] text-[#5f6b66]">{r.occurredOn}{r.version ? ` · v${r.version}` : ''} · {outcomeText[r.outcome]}</span>
      {superseded && <span className="text-[10px] font-bold text-[#7a4a1c]" data-testid={`status-record-superseded-${r.id}`}>Corregido por un registro posterior</span>}
    </div>
    <h4 className="text-sm font-semibold" data-testid={`text-record-title-${r.id}`}>{r.title}</h4>
    <p className="whitespace-pre-wrap text-xs text-[#34444a]">{r.details}</p>
    {r.supersedesId && <p className="text-[11px] text-[#5f6b66]" data-testid={`text-record-supersedes-${r.id}`}>Corrige: {target ? target.title : <span className="products-mono">{r.supersedesId}</span>}</p>}
    <EvidenceList items={r.evidence} testPrefix={`record-${r.id}`} />
    <p className="products-mono">rev. {r.revision} · creado {new Date(r.createdAt).toLocaleString('es-ES')}</p>
  </article>;
}
