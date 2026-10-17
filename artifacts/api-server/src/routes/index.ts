import { Router, type IRouter } from "express";
import authRouter from "./auth";
import activitiesRouter from "./activities";
import catalogRouter from "./catalog";
import dashboardRouter from "./dashboard";
import documentsRouter from "./documents";
import healthRouter from "./health";
import indicatorsRouter from "./indicators";
import informationRouter from "./information";
import plansRouter from "./plans";
import staffRouter from "./staff";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(activitiesRouter);
router.use(documentsRouter);
router.use(informationRouter);
router.use(indicatorsRouter);
router.use(staffRouter);
router.use(usersRouter);
router.use(catalogRouter);
router.use(plansRouter);

export default router;
