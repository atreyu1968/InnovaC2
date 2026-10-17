import type { PicPlanCenterProfile, PicPlanFamilyProfile } from "@workspace/api-client-react";

const LEVELS: PicPlanFamilyProfile["levels"] = [
  "FP Básica", "Grado Medio", "Grado Superior", "Cursos de especialización",
  "Ofertas parciales (Grados A, B, C, D)",
];

export function PicCenterFamilies({ center, families, onChange, disabled }: {
  center: PicPlanCenterProfile;
  families: string[];
  onChange: (center: PicPlanCenterProfile) => void;
  disabled: boolean;
}) {
  const rows = center.familyProfiles ?? [];
  const legacy = center.familyProfiles === undefined;
  const available = families.filter(family => !rows.some(row => row.professionalFamily === family));
  const updateRows = (familyProfiles: PicPlanFamilyProfile[]) => onChange({
    ...center, familyProfiles,
    groupCount: familyProfiles.reduce((sum, row) => sum + row.groupCount, 0),
    levels: LEVELS.filter(level => familyProfiles.some(row => row.levels.includes(level))),
  });
  const updateRow = (index: number, change: Partial<PicPlanFamilyProfile>) =>
    updateRows(rows.map((row, position) => position === index ? { ...row, ...change } : row));

  return <fieldset disabled={disabled} className="min-w-0 space-y-5">
    <label className="block text-xs font-semibold text-[#52615a]">
      Familia profesional de coordinación · campo oficial del PIC
      <select className="field mt-2" value={center.professionalFamily}
        onChange={event => onChange({ ...center, professionalFamily: event.target.value })}>
        <option value="">Selecciona una familia…</option>
        {families.map(family => <option key={family}>{family}</option>)}
      </select>
    </label>
    <p className="text-xs leading-relaxed text-[#68746e]">Registra cada familia una sola vez, con sus niveles y grupos del curso. Los totales se calculan automáticamente; no se obtienen de las cuentas de usuario ni de las actuaciones.</p>
    {legacy && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900" role="status">
      <p className="font-bold">Datos anteriores conservados, pendientes de desglosar</p>
      <p className="mt-2">{center.groupCount} grupos · {center.levels.join(", ") || "Sin niveles indicados"}. No se han atribuido automáticamente a ninguna familia. El desglose sustituirá estos totales cuando guardes el PIC.</p>
      {families.includes(center.professionalFamily) && <button type="button" className="quiet-action mt-3"
        onClick={() => updateRows([{ professionalFamily: center.professionalFamily, levels: [...center.levels], groupCount: center.groupCount }])}>
        Asignar estos datos a {center.professionalFamily}
      </button>}
    </div>}
    {rows.map((row, index) => <div key={index} className="space-y-4 rounded-lg border border-[#e4e7df] bg-[#fcfcf9] p-4" data-testid={`pic-family-row-${index}`}>
      <div className="grid items-end gap-4 md:grid-cols-[1fr_10rem_auto]">
        <label className="text-xs font-semibold text-[#52615a]">Familia profesional
          <select className="field mt-2" value={row.professionalFamily} onChange={event => updateRow(index, { professionalFamily: event.target.value })}>
            {families.filter(family => family === row.professionalFamily || available.includes(family)).map(family => <option key={family}>{family}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-[#52615a]">Número de grupos
          <input className="field mt-2" type="number" min={0} step={1} value={row.groupCount}
            onChange={event => {
              const count = Number(event.target.value);
              if (Number.isSafeInteger(count) && count >= 0) updateRow(index, { groupCount: count });
            }} />
        </label>
        <button type="button" className="quiet-action" aria-label={`Quitar ${row.professionalFamily}`}
          onClick={() => updateRows(rows.filter((_, position) => position !== index))}>Quitar familia</button>
      </div>
      <fieldset><legend className="mb-2 text-xs font-semibold text-[#52615a]">Niveles impartidos en esta familia</legend>
        <div className="grid gap-2 sm:grid-cols-2">{LEVELS.map(level => <label key={level} className="flex items-start gap-2 text-xs text-[#52615a]">
          <input type="checkbox" checked={row.levels.includes(level)} onChange={event => updateRow(index, {
            levels: event.target.checked ? [...row.levels, level] : row.levels.filter(item => item !== level),
          })} />{level}
        </label>)}</div>
      </fieldset>
    </div>)}
    <button type="button" className="quiet-action" disabled={!available.length}
      data-testid="button-add-pic-family" onClick={() => updateRows([...rows, { professionalFamily: available[0], levels: [], groupCount: 0 }])}>
      Añadir familia profesional
    </button>
    {!legacy && <div className="rounded-lg bg-[#eaf3ee] p-4 text-sm text-[#31594f]" aria-live="polite" data-testid="pic-center-totals">
      <p className="font-bold">Totales del centro · {rows.length} familias · {center.groupCount} grupos</p>
      <p className="mt-2 text-xs">Niveles: {center.levels.join(", ") || "Sin niveles indicados"}</p>
    </div>}
    <p className="text-xs text-[#68746e]">Los cambios del desglose se guardan con «Guardar PIC». Revisa que cada grupo se haya contabilizado en una sola familia.</p>
  </fieldset>;
}
