import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

type Mode = "local" | "external_authorized";

function mappedIPv4(address: string): string {
  if (!address.toLowerCase().startsWith("::ffff:")) return address;
  const suffix = address.slice(7);
  if (isIP(suffix) === 4) return suffix;
  const parts = suffix.split(":");
  if (parts.length !== 2) return address;
  const high = Number.parseInt(parts[0]!, 16), low = Number.parseInt(parts[1]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function privateAddress(address: string): boolean {
  address = mappedIPv4(address);
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    if (value.startsWith("::ffff:")) return privateAddress(value.slice(7));
    return value === "::1" || value.startsWith("fc") || value.startsWith("fd");
  }
  return false;
}

function forbiddenAddress(address: string): boolean {
  address = mappedIPv4(address);
  const value = address.toLowerCase();
  if (value.startsWith("::ffff:")) return forbiddenAddress(value.slice(7));
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || (a === 169 && b === 254) || a! >= 224 ||
      (a === 100 && b! >= 64 && b! <= 127);
  }
  return value === "::" || value.startsWith("fe80:") || value.startsWith("ff");
}

/** Resolve once, validate every address and pin the outgoing socket to one of them. */
export async function resolveAIEndpoint(mode: Mode, endpoint: string) {
  const url = new URL(endpoint);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("El endpoint debe usar HTTP(S), sin credenciales, consulta ni fragmento.");
  }
  if (mode === "external_authorized" && url.protocol !== "https:") {
    throw new Error("Los proveedores externos deben usar HTTPS.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) =>
    forbiddenAddress(address) ||
    (mode === "local" ? !privateAddress(address) : privateAddress(address)))) {
    throw new Error(mode === "local"
      ? "El modo local requiere una dirección privada o de bucle local; no se permiten servicios de metadatos."
      : "El proveedor externo debe resolver a una dirección pública.");
  }
  return { url, hostname, address: addresses[0]! };
}

/** OpenAI-compatible HTTP transport, no redirects, bounded JSON and no secret-bearing errors. */
export async function requestAIJson(
  config: { mode: Mode; baseUrl: string; apiKey: string | null },
  path: string,
  body: FormData | string,
): Promise<unknown> {
  const { url, hostname, address } = await resolveAIEndpoint(config.mode, `${config.baseUrl}/${path}`);
  const serialized = new Request(url, {
    method: "POST",
    headers: typeof body === "string" ? { "Content-Type": "application/json" } : {},
    body,
  });
  const payload = Buffer.from(await serialized.arrayBuffer());
  const headers: Record<string, string> = {
    ...Object.fromEntries(serialized.headers),
    Host: url.host,
    "Content-Length": String(payload.length),
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const outgoing = send({
        protocol: url.protocol,
        hostname: address.address,
        port: url.port || undefined,
        path: `${url.pathname}`,
        method: "POST",
        headers,
        ...(url.protocol === "https:" ? { servername: hostname } : {}),
        signal: AbortSignal.timeout(120_000),
      }, (response) => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          response.destroy();
          reject(new Error(`HTTP ${response.statusCode ?? 502}`));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) {
            response.destroy(new Error("La respuesta del proveedor supera el límite admitido."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { reject(new Error("El proveedor no devolvió JSON válido.")); }
        });
      });
      outgoing.on("error", reject);
      outgoing.end(payload);
    });
  } finally {
    payload.fill(0);
  }
}
