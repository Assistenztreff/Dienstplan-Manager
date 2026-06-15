/**
 * Zentrale Typen- und Status-Definitionen für den Dienstplan.
 *
 * Diese Datei bündelt fachliche Planungstypen, die quer durch die Oberfläche
 * (z. B. Dienstplan- und Dashboard-Ansicht) genutzt werden können. Import über
 * den Alias `@/types/dienstplan`.
 */

/**
 * Mögliche Zustände eines Dienstes im Planungs- und Lebenszyklus.
 *
 * Die String-Werte sind die persistierten/übertragenen Kennungen; die Schlüssel
 * dienen der sprechenden Verwendung im Code.
 */
export enum DienstStatus {
  /** Interne Planung, noch nicht veröffentlicht. */
  ENTWURF = "VORLAEUFIG",
  /** Dem Mitarbeiter angeboten, wartet auf Bestätigung. */
  VORSCHLAG = "ANGEBOTEN",
  /** Verbindlich bestätigter, fixer Dienst. */
  BESTAETIGT = "FIX",
  /** Vergangener, abgeschlossener Dienst (archiviert). */
  ARCHIVIERT = "BEENDET",
  /** Krankheitsbedingter Ausfall. */
  KRANKHEIT = "KRANK",
  /** Absage durch den Mitarbeiter. */
  ABSAGE_MAB = "ABSAGE_MITARBEITER",
  /** Absage durch den Arbeitgeber bzw. Planer. */
  ABSAGE_AG = "ABSAGE_ARBEITGEBER",
}

/**
 * Vorlage für wiederkehrende Arbeitszeiten (z. B. Früh-, Spät- oder Nachtdienst).
 */
export interface SchichtVorlage {
  /** Eindeutige Kennung der Vorlage. */
  id: string;
  /** Anzeigename, z. B. "Frühdienst" oder "Spätdienst". */
  name: string;
  /** Startzeit im Format "HH:MM". */
  startZeit: string;
  /** Endzeit im Format "HH:MM". */
  endZeit: string;
  /** Gültige Wochentage als Zahlen von 1 (Montag) bis 7 (Sonntag). */
  giltWochentage: number[];
}
