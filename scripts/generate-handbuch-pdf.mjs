/**
 * Generiert ein PDF des Handbuchs aus der laufenden Dienstplan-App.
 * Aufruf:  node scripts/generate-handbuch-pdf.mjs
 */

import pkg from "/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js";
const { chromium } = pkg;
import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.HANDBUCH_BASE_URL || "http://localhost:80";

const KAPITEL = [
  { title: "Handbuch – Startseite", path: "/handbuch" },
  { title: "Registrierung & Einstieg", path: "/handbuch/registrierung" },
  { title: "Rollen verstehen", path: "/handbuch/rollen" },
  { title: "Dashboard", path: "/handbuch/dashboard" },
  { title: "Dienstplan", path: "/handbuch/dienstplan" },
  { title: "Assistenten", path: "/handbuch/assistenten" },
  { title: "Zeiterfassung", path: "/handbuch/zeiterfassung" },
  { title: "Abwesenheiten", path: "/handbuch/abwesenheiten" },
  { title: "Auswertungen", path: "/handbuch/auswertungen" },
  { title: "Team-Verwaltung", path: "/handbuch/team-verwaltung" },
  { title: "Einstellungen", path: "/handbuch/einstellungen" },
];

const OUT_DIR = path.join(__dirname, "../artifacts/dienstplan/public");
const OUT_FILE = path.join(OUT_DIR, "handbuch.pdf");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
  });

  const pdfBuffers = [];

  for (const kapitel of KAPITEL) {
    const url = `${BASE_URL}${kapitel.path}`;
    console.log(`📄  ${kapitel.title}  →  ${url}`);

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

    // Kurz warten, damit Fonts/Bilder vollständig geladen sind
    await page.waitForTimeout(800);

    // Navigationsleisten und interaktive Elemente für den Druck ausblenden
    await page.addStyleTag({
      content: `
        nav, header, [data-dienstplan-header], .dev-bar,
        [aria-label="Handbuch-Navigation"], aside { display: none !important; }
        body { background: white !important; }
        @media print { * { -webkit-print-color-adjust: exact !important; } }
      `,
    });

    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "18mm", right: "18mm" },
    });

    pdfBuffers.push(pdfBytes);
    await page.close();
  }

  await browser.close();

  console.log("🔗  PDFs zusammenführen …");
  const merged = await PDFDocument.create();

  for (const bytes of pdfBuffers) {
    const doc = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }

  const finalBytes = await merged.save();
  fs.writeFileSync(OUT_FILE, finalBytes);
  console.log(`✅  Gespeichert: ${OUT_FILE}  (${(finalBytes.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
