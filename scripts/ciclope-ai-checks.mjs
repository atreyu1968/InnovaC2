// Contract tests use an owned local HTTP double, never a live provider or application credentials.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

export async function startAIRecordingChecks({ request, status, admin, c2, teacher, pool, base, directory }) {
  const testKey = `isolated-provider-${randomUUID()}`;
  const transcript = "Se revisan las evidencias del PIC. Se propone revisar los indicadores en la próxima reunión.";
  const minutes = "BORRADOR DE ACTA\nSe revisaron las evidencias del PIC.\nNo constan responsables ni plazos expresamente asignados.";
  let scenario = "ok", beforeTranscriptionReply, beforeDraftReply, calls = 0, chatCalls = 0, assertions = 0;
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      calls++;
      assert.equal(req.headers.authorization, `Bearer ${testKey}`);
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/audio/transcriptions") {
        assert.match(body.toString(), /whisper-test/);
        assert.match(body.toString(), /meeting-recording\.(wav|webm|ogg|mp4|mp3|flac)/);
        if (scenario === "stt-error") { res.writeHead(500).end("{}"); return; }
        if (scenario === "invalid-json") { res.end("not JSON"); return; }
        if (scenario === "redirect") { res.writeHead(307, { location: "/unexpected" }).end("{}"); return; }
        if (beforeTranscriptionReply) await beforeTranscriptionReply();
        res.end(JSON.stringify({ text: transcript }));
      } else if (req.url === "/v1/chat/completions") {
        chatCalls++;
        const input = JSON.parse(body.toString());
        assert.equal(input.model, "minutes-test");
        assert.match(input.messages[1].content, /evidencias del PIC/);
        assert.match(input.messages[0].content, /No inventes asistentes/);
        if (scenario === "chat-error") { res.writeHead(503).end("{}"); return; }
        if (beforeDraftReply) await beforeDraftReply();
        res.end(JSON.stringify({ choices: [{ message: { content: minutes } }] }));
      } else res.writeHead(404).end("{}");
    } catch { res.writeHead(500).end("{}"); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const providerUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const configFields = {
    provider: "local", baseUrl: providerUrl, transcriptionModel: "whisper-test",
    minutesModel: "minutes-test", clearApiKey: false, externalAuthorizationConfirmed: false,
  };
  const getConfig = async () => status(await request("/admin/ai/provider", admin), 200);
  async function configure(extra = {}, expectedStatus = 200) {
    const current = await getConfig();
    return status(await request("/admin/ai/provider", admin, "PUT", {
      ...configFields, expectedRevision: current.revision, ...extra,
    }), expectedStatus);
  }
  function wave() {
    const pcm = Buffer.alloc(3200);
    const header = Buffer.alloc(44);
    header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
    header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
    header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
  }
  async function upload(meeting, opts = {}) {
    const session = opts.session ?? c2.session;
    const headers = {
      "content-type": opts.mediaType ?? "audio/wav",
      cookie: session.cookie,
      ...(opts.csrf === false ? {} : { "x-csrf-token": session.csrf }),
      ...(opts.consent === false ? {} : { "x-recording-consent": "true" }),
      "x-recording-source": "upload",
      "x-expected-revision": String(opts.revision ?? meeting.revision),
      ...(opts.replace ? { "x-replace-draft": "true" } : {}),
    };
    const response = await fetch(`${base}/ciclope/meetings/${meeting.id}/transcription`, {
      method: "POST", headers, body: opts.empty ? Buffer.alloc(0) : wave(),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    let data; try { data = JSON.parse(bytes.toString()); } catch {}
    return { status: response.status, data, bytes };
  }
  async function meeting(id) {
    return status(await request("/ciclope", c2.session), 200).meetings.find((item) => item.id === id);
  }
  async function act(current, action) {
    status(await request(`/ciclope/meetings/${current.id}/action`, admin, "POST", {
      expectedRevision: current.revision, action,
    }), 200);
    return meeting(current.id);
  }
  async function seedMeeting(input, celebrate = true) {
    let current = status(await request("/ciclope/meetings", c2.session, "POST", input), 201);
    const overview = status(await request("/ciclope", admin), 200);
    let policy = overview.policy;
    if (!policy.authorizedInternalChannel) {
      status(await request("/ciclope/policy", admin, "PUT", {
        expectedRevision: policy.revision, requireInstitutionalApproval: policy.requireInstitutionalApproval,
        authorizedInternalChannel: true,
      }), 200);
      policy = status(await request("/ciclope", admin), 200).policy;
    }
    if (policy.requireInstitutionalApproval) {
      current = await act(current, "solicitar_refrendo");
      current = await act(current, "aprobar_convocatoria");
    }
    current = await act(current, "convocar");
    return celebrate ? act(current, "celebrar") : current;
  }
  async function settingsChecks() {
    status(await request("/admin/ai/provider"), 401);
    status(await request("/admin/ai/provider", c2.session), 403);
    const initial = await getConfig();
    assert.equal(initial.provider, "disabled"); assert.equal(initial.apiKeyConfigured, false);
    assertions += 2;
    const body = { ...configFields, expectedRevision: initial.revision, apiKey: testKey };
    status(await request("/admin/ai/provider", admin, "PUT", body, false), 403);
    status(await request("/admin/ai/provider", c2.session, "PUT", body), 403);
    const saved = status(await request("/admin/ai/provider", admin, "PUT", body), 200);
    assert.equal(saved.apiKeyConfigured, true);
    assert.equal(JSON.stringify(saved).includes(testKey), false);
    const { rows: [stored] } = await pool.query("SELECT * FROM ai_provider_settings");
    assert.notEqual(stored.api_key_ciphertext, testKey);
    assert.ok(stored.api_key_iv && stored.api_key_tag);
    assert.equal(JSON.stringify(stored).includes(testKey), false);
    assertions += 5;
    status(await request("/admin/ai/provider", admin, "PUT", body), 409);
    for (const baseUrl of [
      "http://169.254.169.254/v1", "http://0.0.0.0/v1", "http://8.8.8.8/v1",
      "http://[fe80::1]/v1", "http://user:password@127.0.0.1/v1", `${providerUrl}?secret=forbidden`,
    ]) await configure({ baseUrl }, 400);
    await configure({ provider: "external_authorized", baseUrl: "http://8.8.8.8/v1", externalAuthorizationConfirmed: true }, 400);
    await configure({ provider: "external_authorized", baseUrl: "https://127.0.0.1/v1", externalAuthorizationConfirmed: true }, 400);
    await configure({ provider: "external_authorized", baseUrl: "https://8.8.8.8/v1", externalAuthorizationConfirmed: false }, 400);
    await configure({ provider: "external_authorized", baseUrl: "https://8.8.8.8/v1", externalAuthorizationConfirmed: true, clearApiKey: true }, 400);
    const cleared = await configure({ clearApiKey: true });
    assert.equal(cleared.apiKeyConfigured, false); assertions++;
    await configure({ apiKey: testKey });
    assert.equal(calls, 0, "Saving settings must never send data to an AI provider."); assertions++;
  }
  async function exercise(input) {
    let current = await seedMeeting(input, false);
    status(await upload(current), 409);
    current = await act(current, "celebrar");
    status(await upload(current, { session: teacher.session }), 403);
    status(await upload(current, { csrf: false }), 403);
    status(await upload(current, { consent: false }), 400);
    status(await upload(current, { revision: 0 }), 400);
    status(await upload(current, { revision: current.revision - 1 }), 409);
    status(await upload(current, { empty: true }), 400);
    status(await upload(current, { mediaType: "application/pdf" }), 415);
    await configure({ provider: "disabled" });
    status(await upload(current), 503);
    await configure();
    const filesBefore = await readdir(path.join(directory, "files"), { recursive: true }).catch(() => []);
    const original = structuredClone(current);
    current = status(await upload(current), 200);
    assert.equal(current.state, "acta_borrador");
    assert.equal(current.transcription.text, transcript);
    assert.equal(current.data.notes, minutes);
    assert.deepEqual(current.data.participants, original.data.participants);
    assert.deepEqual(current.data.agreements, original.data.agreements);
    assert.equal(current.approvedPolicyRevision, original.approvedPolicyRevision);
    assert.deepEqual(await readdir(path.join(directory, "files"), { recursive: true }).catch(() => []), filesBefore);
    assertions += 7;
    const versions = status(await request(`/ciclope/meetings/${current.id}/versions`, c2.session), 200);
    assert.equal(versions[0].content.transcription.text, transcript); assertions++;
    const previousCalls = calls;
    status(await upload(current), 409);
    assert.equal(calls, previousCalls); assertions++;
    let release, entered;
    const hold = new Promise((resolve) => { release = resolve; });
    const reachedProvider = new Promise((resolve) => { entered = resolve; });
    beforeTranscriptionReply = async () => { entered(); await hold; };
    const pending = upload(current, { replace: true });
    await reachedProvider;
    try { status(await upload(current, { replace: true }), 429); }
    finally { release(); }
    current = status(await pending, 200);
    beforeTranscriptionReply = undefined;
    for (scenario of ["stt-error", "invalid-json", "redirect", "chat-error"]) {
      status(await upload(current, { replace: true }), 502);
      assert.equal((await meeting(current.id)).revision, current.revision);
      assertions++;
    }
    scenario = "ok";
    beforeDraftReply = async () => {
      status(await request(`/ciclope/meetings/${current.id}`, c2.session, "PUT", {
        ...current.data, expectedRevision: current.revision, notes: "Notas humanas guardadas mientras la IA estaba procesando.",
      }), 200);
    };
    status(await upload(current, { replace: true }), 409);
    beforeDraftReply = undefined;
    current = await meeting(current.id);
    assert.match(current.data.notes, /Notas humanas/); assertions++;
    const chatsBefore = chatCalls;
    beforeTranscriptionReply = () => configure({ provider: "disabled" });
    status(await upload(current, { replace: true }), 503);
    beforeTranscriptionReply = undefined;
    assert.equal(chatCalls, chatsBefore, "Changing/ disabling provider must not send the transcript to a new provider.");
    assertions++;
    await configure();
    current = status(await upload(current, { replace: true }), 200);
    assert.equal(current.data.notes, minutes); assertions++;
    const audit = await pool.query("SELECT details FROM audit_logs WHERE action='ciclope.ai_transcription' AND entity_id=$1", [current.id]);
    assert.ok(audit.rows.length >= 2);
    assert.equal(JSON.stringify(audit.rows).includes(testKey), false);
    assertions += 2;
    console.log(`IA de reuniones: ${assertions} aserciones de configuración, cifrado, consentimiento, transporte y conservación; proveedor HTTP aislado.`);
  }
  return {
    settingsChecks, exercise, seedMeeting,
    rejectValidated: async (current) => { status(await upload(current, { replace: true }), 409); },
    browserFixture: () => ({ providerUrl, providerTestKey: testKey, transcriptionModel: "whisper-test", minutesModel: "minutes-test" }),
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); },
  };
}
