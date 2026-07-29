// Dev-Port-Selbstheilung (Task: Vorschau bleibt erreichbar, auch wenn ein
// abgebrochener Testlauf die Server-Ports blockiert).
//
// Problem: Ein hart abgebrochener/parallel gekillter (Test-)Lauf kann
// verwaiste Server-Prozesse hinterlassen, die die Dev-Ports (z. B. Vite auf
// dem Workflow-PORT, API auf 8080) weiter belegen. Die Dev-Workflows starten
// dann rot mit "Port already in use" und die App-Vorschau ist tot, bis jemand
// von Hand aufräumt.
//
// Lösung: Dieses Skript läuft VOR dem eigentlichen Dev-Serverstart (siehe
// "dev"-Skripte der Artefakte). Es erkennt Prozesse, die auf dem eigenen
// PORT lauschen, und beendet sie (SIGTERM, notfalls SIGKILL) — analog zum
// E2E-Waisen-Reaper in artifacts/dienstplan/playwright.config.ts, der nur
// die dedizierten Test-Ports (8099/5199) räumt.
//
// Sicherheitsleitplanken:
//   - NUR in Entwicklung: In Produktion/Deployment (NODE_ENV=production oder
//     REPLIT_DEPLOYMENT gesetzt) wird NICHTS beendet — dort wäre ein belegter
//     Port ein echter Fehler, der laut scheitern soll.
//   - Bewusst kein `import` aus Workspace-Paketen: reines Node-Skript, damit
//     es vor jedem Dev-Start ohne Build/tsx laufen kann.
//   - Ist der Port frei (Normalfall), passiert nichts und der Start läuft
//     ohne Verzögerung weiter.
//   - Kann der Port nicht freigeräumt werden, bricht das Skript mit einer
//     klaren Meldung ab (der Serverstart würde sonst ohnehin scheitern).

import { spawnSync } from "node:child_process";

const rawPort = process.env.PORT;

if (!rawPort) {
  // Ohne PORT startet der Server selbst nicht (Vite/API validieren das) —
  // hier still durchlassen, die eigentliche Fehlermeldung kommt vom Server.
  process.exit(0);
}

const port = Number.parseInt(rawPort, 10);
if (!Number.isInteger(port) || port <= 0) {
  process.exit(0);
}

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT) {
  // Niemals in Produktion fremde Prozesse beenden.
  process.exit(0);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// PIDs aller Prozesse, die auf dem Port LAUSCHEN (lsof: exit 1 = keine Treffer).
function listListenerPids() {
  const res = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (res.error != null) {
    console.warn(
      `[free-dev-port] lsof für Port ${port} nicht ausführbar: ${res.error.message}`,
    );
    return [];
  }
  if (!res.stdout) return [];
  return res.stdout
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function killAll(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      /* Prozess evtl. schon weg */
    }
  }
}

function waitUntilFree(deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (listListenerPids().length === 0) return true;
    sleepSync(250);
  }
  return listListenerPids().length === 0;
}

let pids = listListenerPids();
if (pids.length === 0) {
  process.exit(0);
}

console.log(
  `[free-dev-port] Port ${port} ist belegt — vermutlich Waisen eines abgebrochenen Laufs. Beende PID(s) ${pids.join(", ")} (SIGTERM)...`,
);
killAll(pids, "SIGTERM");

if (waitUntilFree(5_000)) {
  console.log(`[free-dev-port] Port ${port} ist wieder frei.`);
  process.exit(0);
}

pids = listListenerPids();
console.log(
  `[free-dev-port] Port ${port} nach SIGTERM weiter belegt — SIGKILL für PID(s) ${pids.join(", ")}.`,
);
killAll(pids, "SIGKILL");

if (waitUntilFree(5_000)) {
  console.log(`[free-dev-port] Port ${port} ist wieder frei.`);
  process.exit(0);
}

console.error(
  `[free-dev-port] Port ${port} ist weiterhin belegt und konnte nicht freigeräumt werden — bitte manuell prüfen (lsof -ti tcp:${port} -sTCP:LISTEN).`,
);
process.exit(1);
