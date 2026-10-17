import { useCallback, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Boxes, DownloadCloud, Pencil, Plus, RefreshCw } from 'lucide-react';
import { getSoftwareProducts, getGetSoftwareProductsQueryKey, useGetSoftwareProducts, useInitializeSoftwareProducts, useSyncSoftwareDeliveries, useUpdateSoftwareCatalog } from '@workspace/api-client-react';
import type { SoftwareCatalog, SoftwareOverview } from '@workspace/api-client-react';
import { ConflictReview } from '../spaces/ConflictReview';
import { errorText, isRevisionConflict } from '../spaces/spaces-utils';
import { ProductDetail } from './ProductDetail';
import { ProductForm } from './ProductForm';
import { confirmDiscard, statusText, useBeforeUnload } from './products-utils';
import '../spaces/spaces.css';
import './products.css';

export function SoftwareProductsPage() {
  const q = useGetSoftwareProducts({ query: { queryKey: getGetSoftwareProductsQueryKey(), refetchOnMount: 'always' } });
  if (q.isLoading) return <div className="products-page" data-testid="status-products-loading"><div className="skeleton h-24" /><div className="skeleton h-64" /></div>;
  if (q.isError || !q.data) return <div className="panel p-6" data-testid="status-products-error"><p className="text-sm text-[#9b4337]">{errorText(q.error)}</p><button className="quiet-action mt-3" onClick={() => q.refetch()} data-testid="button-retry-products">Reintentar</button></div>;
  return <ProductsWorkspace key={q.data.schoolYearId} data={q.data} refreshing={q.isFetching} onRefresh={() => q.refetch()} />;
}

type DirtyKeys = { catalog: boolean; product: boolean; record: boolean; create: boolean };

