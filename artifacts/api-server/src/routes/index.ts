import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import contractsRouter from "./contracts";
import shiftsRouter from "./shifts";
import shiftModelsRouter from "./shift_models";
import timeTrackingRouter from "./time_tracking";
import dashboardRouter from "./dashboard";
import invitationsRouter from "./invitations";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(usersRouter);
router.use(contractsRouter);
router.use(shiftsRouter);
router.use(shiftModelsRouter);
router.use(timeTrackingRouter);
router.use(dashboardRouter);
router.use(invitationsRouter);

export default router;
