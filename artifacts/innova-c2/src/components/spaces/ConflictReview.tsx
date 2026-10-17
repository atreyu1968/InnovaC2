import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { errorText } from './spaces-utils';

export type ConflictRow = { label: string; latest: string; mine: string };
export type ConflictSnapshot = { revision: number; rows: ConflictRow[] } | null;

/** Explicit recovery for server revision conflicts: never auto-saves or merges. */
export function ConflictReview({ testPrefix, load, onAdopt }: { testPrefix: string; load: () => Promise<ConflictSnapshot>; onAdopt: (revision: number) => void }) {
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'error' | 'missing' | 'ready'; snap?: ConflictSnapshot; error?: string }>({ status: 'idle' });
  const review = async () => {
    setState({ status: 'loading' });
    try { const snap = await load(); setState(snap ? { status: 'ready', snap } : { status: 'missing' }); }
    catch (e) { setState({ status: 'error', error: errorText(e) }); }
  };
  const snap = state.snap;
  return <div className="spaces-conflict is-wide" data-testid={`${testPrefix}-conflict`}>
    <p className="flex items-start gap-2 text-xs font-semibold text-[#8a4a24]"><AlertTriangle size={14} className="mt-0.5 shrink-0" />Otra sesión guardó este registro antes. No se ha guardado nada. Revisa la versión actual antes de decidir.</p>
    <button type="button" className="quiet-action mt-2 flex items-center gap-1.5" onClick={review} disabled={state.status === 'loading'} data-testid={`${testPrefix}-button-review-latest`}><RefreshCw size={14} className={state.status === 'loading' ? 'animate-spin' : ''} />{state.status === 'loading' ? 'Cargando versión actual…' : 'Revisar versión actual'}</button>
    {state.status === 'error' && <p className="mt-2 text-xs text-[#9b4337]" role="alert" data-testid={`${testPrefix}-conflict-load-error`}>No se ha podido cargar la versión actual: {state.error}</p>}
    {state.status === 'missing' && <p className="mt-2 text-xs text-[#9b4337]" data-testid={`${testPrefix}-conflict-missing`}>El registro ya no está disponible en el curso actual.</p>}
    {state.status === 'ready' && snap && <div className="mt-2" data-testid={`${testPrefix}-conflict-latest`}>
      <p className="text-xs text-[#34444a]">Versión guardada actual: <strong data-testid={`${testPrefix}-conflict-revision`}>revisión {snap.revision}</strong>. Campos distintos de lo que has escrito:</p>
      {snap.rows.filter(r => r.latest !== r.mine).length === 0 ? <p className="mt-1 text-xs text-[#5f6b66]">Sin diferencias en los campos.</p> :
        <dl className="spaces-conflict-diff">{snap.rows.filter(r => r.latest !== r.mine).map(r => <div key={r.label} className="contents"><dt>{r.label}</dt><dd><span className="block"><em>Guardado:</em> {r.latest || '—'}</span><span className="block"><em>Tu texto:</em> {r.mine || '—'}</span></dd></div>)}</dl>}
      <button type="button" className="primary-action mt-2" onClick={() => onAdopt(snap.revision)} data-testid={`${testPrefix}-button-adopt-revision`}>Mantener mis valores sobre la revisión {snap.revision}</button>
      <p className="mt-1 text-[10px] text-[#6f7974]">Tus valores no se guardan hasta que pulses Guardar.</p>
    </div>}
  </div>;
}
