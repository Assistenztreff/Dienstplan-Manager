import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import contractsRouter from "./contracts";
import shiftsListRouter from "./shifts-list";
import shiftsCrudRouter from "./shifts-crud";
import shiftsBulkRouter from "./shifts-bulk";
import shiftsConfirmationsRouter from "./shifts-confirmations";
import shiftsDeviationsRouter from "./shifts-deviations";
import shiftsSwapRequestsRouter from "./shifts-swap-requests";
import shiftsChangesRouter from "./shifts-changes";
import shiftModelsRouter from "./shift_models";
import allowancesRouter from "./allowances";
import brandingRouter from "./branding";
import storageRouter from "./storage";
import timeTrackingRouter from "./time_tracking";
import dashboardRouter from "./dashboard";
import monthClosingsRouter from "./month_closings";
import invitationsRouter from "./invitations";
import koordinatorenRouter from "./koordinatoren";
import calendarRouter from "./calendar";
import teamsRouter from "./teams";
import operatorRouter from "./operator";
import authRouter from "./auth";
import hourBudgetsRouter from "./hour_budgets";
import absenceRequestsRouter from "./absence-requests";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(usersRouter);
router.use(contractsRouter);
router.use(shiftsListRouter);
// REIHENFOLGE IST PFLICHT: Alle Router mit einem STATISCHEN GET-Pfad unter
// /shifts/<wort> muessen VOR shiftsCrudRouter stehen — der bringt
// GET /shifts/:id mit und wuerde "deviations" sonst als ID lesen
// (Number("deviations") => NaN => 400 "Invalid id"). Genau das ist am
// 28.08.2026 passiert: GET /shifts/deviations lief ins Leere, die
// Abweichungs-Liste blieb im Frontend dauerhaft leer und das "Gemeldet"-Badge
// erschien nie. Die uebrigen /shifts/<wort>-Routen (bulk, send-proposals, ...)
// sind POST und kollidieren deshalb nicht — shifts-crud hat kein POST
// /shifts/:id. Regressionstest: routes/index.route-order.test.ts.
router.use(shiftsDeviationsRouter);
router.use(shiftsSwapRequestsRouter);
router.use(shiftsChangesRouter);
router.use(shiftsCrudRouter);
router.use(shiftsBulkRouter);
router.use(shiftsConfirmationsRouter);
router.use(shiftModelsRouter);
router.use(allowancesRouter);
router.use(brandingRouter);
router.use(storageRouter);
router.use(timeTrackingRouter);
router.use(dashboardRouter);
router.use(monthClosingsRouter);
router.use(invitationsRouter);
router.use(koordinatorenRouter);
router.use(calendarRouter);
router.use(teamsRouter);
router.use(operatorRouter);
router.use(hourBudgetsRouter);
router.use(absenceRequestsRouter);

export default router;
