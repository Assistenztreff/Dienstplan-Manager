import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Dev-only: loest absichtlich einen unbehandelten Fehler aus, um den
// zentralen Error-Handler + das Fehler-Tracking (platform_errors) end-to-end
// zu testen. Durch den NODE_ENV-Guard in Produktion nicht vorhanden.
if (process.env.NODE_ENV !== "production") {
  router.get("/dev/boom", async (): Promise<void> => {
    throw new Error("Dev-Testfehler (absichtlich ausgeloest ueber /dev/boom)");
  });
}

export default router;
