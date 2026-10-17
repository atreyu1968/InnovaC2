import { Router, type IRouter } from "express";
import authRouter from "./auth";
import catalogRouter from "./catalog";
import dashboardRouter from "./dashboard";
import healthRouter from "./health";
import plansRouter from "./plans";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(usersRouter);
router.use(catalogRouter);
router.use(plansRouter);

export default router;
