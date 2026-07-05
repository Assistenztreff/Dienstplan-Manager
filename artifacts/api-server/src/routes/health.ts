import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { DEV_BOOM_ROUTE_PATH } from "@workspace/test-fixtures";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Dev-only: loest absichtlich einen unbehandelten Fehler aus, um den
// zentralen Error-Handler + das Fehler-Tracking (platform_errors) end-to-end
// zu testen. Durch den NODE_ENV-Guard in Produktion nicht vorhanden.
if (process.env.NODE_ENV !== "production") {
  // Optionales `?label=`: haengt eine Markierung an die Fehlermeldung an.
  // Da die Buendelung in platform_errors ueber Meldung+Kontext laeuft,
  // erzeugt ein eindeutiges Label gezielt einen EIGENEN (einmaligen)
  // Eintrag — noetig fuer E2E-Tests des Wiederholungs-Zaehlers (N×),
  // die einen nur einmal aufgetretenen Fehler daneben brauchen.
  router.get(DEV_BOOM_ROUTE_PATH, async (req): Promise<void> => {
    const label = typeof req.query.label === "string" ? req.query.label.trim() : "";
    const suffix = label ? ` [${label}]` : "";
    throw new Error(
      `Dev-Testfehler (absichtlich ausgeloest ueber /dev/boom)${suffix}`,
    );
  });
}

export default router;
