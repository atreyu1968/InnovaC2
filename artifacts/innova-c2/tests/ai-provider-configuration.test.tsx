import "./dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test, type TestContext } from "node:test";
import { StrictMode, type PropsWithChildren } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  getGetAdminAIProviderSettingsQueryKey,
  useCheckAdminAIProviderMutationOptions,
  useCheckAdminAIProvider,
  type AdminAIProviderSettings,
  type AIProviderCheckResult,
} from "@workspace/api-client-react";
import { AdminAIProviderConfiguration } from "../src/components/AdminAIProviderConfiguration";

const settingsPath = "/api/v1/admin/ai/provider";
const checkPath = `${settingsPath}/check`;
const saved: AdminAIProviderSettings = {
  provider: "local",
  baseUrl: "http://synthetic.invalid/v1",
  transcriptionModel: "synthetic-transcription",
  minutesModel: "synthetic-minutes",
  apiKeyConfigured: false,
  externalAuthorizedAt: null,
  revision: 7,
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const success: AIProviderCheckResult = {
  revision: saved.revision,
  checkedAt: "2026-01-01T00:00:00.000Z",
  transcription: { status: "ok", message: "Transcripción sintética compatible." },
  minutes: { status: "ok", message: "Redacción sintética compatible." },
  qualityAssessed: false,
};

type RequestRecord = { path: string; method: string; body?: unknown };
let requests: RequestRecord[];
let forbidden: RequestRecord[];
let clients: QueryClient[];
let settingsReply: () => Response;
let checkReply: () => Response | Promise<Response>;

function json(body: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...headers },
  });
}

beforeEach((t) => {
  assert.ok("mock" in t);
  requests = [];
  forbidden = [];
  clients = [];
  settingsReply = () => json(saved);
  checkReply = () => json(success);
  // Deliberately hostile defaults: the diagnostic must opt OUT of retries.
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const request = { path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    requests.push(request);
    if (path === settingsPath && request.method === "GET") return settingsReply();
    if (path === checkPath && request.method === "POST") return checkReply();
    // No fall-through to native fetch, even when production code changes.
    forbidden.push(request);
    throw new Error(`Network forbidden in isolated UI test: ${request.method} ${path}`);
  });
});

afterEach((t) => {
  assert.ok("mock" in t);
  cleanup();
  for (const client of clients) client.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  t.mock.timers.reset();
  t.mock.restoreAll();
  assert.deepEqual(forbidden, [], "No writes to settings or unexpected network requests are permitted");
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: 3, retryDelay: 25, gcTime: Infinity },
      mutations: { retry: 3, retryDelay: 25, gcTime: Infinity },
    },
  });
  clients.push(client);
  return {
    client,
    Wrapper: ({ children }: PropsWithChildren) =>
      <StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></StrictMode>,
  };
}

// Drain fetch/React Query microtasks and notification timers, without real sleeps.
async function advance(t: TestContext, milliseconds = 0) {
  for (let i = 0; i < 12; i++) {
    await act(async () => { t.mock.timers.tick(i === 0 ? milliseconds : 0); });
  }
}

async function mount(t: TestContext) {
  const { client, Wrapper } = wrapper();
  const view = render(<AdminAIProviderConfiguration />, { wrapper: Wrapper });
  await advance(t);
  assert.ok(screen.getByRole("button", { name: "Comprobar proveedor guardado" }));
  return { ...view, client };
}

const checkRequests = () => requests.filter((r) => r.path === checkPath);
function openConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: "Comprobar proveedor guardado" }));
  assert.ok(screen.getByRole("alertdialog", { name: "Confirmar envío de muestras sintéticas" }));
}
function confirm() {
  fireEvent.click(screen.getByRole("button", { name: "Confirmar y enviar muestras" }));
}

test("opening, remounting, reloading settings, focusing and reconnecting never start diagnostics", async (t) => {
  let view = await mount(t);
  await act(async () => { await view.client.invalidateQueries({ queryKey: getGetAdminAIProviderSettingsQueryKey() }); });
  view.unmount();
  // Fresh QueryClient: no cached result, as on a full page reload.
  view = await mount(t);
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await advance(t, 300_000);
  assert.ok(requests.filter((r) => r.path === settingsPath).length >= 3);
  assert.deepEqual(checkRequests(), []);
});

