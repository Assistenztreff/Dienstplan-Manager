import { expect, type Page } from "@playwright/test";

/**
 * Helfer für die Einstellungsseite nach der Neuordnung nach Tragweite.
 *
 * Die Seite hat vier Gruppen. Die beiden oberen ("abrechnungsgrundlagen",
 * "zuschlaege") sind immer offen. Die beiden unteren sind eingeklappt, damit
 * die Seite kurz bleibt:
 *
 * - `struktur`    — Schichtmodelle, Monatliches Stundenbudget, Profil
 * - `darstellung` — Firmenlogo, Assistenzkraft-Farben, Kalender-Export/Abo
 *
 * Wer im Test etwas aus einer der unteren Gruppen bedient, muss sie vorher
 * öffnen. Assistenzkräfte sehen die Gruppen gar nicht (nur Profil und
 * Kalender-Abo direkt) — dort ist der Aufruf ein No-op.
 */
export type Einstellungsgruppe = "struktur" | "darstellung";

/**
 * Öffnet eine eingeklappte Einstellungsgruppe, falls sie zu ist.
 * Idempotent: ein zweiter Aufruf lässt eine offene Gruppe offen.
 */
export async function openSettingsGroup(
  page: Page,
  gruppe: Einstellungsgruppe,
): Promise<void> {
  const schalter = page.getByTestId(`gruppe-schalter-${gruppe}`);
  // Assistenzkräfte bekommen keine Gruppen — dann gibt es nichts zu öffnen.
  if ((await schalter.count()) === 0) return;
  await expect(schalter).toBeVisible();
  if ((await schalter.getAttribute("aria-expanded")) === "true") return;
  await schalter.click();
  await expect(schalter).toHaveAttribute("aria-expanded", "true");
}
