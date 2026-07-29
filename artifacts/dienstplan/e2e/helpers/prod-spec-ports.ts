/**
 * Gemeinsame Quelle für die Ports des Prod-Modus-Specs
 * (dienstplan-prod-dev-switcher-hidden.spec.ts).
 *
 * Sowohl das Spec (startet API-Server + vite preview auf diesen Ports) als
 * auch playwright.config.ts (Waisen-Reaper räumt hängengebliebene Prozesse
 * auf genau diesen Ports auf) importieren von hier. So können Spec-Ports und
 * Aufräum-Liste nicht mehr unbemerkt auseinanderlaufen (Task #639).
 *
 * ACHTUNG: Dieses Modul muss frei von Seiteneffekten bleiben — es wird beim
 * Laden der Playwright-Config importiert.
 */

export const PROD_SPEC_API_PORT = 8097;
export const PROD_SPEC_WEB_PORT = 5197;