test("each send requires explicit synthetic confirmation; cancelling sends nothing", async (t) => {
  await mount(t);
  openConfirmation();
  assert.match(screen.getByRole("alertdialog").textContent!, /sin voz/);
  assert.match(screen.getByRole("alertdialog").textContent!, /Nunca se usan reuniones reales/);
  assert.match(screen.getByRole("alertdialog").textContent!, /consumo o costes/);
  assert.equal(checkRequests().length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  await advance(t, 60_000);
  assert.equal(checkRequests().length, 0);
  openConfirmation();
  confirm();
  await advance(t);
  assert.deepEqual(checkRequests(), [{
    path: checkPath, method: "POST",
    body: { expectedRevision: saved.revision, syntheticSampleConfirmed: true },
  }]);
  assert.match(screen.getByRole("status").textContent!, /Transcripción sintética compatible/);
  assert.match(screen.getByRole("status").textContent!, /Redacción sintética compatible/);
  assert.match(screen.getByRole("status").textContent!, /no evalúa la calidad/);
  openConfirmation();
  assert.equal(checkRequests().length, 1);
  confirm();
  await advance(t);
  assert.equal(checkRequests().length, 2);
});

test("repeated clicks while pending cannot duplicate the request", async (t) => {
  let release!: (response: Response) => void;
  checkReply = () => new Promise<Response>((resolve) => { release = resolve; });
  await mount(t);
  openConfirmation();
  const confirmation = screen.getByRole("button", { name: "Confirmar y enviar muestras" });
  fireEvent.click(confirmation);
  await advance(t);
  const pending = screen.getByRole("button", { name: "Comprobando los dos modelos…" }) as HTMLButtonElement;
  assert.equal(pending.disabled, true);
  assert.equal((screen.getByRole("button", { name: "Guardar proveedor de IA" }) as HTMLButtonElement).disabled, true);
  assert.equal(screen.queryByRole("alertdialog"), null);
  for (let i = 0; i < 10; i++) {
    fireEvent.click(pending);
    fireEvent.click(confirmation);
  }
  await advance(t, 40_000);
  assert.equal(checkRequests().length, 1);
  await act(async () => { release(json(success)); });
  await advance(t);
  assert.equal(checkRequests().length, 1);
  assert.equal((screen.getByRole("button", { name: "Comprobar proveedor guardado" }) as HTMLButtonElement).disabled, false);
});

for (const scenario of ["429", "500", "network", "model"] as const) {
  test(`${scenario}: shows the failure and never retries, even after waiting, focus or reconnect`, async (t) => {
    const waitMessage = "Se ha alcanzado el límite de comprobaciones de IA. Espera 73 segundos antes de reintentarlo.";
    checkReply = () => {
      if (scenario === "network") throw new TypeError("Synthetic network failure");
      if (scenario === "model") return json({
        ...success,
        transcription: { status: "model_error", message: "Modelo sintético no disponible." },
        minutes: { status: "connection_error", message: "Conexión sintética fallida." },
      });
      return json({ error: scenario === "429" ? waitMessage : "Fallo sintético del servidor." },
        Number(scenario), scenario === "429" ? { "Retry-After": "73" } : {});
    };
    await mount(t);
    openConfirmation();
    confirm();
    await advance(t);
    const feedback = screen.getByRole(scenario === "model" ? "status" : "alert").textContent!;
    if (scenario === "429") assert.ok(feedback.includes(waitMessage), "Display the server's wait message, not a client-invented cooldown");
    if (scenario === "500") assert.match(feedback, /Fallo sintético del servidor/);
    if (scenario === "network") assert.match(feedback, /Synthetic network failure/);
    if (scenario === "model") assert.match(feedback, /Modelo sintético no disponible/);
    await advance(t, 300_000); // Beyond Retry-After and the default React Query backoff.
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await advance(t, 300_000);
    assert.equal(checkRequests().length, 1);
    assert.equal(screen.queryByRole("alertdialog"), null);
    openConfirmation();
    assert.equal(checkRequests().length, 1, "A manual retry still needs a fresh confirmation");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  });
}

test("disabled providers and unsaved changes cannot trigger diagnostics", async (t) => {
  settingsReply = () => json({ ...saved, provider: "disabled" });
  const view = await mount(t);
  const button = () => screen.getByRole("button", { name: "Comprobar proveedor guardado" }) as HTMLButtonElement;
  assert.equal(button().disabled, true);
  fireEvent.click(button());
  assert.equal(screen.queryByRole("alertdialog"), null);
  view.unmount();
  settingsReply = () => json(saved);
  await mount(t);
  openConfirmation();
  fireEvent.change(screen.getByRole("textbox", { name: "Modelo para redactar actas" }), { target: { value: "changed-synthetic-model" } });
  assert.equal(button().disabled, true);
  assert.equal(screen.queryByRole("alertdialog"), null);
  fireEvent.click(button());
  await advance(t, 300_000);
  assert.equal(checkRequests().length, 0);
});

test("settings read failures neither retry automatically nor launch diagnostics", async (t) => {
  settingsReply = () => json({ error: "Lectura sintética fallida." }, 500);
  const { Wrapper } = wrapper();
  render(<AdminAIProviderConfiguration />, { wrapper: Wrapper });
  await advance(t);
  assert.match(screen.getByRole("alert").textContent!, /Lectura sintética fallida/);
  await advance(t, 300_000);
  assert.equal(requests.length, 1);
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await advance(t);
  assert.equal(requests.length, 2);
  assert.deepEqual(checkRequests(), []);
});

test("real diagnostic hook overrides global AND caller retries, and remains manual", async (t) => {
  const options = renderHook(() => useCheckAdminAIProviderMutationOptions({ mutation: { retry: 5 } }));
  assert.equal(options.result.current.retry, false);
  checkReply = () => json({ error: "Fallo sintético del hook." }, 500);
  const { Wrapper } = wrapper();
  const { result, rerender } = renderHook(() => useCheckAdminAIProvider({ mutation: { retry: 5, retryDelay: 25 } }), { wrapper: Wrapper });
  await advance(t, 300_000);
  assert.deepEqual(checkRequests(), []);
  act(() => { result.current.mutate({ data: { expectedRevision: 7, syntheticSampleConfirmed: true } }); });
  await advance(t);
  assert.equal(result.current.isError, true);
  assert.match(result.current.error!.message, /Fallo sintético del hook/);
  rerender();
  await advance(t, 300_000);
  assert.equal(checkRequests().length, 1);
});
