// Nachher-Screenshots + Abnahme-Nachweise für Arbeitspaket 07.08.2026 (#710).
// Läuft gegen den DEV-Stack (Vite-Proxy :80 + API :8080), seedet 4-/6-Dienste-
// Tage + Urlaub in der DEV-DB und räumt danach wieder auf.
// API-Zugriff via curl (Node-fetch/undici bekommt die Session hier nicht durch).
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";

const WEB = "http://127.0.0.1:80/dienstplan";
const OUT = "../../screenshots";
const JAR = "/tmp/screenshot-710-cookies.txt";
const DAY4 = "2026-08-17"; // Mo — 4 Dienste
const DAY6 = "2026-08-18"; // Di — 6 Dienste (einer Entwurf)
const DAYV = "2026-08-19"; // Mi — Urlaub

const created = [];

let bodySeq = 0;
function api(method, path, body) {
  let dataArg = "";
  if (body !== undefined) {
    const f = `/tmp/screenshot-710-body-${process.pid}-${bodySeq++}.json`;
    fs.writeFileSync(f, JSON.stringify(body));
    dataArg = `--data-binary @${f}`;
  }
  const cmd = `curl -s -S -b ${JAR} -c ${JAR} -X ${method} -H "content-type: application/json" ${dataArg} "http://localhost:8080${path}"`;
  return execSync(cmd).toString();
}

let rot = 0;
let assistants = [];
// Rotiert über die Assistenzkräfte, damit bestehende Dev-Daten (Overlaps,
// fehlende Verträge) übersprungen werden.
function addShift(day, start, end, planningStatus = "FIX", type = "active") {
  for (let tries = 0; tries < assistants.length; tries++) {
    const u = assistants[rot % assistants.length];
    rot++;
    try {
      const out = api("POST", "/api/shifts", {
        userId: u.id,
        type,
        startTime: `${day}T${start}:00.000Z`,
        endTime: `${day}T${end}:00.000Z`,
        planningStatus,
      });
      const parsed = JSON.parse(out);
      if (parsed.id) {
        created.push(parsed.id);
        return parsed.id;
      }
      console.log(`  [skip] ${u.name} (#${u.id}): ${out.slice(0, 140)}`);
    } catch (err) {
      console.log(`  [skip] ${u.name} (#${u.id}): curl-Fehler ${String(err).slice(0, 120)}`);
    }
  }
  throw new Error(`Shift ${day} ${start} konnte mit keiner Assistenzkraft angelegt werden`);
}

fs.rmSync(JAR, { force: true });
api("POST", "/api/auth/dev-login");
const users = JSON.parse(api("GET", "/api/users"));
assistants = users.filter((u) => u.role === "assistant" && u.isActive !== false);
if (assistants.length < 3) throw new Error("Zu wenige Assistenzkräfte in der Dev-DB");

for (const [s, e] of [["06:00", "14:00"], ["08:00", "16:00"], ["10:00", "18:00"], ["12:00", "20:00"]]) addShift(DAY4, s, e);
let draftId;
for (const [i, [s, e]] of [["05:00", "09:00"], ["06:00", "10:00"], ["07:00", "11:00"], ["09:00", "13:00"], ["10:00", "14:00"], ["11:00", "15:00"]].entries()) {
  const id = addShift(DAY6, s, e, i === 5 ? "VORLAEUFIG" : "FIX");
  if (i === 5) draftId = id;
}
addShift(DAYV, "00:00", "23:59", "FIX", "vacation");
console.log(`[Seed] ${created.length} Dienste angelegt (Entwurf: ${draftId})`);

// Verifikation: Seeds serverseitig sichtbar?
const august = JSON.parse(api("GET", "/api/shifts?month=8&year=2026"));
const mine = august.filter((s) => created.includes(s.id));
console.log(`[Verify] ${mine.length}/${created.length} Seeds in GET /api/shifts sichtbar`);

