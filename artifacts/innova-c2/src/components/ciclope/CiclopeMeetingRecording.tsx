import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square, Upload, WandSparkles } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { type AudioSource, getPending, isActive, isProcessing, pendingGeneration, pendingKey, registerActive, setPending, setProcessing, stopActive, subscribe } from "./ciclopePendingAudio";

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
type Source = AudioSource;

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Permiso denegado o compartición cancelada. No se ha grabado nada.";
  return error instanceof Error ? error.message : "No se pudo procesar el audio.";
}
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

export function CiclopeMeetingRecording({
  meetingId,
  userId,
  currentNotes,
  canProcess,
  expectedRevision,
  onDone,
}: {
  meetingId: string;
  userId: string;
  meetingTitle?: string;
  meetingStartsAt?: string;
  currentNotes: string;
  canProcess: boolean;
  expectedRevision: number;
  onDone: () => Promise<void>;
}) {
  const key = pendingKey(userId, meetingId);
  const stored = useSyncExternalStore(subscribe, () => getPending(key));
  const recording = useSyncExternalStore(subscribe, () => isActive(key));
  const [source, setSource] = useState<Source>(stored?.source ?? "in_person");
  const [withMic, setWithMic] = useState(true);
  const [starting, setStarting] = useState(false);
  const [consent, setConsent] = useState(false);
  const [replaceDraft, setReplaceDraft] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const busy = useSyncExternalStore(subscribe, () => isProcessing(key));
  const setBusy = (value: boolean) => setProcessing(key, value);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const startedAtRef = useRef(0);
  const mountedRef = useRef(true);

  const audio = stored?.blob ?? null;
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    const url = audio ? URL.createObjectURL(audio) : "";
    setPreviewUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [audio]);

  useEffect(() => {
    if (!recording) return;
    if (!startedAtRef.current) startedAtRef.current = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  // On unmount (navigation / meeting switch) stop safely; the onstop handler stores the completed Blob in memory.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; stopActive(key); };
  }, [key]);

  const safe = (fn: () => void) => { if (mountedRef.current) fn(); };
  const confirmLoss = (what: string) => !audio || window.confirm(`Hay audio pendiente (${mb(audio.size)} MB) que solo existe en este navegador. ¿${what}? Se perderá definitivamente.`);

  async function startRecording() {
    if (starting || recording || busy) return;
    setError(""); setNotice("");
    if (!consent) { setError("Confirma primero que las personas participantes han sido informadas y han consentido."); return; }
    if (!navigator.mediaDevices || typeof MediaRecorder === "undefined") { setError("Este navegador no permite grabar aquí. Puedes subir una grabación de audio existente."); return; }
    if (!confirmLoss("Iniciar una nueva grabación y sustituirlo")) return;
    setStarting(true);
    const tracks: MediaStreamTrack[] = [];
    const generation = pendingGeneration(key);
    const stillCurrent = () => mountedRef.current && pendingGeneration(key) === generation;
    let ctx: AudioContext | null = null;
    const cleanup = () => {
      tracks.forEach((t) => t.stop());
      if (ctx && ctx.state !== "closed") void ctx.close();
      ctx = null;
    };
    try {
      let recordStream: MediaStream;
      const recSource = source;
      if (recSource === "online") {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        tracks.push(...display.getTracks());
        if (!stillCurrent()) { cleanup(); return; }
        if (!display.getAudioTracks().length) {
          throw new Error("La pestaña compartida no aporta audio. Vuelve a compartir eligiendo «Pestaña de Chrome» y activa «Compartir también el audio de la pestaña». Si no es posible, graba con la opción presencial o sube un archivo de audio.");
        }
        let mic: MediaStream | null = null;
        if (withMic) {
          try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); tracks.push(...mic.getTracks()); }
          catch { safe(() => setNotice("No se pudo usar tu micrófono; se grabará solo el audio de la pestaña.")); }
        }
        if (!stillCurrent()) { cleanup(); return; }
        ctx = new AudioContext();
        await ctx.resume();
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
        if (mic) ctx.createMediaStreamSource(mic).connect(dest);
        recordStream = dest.stream; // audio only, video bytes are never recorded
        tracks.push(...dest.stream.getTracks());
      } else {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        tracks.push(...mic.getTracks());
        recordStream = new MediaStream(mic.getAudioTracks());
      }
      if (!stillCurrent()) { cleanup(); return; }
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((v) => MediaRecorder.isTypeSupported(v));
      const recorder = mime ? new MediaRecorder(recordStream, { mimeType: mime }) : new MediaRecorder(recordStream);
      const chunks: Blob[] = [];
      let bytes = 0;
      const stop = () => { if (recorder.state !== "inactive") recorder.stop(); else cleanup(); };
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        bytes += event.data.size;
        if (bytes > MAX_AUDIO_BYTES) {
          safe(() => setError("La grabación alcanzó el límite de 50 MB y se ha detenido. Se conserva el fragmento anterior al límite; inicia otro fragmento para continuar la reunión."));
          stop();
          return;
        }
        chunks.push(event.data);
      };
      recorder.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        chunks.length = 0;
        if (blob.size > 0) {
          setPending(key, { blob, fileName: "Grabación de la reunión", source: recSource }, generation);
          safe(() => setNotice(`Audio preparado (${mb(blob.size)} MB). Solo está en este navegador; no se ha enviado todavía.`));
        }
        if (pendingGeneration(key) === generation) registerActive(key, null);
        startedAtRef.current = 0;
      };
      recorder.onerror = () => { safe(() => setError("Error del grabador. Se conserva lo grabado hasta ahora si es posible.")); stop(); };
      tracks.forEach((t) => t.addEventListener("ended", () => stop(), { once: true }));
      setPending(key, null);
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.start(5000);
      registerActive(key, stop);
    } catch (caught) {
      cleanup();
      registerActive(key, null);
      safe(() => setError(describeError(caught)));
    } finally {
      safe(() => setStarting(false));
    }
  }

  function chooseFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    setError(""); setNotice("");
    if (!file) return;
    if (!file.type.toLowerCase().startsWith("audio/")) { setError("Selecciona un archivo de audio válido."); return; }
    if (file.size > MAX_AUDIO_BYTES) { setError("El archivo supera el límite de 50 MB."); return; }
    if (!confirmLoss("Sustituirlo por este archivo")) return;
    setPending(key, { blob: file, fileName: file.name, source: "upload" });
    setNotice(`Archivo preparado (${mb(file.size)} MB). Solo está en este navegador; no se ha enviado todavía.`);
  }

  function changeSource(next: Source) {
    if (audio && !confirmLoss("Cambiar el origen y descartarlo")) return;
    if (audio) setPending(key, null);
    setSource(next); setNotice(""); setError("");
  }

  function discard() {
    if (!confirmLoss("Descartarlo")) return;
    setPending(key, null); setNotice("Audio descartado.");
  }

  async function processAudio() {
    if (!audio || busy || starting || !stored || !canProcess) return;
    if (!consent) { setError("Confirma el consentimiento antes de enviar la grabación."); return; }
    if (currentNotes.trim() && !replaceDraft) { setError("Confirma si quieres sustituir las notas del borrador actual."); return; }
    setBusy(true); setError("");
    setNotice("Transcribiendo y preparando el borrador de acta…");
    try {
      await customFetch(`/api/v1/ciclope/meetings/${encodeURIComponent(meetingId)}/transcription`, {
        method: "POST",
        responseType: "json",
        headers: {
          "Content-Type": audio.type || "application/octet-stream",
          "X-Recording-Consent": "true",
          "X-Recording-Source": stored.source,
          "X-Expected-Revision": String(expectedRevision),
          ...(currentNotes.trim() && replaceDraft ? { "X-Replace-Draft": "true" } : {}),
        },
        body: audio,
      });
      setPending(key, null);
      safe(() => {
        setConsent(false); setReplaceDraft(false);
        setNotice("Transcripción guardada y borrador generado. Revisa el acta antes de validarla.");
      });
      await onDone();
    } catch (caught) {
      safe(() => { setError(describeError(caught)); setNotice(""); });
    } finally {
      setBusy(false);
    }
  }

  const needsReplace = currentNotes.trim().length > 0 && !replaceDraft;
  return <section className="min-w-0 max-w-full break-words rounded-lg border border-teal-200 bg-teal-50/50 p-3 sm:p-4" data-testid="meeting-ai-recording">
    <div className="flex items-center gap-2 text-sm font-semibold text-[#20393b]"><WandSparkles size={17} className="text-teal-800" />Grabación y borrador con IA</div>
    <p className="mt-1 text-xs leading-relaxed text-slate-600">El audio pendiente se guarda solo en la memoria de este navegador; si cierras o recargas la página se perderá. Al procesarlo se envía al proveedor configurado por administración técnica y se descarta tras guardar la transcripción y el borrador. Si falla, se mantiene aquí para reintentar o descartarlo. El proveedor tiene su propia política de conservación. El acta siempre requiere revisión humana.</p>

    <label className="mt-3 grid gap-1 text-xs">
      Origen del audio
      <select className="min-w-0 max-w-full" value={source} disabled={recording || busy || starting} onChange={(e) => changeSource(e.target.value as Source)} data-testid="select-recording-source">
        <option value="in_person">Reunión presencial · micrófono</option>
        <option value="online">Reunión online · audio de pestaña compartida</option>
        <option value="upload">Subir una grabación existente</option>
      </select>
    </label>

    {source === "online" && <label className="mt-2 flex items-start gap-2 text-xs text-slate-700">
      <input className="mt-0.5" type="checkbox" checked={withMic} disabled={recording || busy || starting} onChange={(e) => setWithMic(e.target.checked)} data-testid="checkbox-recording-mic" />
      Mezclar también mi micrófono (para que se oigan mis intervenciones).
    </label>}

    {source === "upload" ? <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-teal-300 bg-white p-3 text-xs text-teal-900">
      <Upload size={16} />Seleccionar archivo de audio (máximo 50 MB)
      <input className="sr-only" type="file" accept="audio/*" disabled={busy || recording || starting} onChange={(e) => chooseFile(e.currentTarget)} data-testid="input-recording-file" />
    </label> : <div className="mt-3 flex flex-wrap items-center gap-2">
      {!recording
        ? <button className="quiet-action disabled:opacity-50" disabled={busy || starting} onClick={() => void startRecording()} data-testid="button-recording-start"><Mic size={15} />{starting ? "Solicitando permisos…" : "Iniciar grabación"}</button>
        : <button className="quiet-action !text-[#9b4337]" onClick={() => stopActive(key)} data-testid="button-recording-stop"><Square size={14} />Detener · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</button>}
      {source === "online" && <span className="text-[11px] text-slate-500">Elige la pestaña de la reunión y activa «Compartir audio de la pestaña». Solo se graba audio, nunca la imagen.</span>}
    </div>}
    {recording && <p className="mt-2 text-[11px] font-semibold text-[#9b4337]" data-testid="status-recording-active">Grabando. Si sales de esta reunión la grabación se detendrá y se conservará aquí.</p>}

    <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-slate-700">
      <input className="mt-0.5" type="checkbox" checked={consent} disabled={recording || busy || starting} onChange={(e) => setConsent(e.target.checked)} data-testid="checkbox-recording-consent" />
      Confirmo que he informado a las personas participantes y que han consentido la grabación y su transcripción.
    </label>
    {currentNotes.trim() && <label className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-amber-900">
      <input className="mt-0.5" type="checkbox" checked={replaceDraft} disabled={busy} onChange={(e) => setReplaceDraft(e.target.checked)} data-testid="checkbox-recording-replace" />
      Sustituir las notas actuales del borrador por el acta generada.
    </label>}

    {audio && stored && <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-white p-2 text-xs" data-testid="panel-recording-pending">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate" data-testid="text-recording-file">{stored.fileName} · {mb(audio.size)} MB · pendiente en este navegador</span>
        <button className="quiet-action" disabled={busy || starting} onClick={discard} data-testid="button-recording-discard">Descartar audio</button>
      </div>
      {previewUrl && <audio controls src={previewUrl} className="min-w-0 max-w-full w-full" data-testid="audio-recording-preview" />}
    </div>}
    {!canProcess && <p role="status" className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900" data-testid="status-recording-wait">Puedes grabar ya. Para transcribir y preparar el borrador, primero marca la reunión como celebrada cuando haya pasado su hora de fin; el audio se mantiene aquí mientras tanto.</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-800" data-testid="status-recording-error">{error}</p>}
    {notice && <p role="status" className="mt-2 text-xs text-teal-900" data-testid="status-recording-notice">{notice}</p>}
    <button className="primary-action mt-3 w-full justify-center disabled:opacity-50" disabled={!canProcess || !audio || !consent || busy || recording || starting || needsReplace} onClick={() => void processAudio()} data-testid="button-recording-process">
      <WandSparkles size={15} />{busy ? "Procesando audio…" : "Transcribir y preparar borrador"}
    </button>
    <p className="mt-2 text-[10px] leading-relaxed text-slate-500">Hasta 50 MB por envío. La revisión y validación del acta siguen siendo humanas.</p>
  </section>;
}
