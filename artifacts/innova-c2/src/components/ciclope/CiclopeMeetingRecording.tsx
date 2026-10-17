import { useEffect, useRef, useState } from "react";
import { Mic, Square, Upload, WandSparkles } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
type Source = "in_person" | "online" | "upload";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "No se pudo procesar el audio.";
}

export function CiclopeMeetingRecording({
  meetingId,
  meetingTitle,
  meetingStartsAt,
  currentNotes,
  onDone,
}: {
  meetingId: string;
  meetingTitle: string;
  meetingStartsAt: string;
  currentNotes: string;
  onDone: () => Promise<void>;
}) {
  const [source, setSource] = useState<Source>("in_person");
  const [consent, setConsent] = useState(false);
  const [replaceDraft, setReplaceDraft] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const exceededLimitRef = useRef(false);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function startRecording() {
    setError("");
    setNotice("");
    setAudio(null);
    setFileName("");
    if (!consent) {
      setError("Confirma primero que las personas participantes han sido informadas y han consentido.");
      return;
    }
    if (!navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      setError("Este navegador no permite grabar aquí. Puedes subir una grabación de audio existente.");
      return;
    }
    try {
      let sourceStream: MediaStream;
      if (source === "online") {
        sourceStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (!sourceStream.getAudioTracks().length) {
          sourceStream.getTracks().forEach((track) => track.stop());
          throw new Error("La pestaña compartida no aporta audio. Vuelve a compartirla y activa «Compartir audio de la pestaña».");
        }
      } else {
        sourceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = sourceStream;
      const audioOnly = new MediaStream(sourceStream.getAudioTracks());
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((value) => MediaRecorder.isTypeSupported(value));
      const recorder = mime ? new MediaRecorder(audioOnly, { mimeType: mime }) : new MediaRecorder(audioOnly);
      chunksRef.current = [];
      bytesRef.current = 0;
      exceededLimitRef.current = false;
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        bytesRef.current += event.data.size;
        if (bytesRef.current > MAX_AUDIO_BYTES) {
          exceededLimitRef.current = true;
          setError("La grabación ha alcanzado el límite de 50 MB y se descartará. Divide la reunión en fragmentos más cortos.");
          if (recorder.state === "recording") recorder.stop();
          return;
        }
        chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setRecording(false);
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (!exceededLimitRef.current && blob.size > 0) {
          setAudio(blob);
          setFileName("Grabación de la reunión");
          setNotice(`Audio preparado (${(blob.size / 1024 / 1024).toFixed(1)} MB). No se ha enviado todavía.`);
        }
        chunksRef.current = [];
        bytesRef.current = 0;
      };
      sourceStream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => {
        if (recorder.state === "recording") recorder.stop();
      }, { once: true }));
      recorderRef.current = recorder;
      recorder.start(5000);
      setRecording(true);
    } catch (caught) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setError(describeError(caught));
    }
  }

  function chooseFile(file?: File) {
    setError("");
    setNotice("");
    setAudio(null);
    if (!file) return;
    if (!file.type.toLowerCase().startsWith("audio/")) {
      setError("Selecciona un archivo de audio válido.");
      return;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      setError("El archivo supera el límite de 50 MB.");
      return;
    }
    setAudio(file);
    setFileName(file.name);
    setSource("upload");
    setNotice(`Archivo preparado (${(file.size / 1024 / 1024).toFixed(1)} MB). No se ha enviado todavía.`);
  }

  async function processAudio() {
    if (!audio || busy) return;
    if (!consent) {
      setError("Confirma el consentimiento antes de enviar la grabación.");
      return;
    }
    if (currentNotes.trim() && !replaceDraft) {
      setError("Confirma si quieres sustituir las notas del borrador actual.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("Transcribiendo y preparando el borrador de acta…");
    try {
      await customFetch(`/api/v1/ciclope/meetings/${encodeURIComponent(meetingId)}/transcription`, {
        method: "POST",
        responseType: "json",
        headers: {
          "Content-Type": audio.type || "application/octet-stream",
          "X-Recording-Consent": "true",
          "X-Recording-Source": source,
          ...(currentNotes.trim() && replaceDraft ? { "X-Replace-Draft": "true" } : {}),
        },
        body: audio,
      });
      setAudio(null);
      setFileName("");
      setConsent(false);
      setReplaceDraft(false);
      setNotice("Transcripción guardada y borrador generado. Revisa el acta antes de validarla.");
      await onDone();
    } catch (caught) {
      setError(describeError(caught));
      setNotice("");
    } finally {
      setBusy(false);
    }
  }

  return <section className="rounded-lg border border-teal-200 bg-teal-50/50 p-4" data-testid="meeting-ai-recording">
    <div className="flex items-center gap-2 text-sm font-semibold text-[#20393b]"><WandSparkles size={17} className="text-teal-800" />Grabación y borrador con IA</div>
    <p className="mt-1 text-xs leading-relaxed text-slate-600">El audio se envía solo al proveedor configurado por administración técnica, se procesa en memoria y se descarta al terminar. La transcripción y el acta quedan como borrador para revisión humana.</p>

    <label className="mt-3 grid gap-1 text-xs">
      Origen del audio
      <select value={source} disabled={recording || busy} onChange={(event) => { setSource(event.target.value as Source); setAudio(null); setNotice(""); }}>
        <option value="in_person">Reunión presencial · micrófono</option>
        <option value="online">Reunión online · audio de pestaña compartida</option>
        <option value="upload">Subir una grabación existente</option>
      </select>
    </label>

    {source === "upload" ? <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-teal-300 bg-white p-3 text-xs text-teal-900">
      <Upload size={16} />Seleccionar archivo de audio (máximo 50 MB)
      <input className="sr-only" type="file" accept="audio/*" disabled={busy || recording} onChange={(event) => chooseFile(event.currentTarget.files?.[0])} />
    </label> : <div className="mt-3 flex flex-wrap items-center gap-2">
      {!recording
        ? <button className="quiet-action" disabled={busy} onClick={() => void startRecording()}><Mic size={15} />Iniciar grabación</button>
        : <button className="quiet-action !text-[#9b4337]" onClick={() => recorderRef.current?.stop()}><Square size={14} />Detener · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</button>}
      {source === "online" && <span className="text-[11px] text-slate-500">Elige la pestaña de la reunión y activa compartir su audio.</span>}
    </div>}

    <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-slate-700">
      <input className="mt-0.5" type="checkbox" checked={consent} disabled={recording || busy} onChange={(event) => setConsent(event.target.checked)} />
      Confirmo que he informado a las personas participantes y que han consentido la grabación y su transcripción.
    </label>
    {currentNotes.trim() && <label className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-amber-900">
      <input className="mt-0.5" type="checkbox" checked={replaceDraft} disabled={busy} onChange={(event) => setReplaceDraft(event.target.checked)} />
      Sustituir las notas actuales del borrador por el acta generada.
    </label>}

    {audio && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-2 text-xs">
      <span className="min-w-0 truncate">{fileName} · {(audio.size / 1024 / 1024).toFixed(1)} MB</span>
      <button className="quiet-action" disabled={busy} onClick={() => { setAudio(null); setFileName(""); setNotice(""); }}>Descartar audio</button>
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-2 text-xs text-teal-900">{notice}</p>}
    <button className="primary-action mt-3 w-full justify-center disabled:opacity-50" disabled={!audio || !consent || busy || recording || (currentNotes.trim().length > 0 && !replaceDraft)} onClick={() => void processAudio()}>
      <WandSparkles size={15} />{busy ? "Procesando audio…" : "Transcribir y preparar borrador"}
    </button>
    <p className="mt-2 text-[10px] leading-relaxed text-slate-500">Hasta 50 MB por envío. La revisión y validación del acta siguen siendo humanas.</p>
  </section>;
}