const browser = await chromium.launch({
  executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
async function debugShot(page, name) {
  try {
    await page.screenshot({ path: `${OUT}/debug-710-${name}.jpg`, type: "jpeg", quality: 70, fullPage: true });
    console.log(`[Debug] Screenshot: screenshots/debug-710-${name}.jpg | url=${page.url()}`);
  } catch (e) {
    console.log(`[Debug] Screenshot fehlgeschlagen: ${e}`);
  }
}
try {
  // ── Desktop ─────────────────────────────────────────────────────────────
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await dctx.newPage();
  await page.goto(WEB);
  const desktop = page.getByTestId("dienstplan-desktop");
  // Standardansicht Desktop ist „Tabelle" → auf Monatsraster umschalten
  const gridToggle = page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid");
  await gridToggle.waitFor({ timeout: 60000 });
  if ((await gridToggle.getAttribute("data-active")) !== "true") await gridToggle.click();
  try {
    await desktop.getByTestId("month-grid").waitFor({ timeout: 60000 });
  } catch (e) {
    console.log("[Debug] month-grid nicht sichtbar — Login-Formular?", await page.locator("input#email").count());
    await debugShot(page, "desktop-nogrid");
    throw e;
  }
  const cell4 = desktop.getByTestId(`day-cell-${DAY4}`);
  try {
    await cell4.locator('[data-testid^="day-chip-"]').first().waitFor({ timeout: 45000 });
  } catch (e) {
    const cells = await desktop.locator('[data-testid^="day-cell-"]').count();
    console.log(`[Debug] Grid da (${cells} Zellen), aber keine Chips in ${DAY4}`);
    await debugShot(page, "desktop-nochips");
    throw e;
  }
  const cell6 = desktop.getByTestId(`day-cell-${DAY6}`);
  const chips4 = await cell4.locator('[data-testid^="day-chip-"]').count();
  const chips6 = await cell6.locator('[data-testid^="day-chip-"]').count();
  const more6 = await desktop.getByTestId(`day-more-${DAY6}`).innerText();
  console.log(`[Desktop] 4er-Tag: ${chips4} Pillen (erw. 4) | 6er-Tag: ${chips6} Pillen (erw. 4) + Überlauf "${more6.trim()}" (erw. +2)`);
  if (chips4 !== 4 || chips6 !== 4 || more6.trim() !== "+2") throw new Error("Pillen-Abnahme fehlgeschlagen");

  // Tagesleiste: 6er-Tag wählen (Klick oben links aufs Datum = nur Auswahl)
  await cell6.click({ position: { x: 8, y: 8 } });
  const panel = desktop.getByTestId("day-detail-panel");
  await panel.getByTestId(`shift-confirm-${draftId}`).waitFor();
  const rowCount = await panel.locator('[data-testid^="shift-badge-"]').count();
  console.log(`[Desktop] Tagesleiste 6er-Tag: ${rowCount} Zeilen (erw. 6), Entwurf mit Bestätigen-Button`);
  if (rowCount !== 6) throw new Error("Tagesleisten-Zeilen fehlerhaft");
  await page.screenshot({ path: `${OUT}/nachher-710-desktop.jpg`, type: "jpeg", quality: 80, fullPage: true });

  // Gruppierung: Zeitraum „Diese Woche" → Tagesüberschriften
  await panel.getByTestId("day-detail-range-filter").click();
  await page.getByRole("option", { name: "Diese Woche" }).click();
  await panel.getByText("Montag, 17. August").waitFor();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/nachher-710-desktop-woche.jpg`, type: "jpeg", quality: 80, fullPage: true });
  console.log("[Desktop] Gruppierung mit Tagesüberschriften sichtbar");
  await dctx.close();

  // ── Smartphone ──────────────────────────────────────────────────────────
  const mctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const mp = await mctx.newPage();
  await mp.goto(WEB);
  const mobile = mp.getByTestId("dienstplan-mobile");
  // Standardansicht Smartphone ist „Liste" → auf Monatsraster umschalten
  const mGridToggle = mp.getByTestId("view-toggles-mobile").getByTestId("view-toggle-grid");
  await mGridToggle.waitFor({ timeout: 60000 });
  if ((await mGridToggle.getAttribute("data-active")) !== "true") await mGridToggle.click();
  await mobile.getByTestId(`day-bars-${DAY6}`).waitFor({ timeout: 45000 });

  // Quadrat-Prüfung (zugeklappt): Zelle ohne Einträge ≈ 1:1
  let squareDay = null;
  for (const d of ["2026-08-31", "2026-08-30", "2026-08-26", "2026-08-25"]) {
    if ((await mobile.getByTestId(`day-bars-${d}`).count()) === 0) { squareDay = d; break; }
  }
  const sq = await mobile.getByTestId(`day-cell-${squareDay}`).boundingBox();
  console.log(`[Mobil zugeklappt] Quadrat-Zelle (${squareDay}): ${sq.width.toFixed(1)}x${sq.height.toFixed(1)}`);
  if (Math.abs(sq.width - sq.height) > 3) throw new Error("Leere Zelle nicht quadratisch");
  await mp.screenshot({ path: `${OUT}/nachher-710-smartphone-collapsed.jpg`, type: "jpeg", quality: 80, fullPage: true });

  // Aufklappen: 4 Pillen + Überlauf; die 6er-Woche wächst über das Quadrat hinaus
  await mp.getByTestId("toggle-mobile-expand").click();
  const mcell6 = mobile.getByTestId(`day-cell-${DAY6}`);
  await mcell6.locator('[data-testid^="day-chip-"]').first().waitFor();
  const mchips6 = await mcell6.locator('[data-testid^="day-chip-"]').count();
  if (mchips6 !== 4) throw new Error("Mobile Pillen-Abnahme fehlgeschlagen");
  const grown = await mcell6.boundingBox();
  const sameRow = await mobile.getByTestId(`day-cell-${DAY4}`).boundingBox();
  const sqAfter = await mobile.getByTestId(`day-cell-${squareDay}`).boundingBox();
  console.log(`[Mobil aufgeklappt] 6er-Tag: ${mchips6} Pillen (erw. 4) | 6er-Woche: ${grown.height.toFixed(1)}px hoch | leere Woche: ${sqAfter.height.toFixed(1)}px | Nachbarzelle (17.): ${sameRow.height.toFixed(1)}px`);
  if (grown.height <= sqAfter.height + 10) throw new Error("6er-Woche wächst nicht über das Quadrat hinaus");
  if (Math.abs(grown.height - sameRow.height) > 1) throw new Error("Wochenzeile nicht einheitlich hoch");
  await mp.screenshot({ path: `${OUT}/nachher-710-smartphone-expanded.jpg`, type: "jpeg", quality: 80, fullPage: true });

  // Tagesleiste am Smartphone: Urlaubs-Tag → einzeilige Zeile
  await mobile.getByTestId(`day-cell-${DAYV}`).click({ position: { x: 20, y: 20 } });
  const mpanel = mobile.getByTestId("day-detail-panel");
  await mpanel.getByText("Abwesenheit · Urlaub").waitFor();
  await mpanel.scrollIntoViewIfNeeded();
  await mpanel.screenshot({ path: `${OUT}/nachher-710-smartphone-tagesleiste.jpg`, type: "jpeg", quality: 85 });
  console.log("[Mobil] Tagesleiste zeigt einzeilige Abwesenheits-Zeile");
  await mctx.close();
  console.log("[OK] Alle Abnahme-Prüfungen bestanden");
} finally {
  const keep = process.argv.includes("--keep");
  if (keep) {
    console.log(`[Cleanup] ÜBERSPRUNGEN (--keep) — IDs: ${created.join(",")}`);
  } else {
    for (const id of created) {
      try {
        api("DELETE", `/api/shifts/${id}`);
      } catch {
        // best effort
      }
    }
    console.log(`[Cleanup] ${created.length} Seed-Dienste gelöscht`);
  }
  await browser.close();
}
