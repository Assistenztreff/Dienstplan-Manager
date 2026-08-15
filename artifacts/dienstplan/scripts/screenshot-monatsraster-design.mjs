// Abnahme-Screenshots + Prüfungen für den Design-Auftrag 15.08.2026
// (Monatsraster Desktop: volle Wochentagsnamen, #dfe4ea-Rahmen, weiße
// Kopfzeile + graue Pillenzone, Mindesthöhe, erhabene Pillen).
// Läuft gegen den DEV-Stack (Vite-Proxy :80 + API :8080), seedet Dienste in
// der DEV-DB und räumt danach wieder auf.
// API-Zugriff via curl (Node-fetch/undici bekommt die Session hier nicht durch).
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";

const WEB = "http://127.0.0.1:80/dienstplan";
const OUT = "../../screenshots";
const JAR = "/tmp/screenshot-mrd-cookies.txt";

const today = new Date();
const y = today.getFullYear();
const m = String(today.getMonth() + 1).padStart(2, "0");
const d1 = today.getDate() <= 24 ? today.getDate() + 1 : today.getDate() - 3;
const dayKey = `${y}-${m}-${String(d1).padStart(2, "0")}`;
// Heute-Markierung: 2-px-Rahmen in Dunkelblau um die ganze Zelle.
const todayKey = `${y}-${m}-${String(today.getDate()).padStart(2, "0")}`;

const created = [];
let bodySeq = 0;
function api(method, path, body) {
  let dataArg = "";
  if (body !== undefined) {
    const f = `/tmp/screenshot-mrd-body-${process.pid}-${bodySeq++}.json`;
    fs.writeFileSync(f, JSON.stringify(body));
    dataArg = `--data-binary @${f}`;
  }
  const cmd = `curl -s -S -b ${JAR} -c ${JAR} -X ${method} -H "content-type: application/json" ${dataArg} "http://localhost:8080${path}"`;
  return execSync(cmd).toString();
}

