import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound, Save, ShieldCheck } from "lucide-react";
import {
  getGetAdminAIProviderSettingsQueryKey,
  useGetAdminAIProviderSettings,
  useUpdateAdminAIProviderSettings,
  useCheckAdminAIProvider,
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
  const check = useCheckAdminAIProvider();
  const [confirmCheck, setConfirmCheck] = useState(false);
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
    setConfirmCheck(false);
    check.reset();
  }, [settings.data]);

  const unsaved = Boolean(settings.data && (
    provider !== settings.data.provider || baseUrl !== (settings.data.baseUrl ?? "") ||
    transcriptionModel !== (settings.data.transcriptionModel ?? "") ||
    minutesModel !== (settings.data.minutesModel ?? "") || apiKey || clearApiKey
  ));

  function runCheck() {
    if (!settings.data || unsaved) return;
    setConfirmCheck(false);
    check.mutate({ data: { expectedRevision: settings.data.revision, syntheticSampleConfirmed: true } });
  }

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

  return <section className="panel min-w-0 break-words p-5 md:p-7 [&_input:not([type=checkbox])]:min-w-0 [&_input:not([type=checkbox])]:max-w-full [&_select]:min-w-0 [&_select]:max-w-full" data-testid="ai-provider-configuration">
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
        <button className="primary-action" type="submit" disabled={update.isPending || check.isPending}>
          <Save size={15} />{update.isPending ? "Guardando…" : "Guardar proveedor de IA"}
        </button>
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          {settings.data.apiKeyConfigured ? <CheckCircle2 size={14} className="text-green-700" /> : <ShieldCheck size={14} />}
          {settings.data.apiKeyConfigured ? "Credencial almacenada cifrada" : "Sin credencial guardada"}
          {" · revisión "}{settings.data.revision}
        </span>
      </div>
    </form>}

    {settings.data && <div className="mt-5 space-y-3 border-t border-slate-200 pt-5">
      <h3 className="font-semibold text-[#20393b]">Comprobar conexión con la IA</h3>
      <p className="text-sm text-slate-600">Comprueba conexión, autenticación y compatibilidad de los dos modelos guardados. No modifica la configuración ni guarda audio, transcripciones o actas.</p>
      {settings.data.provider === "disabled" && <p className="text-sm text-slate-600">Activa y guarda un proveedor para comprobarlo.</p>}
      {unsaved && <p className="text-sm text-amber-800">Guarda o descarta los cambios del formulario antes de comprobar la configuración guardada.</p>}
      <button type="button" className="secondary-action" disabled={settings.data.provider === "disabled" || unsaved || update.isPending || check.isPending} onClick={() => { check.reset(); setConfirmCheck(true); }}>
        {check.isPending ? "Comprobando los dos modelos…" : "Comprobar proveedor guardado"}
      </button>
      {confirmCheck && !unsaved && <div role="alertdialog" aria-labelledby="ai-check-title" aria-describedby="ai-check-description" className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h4 id="ai-check-title" className="font-semibold">Confirmar envío de muestras sintéticas</h4>
        <p id="ai-check-description" className="mt-2 text-sm">Se enviarán un tono de audio sintético de un segundo (sin voz) y un texto ficticio al proveedor {settings.data.provider === "local" ? "local" : "externo autorizado"} guardado. Nunca se usan reuniones reales. Puede generar consumo o costes; el proveedor aplica sus propias políticas de tratamiento.</p>
        <dl className="my-3 text-sm">
          <dt className="font-semibold">Endpoint guardado</dt><dd>{settings.data.baseUrl}</dd>
          <dt className="font-semibold">Transcripción</dt><dd>{settings.data.transcriptionModel}</dd>
          <dt className="font-semibold">Redacción</dt><dd>{settings.data.minutesModel}</dd>
        </dl>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="primary-action" disabled={update.isPending || check.isPending} onClick={runCheck}>Confirmar y enviar muestras</button>
          <button type="button" className="secondary-action" onClick={() => setConfirmCheck(false)}>Cancelar</button>
        </div>
      </div>}
      {check.isPending && <p role="status" className="text-sm text-slate-600">Esperando al proveedor; cada modelo tiene un límite de 20 segundos.</p>}
      {check.isError && <p role="alert" className="text-sm text-red-800">No se pudo completar la comprobación. {message(check.error)}</p>}
      {check.data && <div role="status" className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
        <p className="font-semibold">Resultado de la revisión {check.data.revision} · {new Date(check.data.checkedAt).toLocaleString("es-ES")}</p>
        <p className={check.data.transcription.status === "ok" ? "text-teal-900" : "text-red-800"}><strong>Transcripción: </strong>{check.data.transcription.message}</p>
        <p className={check.data.minutes.status === "ok" ? "text-teal-900" : "text-red-800"}><strong>Redacción: </strong>{check.data.minutes.message}</p>
        <p>Esta prueba no evalúa la calidad del resultado ni garantiza futuras solicitudes. Un tono sin voz puede producir una transcripción vacía. Las actas reales siempre requieren revisión humana.</p>
        {unsaved && <p className="text-amber-800">Este resultado corresponde a la configuración guardada, no a los cambios sin guardar.</p>}
      </div>}
    </div>}

    <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
      La grabación requiere consentimiento explícito. Se procesa en memoria, no se guarda el audio original y se conservan la transcripción y el borrador para revisión humana. El modo externo solo se activa tras la confirmación expresa.
    </p>
  </section>;
}
