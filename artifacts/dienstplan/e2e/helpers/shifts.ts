import { expect, type Page } from "@playwright/test";

type ApiShift = { id: number; userId: number; startTime: string };

/**
 * Entfernt alle Schichten des Nutzers, die an den Tagen day-1..day+1 des
 * angegebenen Monats beginnen (deckt auch Übernacht-/24h-Dienste ab).
 *
 * Hintergrund: Seit der Free/Premium-Einführung ist die Vorausplanung auch für
 * Premium auf 12 Monate begrenzt — die Specs können Kollisionen also nicht mehr
 * durch "weit in die Zukunft navigieren" vermeiden. Stattdessen räumt jeder
 * Spec seinen Zieltag vor dem Anlegen frei, damit Leftover-Schichten aus
 * früheren (ggf. abgebrochenen) Läufen keine Überschneidungs-Warnung auslösen.
 */
export async function clearUserShiftsAroundDay(
  page: Page,
  year: number,
  month: number,
  day: number,
  userId: number,
): Promise<void> {
  const res = await page.request.get(`/api/shifts?month=${month}&year=${year}`);
  expect(res.ok(), "GET /api/shifts (Pre-Clean) fehlgeschlagen").toBe(true);
  const shifts = (await res.json()) as ApiShift[];
  for (const s of shifts) {
    if (s.userId !== userId) continue;
    const start = new Date(s.startTime);
    if (start.getFullYear() !== year || start.getMonth() + 1 !== month) continue;
    if (Math.abs(start.getDate() - day) <= 1) {
      const del = await page.request.delete(`/api/shifts/${s.id}`);
      expect(del.ok(), `Pre-Clean der Schicht ${s.id} fehlgeschlagen`).toBe(true);
    }
  }
}