let rot = 0;
let assistants = [];
function addShift(day, start, end) {
  for (let tries = 0; tries < assistants.length; tries++) {
    const u = assistants[rot % assistants.length];
    rot++;
    try {
      const out = api("POST", "/api/shifts", {
        userId: u.id,
        type: "active",
        startTime: `${day}T${start}:00.000Z`,
        endTime: `${day}T${end}:00.000Z`,
        planningStatus: "FIX",
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

addShift(dayKey, "08:00", "12:00");
addShift(dayKey, "13:00", "17:00");
console.log(`[Seed] ${created.length} Dienste am ${dayKey} angelegt`);

const browser = await chromium.launch({
  executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
try {
  for (const [label, width] of [["breit", 1280], ["schmal", 820]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(WEB);
    // Explizit auf die Monatsansicht schalten (localStorage-Drift).
    const gridToggle = page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid");
    await gridToggle.waitFor({ timeout: 60000 });
    if ((await gridToggle.getAttribute("data-active")) !== "true") await gridToggle.click();
    const desktop = page.getByTestId("dienstplan-desktop");
    const grid = desktop.getByTestId("month-grid");
    await grid.waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);

    if (width >= 900) {
      // ── Abnahme 1: volle Wochentagsnamen bei breitem Viewport ────────────
      const headerText = await desktop
        .locator("..")
        .locator("div.sticky.grid")
        .first()
        .innerText()
        .catch(() => "");
      const bodyText = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid="dienstplan-desktop"] span'))
          .map((el) => el.textContent)
          .join("|"),
      );
      const hasFull = /Donnerstag/.test(bodyText) || /Donnerstag/.test(headerText);
      const fullVisible = await page
        .locator('[data-testid="dienstplan-desktop"]')
        .locator("xpath=..")
        .evaluate((root) => {
          const spans = Array.from(root.querySelectorAll("span"));
          const el = spans.find((s) => s.textContent === "Donnerstag");
          return el ? getComputedStyle(el).display !== "none" && el.offsetParent !== null : false;
        });
      console.log(`[${label}] Volle Wochentagsnamen sichtbar: ${fullVisible} (im DOM: ${hasFull})`);
      if (!fullVisible) throw new Error("Donnerstag ist bei 1280px nicht sichtbar");
      // Schriftgröße 15px prüfen
      const fs15 = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span"));
        const el = spans.find((s) => s.textContent === "Donnerstag" && s.offsetParent !== null);
        return el ? getComputedStyle(el.parentElement).fontSize : null;
      });
      console.log(`[${label}] Wochentag-Schriftgröße: ${fs15} (erw. 15px)`);
    } else {
      // ── Abnahme 2: Kürzel bei schmalem Viewport ──────────────────────────
      const abbrVisible = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span"));
        const full = spans.find((s) => s.textContent === "Donnerstag" && s.offsetParent !== null);
        const abbr = spans.find((s) => s.textContent === "Do" && s.offsetParent !== null);
        return { full: !!full, abbr: !!abbr };
      });
      console.log(`[${label}] Kürzel sichtbar: ${abbrVisible.abbr}, volle Namen sichtbar: ${abbrVisible.full}`);
      if (abbrVisible.full || !abbrVisible.abbr) throw new Error("Kürzel-Fallback unter 900px greift nicht");
    }

    // ── Abnahme 3: Rahmen-, Grauzonen- und Pillen-Styles ───────────────────
    // Der aktuelle Monat kann in der Dev-DB komplett belegt sein — für die
    // Leerer-Tag-Prüfung notfalls bis zu 4 Monate weiterblättern.
    let hasEmpty = false;
    for (let hop = 0; hop < 4 && width >= 900; hop++) {
      // Heute ausklammern: dessen Zone ist gelblich getönt, nicht #eef0f3.
      hasEmpty = await page.evaluate((tKey) => {
        const desk = document.querySelector('[data-testid="dienstplan-desktop"]');
        const cells = Array.from(desk.querySelectorAll('[data-testid^="day-cell-"]'));
        return cells.some((c) => !c.querySelector('[data-testid^="day-chip-"]') && c.dataset.testid !== `day-cell-${tKey}`);
      }, todayKey);
      if (hasEmpty) break;
      await page.getByTestId("next-month").click();
      await page.waitForTimeout(1200);
    }
    // Danach ggf. wieder zurück zum Seed-Monat für Pillen-Prüfung + Screenshot:
    // Grauzonen-Werte des leeren Tags JETZT einsammeln.
    const emptyStyles = width >= 900
      ? await page.evaluate((tKey) => {
          const desk = document.querySelector('[data-testid="dienstplan-desktop"]');
          const cells = Array.from(desk.querySelectorAll('[data-testid^="day-cell-"]'));
          const emptyCell = cells.find((c) => !c.querySelector('[data-testid^="day-chip-"]') && c.dataset.testid !== `day-cell-${tKey}`);
          const gz = emptyCell && Array.from(emptyCell.children).find(
            (ch) => getComputedStyle(ch).backgroundColor === "rgb(238, 240, 243)",
          );
          return {
            found: !!emptyCell,
            emptyHasGray: !!gz,
            emptyGrayHeight: gz ? gz.getBoundingClientRect().height : null,
            emptyGrayFillsBottom: gz
              ? Math.abs(gz.getBoundingClientRect().bottom - emptyCell.getBoundingClientRect().bottom) < 2
              : null,
          };
        }, todayKey)
      : { found: false };
    while (width >= 900) {
      const onSeedMonth = await page.evaluate(
        (seedDay) => !!document.querySelector(`[data-testid="dienstplan-desktop"] [data-testid="day-cell-${seedDay}"]`),
        dayKey,
      );
      if (onSeedMonth) break;
      await page.getByTestId("prev-month").click();
      await page.waitForTimeout(1200);
    }
    const styles = await page.evaluate(({ seedDay, tKey }) => {
      const desk = document.querySelector('[data-testid="dienstplan-desktop"]');
      const grid = desk.querySelector('[data-testid="month-grid"]');
      const cellSeed = desk.querySelector(`[data-testid="day-cell-${seedDay}"]`);
      const cellToday = desk.querySelector(`[data-testid="day-cell-${tKey}"]`);
      const cells = Array.from(desk.querySelectorAll('[data-testid^="day-cell-"]'));
      const emptyCell = cells.find((c) => !c.querySelector('[data-testid^="day-chip-"]'));
      const grayZone = (c) => c && Array.from(c.children).find((ch) => getComputedStyle(ch).backgroundColor === "rgb(238, 240, 243)");
      const pill = cellSeed?.querySelector('[data-testid^="day-chip-"]');
      return {
        gridBorder: getComputedStyle(grid).borderTopColor + " / " + getComputedStyle(grid).borderLeftColor,
        gridBg: getComputedStyle(grid).backgroundColor,
        seedHasGray: !!grayZone(cellSeed),
        pillBorder: pill ? getComputedStyle(pill).borderTopColor : null,
        pillShadow: pill ? getComputedStyle(pill).boxShadow : null,
        todayBorder: cellToday
          ? `${getComputedStyle(cellToday).borderTopWidth} ${getComputedStyle(cellToday).borderTopColor} / ${getComputedStyle(cellToday).borderBottomWidth} ${getComputedStyle(cellToday).borderBottomColor}`
          : null,
      };
    }, { seedDay: dayKey, tKey: todayKey });
    console.log(`[${label}] Styles:`, JSON.stringify({ ...styles, ...emptyStyles }, null, 2));
    if (width >= 900) {
      if (!styles.gridBg.includes("223, 228, 234")) throw new Error("Trennlinien-Farbe #dfe4ea fehlt (grid bg)");
      if (!styles.seedHasGray) throw new Error("Grauzone #eef0f3 fehlt in der Seed-Zelle");
      if (!emptyStyles.found) throw new Error("Kein leerer Tag in 4 Monaten gefunden — Prüfung unvollständig");
      if (!emptyStyles.emptyHasGray) throw new Error("Grauzone #eef0f3 fehlt am leeren Tag");
      if (!emptyStyles.emptyGrayFillsBottom) throw new Error("Grauzone füllt leere Zelle nicht bis unten");
      if (emptyStyles.emptyGrayHeight !== null && emptyStyles.emptyGrayHeight < 40) throw new Error(`Grauzone-Mindesthöhe < 40px (${emptyStyles.emptyGrayHeight})`);
      if (!styles.pillBorder?.includes("199, 206, 216")) throw new Error("Pillen-Kontur #c7ced8 fehlt");
      if (!styles.pillShadow || styles.pillShadow === "none") throw new Error("Pillen-Schatten fehlt");
      if (!styles.todayBorder?.startsWith("2px rgb(9, 41, 72)") || !styles.todayBorder?.includes("/ 2px rgb(9, 41, 72)")) throw new Error(`Heute-Rahmen 2px #092948 fehlt (${styles.todayBorder})`);
    }

    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/monatsraster-design-${label}.png` });
    console.log(`[${label}] Screenshot gespeichert: ${OUT}/monatsraster-design-${label}.png`);
    await ctx.close();
  }
} finally {
  await browser.close();
  for (const id of created) {
    try { api("DELETE", `/api/shifts/${id}`); } catch { /* Cleanup best effort */ }
  }
  console.log(`[Cleanup] ${created.length} Seed-Dienste gelöscht`);
}
