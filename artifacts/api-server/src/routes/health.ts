import { Router, type IRouter, type RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import { verifyWritableStorage } from "../lib/storage";

const router: IRouter = Router();

const health: RequestHandler = async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    await verifyWritableStorage();
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Health check failed");
    res.status(503).json({ status: "unavailable" });
  }
};

router.get("/health", health);
router.get("/healthz", health);

export default router;
