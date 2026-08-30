// ---------------------------------------------------------------------------
// Nutzergebundene Nachweis-Tabellen — EINE Quelle fuer alle Aufrufer.
// ---------------------------------------------------------------------------
// Seit dem Loeschschutz (§ 16 ArbZG / § 17 MiLoG) haengen diese Tabellen per
// user_id mit ON DELETE RESTRICT am Konto. Wer ein Konto loescht, muss sie
// vorher ausdruecklich abraeumen — frueher erledigte das die Kaskade.
//
// WARUM HIER UND NICHT ZWEIMAL: die Liste wird an zwei voellig verschiedenen
// Stellen gebraucht — vom echten Loesch-Endpunkt (artifacts/api-server,
// routes/users.ts) und vom Test-Cleanup (lib/test-fixtures). Genau so ein
// Doppel hat am 28.08.2026 den Fehler in der Melde-Regel verursacht: dieselbe
// Regel an mehreren Stellen gebaut, nur eine davon getestet. Eine neue
// Nachweis-Tabelle wird jetzt an EINER Stelle eingetragen und wirkt sofort in
// beiden Pfaden.
//
// REIHENFOLGE IST TEIL DER REGEL: die Schicht-Protokolltabellen zuerst (sie
// haengen zusaetzlich am Dienst), danach die uebrigen, zuletzt die Dienste
// selbst.
// ---------------------------------------------------------------------------

export const USER_BOUND_RESTRICT_TABLES = [
  "shift_changes",
  "shift_deviation_reports",
  "shift_correction_objections",
  "time_tracking",
  "absence_requests",
  "contracts",
  "shifts",
] as const;

export type UserBoundRestrictTable = (typeof USER_BOUND_RESTRICT_TABLES)[number];