function ProductsWorkspace({ data, refreshing, onRefresh }: { data: SoftwareOverview; refreshing: boolean; onRefresh: () => void }) {
  const client = useQueryClient();
  const init = useInitializeSoftwareProducts();
  const sync = useSyncSoftwareDeliveries();
  const [selected, setSelected] = useState<string | 'new' | null>(data.products[0]?.id ?? null);
  const [dirty, setDirtyState] = useState<DirtyKeys>({ catalog: false, product: false, record: false, create: false });
  const setDirty = useCallback((k: keyof DirtyKeys, v: boolean) => setDirtyState(d => (d[k] === v ? d : { ...d, [k]: v })), []);
  const anyDirty = Object.values(dirty).some(Boolean);
  useBeforeUnload(anyDirty);
  const [initError, setInitError] = useState('');
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const select = (id: string | 'new') => {
    if (id === selected) return;
    if ((dirty.product || dirty.record || dirty.create) && !confirmDiscard()) return;
    setDirtyState(d => ({ ...d, product: false, record: false, create: false }));
    setSelected(id);
  };

  if (!data.catalog) return <div className="products-page">
    <div className="panel p-6" data-testid="status-products-uninitialized">
      <Boxes className="text-[#174f49]" size={28} />
      <h3 className="mt-2 text-lg font-bold text-[#174f49]">Catálogo sin inicializar en {data.schoolYear}</h3>
      <p className="mt-1 max-w-prose text-sm text-[#34444a]">La inicialización crea la ficha paraguas «Innovando en FP» y los nombres INNOVA-C2, CoordinacionFP y SafeExit en fase de idea. Ningún producto queda marcado como implantado.</p>
      {data.canManage ? <>
        <button className="primary-action mt-4" disabled={init.isPending} data-testid="button-initialize-products" onClick={() => { setInitError(''); init.mutate(undefined, { onSuccess: next => client.setQueryData(getGetSoftwareProductsQueryKey(), next), onError: e => setInitError(errorText(e)) }); }}>{init.isPending ? 'Inicializando…' : 'Inicializar catálogo del curso'}</button>
        {initError && <p className="products-error mt-3" role="alert" data-testid="error-initialize-products">{initError}</p>}
      </> : <p className="mt-3 text-xs text-[#5f6b66]" data-testid="status-products-readonly">Solo C2 de innovación o administración pueden inicializarlo.</p>}
    </div>
  </div>;

  return <div className="products-page">
    <CatalogCard catalog={data.catalog} data={data} setDirty={v => setDirty('catalog', v)} dirty={dirty.catalog} />
    <div className="panel flex flex-wrap items-center gap-2 p-3">
      <span className="text-xs text-[#5f6b66]" data-testid="text-installed-version">Versión instalada: <code className="products-mono">{data.installedVersion || 'sin dato'}</code></span>
      <button className="quiet-action ml-auto flex items-center gap-1.5" onClick={onRefresh} disabled={refreshing} data-testid="button-refresh-products"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />Actualizar</button>
      {data.canManage && <button className="quiet-action flex items-center gap-1.5" disabled={sync.isPending} data-testid="button-sync-deliveries" onClick={() => { setSyncMsg(null); sync.mutate(undefined, {
        onSuccess: r => { setSyncMsg({ ok: true, text: `${r.message} (${r.inserted} nuevas)` }); client.invalidateQueries({ queryKey: getGetSoftwareProductsQueryKey() }); client.invalidateQueries({ predicate: qq => String(qq.queryKey[0] ?? '').includes('/software-products/') }); },
        onError: e => setSyncMsg({ ok: false, text: errorText(e) }) }); }}><DownloadCloud size={14} />{sync.isPending ? 'Importando…' : 'Importar entregas instaladas'}</button>}
    </div>
    {syncMsg && <p className={syncMsg.ok ? 'panel p-3 text-xs text-[#174f49]' : 'products-error'} data-testid="status-sync-result">{syncMsg.text}{syncMsg.ok && ' Solo metadatos técnicos; el estado de los productos no cambia.'}</p>}
    {!data.canManage && <p className="text-xs text-[#5f6b66]" data-testid="status-products-readonly">Consulta en modo lectura.</p>}

    <div className="products-layout">
      <nav className="products-list" aria-label="Productos" data-testid="list-products">
        {data.canManage && <button className="primary-action flex items-center justify-center gap-1.5" onClick={() => select('new')} data-testid="button-new-product"><Plus size={14} />Nuevo producto</button>}
        {data.products.length === 0 && <p className="panel p-4 text-xs text-[#5f6b66]" data-testid="status-products-empty">No hay productos en este curso.</p>}
        {data.products.map(p => <button key={p.id} className={`product-tile ${selected === p.id ? 'is-active' : ''}`} onClick={() => select(p.id)} data-testid={`card-product-${p.id}`}>
          <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-bold text-[#1f2d2b]">{p.name}</span><span className={`product-status is-${p.status}`}>{statusText[p.status]}</span></span>
          <span className="mt-1 block text-[11px] text-[#5f6b66]">{p.responsibleName ?? 'Sin responsable'} · {p.currentVersion || 'sin versión'}</span>
          {p.evidenceIssues.length > 0 && <span className="mt-1 block text-[11px] font-semibold text-[#9b4337]" data-testid={`status-product-issues-${p.id}`}>{p.evidenceIssues.length} incidencia(s) de evidencia</span>}
        </button>)}
      </nav>
      <div className="min-w-0">
        {selected === 'new' ? <ProductForm key="new" overview={data} onDirtyChange={v => setDirty('create', v)}
          onClose={() => { if (dirty.create && !confirmDiscard()) return; setDirty('create', false); setSelected(data.products[0]?.id ?? null); }}
          onSaved={p => { setDirty('create', false); setSelected(p.id); }} />
          : selected ? <ProductDetail key={selected} productId={selected} overview={data} dirty={dirty} setDirty={(k, v) => setDirty(k, v)} />
            : <div className="panel p-6 text-sm text-[#5f6b66]" data-testid="status-no-product-selected">Selecciona un producto para ver su ficha.</div>}
      </div>
    </div>
  </div>;
}

function CatalogCard({ catalog, data, dirty, setDirty }: { catalog: SoftwareCatalog; data: SoftwareOverview; dirty: boolean; setDirty: (v: boolean) => void }) {
  const client = useQueryClient();
  const update = useUpdateSoftwareCatalog();
  const [form, setForm] = useState<{ description: string; picProjectId: string; base: number } | null>(null);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const picName = data.picProjects.find(p => p.id === catalog.picProjectId)?.name;
  const open = () => { setError(null); setForm({ description: catalog.description, picProjectId: catalog.picProjectId ?? '', base: catalog.revision }); };
  const change = (patch: Partial<{ description: string; picProjectId: string }>) => { setForm(f => (f ? { ...f, ...patch } : f)); setDirty(true); };
  const close = () => { if (dirty && !confirmDiscard()) return; setDirty(false); setForm(null); };
  const submit = (e: FormEvent) => {
    e.preventDefault(); if (!form) return; setError(null);
    update.mutate({ data: { expectedRevision: form.base, description: form.description, picProjectId: form.picProjectId || null } }, {
      onSuccess: next => { client.setQueryData(getGetSoftwareProductsQueryKey(), next); setDirty(false); setForm(null); },
      onError: err => setError({ text: errorText(err), conflict: isRevisionConflict(err) }),
    });
  };
  const loadLatest = async () => {
    const latest = await getSoftwareProducts();
    const c = latest.catalog; if (!c || !form) return null;
    return { revision: c.revision, rows: [
      { label: 'Descripción', latest: c.description, mine: form.description },
      { label: 'Proyecto PIC', latest: latest.picProjects.find(p => p.id === c.picProjectId)?.name ?? '', mine: data.picProjects.find(p => p.id === form.picProjectId)?.name ?? '' },
    ] };
  };
  return <section className="panel p-4" data-testid="card-software-catalog">
    <div className="flex flex-wrap items-center gap-2">
      <Boxes size={18} className="text-[#174f49]" />
      <h3 className="text-base font-bold text-[#174f49]" data-testid="text-catalog-name">{catalog.name}</h3>
      <span className="products-mono">revisión {catalog.revision} · {data.schoolYear}</span>
      {data.canManage && !form && <button className="quiet-action ml-auto flex items-center gap-1.5" onClick={open} data-testid="button-edit-catalog"><Pencil size={14} />Editar</button>}
    </div>
    {!form ? <>
      <p className={`mt-2 whitespace-pre-wrap text-sm ${catalog.description ? 'text-[#34444a]' : 'italic text-[#8a948f]'}`} data-testid="text-catalog-description">{catalog.description || 'Sin descripción.'}</p>
      <p className="mt-1 text-xs text-[#5f6b66]" data-testid="text-catalog-pic-project">Proyecto PIC vinculado: {picName ?? (catalog.picProjectId ? <code className="products-mono">{catalog.picProjectId}</code> : 'ninguno')}</p>
    </> : <form className="products-form mt-3" onSubmit={submit} data-testid="form-catalog">
      <label className="products-field is-wide">Descripción<textarea value={form.description} maxLength={4000} onChange={e => change({ description: e.target.value })} data-testid="input-catalog-description" /></label>
      <label className="products-field is-wide">Proyecto PIC existente (opcional)<select value={form.picProjectId} onChange={e => change({ picProjectId: e.target.value })} data-testid="select-catalog-pic-project">
        <option value="">Sin vincular</option>{data.picProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <p className="is-wide text-[11px] text-[#5f6b66]">Vincular no selecciona el proyecto oficial del PIC ni modifica el límite de proyectos.</p>
      {error && !error.conflict && <p className="products-error is-wide" role="alert" data-testid="error-catalog">{error.text}</p>}
      {error?.conflict && <ConflictReview testPrefix="catalog" load={loadLatest} onAdopt={rev => { setForm(f => (f ? { ...f, base: rev } : f)); setError(null); }} />}
      <div className="is-wide flex justify-end gap-2">
        <button type="button" className="quiet-action" onClick={close} disabled={update.isPending} data-testid="button-cancel-catalog">Cancelar</button>
        <button type="submit" className="primary-action" disabled={update.isPending} data-testid="button-save-catalog">{update.isPending ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>}
  </section>;
}
