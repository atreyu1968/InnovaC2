import { createConnection } from "node:net";

export type AntivirusResult =
  | "limpio"
  | "infectado"
  | "no_configurado"
  | "no_disponible";

const CHUNK_BYTES = 64 * 1024;
const SCAN_TIMEOUT_MS = 8_000;

export function scanWithClamAv(data: Buffer): Promise<AntivirusResult> {
  const host = process.env.CLAMAV_HOST?.trim();
  if (!host) return Promise.resolve("no_configurado");
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return Promise.resolve("no_disponible");
  }

  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    let reply = "";
    const finish = (result: AntivirusResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(result);
    };
    const timeout = setTimeout(
      () => finish("no_disponible"),
      SCAN_TIMEOUT_MS,
    );
    socket.setTimeout(SCAN_TIMEOUT_MS);
    socket.on("timeout", () => finish("no_disponible"));
    socket.on("error", () => finish("no_disponible"));
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (reply.length > 2_048) {
        finish("no_disponible");
        return;
      }
      if (!reply.includes("\0")) return;
      const response = reply.split("\0", 1)[0] ?? "";
      if (/\bFOUND\b/.test(response)) finish("infectado");
      else if (/\bOK\b/.test(response)) finish("limpio");
      else finish("no_disponible");
    });
    socket.on("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0", "ascii"));
      for (let offset = 0; offset < data.length; offset += CHUNK_BYTES) {
        const part = data.subarray(offset, offset + CHUNK_BYTES);
        const header = Buffer.allocUnsafe(4);
        header.writeUInt32BE(part.length, 0);
        socket.write(header);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
