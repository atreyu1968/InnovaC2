import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListStaffOptionsQueryKey, getListUsersQueryKey, useUpdateUserFamily,
  type User,
} from "@workspace/api-client-react";

export function UserFamilyAssignment({ person, families }: { person: User; families: string[] }) {
  const client = useQueryClient();
  const mutation = useUpdateUserFamily();
  const [family, setFamily] = useState(person.professionalFamily ?? "");
  const required = ["profesorado", "jefatura_departamento", "coordinacion_red"].includes(person.role);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({
      userId: person.id,
      data: { professionalFamily: family || null, expectedFamily: person.professionalFamily ?? null },
    }, {
      onSuccess: updated => {
        client.setQueryData<User[]>(getListUsersQueryKey(), old => old?.map(item => item.id === updated.id ? updated : item));
        void client.invalidateQueries({ queryKey: getListStaffOptionsQueryKey() });
      },
    });
  };
  return <form onSubmit={submit} className="flex max-w-64 flex-col gap-1">
    <select aria-label={`Familia de ${person.name}`} className="field text-xs" value={family}
      onChange={event => setFamily(event.target.value)} required={required} disabled={mutation.isPending || !families.length}>
      <option value="">Sin asignar</option>
      {families.map(item => <option key={item} value={item}>{item}</option>)}
    </select>
    {family !== (person.professionalFamily ?? "") && <>
      <small className="text-[10px] text-[#6f7974]">Cambiarla modifica el acceso a documentos compartidos.</small>
      <button className="quiet-action" disabled={mutation.isPending} type="submit">{mutation.isPending ? "Guardando…" : "Guardar familia"}</button>
    </>}
    {mutation.isError && <span role="alert" className="text-[10px] text-[#9b4337]">{mutation.error instanceof Error ? mutation.error.message : "No se pudo guardar la familia."}</span>}
  </form>;
}
