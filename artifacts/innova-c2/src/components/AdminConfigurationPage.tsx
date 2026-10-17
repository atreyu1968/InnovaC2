import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, CircleAlert, RefreshCw, Save, ShieldCheck } from "lucide-react";
import {
  getGetAdminMailSettingsQueryKey, useGetAdminMailSettings,
  useUpdateAdminMailSettings, useVerifyAdminMailProvider,
} from "@workspace/api-client-react";
import { AdminAIProviderConfiguration } from "./AdminAIProviderConfiguration";

type SenderAlias = "innovacion" | "ciclope" | "proyectos";
function describeError(error: unknown) {
  return error instanceof Error ? error.message : "No se completó la configuración.";
}

export function AdminConfigurationPage() {
  const status = useGetAdminMailSettings({ query: { queryKey: getGetAdminMailSettingsQueryKey(), retry: false } });
  const verify = useVerifyAdminMailProvider();
  const save = useUpdateAdminMailSettings();
  const [sendEnabled, setSendEnabled] = useState(false);
  const [senderAlias, setSenderAlias] = useState<SenderAlias>("innovacion");
  const [replyTo, setReplyTo] = useState("innovacion@buzon.iesmmg.org");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!status.data) return;
    setSendEnabled(status.data.settings.sendEnabled);
    setSenderAlias(status.data.settings.senderAlias);
    setReplyTo(status.data.settings.replyTo);
  }, [status.data]);

  function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!status.data) return;
    setError(""); setNotice("");
    save.mutate({ data: {
      expectedRevision: status.data.settings.revision,
      sendEnabled, senderAlias, replyTo,
    } }, {
      onSuccess: () => { setNotice("Configuración guardada. La política de aprobación humana sigue activa."); void status.refetch(); },
      onError: e => setError(describeError(e)),
    });
  }
  function verifyDomain() {
    setError(""); setNotice("");
    verify.mutate(undefined, {
      onSuccess: result => {
        setNotice(result.dns.ready && result.provider.domainVerified
          ? "DNS público y dominio de Resend verificados. El envío sigue sujeto a la activación explícita del servidor."
          : "La comprobación ha terminado; falta completar DNS público o la verificación de Resend. El envío permanece desactivado.");
        void status.refetch();
      },
      onError: e => setError(describeError(e)),
    });
  }

  if (status.isLoading) return <main className="fade-up space-y-5"><section className="panel p-8">Cargando configuración de correo…</section><AdminAIProviderConfiguration /></main>;
  if (!status.data || status.isError) return <main className="fade-up space-y-5"><section className="panel p-8"><h1 className="text-xl font-bold">Configuración técnica</h1><p className="mt-2 text-sm">No se pudo obtener la configuración de correo. {describeError(status.error)}</p><button className="quiet-action mt-4" onClick={() => status.refetch()}>Reintentar</button></section><AdminAIProviderConfiguration /></main>;
  const provider = status.data.provider;
  const records = status.data.domainRecords ?? [];
  const dns = status.data.dns;
  return <main className="fade-up space-y-5" data-testid="technical-configuration-page">
    <header><p className="eyebrow">Administración técnica</p><h1 className="text-2xl font-bold text-[#20393b]">Configuración del centro</h1><p className="mt-1 text-sm text-[#637475]">Resend se gestiona aquí, dentro de la configuración existente. Las claves privadas permanecen exclusivamente en el servidor.</p></header>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{notice}</div>}
    <section className="panel p-5 md:p-7">
      <div className="flex items-start gap-3"><div className="rounded-xl bg-teal-50 p-3 text-teal-800"><ShieldCheck size={22} /></div><div><h2 className="text-lg font-bold">Correo institucional · Resend</h2><p className="mt-1 text-sm text-slate-600">La consulta de estado es de solo lectura: no escribe DNS ni modifica el MX del dominio raíz.</p></div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border p-4"><p className="text-xs text-slate-500">Clave privada en el servidor</p><p className="mt-1 font-semibold">{provider.keyConfigured ? "Configurada (valor oculto)" : "No configurada"}</p></div>
        <div className="rounded-lg border p-4"><p className="text-xs text-slate-500">Secreto del webhook</p><p className="mt-1 font-semibold">{provider.webhookConfigured ? "Configurado (valor oculto)" : "No configurado"}</p></div>
        <div className="rounded-lg border p-4"><p className="text-xs text-slate-500">Interruptor de despliegue</p><p className="mt-1 font-semibold">{provider.deploymentEnabled ? "Habilitado por el servidor" : "Deshabilitado por el servidor"}</p></div>
         <div className="rounded-lg border p-4"><p className="text-xs text-slate-500">Activación institucional explícita</p><p className="mt-1 font-semibold">{provider.activationConfirmed ? "Confirmada en el servidor" : "No confirmada"}</p></div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
         <button className="quiet-action" onClick={verifyDomain} disabled={verify.isPending}><RefreshCw size={15} />{verify.isPending ? "Consultando DNS…" : "Comprobar DNS y Resend"}</button>
        <span className="inline-flex items-center gap-1 text-sm">{status.data.lastDomainStatus === "verified" ? <CheckCircle2 size={16} className="text-green-700" /> : <CircleAlert size={16} className="text-amber-700" />}iesmmg.org · {status.data.lastDomainStatus || "pendiente de comprobar"}</span>
        {status.data.lastDomainCheck && <span className="text-xs text-slate-500">Consultado {new Date(status.data.lastDomainCheck).toLocaleString()}</span>}
      </div>
       <div className="mt-4 grid gap-3 rounded-lg border bg-slate-50 p-4 text-sm sm:grid-cols-2">
         <div><p className="text-xs text-slate-500">SPF en iesmmg.org / send.iesmmg.org</p><p className="mt-1 font-medium">{dns.spf}</p></div>
         <div><p className="text-xs text-slate-500">DKIM · resend._domainkey.iesmmg.org</p><p className="mt-1 font-medium">{dns.dkim}</p></div>
         <div><p className="text-xs text-slate-500">DMARC · _dmarc.iesmmg.org</p><p className="mt-1 font-medium">{dns.dmarc}</p></div>
         <div><p className="text-xs text-slate-500">MX de recepción · buzon.iesmmg.org</p><p className="mt-1 break-all font-medium">{dns.inboundMx.join(", ") || "Sin registros"}</p></div>
         <div className="sm:col-span-2"><p className="text-xs text-slate-500">MX del dominio raíz · iesmmg.org</p><p className="mt-1 break-all font-medium">{dns.rootMx.join(", ") || "Sin registros MX raíz"}</p><p className="mt-1 text-xs text-slate-500">Solo lectura; esta comprobación no cambia ni recomienda sustituir el MX raíz. Consulta realizada {new Date(dns.checkedAt).toLocaleString()}.</p></div>
       </div>
      {records.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[600px] text-left text-xs"><thead><tr><th className="p-2">Tipo</th><th className="p-2">Nombre exacto</th><th className="p-2">Valor indicado por Resend</th><th className="p-2">Estado</th></tr></thead><tbody>{records.map((record,index) => <tr className="border-t" key={`${record.type}-${record.name}-${index}`}><td className="p-2">{record.type}</td><td className="break-all p-2">{record.name}</td><td className="break-all p-2">{record.value}</td><td className="p-2">{record.status}</td></tr>)}</tbody></table><p className="mt-2 text-xs text-slate-500">Añade estos registros en el DNS de iesmmg.org. No cambies su MX raíz; la recepción se prepara en el subdominio buzon.iesmmg.org.</p></div>}
    </section>
    <form onSubmit={saveSettings} className="panel space-y-4 p-5 md:p-7">
       <div><h2 className="text-lg font-bold">Ajustes de envío del centro</h2><p className="mt-1 text-sm text-slate-600">El envío requiere clave de Resend, DNS completo, dominio verificado y dos interruptores del servidor, incluido el de activación institucional. Todos los mensajes siguen requiriendo aprobación humana.</p></div>
      <label className="flex items-start gap-3 rounded-lg border p-4"><input className="mt-1" type="checkbox" checked={sendEnabled} onChange={e => setSendEnabled(e.target.checked)} /><span><strong className="block text-sm">Permitir procesar la cola de envíos</strong><span className="text-xs text-slate-600">Por defecto está desactivado; guardar esta opción no sustituye la autorización del servidor.</span></span></label>
      <div className="grid gap-3 md:grid-cols-2"><label className="grid gap-1 text-sm">Alias remitente<select value={senderAlias} onChange={e => setSenderAlias(e.target.value as SenderAlias)}><option value="innovacion">innovacion@iesmmg.org</option><option value="ciclope">ciclope@iesmmg.org</option><option value="proyectos">proyectos@iesmmg.org</option></select></label>
        <label className="grid gap-1 text-sm">Dirección Reply-To<input required maxLength={250} type="email" pattern="^[a-z][a-z0-9._-]{0,40}@buzon\.iesmmg\.org$" value={replyTo} onChange={e => setReplyTo(e.target.value)} /><span className="text-xs text-slate-500">Dominio de recepción: buzon.iesmmg.org</span></label>
      </div>
      <div className="flex flex-wrap items-center gap-3"><button className="primary-action" disabled={save.isPending}><Save size={15} />{save.isPending ? "Guardando…" : "Guardar configuración"}</button><span className="text-xs text-slate-500">Revisión {status.data.settings.revision} · aprobación obligatoria</span></div>
    </form>
     <section className="rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600"><strong>Para una instalación independiente:</strong> configura las variables privadas RESEND_API_KEY, RESEND_WEBHOOK_SECRET, EMAIL_ENABLED y EMAIL_ACTIVATION_CONFIRMED en el almacén seguro del servidor Ubuntu; no se muestran ni se guardan en esta pantalla. La verificación DNS es de solo lectura. La bandeja local funciona sin proveedor.</section>
    <AdminAIProviderConfiguration />
  </main>;
}
