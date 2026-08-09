// Abnahme-Screenshots + Prüfungen für Task #746 (Mobile Listenansicht:
// Wochen-Kapitel, leere Tage einzeilig, Wochenend-Hervorhebung).
// Läuft gegen den DEV-Stack (Vite-Proxy :80 + API :8080), seedet Dienste in
// der DEV-DB und räumt danach wieder auf.
// API-Zugriff via curl (Node-fetch/undici bekommt die Session hier nicht durch).
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";

const WEB = "http://127.0.0.1:80/dienstplan";
const OUT = "../../screenshots";
const JAR = "/tmp/screenshot-746-cookies.txt";

// Heutiges Datum (Dev-Umgebung) → wir seeden im aktuellen Monat.
const today = new Date();
const y = today.getFullYear();
const m = String(today.getMonth() + 1).padStart(2, "0");
const todayKey = `${y}-${m}-${String(today.getDate()).padStart(2, "0")}`;
// Zwei Seed-Tage: heute + ein weiterer Tag in derselben Woche/Monat.
const otherDay = today.getDate() <= 25 ? today.getDate() + 2 : today.getDate() - 2;
const otherKey = `${y}-${m}-${String(otherDay).padStart(2, "0")}`;

const created = [];
let bodySeq = 0;
function api(method, path, body) {
  let dataArg = "";
  if (body !== undefined) {
    const f = `/tmp/screenshot-746-body-${process.pid}-${bodySeq++}.json`;
    fs.writeFileSync(f, JSON.stringify(body));
    dataArg = `--data-binary @${f}`;
  }
  const cmd = `curl -s -S -b ${JAR} -c ${JAR} -X ${method} -H "content-type: application/json" ${dataArg} "http://localhost:8080${path}"`;
  return execSync(cmd).toString();
}

let rot = 0;
let assistants = [];
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
if (assistants.length < 2) throw new Error("Zu wenige Assistenzkräfte in der Dev-DB");

addShift(todayKey, "08:00", "14:00");
addShift(todayKey, "14:00", "22:00");
const draftId = addShift(otherKey, "08:00", "14:00", "VORLAEUFIG");
console.log(`[Seed] ${created.length} Dienste angelegt (heute: ${todayKey}, Entwurf am ${otherKey}: #${draftId})`);

