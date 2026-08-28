import { useEffect, useRef, useState } from "react";
import { format, isSameDay, isToday, getDay, addDays } from "date-fns";
import { de } from "date-fns/locale";
import { StatusBadge } from "@/components/status-badge";
import { nameInitials } from "@/lib/shift-model-colors";
import { ABSENCE_CATEGORY } from "@/components/abwesenheits-kalender";
import {
  dienstStatusColor,
  dienstStatusLabel,
  dienstStatusTextColor,
  isAbsenceShift,
  lastName,
  lastNameInitial,
  PillAvatar,
  type Shift,
  type ShiftModelInfo,
  usePersonColors,
  usePersonSlotLookup,
  WEEKDAY_LABELS,
  WEEKDAY_LABELS_FULL,
} from "./dienstplan-helpers";

export function MonthGrid({
  days,
  monthStart,
  shifts,
  modelMap,
  selectedDay,
  onSelectDay,
  onAddShift,
  onShiftClick,
  onConfirmShift,
  canEdit,
  selectionMode = false,
  selectedDates,
  onToggleDate,
  onNavigateMonth,
  focusDate,
  onFocusDateHandled,
  variant = "full",
  pillMinimiert = false,
  onCollapsedDayActivate,
}: {
  days: Date[];
  monthStart: Date;
  shifts: Shift[];
  modelMap: Map<number, ShiftModelInfo>;
  selectedDay: Date;
  onSelectDay: (day: Date) => void;
  onAddShift: (day: Date) => void;
  onShiftClick: (shift: Shift) => void;
  onConfirmShift?: (shift: Shift) => void;
  canEdit: boolean;
  selectionMode?: boolean;
  selectedDates?: string[];
  onToggleDate?: (day: Date) => void;
  onNavigateMonth?: (targetDate: Date) => void;
  focusDate?: Date | null;
  onFocusDateHandled?: () => void;
  /** Darstellungsdichte: full = Desktop/Tablet (zweizeilige Pille), collapsed =
   *  Smartphone-Dauerzustand (einzeilige Initialen-Pille, Arbeitsanweisung
   *  16.08.2026 Punkt 3 — der frühere „compact"-Zwischenzustand entfällt). */
  variant?: "full" | "collapsed";
  /** Arbeitsanweisung 17.08.2026 Punkt 1: globaler Minimiert-Umschalter für
   *  Desktop/Tablet (nur bei variant="full" relevant) — kollabiert die
   *  zweizeilige Pille auf eine Zeile. */
  pillMinimiert?: boolean;
  /** Nur bei variant="collapsed": Tap/Enter auf eine Zelle wählt den Tag UND
   *  soll zur entsprechenden Zeile in der Wochen-Liste darunter scrollen
   *  (ersetzt das frühere, in MonthGrid eingebettete Tagesdetail-Panel). */
  onCollapsedDayActivate?: (day: Date) => void;
}) {
  const personColors = usePersonColors();
  const selectedDateSet = new Set(selectedDates ?? []);
  const offset = (getDay(monthStart) + 6) % 7;
  const blanks = Array.from({ length: offset });
  const numWeeks = Math.ceil((blanks.length + days.length) / 7);

  // ── Kategoriale Personen-Slot-Farben (gemeinsamer Hook mit der mobilen
  //    Listenansicht, damit die Farbzuordnung überall identisch ist) ────────
  const getPersonSlot = usePersonSlotLookup();

  // ── Zeilenhöhe: immer inhaltsbasiert (Task #847) ──────────────────────────
  // Früher gab es zwei Modi: bei ≤2 Einträgen/Tag wurde das Grid künstlich auf
  // 100svh minus Kopfzeilen gestreckt (gleichmäßige 1fr-Verteilung), ab 3
  // Einträgen wurden reine Inhalts-Zeilen verwendet. Das erzeugte zwei Fehler:
  // (1) der Abstand von der Pille zur nächsten Tageszeile war Restfläche vom
  // Viewport, nicht fix — bei Browser-Zoom <100% wuchs er sichtbar mit, weil
  // 100svh in CSS-Pixeln bei kleinerem Zoom größer wird; (2) ein einzelner
  // dritter Eintrag an einem Tag kippte das Layout-Modell des GESAMTEN Monats
  // von "gestreckt" auf "kompakt" (sichtbarer Sprung). Jetzt gilt immer die
  // Inhalts-Variante: jede Wochenzeile ist so hoch wie ihre "belegteste"
  // Zelle (CSS-Grid-Auto-Sizing), der Abstand unter der letzten Pille ist ein
  // fixes Padding (siehe Grauzone unten) und skaliert damit 1:1 mit dem Zoom.
  // Ist ein Monat dienst-arm, ist er dadurch von selbst kompakt genug, um
  // unter der Sticky-Kopfzeile vollständig sichtbar zu sein — ohne dass wir
  // ihn künstlich auf Bildschirmhöhe ziehen müssen.

  // ── Sticky-Header-Höhe messen (ResizeObserver) ────────────────────────────
  // Der Dienstplan-Header klebt bei top:0; die Wochenzeile klebt direkt
  // darunter und braucht dessen Höhe als eigenen `top`-Versatz.
  const [headerH, setHeaderH] = useState(0);
  const weekdayRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = document.querySelector("[data-dienstplan-header]") as HTMLElement | null;
    if (!el) return;
    const update = () => setHeaderH(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Roving Tabindex (WAI-ARIA-Grid-Pattern) ───────────────────────────────
  const cellRefs = useRef<(HTMLElement | null)[]>([]);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  useEffect(() => {
    setFocusedIdx(null);
  }, [monthStart.getTime()]);
  useEffect(() => {
    if (!focusDate) return;
    const idx = days.findIndex((d) => isSameDay(d, focusDate));
    if (idx < 0) return;
    const el = cellRefs.current[idx];
    if (!el || el.offsetParent === null) return;
    setFocusedIdx(idx);
    el.focus();
    onFocusDateHandled?.();
  }, [focusDate, days]);
  const selectedIdx = days.findIndex((d) => isSameDay(d, selectedDay));
  const tabbableIdx = focusedIdx ?? (selectedIdx >= 0 ? selectedIdx : 0);
  const moveFocus = (idx: number) => {
    const clamped = Math.max(0, Math.min(days.length - 1, idx));
    setFocusedIdx(clamped);
    cellRefs.current[clamped]?.focus();
  };
  const handleCellKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const col = (offset + idx) % 7;
    let target: number | null = null;
    let crossesBoundary = false;
    switch (e.key) {
      case "ArrowRight": target = idx + 1; crossesBoundary = true; break;
      case "ArrowLeft":  target = idx - 1; crossesBoundary = true; break;
      case "ArrowDown":  target = idx + 7; crossesBoundary = true; break;
      case "ArrowUp":    target = idx - 7; crossesBoundary = true; break;
      case "Home":       target = idx - col; break;
      case "End":        target = idx + (6 - col); break;
      case "Enter":
      case " ": {
        // Enter/Space auf der Zelle = wie Klick: Tag wählen (3.4 — Anlegen nur
        // über das Plus). Nötig, weil die Zelle ein div role="button" ist;
        // ein nativer Button würde Enter/Space selbst als Klick auslösen.
        e.preventDefault();
        const d = days[idx];
        if (selectionMode) { onToggleDate?.(d); return; }
        onSelectDay(d);
        if (variant === "collapsed") {
          onCollapsedDayActivate?.(d);
        }
        return;
      }
      default: return;
    }
    e.preventDefault();
    if (crossesBoundary && (target < 0 || target > days.length - 1) && onNavigateMonth) {
      onNavigateMonth(addDays(days[idx], target - idx));
      return;
    }
    moveFocus(target);
  };

  return (
    <div>
      {/* ── Sticky Wochentag-Zeile (klebt direkt unter dem Dienstplan-Header) ─ */}
      <div
        ref={weekdayRowRef}
        className={[
          "sticky z-20 grid grid-cols-7 bg-[#f1f1ee]",
          // Punkt 2 (15.08.2026): Der 1-px-Rahmen (#dfe4ea) läuft um das gesamte
          // Raster inklusive Wochentag-Zeile; mobil bleibt der bisherige Look.
          variant === "full"
            ? "border-x border-t border-b border-[#dfe4ea]"
            : "border-b border-border/30",
        ].join(" ")}
        style={{ top: headerH || 0 }}
      >
        {WEEKDAY_LABELS.map((d, i) => (
          // Desktop (Punkt 1, 15.08.2026): volle Wochentagsnamen, 15 px — unter
          // 900 px reicht der Platz für „Donnerstag" nicht mehr, dann Kürzel.
          // Smartphone (Arbeitspaket 07.08.2026): Kürzel, 11 px, Versalien.
          <div
            key={d}
            className={
              variant === "full"
                ? "py-1.5 text-center text-[15px] font-semibold text-[#151515]"
                : "py-1 text-center text-[11px] font-semibold uppercase tracking-wider text-[#151515]"
            }
          >
            {variant === "full" ? (
              <>
                <span className="hidden min-[900px]:inline">{WEEKDAY_LABELS_FULL[i]}</span>
                <span className="min-[900px]:hidden">{d}</span>
              </>
            ) : (
              d
            )}
          </div>
        ))}
      </div>

      {/* ── Kalender-Grid ─────────────────────────────────────────────────── */}
      {/* Task #847: Zeilen sind immer reine Inhalts-Zeilen (auto) — keine
          Viewport-Streckung mehr. Jede Wochenzeile ist so hoch wie ihre
          belegteste Zelle; ein zusätzlicher Eintrag an einem Tag ändert nur
          diese eine Zeile, nie das Layout-Modell des ganzen Monats. Ist ein
          Monat dienst-arm, ist er dadurch von selbst kompakt genug, um unter
          der Sticky-Kopfzeile ganz sichtbar zu sein — ohne Zutun. */}
      <div
        className={[
          "grid grid-cols-7 gap-px",
          // Punkt 2 (15.08.2026): 1 px #dfe4ea als Außenrahmen UND als Spalten-/
          // Zeilentrennlinien — gap-px lässt die Hintergrundfarbe durchscheinen.
          variant === "full"
            ? "border border-t-0 border-[#dfe4ea] bg-[#dfe4ea]"
            : "rounded-b-lg border border-t-0 border-border/30 bg-border/20",
        ].join(" ")}
        style={
          variant !== "full"
            ? // Smartphone (Punkt 4): keine feste Grid-Höhe — die Zellen sind
              // quadratisch (1:1) als Mindestmaß und Zeilen wachsen mit Inhalt.
              { gridTemplateColumns: "repeat(7, 1fr)" }
            : { gridTemplateColumns: "repeat(7, 1fr)", overflow: "visible" }
        }
        data-testid="month-grid"
      >
        {blanks.map((_, i) => (
          <div
            key={`blank-${i}`}
            className={variant === "full" ? "bg-muted/10" : "rounded-[5px] bg-muted/10"}
            data-testid="month-grid-blank"
          />
        ))}
        {days.map((day, dayIdx) => {
          const dayShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), day));
          const selected = isSameDay(day, selectedDay);
          const today = isToday(day);
          // Chronologisch sortieren: das Pillen-Limit (2 bzw. 4) soll immer die
          // FRÜHESTEN Dienste zeigen, unabhängig von der API-Reihenfolge.
          const nonAbsence = dayShifts
            .filter((s) => !isAbsenceShift(s))
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
          const absences = dayShifts.filter((s) => isAbsenceShift(s));
           // Desktop/Tablet zeigen bis zu vier Pillen; die Smartphone-Zelle
           // (Dauerzustand „collapsed") bleibt mit höchstens zwei einzeiligen
           // Initialen-Pillen gleich hoch.
           const pillLimit = variant === "collapsed" ? 2 : 4;
           const visiblePills = nonAbsence.slice(0, pillLimit);
          const hiddenCount = nonAbsence.length - visiblePills.length;
          // Task #726: Personen mit einer Ausfall-Abwesenheit (Krank/Kind krank)
          // am selben Tag — deren Dienst-Pillen erhalten das rote Warn-Icon.
          const ausfallUserIds = new Set(
            absences
              .filter((s) => ABSENCE_CATEGORY[s.type] === "ausfall")
              .map((s) => s.userId),
          );
          const prevDay = dayIdx > 0 ? days[dayIdx - 1] : undefined;
          const nextDay = dayIdx < days.length - 1 ? days[dayIdx + 1] : undefined;
          const bulkSelected = selectionMode && selectedDateSet.has(format(day, "yyyy-MM-dd"));
          const dow = day.getDay();
          const isWeekend = dow === 0 || dow === 6;

          return (
            <div
              key={day.toISOString()}
              role="button"
              ref={(el) => { cellRefs.current[dayIdx] = el; }}
              tabIndex={dayIdx === tabbableIdx ? 0 : -1}
              onKeyDown={(e) => handleCellKeyDown(e, dayIdx)}
              onFocus={() => setFocusedIdx(dayIdx)}
              data-testid={`day-cell-${format(day, "yyyy-MM-dd")}`}
              data-selected={(selectionMode ? bulkSelected : selected) ? "true" : "false"}
              aria-selected={selectionMode ? bulkSelected : selected}
              aria-label={format(day, "EEEE, d. MMMM yyyy", { locale: de })}
              onClick={() => {
                if (selectionMode) { onToggleDate?.(day); return; }
                // 3.4: Klick auf Zelle/Datum wählt den Tag nur aus — das Anlegen
                // erfolgt ausschließlich über das Plus in der Zellen-Kopfzeile.
                onSelectDay(day);
                // 3.3: Eingeklappt scrollt der Tap zur entsprechenden Zeile in
                // der Wochen-Liste darunter (ersetzt das frühere Panel).
                if (variant === "collapsed") {
                  onCollapsedDayActivate?.(day);
                }
              }}
              // Punkt 4 (Smartphone): quadratische Zellen (1:1) als Mindestmaß —
              // die Wochenzeile wächst erst, wenn Pillen nicht mehr passen.
              // min-w-0 ist dabei Pflicht: Bei aspect-ratio auf einem Grid-Item mit
              // align-self:stretch überträgt CSS die Inhalts-HÖHE über das Verhältnis
              // als automatische Mindest-BREITE zurück auf die Spalte (Rückkopplung)
              // und bläht das Grid auf. min-w-0 deaktiviert dieses Automatic Minimum;
              // overflow-x: clip clippt Reste horizontal, ohne die Block-Achse zu
              // unterdrücken (overflow:hidden würde das Zeilenwachstum killen).
              style={variant !== "full" ? { aspectRatio: "1 / 1", overflowX: "clip" } : undefined}
              className={[
                "relative flex w-full flex-col items-stretch transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                // Desktop (Punkt 3, 15.08.2026): keine Rundung/kein Außen-Padding
                // mehr — die Grauzone (Pillenbereich) stößt bündig an die
                // Trennlinien. Smartphone behält Rundung + 2-px-Innenabstand.
                // min-w-0 statt overflow-hidden: Spaltenbreite bleibt stabil
                // (truncate greift), aber Zeilen wachsen mit dem Inhalt.
                variant === "full"
                  ? "min-w-0 rounded-none p-0"
                  : "min-w-0 rounded-[5px] p-0.5",
                // Zellhintergrund, exklusiv: Auswahl (Mint) > Weiß.
                // Task #826: Am Heute-Tag zeigt NUR die Mint-Fläche die
                // Auswahl an — der Auswahl-Rahmen entfällt dort, damit der
                // Heute-Rahmen die einzige Kante bleibt.
                bulkSelected
                  ? today
                    ? "bg-assistenz-mint"
                    : "bg-assistenz-mint"
                  : selected && !selectionMode
                    ? today
                      ? "bg-assistenz-mint/60"
                      : "bg-assistenz-mint/60"
                    : "bg-white hover:bg-accent/20",
                // Heute (Task #826) + Auswahl (Task #846): 2-px-Rahmen um die
                // GANZE Zelle inkl. Dienstpillen-Bereich — echter Border statt
                // ring-inset, weil ein Ring Teil der Box-Shadow-Ebene der
                // Zelle ist und von der opaken Pillen-Grauzone (Kind-Element)
                // darunter überdeckt wird; ein Border bleibt immer sichtbar.
                // Die Randbreite (border-[2px]) ist IMMER gesetzt, auch ohne
                // Auswahl (dort transparent) — sonst würde eine Zelle beim
                // Anklicken/Abwählen um die Randbreite wachsen/schrumpfen
                // (Layout-Sprung). Nur die Randfarbe wechselt:
                // Heute > Auswahl > unsichtbar.
                "border-[2px]",
                today
                  ? "border-[#092948]"
                  : bulkSelected || (selected && !selectionMode)
                    ? "border-assistenz-brand"
                    : "border-transparent",
              ].filter(Boolean).join(" ")}
            >
              {/* Kopfzeile (3.4): Datum LINKS, Plus RECHTS in derselben Zeile.
                  Nur das Plus legt einen neuen Dienst an; der Zellenklick wählt.
                  Desktop (Punkt 3): weißer oberer Bereich mit eigenem Padding,
                  da die Zelle selbst dort kein Padding mehr trägt. */}
              <span
                className={`flex items-center justify-between gap-1 ${
                  variant === "full" ? "px-1 py-1" : ""
                }`}
              >
                <span
                  className={[
                    "leading-none font-semibold rounded-md",
                    // Punkt 2: Datum 1–2 px größer; Smartphone = Desktop-Größe.
                    // Touch-Geräte (Tablet, siehe Kay-Feedback 28.08.2026): Ziel
                    // war auf dem Tablet kaum lesbar/treffbar — pointer-coarse
                    // greift nur bei Touch, Desktop-Maus bleibt unverändert.
                    "text-[12px] px-1.5 py-0.5 pointer-coarse:text-[15px] pointer-coarse:px-2 pointer-coarse:py-1",
                    today
                      ? "bg-[#092948] text-white"
                      : isWeekend
                        ? "bg-slate-200/70 text-slate-500"
                        : "bg-muted/50 text-foreground/70",
                  ].join(" ")}
                >
                  {format(day, "d")}
                </span>
                {canEdit && !selectionMode && (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Neuen Dienst anlegen am ${format(day, "d. MMMM", { locale: de })}`}
                    title="Dienst anlegen"
                    data-testid={`day-add-${format(day, "yyyy-MM-dd")}`}
                    onClick={(e) => { e.stopPropagation(); onAddShift(day); }}
                    // Enter/Space lösen bei nativen Buttons den Klick selbst aus —
                    // hier nur das Bubbling zur Zelle stoppen, damit deren
                    // Enter-Handler (Tag wählen) nicht zusätzlich feuert.
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") e.stopPropagation();
                    }}
                    // Punkt 2: Plus 1–2 px größer; Smartphone = Desktop-Größe.
                    // Touch-Geräte (Tablet, siehe Kay-Feedback 28.08.2026): 14px
                    // Kantenlänge war auf dem Tablet zu klein zum Treffen —
                    // pointer-coarse verdoppelt die Fläche nur bei Touch.
                    className="flex h-3.5 w-3.5 shrink-0 cursor-pointer select-none items-center justify-center rounded-[3px] border border-[#d8d8d4] bg-white p-0 text-[10px] font-bold leading-none text-[#092948] hover:border-[#092948] pointer-coarse:h-6 pointer-coarse:w-6 pointer-coarse:rounded-[5px] pointer-coarse:text-sm"
                  >
                    +
                  </button>
                )}
              </span>

              {/* 3.3 Dauerzustand (Arbeitsanweisung 16.08.2026): das ehemals
                  „aufgeklappte" einzeilige Pillendesign ist jetzt die EINZIGE
                  Smartphone-Darstellung — der bisherige Mini-Balken-Zweig und
                  der Auf-/Zuklapp-Umschalter entfallen ersatzlos. */}
              {variant === "collapsed" ? (
                (visiblePills.length > 0 || absences.length > 0) && (
                  // Arbeitsanweisung 17.08.2026 Punkt 6, Folgeauftrag: die
                  // Grauzone war mit #eef0f3 kaum vom weißen Zellenkopf zu
                  // unterscheiden — auf #e4e8ee (spürbar dunkler, dieselbe
                  // Farbe wie am Desktop, s. u.) angehoben, damit sich die
                  // weißen Pillen sichtbar abheben.
                  <div className="flex flex-col gap-[2px] rounded-b-[4px] border-t border-[#dfe4ea] bg-[#e4e8ee] px-[1px] py-[2px]">
                  {visiblePills.length > 0 && (
                    <div
                      className="flex flex-col min-w-0 gap-[2px]"
                      data-testid={`day-pills-${format(day, "yyyy-MM-dd")}`}
                    >
                      {visiblePills.map((s) => {
                        const isTeam = s.type === "team";
                        const slot = getPersonSlot(s.userId);
                        const status = s.planningStatus ?? "FIX";
                        // Task #726: eingeplante Assistenzkraft ist am selben Tag
                        // krank/Kind krank → roter Ausfall-Hinweis an der Pille.
                        const hasAusfall = !isTeam && ausfallUserIds.has(s.userId);
                        const chipClickable = canEdit && !selectionMode;
                        const timeRange = `${format(new Date(s.startTime), "HH:mm")}–${format(new Date(s.endTime), "HH:mm")}`;
                        const barColor = isTeam ? "#0284c7" : slot.bg;
                        // Arbeitsanweisung 17.08.2026 Punkt 4: der Avatar-Kreis
                        // zeigt jetzt die Initialen — das Namensfeld daneben zeigt
                        // deshalb den Nachnamen (dieselbe Funktion wie Desktop/
                        // Tablet), nicht mehr die Initialen als Text-Duplikat.
                        // Arbeitsanweisung 17.08.2026 Punkt 4 (nach Messung korrigiert):
                        // bei ~48 px Pillenbreite kollabiert ein zusaetzliches
                        // Namensfeld neben Avatar + bis zu drei 12-px-Icons auf 0 px
                        // Breite. Entscheidung: kein separates Namensfeld in der
                        // Smartphone-Pille, die Avatar-Initialen sind hier die
                        // einzige Personen-Kennung (voller Name im title-Attribut).
                        const avatarLabel = isTeam ? "T" : s.user?.name ? lastNameInitial(s.user.name) : "?";
                        const statusColor = dienstStatusColor(status, hasAusfall, s.isVertretung);
                        return (
                          <span
                            key={s.id}
                            data-testid={`day-chip-${s.id}`}
                            role={chipClickable ? "button" : undefined}
                            tabIndex={chipClickable ? -1 : undefined}
                            title={`${s.user?.name ?? ""} · ${timeRange}${s.isVertretung ? " · Vertretung" : ""}${s.standbyUserId != null ? ` · Vertretung vorgemerkt: ${s.standbyUserName ?? ""}` : ""}`.trim()}
                            onClick={chipClickable ? (e) => { e.stopPropagation(); onShiftClick(s); } : undefined}
                            onKeyDown={chipClickable ? (e) => {
                              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onShiftClick(s); }
                            } : undefined}
                            className={[
                              "relative flex items-stretch overflow-hidden rounded-[5px] border border-[#e6e6e2]",
                              "shadow-[0_2px_3px_rgba(9,41,72,0.12)]",
                              chipClickable ? "cursor-pointer" : "",
                            ].filter(Boolean).join(" ")}
                          >
                            {/* Punkt 3 (17.08.2026): rechter 4px-Statusfarbbalken —
                                zeigt den Dienststatus, nicht die Person. Kein
                                linker Farbbalken mehr (Punkt 1, 17.08.2026):
                                nur die Avatar-Farbe bleibt als Personenkennung. */}
                            <span
                              aria-hidden="true"
                              className="absolute right-0 top-0 bottom-0 w-[4px]"
                              style={{ backgroundColor: statusColor }}
                            />
                            {/* Zeile 1: Avatar + Status-Icons. Enge Abstände: bei
                                ~57 px Zellbreite müssen Avatar UND bis zu drei
                                13-px-Icons passen (kein Namensfeld, s. Kommentar
                                oben). */}
                            <span className="flex w-full items-center justify-between gap-[3px] bg-white py-0 pl-[3px] pr-[6px] leading-none">
                              <PillAvatar color={barColor} label={avatarLabel} />
                              {/* Arbeitsanweisung 16.08.2026: Status-Icon jetzt
                                  IMMER sichtbar (inkl. grünem Bestätigt-Haken),
                                  nicht mehr nur bei Abweichung. Priorität von
                                  links nach rechts aufsteigend: Basis-Status <
                                  Vertretung < Ausfall — das wichtigste Icon
                                  liegt im Badge-Stack rechts oben. */}
                              <span className="flex shrink-0 items-center -space-x-[7px]">
                                {status === "FIX" ? (
                                  <StatusBadge kind="confirmed" label="Bestätigt" calendarCompact />
                                ) : (
                                  <StatusBadge
                                    kind={status === "ANGEBOTEN" ? "sent" : "draft"}
                                    label={status === "ANGEBOTEN" ? "Vorschlag" : "Entwurf"}
                                    calendarCompact
                                  />
                                )}
                                {s.isVertretung && (
                                  <StatusBadge kind="vertretung" label="Vertretung" calendarCompact />
                                )}
                                {hasAusfall && (
                                  <StatusBadge
                                    kind="krank"
                                    label="Ausfall: Assistenzkraft abwesend"
                                    calendarCompact
                                  />
                                )}
                              </span>
                            </span>
                          </span>
                        );
                      })}
                      {hiddenCount > 0 && (
                        <span
                          data-testid={`day-more-${format(day, "yyyy-MM-dd")}`}
                          className="self-start px-1 text-[7px] font-semibold text-muted-foreground/60 leading-none"
                        >
                          +{hiddenCount}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Arbeitsanweisung 17.08.2026 Punkt 7: statt der bisherigen
                      Kategorie-Aufzählung ("Geplant"/"Ausfall"/"Absage" in
                      Kategoriefarbe) jetzt eine einzige Gesamtzahl aller
                      Abwesenheits-Einträge des Tages, dunkel statt bunt —
                      besser von den (farbigen) Status-Labels unterscheidbar. */}
                  {absences.length > 0 && (
                    <span
                      className="mt-[2px] px-[1px] text-[8px] font-semibold leading-tight text-[#151515]"
                      data-testid={`day-absence-text-${format(day, "yyyy-MM-dd")}`}
                    >
                      {absences.length} Abw.
                    </span>
                  )}
                  </div>
                )
              ) : variant === "full" && (
                /* Desktop/Tablet: zweizeilige Pille mit Uhrzeit. Grauzone
                   #eef0f3 unter der Kopfzeile, Trennlinie in Rahmenfarbe.
                   Task #847: Mindesthöhe an leeren Tagen ist jetzt exakt
                   "Platz für eine einzeilige Pille" (23 px, siehe minimierte
                   Pille) + das eigene py-1-Padding (4 px oben/unten) = 31 px —
                   kein künstlicher Puffer mehr. flex-1 lässt die Grauzone bei
                   einem geschäftigeren Nachbartag INNERHALB derselben Woche
                   trotzdem mitwachsen (CSS-Grid-Zeilen stretchen die Zellen
                   einer Reihe auf die Höhe der belegtesten Zelle); nach oben
                   wächst die Zelle unbegrenzt mit den eigenen Diensten. */
                <div className="flex min-h-[31px] min-w-0 flex-1 flex-col gap-[3px] border-t border-[#dfe4ea] bg-[#e4e8ee] px-1 py-1">
                  {visiblePills.map((s) => {
                    const isTeam = s.type === "team";
                    const slot = getPersonSlot(s.userId);
                    const status = s.planningStatus ?? "FIX";
                    // Task #726: eingeplante Assistenzkraft ist am selben Tag
                    // krank/Kind krank → roter Ausfall-Hinweis an der Pille.
                    const hasAusfall = !isTeam && ausfallUserIds.has(s.userId);
                    const chipClickable = canEdit && !selectionMode;
                    const startOnly = format(new Date(s.startTime), "HH:mm");
                    const timeRange = `${startOnly}–${format(new Date(s.endTime), "HH:mm")}`;
                    const barColor = isTeam ? "#0284c7" : slot.bg;
                    // Arbeitsanweisung 17.08.2026 Punkt 2: bei genug Platz voller
                    // Name, sonst (Container < 155px bzw. Minimiert-Modus immer)
                    // nur der Nachname.
                    const fullName = isTeam ? "Team" : s.user?.name ?? "?";
                    const shortNameLabel = isTeam ? "Team" : s.user?.name ? lastName(s.user.name) : "?";
                    const avatarLabel = isTeam ? "T" : s.user?.name ? nameInitials(s.user.name) : "?";
                    const statusColor = dienstStatusColor(status, hasAusfall, s.isVertretung);
                    const statusLabel = dienstStatusLabel(status, hasAusfall, s.isVertretung);
                    const commonHandlers = {
                      role: chipClickable ? ("button" as const) : undefined,
                      tabIndex: chipClickable ? -1 : undefined,
                      title: `${s.user?.name ?? ""} · ${timeRange}${s.isVertretung ? " · Vertretung" : ""}${s.standbyUserId != null ? ` · Vertretung vorgemerkt: ${s.standbyUserName ?? ""}` : ""}`.trim(),
                      onClick: chipClickable ? (e: React.MouseEvent) => { e.stopPropagation(); onShiftClick(s); } : undefined,
                      onKeyDown: chipClickable ? (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onShiftClick(s); }
                      } : undefined,
                    };
                    const statusBadgeStack = (
                      <>
                        {status === "FIX" ? (
                          <StatusBadge kind="confirmed" label="Bestätigt" calendarCompact={pillMinimiert} />
                        ) : (
                          <StatusBadge
                            kind={status === "ANGEBOTEN" ? "sent" : "draft"}
                            label={status === "ANGEBOTEN" ? "Vorschlag" : "Entwurf"}
                            calendarCompact={pillMinimiert}
                          />
                        )}
                        {pillMinimiert && s.isVertretung && (
                          <StatusBadge kind="vertretung" label="Vertretung" calendarCompact />
                        )}
                        {s.standbyUserId != null && (
                          <StatusBadge
                            kind="standby"
                            label={`Vertretung vorgemerkt: ${s.standbyUserName ?? ""}`.trim()}
                            calendarCompact={pillMinimiert}
                          />
                        )}
                        {hasAusfall && (
                          <StatusBadge
                            kind="krank"
                            label="Ausfall: Assistenzkraft abwesend"
                            calendarCompact={pillMinimiert}
                          />
                        )}
                      </>
                    );
                    // Punkt 1 (17.08.2026): globaler Minimiert-Umschalter —
                    // kollabiert die zweizeilige Pille auf eine Zeile (Avatar/
                    // Farbbalken · Nachname · Uhrzeit · Status-Icon), Zeile 2
                    // entfällt komplett. Punkt 2: Uhrzeit reagiert per
                    // Container-Query auf die tatsächliche Pillenbreite
                    // (< 115 px im Minimiert-Modus → nur Dienstbeginn).
                    if (pillMinimiert) {
                      return (
                        <span
                          key={s.id}
                          data-testid={`day-chip-${s.id}`}
                          {...commonHandlers}
                          className={[
                            // Task #847: keine feste h-6 mehr — die Höhe ergibt
                            // sich aus dem Inhalt (min-h-[23px] unten), damit die
                            // minimierte Pille exakt so hoch ist wie Zeile 1 der
                            // zweizeiligen Pille (dieselbe Mindesthöhe, Punkt 5,
                            // 17.08.2026). Vorher: h-6 (24px) vs. natürliche
                            // Inhaltshöhe 21px → wirkte 2px niedriger als Zeile 1.
                            "@container relative flex items-center overflow-hidden rounded-[6px] border",
                            "border-[#c7ced8] shadow-[0_3px_5px_rgba(9,41,72,0.13)]",
                            chipClickable ? "cursor-pointer" : "",
                          ].filter(Boolean).join(" ")}
                        >
                          {/* Punkt 3 (17.08.2026): rechter 4px-Statusfarbbalken —
                              zeigt den Dienststatus, nicht die Person. Kein
                              linker Farbbalken mehr (Arbeitsanweisung
                              17.08.2026 Punkt 1: nur die Avatar-Farbe bleibt
                              als Personenkennung). */}
                          <span
                            aria-hidden="true"
                            className="absolute right-0 top-0 bottom-0 w-[4px]"
                            style={{ backgroundColor: statusColor }}
                          />
                          <span className="flex min-h-[23px] w-full items-center gap-[4px] bg-white py-[2px] pl-[6px] pr-[6px] leading-none">
                            <PillAvatar color={barColor} label={avatarLabel} />
                            {/* Arbeitsanweisung 17.08.2026, Folgeauftrag: kein
                                shrink-0 mehr — der Name soll bei wenig Platz
                                wie im ausgeklappten Modus per truncate mit „…"
                                abgekürzt werden, statt starr seine volle Breite
                                zu behaupten und dabei die Status-Icons daneben
                                aus der Pille zu drängen. */}
                            <span data-testid={`day-chip-label-${s.id}`} className="min-w-0 truncate text-[12px] font-bold text-[#151515]">
                              {shortNameLabel}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#444444]">
                              {isTeam ? (
                                "Teamdienst"
                              ) : (
                                <>
                                  <span className="@max-[114px]:hidden">{timeRange}</span>
                                  <span className="hidden @max-[114px]:inline">{startOnly}</span>
                                </>
                              )}
                            </span>
                            <span className="flex shrink-0 items-center -space-x-[7px]">{statusBadgeStack}</span>
                          </span>
                        </span>
                      );
                    }
                    return (
                      <span
                        key={s.id}
                        data-testid={`day-chip-${s.id}`}
                        {...commonHandlers}
                        className={[
                          "@container relative flex flex-col items-stretch overflow-hidden rounded-[6px] border",
                          // Punkt 5 (15.08.2026): Desktop-Pillen leicht erhaben —
                          // Kontur #c7ced8 + weicher Schatten.
                          "border-[#c7ced8] shadow-[0_3px_5px_rgba(9,41,72,0.13)]",
                          chipClickable ? "cursor-pointer" : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {/* Punkt 3 (17.08.2026): rechter 4px-Statusfarbbalken —
                            zeigt den Dienststatus, nicht die Person. Kein
                            linker Farbbalken mehr (Arbeitsanweisung
                            17.08.2026 Punkt 1: nur die Avatar-Farbe bleibt
                            als Personenkennung). */}
                        <span
                          aria-hidden="true"
                          className="absolute right-0 top-0 bottom-0 w-[4px]"
                          style={{ backgroundColor: statusColor }}
                        />
                        {/* Zeile 1: Avatar + Name + Status-Badge Variante C.
                            Ausfall-Warnung (Task #726) rechts außen. Feste
                            Mindesthöhe (Punkt 5, 17.08.2026): die Zeile darf
                            bei schmalen Containern nicht schrumpfen, sonst
                            wirken die Status-Icons überproportional groß. */}
                        <span className="flex min-h-[23px] items-center justify-between gap-1 bg-white py-[2px] pl-[6px] pr-[6px] leading-none">
                          <span className="flex min-w-0 items-center gap-[4px]">
                            <PillAvatar color={barColor} label={avatarLabel} />
                            <span className="min-w-0 truncate text-[12px] font-bold text-[#151515]">
                              <span className="@max-[154px]:hidden">{fullName}</span>
                              <span className="hidden @max-[154px]:inline">{shortNameLabel}</span>
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-[3px]">{statusBadgeStack}</span>
                        </span>
                        {/* Zeile 2: Uhr-Badge + Uhrzeit (+ Vertretung rechts) auf
                            Grauweiß. Punkt 2 (17.08.2026): Container-Query statt
                            fixem Viewport-Breakpoint — reagiert auf die
                            tatsächliche Pillenbreite (< 215 px → reduziert).
                            Feste Mindesthöhe (Punkt 5) aus demselben Grund wie
                            Zeile 1. */}
                        <span className="flex min-h-[23px] items-center gap-[3px] bg-[#f1f1ee] py-[2px] pl-[6px] pr-[6px] leading-none">
                          <StatusBadge kind="clock" />
                          <span className="truncate text-[11px] font-semibold text-[#444444]">
                            {isTeam ? (
                              "Teamdienst"
                            ) : (
                              <>
                                {/* Schwelle messtechnisch ermittelt (headless
                                    Overflow-Test mit dieser Schrift/Icon-Breite):
                                    98 px sind die tatsächlich benötigte Breite
                                    für "HH:MM–HH:MM" inkl. Uhr-Icon + Innenabstand
                                    — nicht mehr der zuvor geschätzte Rundwert
                                    214 px, der die Endzeit weit vor dem echten
                                    Platzmangel abgeschnitten hat. */}
                                <span className="@max-[97px]:hidden">{timeRange}</span>
                                <span className="hidden @max-[97px]:inline">{startOnly}</span>
                              </>
                            )}
                          </span>
                          {/* Status-Beschriftung rechts (auf Nutzerwunsch wieder
                              eingeführt): dieselbe Priorität wie statusColor/
                              statusBadgeStack (Krank > Vertretung > Bestätigt/
                              Entwurf). Schwelle ebenfalls messtechnisch ermittelt:
                              168 px sind die tatsächlich benötigte Breite für
                              Uhr-Icon + volle Uhrzeit + Wechsel-Icon + längste
                              Beschriftung "Vertretung" (Worst Case) — deutlich
                              unter dem alten Schätzwert 215 px, der die
                              Beschriftung schon wegfallen ließ, obwohl noch
                              sichtbar Platz zwischen Uhrzeit und Pillenrand war.
                              Zwischen 98–167 px bleibt jetzt die volle Uhrzeit
                              sichtbar, nur die Beschriftung entfällt zuerst
                              (weniger wichtig als Start-/Endzeit). */}
                          <span
                            className="ml-auto hidden shrink-0 items-center gap-[2px] @[168px]:inline-flex"
                            style={{ color: dienstStatusTextColor(status, hasAusfall, s.isVertretung) }}
                            title={statusLabel}
                          >
                            {s.isVertretung && <StatusBadge kind="vertretung" />}
                            <span className="text-[10px] font-semibold">{statusLabel}</span>
                          </span>
                        </span>
                      </span>
                    );
                  })}
                  {/* Überlauf-Zähler: liegt IM Pillen-Container, damit er
                      innerhalb der Grauzone bleibt — die füllt die Zelle seit
                      Punkt 3 (15.08.2026) bis ganz unten. */}
                  {hiddenCount > 0 && (
                    <span
                      data-testid={`day-more-${format(day, "yyyy-MM-dd")}`}
                      className="self-start px-1 text-[7px] font-semibold text-muted-foreground/60 leading-none"
                    >
                      +{hiddenCount}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {/* Punkt 2 (15.08.2026): Auffüller NACH dem Monatsende, damit auch die
            letzte Zeile durchgehende Trennlinien statt einer grauen Fläche
            zeigt. Eigene testid — e2e zählt month-grid-blank == Monats-Offset. */}
        {variant === "full" &&
          Array.from({ length: numWeeks * 7 - blanks.length - days.length }).map((_, i) => (
            <div key={`tail-blank-${i}`} className="bg-muted/10" data-testid="month-grid-tail-blank" />
          ))}
      </div>
    </div>
  );
}
