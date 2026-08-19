// Abnahme-Skript Task #855 (Tabellenansicht: zweizeilige Zellen im Pillen-Design).
// Prüft gegen den DEV-Stack (Vite-Proxy :80 + API :8080):
//  1. Zelle zeigt zweizeiliges weißes Feld (Status-Icon + Farbbalken / Uhr + Zeit),
//  2. die Uhrzeit „HH:mm – HH:mm" wird NICHT abgeschnitten (scrollWidth-Check),
//  3. Bestätigen-Button (VORLAEUFIG) sichtbar + Klick → Status FIX,
//  4. Klick auf die Zelle öffnet den Bearbeiten-Dialog.
// Seedet in einem Folgemonat (leere Tage) und räumt danach wieder auf.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";

const WEB = "http://127.0.0.1:80/dienstplan";
const OUT = "../../screenshots";
const JAR = "/tmp/screenshot-855-cookies.txt";
fs.mkdirSync(OUT, { recursive: true });

// Zwei Monate in der Zukunft — dort ist die Dev-DB erfahrungsgemäß leer.
const base = new Date();
const target = new Date(base.getFullYear(), base.getMonth() + 2, 1);
const ty = target.getFullYear();
const tm = String(target.getMonth() + 1).padStart(2, "0");
const dayKey = (d) => `${ty}-${tm}-${String(d).padStart(2, "0")}`;

const created = { shifts: [] };
let bodySeq = 0;
function api(method, path, body) {
  let dataArg = "";
  if (body !== undefined) {
    const f = `/tmp/screenshot-855-body-${process.pid}-${bodySeq++}.json`;
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

function addShift(day, start, end, planningStatus, extra = {}) {
  const out = api("POST", "/api/shifts", {
    userId: a.id,
    type: "active",
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

const fixId = addShift(dayKey(6), "09:15", "17:45", "FIX", { notes: "Notiz für #855" });
const draftId = addShift(dayKey(7), "08:00", "14:30", "VORLAEUFIG");

const executable = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executable) throw new Error("REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE fehlt");

const browser = await chromium.launch({ executablePath: executable });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Dienstplan", exact: true }).waitFor({ timeout: 30000 });

  // Tabellenansicht sicherstellen (localStorage-Drift) + Zielmonat ansteuern.
  const toggle = page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-table");
  if ((await toggle.getAttribute("data-active")) !== "true") await toggle.click();
  for (let i = 0; i < 2; i++) {
    await page.getByTestId("next-month").click();
    await page.waitForTimeout(400);
  }

  const desktop = page.getByTestId("dienstplan-desktop");
  const fixBadge = desktop.getByTestId(`shift-badge-${fixId}`);
  const draftBadge = desktop.getByTestId(`shift-badge-${draftId}`);
  await fixBadge.waitFor({ timeout: 15000 });
  await draftBadge.waitFor({ timeout: 15000 });

  // (2) Uhrzeit darf nicht abgeschnitten sein und muss „HH:mm – HH:mm" zeigen.
  for (const [id, badge] of [[fixId, fixBadge], [draftId, draftBadge]]) {
    const info = await badge.evaluate((el) => {
      const time = el.querySelector(".truncate");
      return {
        text: time?.textContent ?? "",
        clipped: time ? time.scrollWidth > time.clientWidth : true,
        bg: getComputedStyle(el).backgroundColor,
        wraps: el.getBoundingClientRect().height,
      };
    });
    console.log(`Badge ${id}:`, JSON.stringify(info));
    if (info.clipped) throw new Error(`Uhrzeit in Badge ${id} abgeschnitten: "${info.text}"`);
    if (!/^\d{2}:\d{2} – \d{2}:\d{2}$/.test(info.text)) throw new Error(`Uhrzeit-Format falsch: "${info.text}"`);
    if (info.bg !== "rgb(255, 255, 255)") throw new Error(`Hintergrund nicht weiß: ${info.bg}`);
  }

  // Notiz-Icon am FIX-Dienst vorhanden.
  await desktop.getByTestId(`shift-note-icon-${fixId}`).waitFor({ timeout: 5000 });

  await page.screenshot({ path: `${OUT}/task-855-tabelle-zellen.png`, fullPage: false });

  // (3) Bestätigen-Button am Entwurf → Klick → FIX.
  const confirmBtn = desktop.getByTestId(`shift-confirm-${draftId}`);
  await confirmBtn.waitFor({ timeout: 5000 });
  const btnClipped = await confirmBtn.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  if (btnClipped) throw new Error("Bestätigen-Button läuft über die Zellenbreite hinaus");
  await confirmBtn.click();
  await page.waitForFunction(
    ([id]) => document.querySelector(`[data-testid="shift-badge-${id}"]`)?.getAttribute("data-planning-status") === "FIX",
    [draftId],
    { timeout: 10000 },
  );
  console.log("Bestätigen-Button → Status FIX ✓");

  // (4) Zellen-Klick öffnet den Bearbeiten-Dialog.
  await fixBadge.click();
  await page.getByTestId("shift-dialog").waitFor({ timeout: 10000 });
  console.log("Zellen-Klick → Bearbeiten-Dialog ✓");
  await page.keyboard.press("Escape");

  console.log("ALLE PRÜFUNGEN OK");
} finally {
  await browser.close();
  for (const id of created.shifts) {
    try { api("DELETE", `/api/shifts/${id}`); } catch { /* best effort */ }
  }
}
