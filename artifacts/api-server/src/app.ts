import express, { type Express } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  next();
});
app.use(express.json({
  limit: "2mb",
  verify(req, _res, buffer) {
    if (req.url?.split("?")[0] === "/api/v1/webhooks/resend") {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    }
  },
}));

app.use("/api/v1", router);

const webDist = process.env.WEB_DIST_DIR;
if (webDist) {
  const webRoot = path.resolve(webDist);
  const indexFile = path.join(webRoot, "index.html");
  if (!existsSync(indexFile)) {
    throw new Error(`WEB_DIST_DIR does not contain index.html: ${webRoot}`);
  }
  app.use(express.static(webRoot, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indexFile);
      return;
    }
    next();
  });
}

app.use("/api/v1", (_req, res) => {
  res.status(404).json({ error: "No existe la ruta solicitada." });
});
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const failure = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const databaseFailure = failure.cause ?? failure;
  if (databaseFailure.code === "23514" && databaseFailure.message?.startsWith("COURSE_")) {
    res.status(409).json({ error: "El curso está cerrado o la referencia pertenece a otro curso. Actualiza la vista; el expediente histórico no se puede modificar." });
    return;
  }
  if ((failure as { status?: number }).status === 413) {
    res.status(413).json({ error: "El archivo recibido supera el límite de tamaño." });
    return;
  }
  logger.error({ err, method: req.method, path: req.path }, "Unhandled API error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Se produjo un error interno." });
});

export default app;
