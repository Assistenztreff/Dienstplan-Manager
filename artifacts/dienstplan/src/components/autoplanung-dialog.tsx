// ---------------------------------------------------------------------------
// Automatische Planung (Baustein 3, Kay-Entscheidung 01.09.2026)
// ---------------------------------------------------------------------------
// Der Assistent verteilt die offenen Plaetze EINES Regelplan-Dienstes reihum
// auf die gewaehlten Personen (Rotation mit Blocklaenge) und legt sie nach
// Bestaetigung der Vorschau als ENTWUERFE an — nie als FIX, der normale
// Planungs-Workflow (Vorschlag senden, bestaetigen) bleibt unveraendert.
//
// Bewusst schlicht gehalten (Kostenentscheidung): EIN Dialog mit vier
// Abschnitten statt eines mehrseitigen Wizards, die Vorschau rechnet live.
// Die Rechenlogik lebt vollstaendig in lib/autoplanung.ts (rein, getestet);
// hier stehen nur Formular, Vorschau und der Sammel-Anlegen-Aufruf
// (POST /shifts/bulk je Person — transaktional pro Person).
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useBulkCreateShifts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { readableApiError } from "@/lib/api-error";
import {
  invalidateArbeitsdienstSalden,
  naechsteTempId,
  removeShiftsFromCache,
  upsertShiftsInCache,
  type CachedShiftRow,
} from "@/lib/shift-cache";
import {
  offenePlaetzeFuerTag,
  schichtenNachTag,
  type GeruestDienst,
} from "@/lib/dienstgeruest";
import {
  planeRotation,
  zuweisungsStunden,
  type PlanPerson,
  type Zuweisung,
} from "@/lib/autoplanung";
import { isAbsenceShift, type Shift } from "@/pages/dienstplan-helpers";
import type { StundenkontoEintrag } from "@/components/stundenkonto-leiste";

const RUHEZEIT_STANDARD = 11;

type Props = {
  open: boolean;
  onClose: () => void;
  /** Dienste, die am Regelplan teilnehmen (Anzeigereihenfolge). */
  geruestDienste: GeruestDienst[];
  /** Alle Kalendertage des angezeigten Monats. */
  days: Date[];
  monatsLabel: string;
  shifts: Shift[];
  assistants: { id: number; name: string }[];
  absenceByUser: Map<number, Set<string>>;
  /** Stundenkonto-Bilanzen fuer die Budget-Warnung (leer ohne Vertraege). */
  eintraege: StundenkontoEintrag[];
  teamId: number | null;
  /** Free-Vorausplanungs-Grenze ist beim Aufrufer geprueft (Premium-Gate). */
};

