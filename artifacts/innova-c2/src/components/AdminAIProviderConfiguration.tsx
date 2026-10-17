import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound, Save, ShieldCheck } from "lucide-react";
import {
  getGetAdminAIProviderSettingsQueryKey,
  useGetAdminAIProviderSettings,
  useUpdateAdminAIProviderSettings,
} from "@workspace/api-client-react";

type ProviderMode = "disabled" | "local" | "external_authorized";

function message(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo guardar la configuración de IA.";
}

export function AdminAIProviderConfiguration() {
  const settings = useGetAdminAIProviderSettings({
    query: { queryKey: getGetAdminAIProviderSettingsQueryKey(), retry: false },
  });
  const update = useUpdateAdminAIProviderSettings();
  const [provider, setProvider] = useState<ProviderMode>("disabled");
  const [baseUrl, setBaseUrl] = useState("");
  const [transcriptionModel, setTranscriptionModel] = useState("");
  const [minutesModel, setMinutesModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [externalAuthorizationConfirmed, setExternalAuthorizationConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!settings.data) return;
    setProvider(settings.data.provider);
    setBaseUrl(settings.data.baseUrl ?? "");
    setTranscriptionModel(settings.data.transcriptionModel ?? "");
    setMinutesModel(settings.data.minutesModel ?? "");
    setExternalAuthorizationConfirmed(false);
  }, [settings.data]);

  function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settings.data) return;
    setError("");
    setNotice("");
    update.mutate({
      data: {
        expectedRevision: settings.data.revision,
        provider,
        baseUrl,
        transcriptionModel,
        minutesModel,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        clearApiKey,
        externalAuthorizationConfirmed,
      },
    }, {
      onSuccess: () => {
        setApiKey("");
        setClearApiKey(false);
        setExternalAuthorizationConfirmed(false);
        setNotice("Configuración de IA guardada. El audio original no se conserva tras procesarlo.");
        void settings.refetch();
      },
      onError: (e) => setError(message(e)),
    });
  }

  return <section className="panel p-5 md:p-7" data-testid="ai-provider-configuration">
    <div className="flex items-start gap-3">
      <div className="rounded-xl bg-teal-50 p-3 text-teal-800"><KeyRound size={22} /></div>
      <div>
        <h2 className="text-lg font-bold text-[#20393b]">Asistente de IA y actas de reuniones</h2>
        <p className="mt-1 max-w-3xl text-sm text-[#637475]">La IA usa únicamente el proveedor configurado aquí. Las claves se cifran en el servidor y nunca se devuelven a la pantalla.</p>
      </div>
    </div>

    {settings.isLoading && <p className="mt-5 text-sm text-slate-600">Cargando configuración del proveedor…</p>}
    {settings.isError && <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">No se pudo consultar la configuración de IA. {message(settings.error)} <button className="underline" onClick={() => settings.refetch()}>Reintentar</button></div>}
    {error && <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="mt-5 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{notice}</div>}

    {settings.data && <form className="mt-5 space-y-4" onSubmit={saveSettings}>
      <label className="grid gap-1 text-sm">
        Proveedor
        <select value={provider} onChange={(event) => setProvider(event.target.value as ProviderMode)}>
          <option value="disabled">Desactivado</option>
          <option value="local">API local del centro</option>
          <option value="external_authorized">API externa autorizada</option>
        </select>
      </label>

      {provider !== "disabled" && <>
        <label className="grid gap-1 text-sm">
          Endpoint base compatible con OpenAI
          <input required type="url" maxLength={2048} placeholder="http://ollama:11434/v1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          <span className="text-xs text-slate-500">Debe ofrecer /audio/transcriptions y /chat/completions. En modo local solo se admiten hosts locales o de red privada; en modo externo se exige HTTPS.</span>
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">Modelo de transcripción
            <input required maxLength={160} value={transcriptionModel} onChange={(event) => setTranscriptionModel(event.target.value)} placeholder="Nombre exacto del modelo" />
          </label>
          <label className="grid gap-1 text-sm">Modelo para redactar actas
            <input required maxLength={160} value={minutesModel} onChange={(event) => setMinutesModel(event.target.value)} placeholder="Nombre exacto del modelo" />
          </label>
        </div>
      </>}

      <label className="grid gap-1 text-sm">
        Clave de la API <span className="text-xs text-slate-500">{settings.data.apiKeyConfigured ? "Ya hay una clave guardada; déjala vacía para conservarla." : "No hay una clave guardada. Es opcional para proveedores locales."}</span>
        <input type="password" autoComplete="new-password" maxLength={4096} value={apiKey} onChange={(event) => { setApiKey(event.target.value); if (event.target.value) setClearApiKey(false); }} placeholder={settings.data.apiKeyConfigured ? "Clave guardada (valor oculto)" : "Pega la clave solo en esta pantalla"} />
      </label>
      {settings.data.apiKeyConfigured && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={clearApiKey} onChange={(event) => { setClearApiKey(event.target.checked); if (event.target.checked) setApiKey(""); }} />
        Eliminar la clave guardada
      </label>}

      {provider === "external_authorized" && <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <input className="mt-1" required type="checkbox" checked={externalAuthorizationConfirmed} onChange={(event) => setExternalAuthorizationConfirmed(event.target.checked)} />
        <span>Confirmo que el centro ha autorizado el tratamiento de estas grabaciones con este proveedor externo conforme a sus obligaciones de protección de datos.</span>
      </label>}

      <div className="flex flex-wrap items-center gap-3">
        <button className="primary-action" type="submit" disabled={update.isPending}>
          <Save size={15} />{update.isPending ? "Guardando…" : "Guardar proveedor de IA"}
        </button>
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          {settings.data.apiKeyConfigured ? <CheckCircle2 size={14} className="text-green-700" /> : <ShieldCheck size={14} />}
          {settings.data.apiKeyConfigured ? "Credencial almacenada cifrada" : "Sin credencial guardada"}
          {" · revisión "}{settings.data.revision}
        </span>
      </div>
    </form>}

    <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
      La grabación requiere consentimiento explícito. Se procesa en memoria, no se guarda el audio original y se conservan la transcripción y el borrador para revisión humana. El modo externo solo se activa tras la confirmación expresa.
    </p>
  </section>;
}
