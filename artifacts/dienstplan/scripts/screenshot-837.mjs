// Abnahme-Screenshots für die Arbeitsanweisung 17.08.2026 (Pillen-Redesign,
// Folgeauftrag zu Task #836): kein linker Farbbalken mehr, größere
// Namens-/Uhrzeit-Schrift, hellere Uhr-Badge, Smartphone-Grauzone +
// "<N> Abw."-Text statt Kategorie-Farbtext.
// Läuft gegen den DEV-Stack (Vite-Proxy :80 + API :8080), seedet Dienste in
// der DEV-DB und räumt danach wieder auf.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";

const WEB = "http://127.0.0.1:80/dienstplan";
const OUT = "../../screenshots";
const JAR = "/tmp/screenshot-837-cookies.txt";

fs.mkdirSync(OUT, { recursive: true });

const today = new Date();
const y = today.getFullYear();
const m = String(today.getMonth() + 1).padStart(2, "0");
const dayNum = today.getDate() <= 25 ? today.getDate() + 1 : today.getDate() - 1;
const dayKey = `${y}-${m}-${String(dayNum).padStart(2, "0")}`;
const vacDayNum = dayNum <= 25 ? dayNum + 1 : dayNum - 1;
const vacDayKey = `${y}-${m}-${String(vacDayNum).padStart(2, "0")}`;

const created = { shifts: [] };
let bodySeq = 0;
function api(method, path, body) {
  let dataArg = "";
  if (body !== undefined) {
    const f = `/tmp/screenshot-837-body-${process.pid}-${bodySeq++}.json`;
    fs.writeFileSync(f, JSON.stringify(body));
    dataArg = `--data-binary @${f}`;
  }
  const cmd = `curl -s -S -b ${JAR} -c ${JAR} -X ${method} -H "content-type: application/json" ${dataArg} "http://localhost:8080${path}"`;
  return execSync(cmd).toString();
}

fs.rmSync(JAR, { force: true });
api("POST", "/api/auth/dev-login");
const users = JSON.parse(api("GET", "/api/users"));
const assistants = users.filter((u) => u.role === "assistant" && u.isActive !== false);
if (assistants.length < 1) throw new Error("Keine Assistenzkraft in der Dev-DB");
const a = assistants[0];

function addShift(day, start, end, planningStatus, type = "active", extra = {}) {
  const out = api("POST", "/api/shifts", {
    userId: a.id,
    type,
    startTime: `${day}T${start}:00.000Z`,
    endTime: `${day}T${end}:00.000Z`,
    planningStatus,
    ...extra,
  });
  const parsed = JSON.parse(out);
  if (!parsed.id) throw new Error(`Seed fehlgeschlagen: ${out.slice(0, 200)}`);
  created.shifts.push(parsed.id);
  return parsed.id;
}

const fixId = addShift(dayKey, "08:00", "14:00", "FIX");
const draftId = addShift(dayKey, "15:00", "20:00", "VORLAEUFIG", "active", { isVertretung: true });
addShift(vacDayKey, "00:00", "23:59", "FIX", "vacation");
console.log(`[Seed] FIX #${fixId} + Entwurf/Vertretung #${draftId} an ${dayKey}, Urlaub an ${vacDayKey}`);

