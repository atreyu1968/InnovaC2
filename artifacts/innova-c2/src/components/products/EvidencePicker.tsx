import { AlertTriangle } from 'lucide-react';
import type { SoftwareEvidence } from '@workspace/api-client-react';
import { shortHash } from './products-utils';

/** Multiselect over approved, clean evidence already in the centre library. No uploads here. */
export function EvidencePicker({ options, value, onChange, disabled, testPrefix }: { options: SoftwareEvidence[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; testPrefix: string }) {
  const known = new Set(options.map(o => o.versionId));
  const missing = value.filter(id => !known.has(id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  return <div className="grid gap-2" data-testid={`${testPrefix}-evidence-picker`}>
    {options.length === 0 && <p className="text-xs text-[#5f6b66]" data-testid={`${testPrefix}-evidence-empty`}>No hay evidencias aprobadas y limpias en la biblioteca del curso. Súbelas desde Actuaciones y evidencias.</p>}
    <div className="products-evidence">
      {options.map(o => <label key={o.versionId} data-testid={`${testPrefix}-evidence-option-${o.versionId}`}>
        <input type="checkbox" checked={value.includes(o.versionId)} disabled={disabled || (!o.available && !value.includes(o.versionId))} onChange={() => toggle(o.versionId)} data-testid={`${testPrefix}-checkbox-evidence-${o.versionId}`} />
        <span className="min-w-0"><span className="block font-semibold">{o.title} <span className="text-[#5f6b66]">v{o.versionNumber}</span></span>
          <code>sha256 {shortHash(o.sha256)}</code>
          {!o.available && <span className="block text-[#9b4337]">No disponible{o.issue ? `: ${o.issue}` : ''}</span>}</span>
      </label>)}
    </div>
    {missing.length > 0 && <p className="products-problems flex gap-2" data-testid={`${testPrefix}-evidence-missing`}><AlertTriangle size={14} className="shrink-0" />{missing.length} evidencia(s) seleccionada(s) ya no figuran entre las disponibles. Quítalas o el servidor rechazará el guardado.
      <button type="button" className="quiet-action ml-auto" onClick={() => onChange(value.filter(id => known.has(id)))} data-testid={`${testPrefix}-button-remove-missing-evidence`}>Quitar</button></p>}
  </div>;
}

export function EvidenceList({ items, testPrefix }: { items: SoftwareEvidence[]; testPrefix: string }) {
  if (items.length === 0) return <p className="text-xs italic text-[#8a948f]" data-testid={`${testPrefix}-evidence-none`}>Sin evidencias vinculadas.</p>;
  return <ul className="grid gap-1" data-testid={`${testPrefix}-evidence-list`}>
    {items.map(e => <li key={e.versionId} className="text-xs" data-testid={`${testPrefix}-evidence-${e.versionId}`}>
      <span className="font-semibold">{e.title}</span> · versión {e.versionNumber} · <code className="products-mono">sha256 {shortHash(e.sha256)}</code>
      <span className="block products-mono">ref. documento {e.documentId}</span>
      {!e.available && <span className="block text-[#9b4337]" data-testid={`${testPrefix}-evidence-unavailable-${e.versionId}`}><AlertTriangle size={12} className="mr-1 inline" />No disponible{e.issue ? `: ${e.issue}` : ''}</span>}
    </li>)}
  </ul>;
}
