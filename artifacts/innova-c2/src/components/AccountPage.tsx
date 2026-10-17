import { useState, type FormEvent } from 'react';
import { useChangePassword, type User } from '@workspace/api-client-react';

export function AccountPage({ user }: { user: User }) {
  const change = useChangePassword();
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (change.isPending) return;
    setError('');
    setResult('');
    const element = event.currentTarget;
    const form = new FormData(element);
    const currentPassword = String(form.get('currentPassword'));
    const password = String(form.get('password'));
    if (password !== String(form.get('confirmation'))) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }
    if (password === currentPassword) {
      setError('La contraseña nueva debe ser diferente de la actual.');
      return;
    }
    change.mutate({ data: { currentPassword, password } }, {
      onSuccess: response => {
        element.reset();
        setResult(response.noticeSent
          ? 'Contraseña actualizada. Se han cerrado las demás sesiones y se ha enviado un aviso a tu correo.'
          : 'Contraseña actualizada y demás sesiones cerradas. No se pudo enviar el aviso por correo; contacta con la administración del centro.');
      },
      onError: issue => setError(issue instanceof Error ? issue.message : 'No se ha podido cambiar la contraseña. Inténtalo de nuevo.'),
    });
  };

  return <section className="panel max-w-2xl p-5 md:p-7">
    <p className="eyebrow">Seguridad de la cuenta</p>
    <h2 className="mt-2 text-xl font-bold text-[#26383d]">Cambiar contraseña</h2>
    <p className="mt-2 text-sm text-[#6e7974]">{user.name} · {user.email}</p>
    <p className="mt-3 text-sm leading-relaxed text-[#6e7974]">
      Usa entre 12 y 1024 caracteres. Al guardar, se cerrarán las demás sesiones y se anularán los enlaces de recuperación pendientes. Esta sesión seguirá abierta.
    </p>
    <form onSubmit={submit} className="mt-6 space-y-4" aria-label="Cambiar contraseña">
      <fieldset disabled={change.isPending} className="space-y-4">
        {([
          ['currentPassword', 'Contraseña actual', 'current-password', 1],
          ['password', 'Contraseña nueva', 'new-password', 12],
          ['confirmation', 'Repite la contraseña nueva', 'new-password', 12],
        ] as const).map(([name, label, autocomplete, minLength]) =>
          <div className="space-y-1.5" key={name}>
            <label htmlFor={`account-${name}`} className="block text-xs font-semibold text-[#43534f]">{label}</label>
            <input id={`account-${name}`} name={name} type="password" className="field" required
              minLength={minLength} maxLength={1024} autoComplete={autocomplete} data-testid={`input-account-${name}`} />
          </div>)}
        <button type="submit" className="primary-action" data-testid="button-change-password">
          {change.isPending ? 'Actualizando contraseña…' : 'Guardar contraseña nueva'}
        </button>
      </fieldset>
      {error && <p role="alert" className="rounded-md bg-[#fae9e5] p-3 text-sm text-[#923f36]">{error}</p>}
      {result && <p role="status" className="rounded-md bg-[#e8f3eb] p-3 text-sm text-[#2c7055]" data-testid="status-password-changed">{result}</p>}
    </form>
  </section>;
}