const browser = await chromium.launch({
  executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
try {
  // ── Desktop: Monatsraster (Grid), volle zweizeilige Pille ────────────────
  const dctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const dp = await dctx.newPage();
  await dp.goto(WEB);
  const gridToggle = dp.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid");
  await gridToggle.waitFor({ timeout: 60000 });
  if ((await gridToggle.getAttribute("data-active")) !== "true") await gridToggle.click();
  const monthGrid = dp.getByTestId("dienstplan-desktop").getByTestId("month-grid");
  await monthGrid.waitFor({ timeout: 60000 });
  const fixChip = dp.getByTestId("dienstplan-desktop").getByTestId(`day-chip-${fixId}`);
  await fixChip.waitFor({ timeout: 30000 });

  // Sicherstellen: pillMinimiert ist AUS (volle zweizeilige Pille).
  const minimiertToggle = dp.getByTestId("pill-minimiert-toggle");
  if ((await minimiertToggle.count()) > 0 && (await minimiertToggle.getAttribute("data-active")) === "true") {
    await minimiertToggle.click();
  }

  const leftBarCount = await fixChip.locator("span[aria-hidden='true'].absolute.left-0").count();
  console.log(`[Desktop] Linker Farbbalken an der Pille: ${leftBarCount} (erw. 0)`);
  if (leftBarCount !== 0) throw new Error("Linker Farbbalken noch vorhanden");

  const nameSpan = fixChip.locator('[data-testid^="day-chip-label-"]').first();
  const nameFontSize = await nameSpan.evaluate((el) => getComputedStyle(el).fontSize).catch(() => null);
  console.log(`[Desktop] Namensfeld font-size: ${nameFontSize} (erw. 12px)`);

  await fixChip.scrollIntoViewIfNeeded();
  await dp.screenshot({ path: `${OUT}/nachher-837-desktop-monat.jpg`, type: "jpeg", quality: 90 });
  const fixBox = await fixChip.boundingBox();
  await dp.screenshot({
    path: `${OUT}/nachher-837-desktop-pille-zoom.jpg`,
    type: "jpeg",
    quality: 90,
    clip: { x: Math.max(0, fixBox.x - 20), y: Math.max(0, fixBox.y - 20), width: fixBox.width + 220, height: fixBox.height + 80 },
  });
  await dctx.close();

  // ── Smartphone: Dauerzustand-Grid mit Grauzone + "<N> Abw." ──────────────
  const mctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  const mp = await mctx.newPage();
  await mp.goto(WEB);
  const mobile = mp.getByTestId("dienstplan-mobile");
  const gridToggleM = mp.getByTestId("view-toggles-mobile").getByTestId("view-toggle-grid");
  await gridToggleM.waitFor({ timeout: 60000 });
  if ((await gridToggleM.getAttribute("data-active")) !== "true") await gridToggleM.click();
  const mobileChip = mobile.getByTestId(`day-chip-${fixId}`);
  await mobileChip.waitFor({ timeout: 30000 });

  const mobileLeftBar = await mobileChip.locator("span[aria-hidden='true'].absolute.left-0").count();
  console.log(`[Smartphone] Linker Farbbalken an der Kurz-Pille: ${mobileLeftBar} (erw. 0)`);
  if (mobileLeftBar !== 0) throw new Error("Linker Farbbalken an der Smartphone-Pille noch vorhanden");

  const absenceText = mobile.getByTestId(`day-absence-text-${vacDayKey}`);
  await absenceText.waitFor({ timeout: 15000 });
  const absenceTextContent = (await absenceText.innerText()).trim();
  const absenceColor = await absenceText.evaluate((el) => getComputedStyle(el).color);
  console.log(`[Smartphone] Abwesenheitstext: "${absenceTextContent}" Farbe ${absenceColor} (erw. "1 Abw." / rgb(21, 21, 21))`);
  if (absenceTextContent !== "1 Abw.") throw new Error(`Unerwarteter Abwesenheitstext: "${absenceTextContent}"`);

  const pillWrap = mobile.getByTestId(`day-cell-${dayKey}`).locator("div.bg-\\[\\#eef0f3\\]").first();
  const wrapBg = await pillWrap.evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null);
  console.log(`[Smartphone] Pillenbereich-Hintergrund: ${wrapBg} (erw. rgb(238, 240, 243))`);

  await mp.screenshot({ path: `${OUT}/nachher-837-mobile-monat.jpg`, type: "jpeg", quality: 90 });
  await mctx.close();

  console.log("[OK] Alle Abnahme-Prüfungen bestanden");
} finally {
  const keep = process.argv.includes("--keep");
  if (keep) {
    console.log(`[Cleanup] ÜBERSPRUNGEN (--keep) — IDs: ${created.shifts.join(",")}`);
  } else {
    for (const id of created.shifts) {
      try {
        api("DELETE", `/api/shifts/${id}`);
      } catch {
        // best effort
      }
    }
    console.log(`[Cleanup] ${created.shifts.length} Seed-Dienste gelöscht`);
  }
  await browser.close();
}
