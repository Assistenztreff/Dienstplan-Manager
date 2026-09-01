// ---------------------------------------------------------------------------
// Dienstgerüst — offene Plätze BERECHNEN, nicht speichern
// ---------------------------------------------------------------------------
// Kay-Entscheidung 01.09.2026. Das Monatsraster zeigt an jedem Tag, welche
// Dienste des Regelplans dort noch unbesetzt sind. Diese Plätze existieren
// NUR als Anzeige: Es gibt keine Platzhalter-Zeilen in der Datenbank.
//
// Warum das wichtig ist: PDF-Export (pdf-export.ts), Stundenliste
// (stundenliste-xlsx.ts), Auswertung und Zeitkonto lesen ausschliesslich
// echte Schichten. Ein offener Platz taucht dort deshalb gar nicht auf —
// weder als Null-Stunde noch als leere Zeile. Genau deshalb kostet das
// Gerüst dort keine einzige Änderung.
//
// Die Regel steht am Dienst (shift_models):
//   imRegelplan  — nimmt dieser Dienst überhaupt am Gerüst teil?
//   defaultWeekdays — an welchen Wochentagen?
//   validFrom    — ab wann? (null = seit jeher)
//   standbySlot  — ist eine Vertretung vorgesehen?
//
// Die ANZAHL der Plätze pro Tag ergibt sich aus der Anzahl der Dienste im
// Regelplan, nicht aus einem Zähler am einzelnen Dienst: 1×24h ergibt einen
// Platz, 3×8h ergibt drei. Bewusst so, siehe Entscheidung vom 01.09.2026.
// ---------------------------------------------------------------------------

/** Die Felder eines Dienstes, die das Gerüst braucht. */
export type GeruestDienst = {
  id: number;
  name: string;
  color: string;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultWeekdays: number[];
  isActive: boolean;
  imRegelplan: boolean;
  /** "YYYY-MM-DD" oder null/undefined = seit jeher gültig. */
  validFrom?: string | null;
  standbySlot: boolean;
};

/** Die Felder einer vorhandenen Schicht, die das Gerüst braucht. */
export type GeruestSchicht = {
  shiftModelId?: number | null;
  startTime: string | Date;
};

/** Ein offener Platz an einem Tag — reine Anzeige, kein Datensatz. */
export type OffenerPlatz = {
  dienstId: number;
  name: string;
  color: string;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM"; gleich der Startzeit bedeutet 24-Stunden-Dienst. */
  endTime: string;
  /** Sieht dieser Dienst eine vorgemerkte Vertretung vor? */
  standbySlot: boolean;
};

/** Wochentag eines Datums als 1 (Montag) bis 7 (Sonntag). */
export function wochentagIso(tag: Date): number {
  const d = tag.getDay();
  return d === 0 ? 7 : d;
}

/** Datum als "YYYY-MM-DD" in LOKALER Zeit (nicht UTC — das Raster denkt lokal). */
export function tagesSchluessel(tag: Date): string {
  const j = tag.getFullYear();
  const m = String(tag.getMonth() + 1).padStart(2, "0");
  const t = String(tag.getDate()).padStart(2, "0");
  return `${j}-${m}-${t}`;
}

/**
 * Gilt die Regel dieses Dienstes an diesem Tag?
 *
 * Drei Bedingungen, alle müssen zutreffen: Der Dienst ist aktiv und im
 * Regelplan, der Wochentag passt, und der Tag liegt nicht vor `validFrom`.
 * Der Datumsvergleich läuft rein lexikografisch über "YYYY-MM-DD" — dieses
 * Format sortiert von sich aus richtig und ist zeitzonenfest, anders als ein
 * Vergleich von Date-Objekten.
 */
export function regelGiltAnTag(dienst: GeruestDienst, tag: Date): boolean {
  if (!dienst.isActive || !dienst.imRegelplan) return false;
  if (!dienst.defaultWeekdays.includes(wochentagIso(tag))) return false;
  if (dienst.validFrom && tagesSchluessel(tag) < dienst.validFrom) return false;
  return true;
}

/**
 * Die offenen Plätze eines Tages.
 *
 * Ein Platz gilt als besetzt, sobald an diesem Tag eine Schicht mit genau
 * diesem Schichtmodell liegt. Eine freihändig angelegte Schicht OHNE Modell
 * besetzt bewusst keinen Platz: Sie gehört zu keinem Regeldienst, und die
 * Lücke im Regelplan bleibt damit sichtbar — was sie ja auch ist.
 *
 * `dienste` sollte bereits in Anzeigereihenfolge (sortOrder) vorliegen; die
 * Rückgabe behält diese Reihenfolge bei, damit Früh/Spät/Nacht im Raster
 * immer gleich untereinander stehen.
 */
export function offenePlaetzeFuerTag(
  dienste: GeruestDienst[],
  tag: Date,
  schichtenDesTages: GeruestSchicht[],
): OffenerPlatz[] {
  const besetzteModelle = new Set<number>();
  for (const s of schichtenDesTages) {
    if (s.shiftModelId != null) besetzteModelle.add(s.shiftModelId);
  }

  const plaetze: OffenerPlatz[] = [];
  for (const dienst of dienste) {
    if (!regelGiltAnTag(dienst, tag)) continue;
    if (besetzteModelle.has(dienst.id)) continue;
    plaetze.push({
      dienstId: dienst.id,
      name: dienst.name,
      color: dienst.color,
      startTime: dienst.defaultStartTime,
      endTime: dienst.defaultEndTime,
      standbySlot: dienst.standbySlot,
    });
  }
  return plaetze;
}

/**
 * Schichten eines Monats nach Tag gruppieren ("YYYY-MM-DD" -> Schichten).
 * Das Raster ruft die Ableitung einmal je Tag auf; ohne diese Gruppierung
 * würde es für jeden Tag erneut die ganze Monatsliste filtern.
 */
export function schichtenNachTag<T extends GeruestSchicht>(schichten: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const s of schichten) {
    const d = s.startTime instanceof Date ? s.startTime : new Date(s.startTime);
    const key = tagesSchluessel(d);
    const vorhanden = map.get(key);
    if (vorhanden) vorhanden.push(s);
    else map.set(key, [s]);
  }
  return map;
}

/** Nimmt mindestens ein Dienst am Regelplan teil? Steuert, ob das Raster überhaupt Plätze zeichnet. */
export function hatRegelplan(dienste: GeruestDienst[]): boolean {
  return dienste.some((d) => d.isActive && d.imRegelplan);
}