const browser = await chromium.launch({
  executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
try {
  const mctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const mp = await mctx.newPage();
  await mp.goto(WEB);
  const mobile = mp.getByTestId("dienstplan-mobile");
  // Explizit auf die Listenansicht schalten (localStorage-Drift).
  const listToggle = mp.getByTestId("view-toggles-mobile").getByTestId("view-toggle-list");
  await listToggle.waitFor({ timeout: 60000 });
  if ((await listToggle.getAttribute("data-active")) !== "true") await listToggle.click();
  const agenda = mobile.getByTestId("agenda-view");
  await agenda.waitFor({ timeout: 60000 });

  // ── Abnahme 1: Wochen-Kapitel vorhanden ─────────────────────────────────
  const weekCount = await agenda.locator('[data-testid^="agenda-week-"]').count();
  console.log(`[Liste] ${weekCount} Wochen-Kapitel (erw. 5–6 im Monat)`);
  if (weekCount < 4) throw new Error("Wochen-Kapitel fehlen");
  const firstHeader = await agenda.locator("h3").first().innerText();
  console.log(`[Liste] Erste Wochen-Überschrift: "${firstHeader}"`);
  if (!/^KW \d+ · /.test(firstHeader)) throw new Error("Wochen-Überschrift falsch formatiert");

  // ── Abnahme 2: leerer Tag ist einzeilig, Hinweis + Plus in der Kopfzeile ─
  let emptyKey = null;
  for (let d = 1; d <= 28; d++) {
    const k = `${y}-${m}-${String(d).padStart(2, "0")}`;
    if (k === todayKey || k === otherKey) continue;
    const cell = agenda.getByTestId(`agenda-day-${k}`);
    if ((await cell.count()) === 1 && (await cell.locator('[data-testid^="shift-badge-"]').count()) === 0) {
      emptyKey = k;
      break;
    }
  }
  const emptyCell = agenda.getByTestId(`agenda-day-${emptyKey}`);
  const emptyText = await emptyCell.innerText();
  if (!emptyText.includes("Schicht hinzufügen")) throw new Error(`Hinweis fehlt am leeren Tag ${emptyKey}: "${emptyText}"`);
  if (emptyText.includes("Keine Schichten")) throw new Error("Alter Leerzustands-Text noch vorhanden");
  const emptyBox = await emptyCell.boundingBox();
  const btnBox = await emptyCell.locator("button").first().boundingBox();
  console.log(`[Liste] Leerer Tag ${emptyKey}: Zeilenhöhe ${emptyBox.height.toFixed(1)}px (Button ${btnBox.height.toFixed(1)}px, erw. ≥44)`);
  if (btnBox.height < 44) throw new Error("Touch-Ziel unter 44px");
  if (emptyBox.height > btnBox.height + 4) throw new Error("Leerer Tag ist nicht einzeilig");

  // ── Abnahme 3: Tag mit Diensten zeigt einzeilige DayDetail-Zeilen ────────
  const todayCell = agenda.getByTestId(`agenda-day-${todayKey}`);
  const badges = todayCell.locator('[data-testid^="shift-badge-"]');
  const badgeCount = await badges.count();
  console.log(`[Liste] Heute (${todayKey}): ${badgeCount} Dienst-Zeilen (erw. ≥2)`);
  if (badgeCount < 2) throw new Error("Dienst-Zeilen fehlen");
  const rowText = await badges.first().innerText();
  if (!/\d{2}:\d{2}–\d{2}:\d{2}/.test(rowText)) throw new Error(`Zeit fehlt in Zeile: "${rowText}"`);
  if (!rowText.includes("Dienst")) throw new Error(`Eintragsart fehlt in Zeile: "${rowText}"`);
  const rowBox = await badges.first().boundingBox();
  console.log(`[Liste] Dienst-Zeile: ${rowBox.height.toFixed(1)}px hoch, Text: "${rowText.replace(/\n/g, " | ")}"`);
  // Heute-Chip
  const heuteChip = await todayCell.getByText("Heute", { exact: true }).count();
  console.log(`[Liste] Heute-Chip vorhanden: ${heuteChip > 0}`);
  if (heuteChip === 0) throw new Error("Heute-Chip fehlt");
  // Entwurf-Zeile mit Bestätigen-Button
  const confirmBtn = agenda.getByTestId(`shift-confirm-${draftId}`);
  if ((await confirmBtn.count()) === 0) throw new Error("Bestätigen-Button an Entwurf fehlt");
  console.log("[Liste] Entwurf-Zeile mit Bestätigen-Button sichtbar");

  // ── Abnahme 4: Wochenend-Zeilen fett (Sa/So) ─────────────────────────────
  let weekendKey = null;
  for (let d = 1; d <= 28; d++) {
    const dt = new Date(y, today.getMonth(), d);
    if (dt.getDay() === 6) { weekendKey = `${y}-${m}-${String(d).padStart(2, "0")}`; break; }
  }
  const weekendCell = agenda.getByTestId(`agenda-day-${weekendKey}`);
  const wdSpan = weekendCell.locator("button span").nth(1);
  const fontWeight = await wdSpan.evaluate((el) => getComputedStyle(el).fontWeight);
  const wdText = await wdSpan.innerText();
  console.log(`[Liste] Samstag ${weekendKey}: Wochentag "${wdText}" font-weight=${fontWeight} (erw. 700)`);
  if (Number(fontWeight) < 700) throw new Error("Wochenend-Wochentag nicht fett");
  if (wdText.length > 2) throw new Error(`Wochentag nicht abgekürzt: "${wdText}"`);

  // ── Screenshots ──────────────────────────────────────────────────────────
  await mp.screenshot({ path: `${OUT}/nachher-746-liste-oben.jpg`, type: "jpeg", quality: 85 });
  await todayCell.scrollIntoViewIfNeeded();
  await mp.screenshot({ path: `${OUT}/nachher-746-liste-heute.jpg`, type: "jpeg", quality: 85 });
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