/** Vorname fuer Hinweistexte. */
function vorname(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function AutoplanungDialog({
  open,
  onClose,
  geruestDienste,
  days,
  monatsLabel,
  shifts,
  assistants,
  absenceByUser,
  eintraege,
  teamId,
}: Props) {
  const queryClient = useQueryClient();
  const bulkCreate = useBulkCreateShifts();

  const [dienstIdRoh, setDienstIdRoh] = useState<string>("");
  // Personen in KLICK-Reihenfolge — sie ist die Rotationsreihenfolge.
  const [personenIds, setPersonenIds] = useState<number[]>([]);
  const [blockLaenge, setBlockLaenge] = useState("1");
  const [ruhezeit, setRuhezeit] = useState(String(RUHEZEIT_STANDARD));
  const [ruhezeitQuittiert, setRuhezeitQuittiert] = useState(false);
  const [anlegen, setAnlegen] = useState(false);

  const dienst =
    geruestDienste.find((d) => d.id === Number(dienstIdRoh)) ?? geruestDienste[0];

  // Offene Tage des gewaehlten Dienstes — exakt dieselbe Ableitung wie die
  // Platzhalter im Monatsraster (dienstgeruest.ts), damit Vorschau und
  // Anzeige nie auseinanderlaufen. Mit einem Unterschied: Der Assistent
  // plant nur AB HEUTE. Das Raster zeigt auch vergangene Luecken (die sind
  // Information), aber rueckwirkend automatisch Entwuerfe anzulegen ergaebe
  // nur Aufraeumarbeit.
  const offeneTage = useMemo(() => {
    if (!dienst) return [];
    const heute = format(new Date(), "yyyy-MM-dd");
    const proTag = schichtenNachTag(
      shifts.filter((s) => !isAbsenceShift(s)) as { shiftModelId?: number | null; startTime: string }[],
    );
    const ergebnis: string[] = [];
    for (const tag of days) {
      const key = format(tag, "yyyy-MM-dd");
      if (key < heute) continue;
      const plaetze = offenePlaetzeFuerTag([dienst], tag, proTag.get(key) ?? []);
      if (plaetze.length > 0) ergebnis.push(key);
    }
    return ergebnis;
  }, [dienst, days, shifts]);

  const personen: PlanPerson[] = personenIds
    .map((id) => assistants.find((a) => a.id === id))
    .filter((a): a is { id: number; name: string } => !!a);

  const ruhezeitZahl = Math.max(0, Number(ruhezeit) || 0);
  const ruhezeitReduziert = ruhezeitZahl < RUHEZEIT_STANDARD;

  const plan = useMemo(() => {
    if (!dienst || personen.length === 0) return null;
    return planeRotation({
      dienst: {
        id: dienst.id,
        name: dienst.name,
        startTime: dienst.defaultStartTime,
        endTime: dienst.defaultEndTime,
      },
      offeneTage,
      personen,
      blockLaenge: Math.max(1, Number(blockLaenge) || 1),
      ruhezeitStunden: ruhezeitZahl,
      bestehende: shifts.filter((s) => !isAbsenceShift(s)),
      abwesend: absenceByUser,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dienst?.id, offeneTage, personenIds.join(","), blockLaenge, ruhezeitZahl, shifts, absenceByUser]);

  // Budget-Warnung (Kay 31.08.2026: EINE Rueckfrage je Monat, kein Genoergel
  // bei jedem Dienst): je Person der Tag, ab dem das Monats-Soll ueberschritten
  // wuerde. Die Bestaetigung des Anlegen-Knopfs IST die Rueckfrage.
  const budgetWarnungen = useMemo(() => {
    if (!plan) return [];
    const proPerson = new Map<number, Zuweisung[]>();
    for (const z of plan.zuweisungen) {
      const liste = proPerson.get(z.userId) ?? [];
      liste.push(z);
      proPerson.set(z.userId, liste);
    }
    const warnungen: { name: string; abDatum: string; soll: number }[] = [];
    for (const [userId, liste] of proPerson) {
      const konto = eintraege.find((e) => e.id === userId);
      if (!konto?.hasContract) continue;
      let stand = konto.verplant;
      for (const z of liste) {
        stand += zuweisungsStunden(z);
        if (stand > konto.contractTarget) {
          warnungen.push({ name: z.name, abDatum: z.datum, soll: konto.contractTarget });
          break;
        }
      }
    }
    return warnungen;
  }, [plan, eintraege]);

  const bereit =
    !!dienst &&
    personen.length > 0 &&
    (plan?.zuweisungen.length ?? 0) > 0 &&
    (!ruhezeitReduziert || ruhezeitQuittiert);

  function togglePerson(id: number) {
    setPersonenIds((liste) =>
      liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id],
    );
  }

  async function handleAnlegen() {
    if (!dienst || !plan || !bereit || anlegen) return;
    setAnlegen(true);
    try {
      const proPerson = new Map<number, Zuweisung[]>();
      for (const z of plan.zuweisungen) {
        const liste = proPerson.get(z.userId) ?? [];
        liste.push(z);
        proPerson.set(z.userId, liste);
      }
      // Protokoll direkt am Dienst: Wer spaeter in den Eintrag schaut, sieht,
      // dass er automatisch geplant wurde — samt quittierter Ruhezeit.
      const stempel = format(new Date(), "dd.MM.yyyy");
      const notiz = ruhezeitReduziert
        ? `Automatisch geplant am ${stempel} — Ruhezeit ${ruhezeitZahl} h quittiert.`
        : `Automatisch geplant am ${stempel}.`;
      // ── Sofort anzeigen (Kay-Vorgabe 01.09.2026) ─────────────────────
      // Gemessen: 5 Personen kosteten 5 SEQUENZIELLE Requests plus sieben
      // Nachlade-Requests — lokal 1 s, auf dem echten Server mit ~1 s Latenz
      // je Roundtrip 12-15 s. Jetzt stehen alle Pillen im Raster, bevor der
      // erste Request rausgeht, und die Requests laufen PARALLEL: eine
      // Latenz statt fuenf, und der Nutzer wartet auf keine davon.
      const tempIds = new Map<number, number[]>();
      const vorlaeufige = plan.zuweisungen.map((z) => {
        const tempId = naechsteTempId();
        tempIds.set(z.userId, [...(tempIds.get(z.userId) ?? []), tempId]);
        return {
          id: tempId,
          userId: z.userId,
          type: "work",
          startTime: z.start.toISOString(),
          endTime: z.ende.toISOString(),
          planningStatus: "VORLAEUFIG",
          shiftModelId: dienst.id,
          notes: notiz,
          user: { name: z.name },
          istVorlaeufig: true,
        } as unknown as CachedShiftRow;
      });
      upsertShiftsInCache(queryClient, vorlaeufige, teamId);
      // Dialog sofort zu — das Ergebnis steht ja schon im Raster dahinter.
      onClose();

      const auftraege = [...proPerson.entries()];
      const ergebnisse = await Promise.allSettled(
        auftraege.map(([userId, liste]) =>
          bulkCreate.mutateAsync({
            data: {
              userId,
              type: "work",
              days: liste.map((z) => ({
                startTime: z.start.toISOString(),
                endTime: z.ende.toISOString(),
              })),
              planningStatus: "VORLAEUFIG",
              shiftModelId: dienst.id,
              notes: notiz,
              ...(teamId != null ? { teamId } : {}),
            },
          }),
        ),
      );

      const fehler: string[] = [];
      let angelegt = 0;
      for (const [i, ergebnis] of ergebnisse.entries()) {
        const [userId, liste] = auftraege[i]!;
        // Die vorlaeufigen Zeilen dieser Person weichen dem Ergebnis —
        // egal ob echte Schichten (Erfolg) oder gar nichts (Fehlschlag).
        removeShiftsFromCache(queryClient, tempIds.get(userId) ?? []);
        if (ergebnis.status === "fulfilled") {
          // BulkShiftsResult liefert die angelegten Zeilen in Listen-Form
          // samt aufgeloestem Team — genau das, was der Cache braucht.
          const { shifts: angelegteSchichten, teamId: zielTeam } = ergebnis.value;
          upsertShiftsInCache(queryClient, angelegteSchichten as CachedShiftRow[], zielTeam);
          angelegt += angelegteSchichten.length;
        } else {
          fehler.push(
            `${vorname(liste[0]!.name)}: ${readableApiError(ergebnis.reason, "Anlegen fehlgeschlagen")}`,
          );
        }
      }
      // Nur die beiden Stundenkonto-Salden nachladen; die Schicht-Listen sind
      // durch den Cache-Abgleich oben bereits richtig (s. shift-cache.ts).
      void invalidateArbeitsdienstSalden(queryClient);
      if (fehler.length === 0) {
        toast.success(
          `${angelegt} Dienste als Entwurf angelegt — prüfen, dann wie gewohnt als Vorschlag senden.`,
        );
      } else {
        toast.error(
          `${angelegt} Dienste angelegt, ${fehler.length} Person(en) fehlgeschlagen: ${fehler.join(" · ")}`,
        );
      }
    } finally {
      setAnlegen(false);
    }
  }

  const dienstwahlLeer = geruestDienste.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]"
        data-testid="autoplanung-dialog"
      >
        <DialogHeader>
          <DialogTitle>Automatische Planung — {monatsLabel}</DialogTitle>
        </DialogHeader>

        {dienstwahlLeer ? (
          <p className="text-sm text-muted-foreground">
            Kein Dienst nimmt am Regelplan teil. Schalte zuerst unter Einstellungen bei einem
            Dienst „Im Regelplan" ein — danach kann der Assistent dessen offene Plätze verteilen.
          </p>
        ) : (
          <div className="space-y-5">
            {/* 1 — Dienst */}
            <div className="space-y-1.5">
              <Label>Dienst</Label>
              <Select value={String(dienst?.id ?? "")} onValueChange={setDienstIdRoh}>
                <SelectTrigger data-testid="autoplanung-dienst">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {geruestDienste.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name} · {d.defaultStartTime}–{d.defaultEndTime}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {offeneTage.length} offene Plätze in diesem Monat (geplant wird ab heute).
              </p>
            </div>

            {/* 2 — Personen (Klick-Reihenfolge = Rotationsreihenfolge) */}
            <div className="space-y-1.5">
              <Label>Assistenzkräfte — in Rotationsreihenfolge antippen</Label>
              <div className="flex flex-wrap gap-1.5">
                {assistants.map((a) => {
                  const pos = personenIds.indexOf(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      data-testid={`autoplanung-person-${a.id}`}
                      onClick={() => togglePerson(a.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        pos >= 0
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {pos >= 0 && (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[10px] font-bold">
                          {pos + 1}
                        </span>
                      )}
                      {a.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3 — Rotation & Grenzen */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="autoplanung-block">Dienste am Stück</Label>
                <Input
                  id="autoplanung-block"
                  data-testid="autoplanung-block"
                  type="number"
                  min="1"
                  max="7"
                  value={blockLaenge}
                  onChange={(e) => setBlockLaenge(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Wie viele Dienste eine Person hintereinander übernimmt, bevor die nächste dran
                  ist.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="autoplanung-ruhezeit">Ruhezeit (Stunden)</Label>
                <Input
                  id="autoplanung-ruhezeit"
                  data-testid="autoplanung-ruhezeit"
                  type="number"
                  min="0"
                  max="48"
                  value={ruhezeit}
                  onChange={(e) => {
                    setRuhezeit(e.target.value);
                    setRuhezeitQuittiert(false);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Mindestabstand zwischen zwei Diensten einer Person — innerhalb eines Blocks
                  bewusst ausgenommen.
                </p>
              </div>
            </div>

            {/* Ruhezeit-Quittierung (entschaerfte Fassung, 31.08.2026): unter
                11 h nur mit bewusster Bestaetigung; die Quittierung wandert
                als Protokoll in die Notiz jedes angelegten Dienstes. */}
            {ruhezeitReduziert && (
              <label
                className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
                data-testid="autoplanung-quittierung"
              >
                <Checkbox
                  checked={ruhezeitQuittiert}
                  onCheckedChange={(v) => setRuhezeitQuittiert(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Das ArbZG sieht 11 Stunden Ruhezeit vor; Abweichungen sind nur auf tariflicher
                  Grundlage zulässig (§ 7 ArbZG — auch nicht tarifgebundene Arbeitgeber können
                  einen einschlägigen Tarifvertrag übernehmen). Ich bestätige, dass die
                  Voraussetzungen dafür geklärt sind. Die Bestätigung wird in der Notiz jedes
                  angelegten Dienstes festgehalten.
                </span>
              </label>
            )}

            {/* 4 — Vorschau */}
            <div className="space-y-1.5">
              <Label>Vorschau</Label>
              {personen.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Wähle mindestens eine Assistenzkraft aus.
                </p>
              ) : plan && plan.zuweisungen.length + plan.offenGeblieben.length > 0 ? (
                <div
                  className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border p-2"
                  data-testid="autoplanung-vorschau"
                >
                  {offeneTage.map((datum) => {
                    const z = plan.zuweisungen.find((x) => x.datum === datum);
                    const offen = plan.offenGeblieben.find((x) => x.datum === datum);
                    return (
                      <div
                        key={datum}
                        className="flex items-center justify-between gap-2 text-sm leading-6"
                        data-testid={`autoplanung-tag-${datum}`}
                      >
                        <span className="tabular-nums text-muted-foreground">
                          {format(new Date(`${datum}T00:00:00`), "EE dd.MM.", { locale: de })}
                        </span>
                        {z ? (
                          <span className="min-w-0 flex-1 truncate text-right font-medium">
                            {z.name}
                          </span>
                        ) : (
                          <span
                            className="min-w-0 flex-1 truncate text-right text-amber-700"
                            title={offen?.gruende
                              .map((g) => `${vorname(g.name)}: ${g.grund}`)
                              .join(", ")}
                          >
                            bleibt offen —{" "}
                            {offen && offen.gruende.length > 0
                              ? "niemand verfügbar"
                              : "keine Person wählbar"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Keine offenen Plätze — dieser Dienst ist im Monat bereits vollständig besetzt.
                </p>
              )}
              {plan && personen.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {plan.zuweisungen.length} von {offeneTage.length} Plätzen vergeben
                  {plan.offenGeblieben.length > 0
                    ? ` — ${plan.offenGeblieben.length} bleiben offen (Abwesenheit, Ruhezeit oder schon belegt).`
                    : "."}
                </p>
              )}
            </div>

            {/* Budget-Rueckfrage: EINMAL hier, nicht bei jedem Dienst. */}
            {budgetWarnungen.length > 0 && (
              <div
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
                data-testid="autoplanung-budget-warnung"
              >
                {budgetWarnungen.map((w) => (
                  <p key={w.name + w.abDatum}>
                    {vorname(w.name)} überschreitet das Monats-Soll ({w.soll.toLocaleString("de-DE")}{" "}
                    h) ab dem {format(new Date(`${w.abDatum}T00:00:00`), "dd.MM.", { locale: de })} —
                    wird mit „Anlegen" trotzdem eingeplant.
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={anlegen}>
            Abbrechen
          </Button>
          {!dienstwahlLeer && (
            <Button onClick={handleAnlegen} disabled={!bereit || anlegen} data-testid="autoplanung-anlegen">
              {anlegen
                ? "Lege an..."
                : `${plan?.zuweisungen.length ?? 0} Dienste als Entwurf anlegen`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
