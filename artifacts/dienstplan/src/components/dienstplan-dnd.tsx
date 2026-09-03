// ---------------------------------------------------------------------------
// Drag-and-Drop im Dienstplan (Baustein 2, Kay-Entscheidung 01.09.2026)
// ---------------------------------------------------------------------------
// Eine Assistenzkraft wird aus dem Zeitkonto (Reihe oben ODER Panel rechts)
// auf das Monatsraster gezogen:
//   - auf einen OFFENEN Platz des Dienstgeruests -> Dienst wird als Entwurf
//     fuer diese Person angelegt (dieselben Zeiten wie der Platz),
//   - auf eine BESETZTE Pille -> die Person uebernimmt den Dienst (Ersetzen),
//     mit Rueckgaengig direkt im Hinweis.
// Beides hat einen gleichwertigen Klick-Weg (offener Platz oeffnet den
// vorbefuellten Dialog, Pille den Bearbeiten-Dialog) — Drag-and-Drop ist
// eine Abkuerzung, keine Pflicht. Deshalb verzichten die Ziehquellen bewusst
// auf die dnd-kit-Tastatur-Attribute: die Pillen sind bereits Buttons mit
// eigener Funktion (Filter), ein zweites fokussierbares Element derselben
// Flaeche waere fuer Screenreader nur Rauschen.
//
// Sensorik: Maus zieht ab 8 px Distanz (ein Klick bleibt ein Klick), Touch
// erst nach 250 ms Haltezeit (Wischen scrollt weiterhin die Reihe/Seite).
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { CSSProperties, ReactNode } from "react";

export type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";

/** Was gezogen wird: eine Person aus dem Zeitkonto. */
export type PersonZug = { userId: number; name: string };

/** Ziel 1: ein offener Platz des Dienstgeruests (legt einen Entwurf an). */
export type PlatzZiel = {
  art: "platz";
  /** "YYYY-MM-DD" */
  datum: string;
  dienstId: number;
  /** "HH:MM" — Zeiten des Platzes; Ende <= Start bedeutet Tagesuebergang. */
  startTime: string;
  endTime: string;
};

/** Ziel 2: ein besetzter Dienst (die gezogene Person uebernimmt ihn). */
export type DienstZiel = { art: "dienst"; shiftId: number };

/**
 * Ziel 3: die Vertretungszeile eines Dienstes — die gezogene Person wird als
 * Vertretung VORGEMERKT, uebernimmt den Dienst also NICHT. Der Unterschied zu
 * DienstZiel ist fachlich wesentlich: hier aendert sich nichts am Dienst
 * selbst, es entsteht nur eine Vormerkung fuer den Ausfall-Fall.
 */
export type VertretungsZiel = { art: "vertretung"; shiftId: number };

export type ZugZiel = PlatzZiel | DienstZiel | VertretungsZiel;

export function zugZielId(bereich: string, ziel: ZugZiel): string {
  if (ziel.art === "platz") return `${bereich}-platz-${ziel.datum}-${ziel.dienstId}`;
  if (ziel.art === "vertretung") return `${bereich}-vertretung-${ziel.shiftId}`;
  return `${bereich}-dienst-${ziel.shiftId}`;
}

/**
 * Ziehquelle: legt sich um eine Zeitkonto-Pille. `bereich` haelt die IDs der
 * doppelt gerenderten Leisten auseinander (mobile Reihe, Desktop-Reihe und
 * Panel stehen zeitgleich im DOM, nur eine ist sichtbar).
 */
export function ZiehbarePerson({
  bereich,
  userId,
  name,
  className,
  children,
}: {
  /** Ohne Bereich ist die Huelle inaktiv (nur Layout-Span). */
  bereich?: string;
  userId: number;
  name: string;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `${bereich ?? "aus"}-person-${userId}`,
    data: { userId, name } satisfies PersonZug,
    disabled: !bereich,
  });
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      // touch-action:manipulation statt none: der Browser darf weiter
      // scrollen/zoomen, nur Doppeltipp-Zoom faellt weg — der TouchSensor
      // uebernimmt erst nach seiner Haltezeit.
      style={{ touchAction: "manipulation" }}
      className={[className ?? "", isDragging ? "opacity-40" : ""].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  );
}

/**
 * Abwurfziel: legt sich um eine Platzhalter- oder Dienst-Pille im Raster.
 * Waehrend eine Person darueber schwebt, bekommt die Pille einen Ring in
 * Vertretungs-Petrol (#0f6e8c — bewusst nicht das Statusgruen/-blau).
 */
export function ZugZielHuelle({
  bereich,
  ziel,
  disabled = false,
  className,
  style,
  children,
}: {
  bereich: string;
  ziel: ZugZiel;
  disabled?: boolean;
  className?: string;
  /** Nur fuer die Reihenfolge in der Tageszelle (CSS `order`), s. month-grid. */
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: zugZielId(bereich, ziel),
    data: ziel,
    disabled,
  });
  return (
    <span
      ref={setNodeRef}
      style={style}
      className={[
        className ?? "",
        // Vormerken sieht anders aus als Uebernehmen: gestrichelter Ring fuer
        // die Vertretungszeile, durchgezogener fuer Platz/Dienst.
        isOver
          ? ziel.art === "vertretung"
            ? "rounded-[7px] outline-dashed outline-2 outline-offset-0 outline-[#6d28d9]"
            : "rounded-[7px] ring-2 ring-[#0f6e8c]"
          : "",
      ].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  );
}

/**
 * Gemeinsamer Kontext samt Zieh-Vorschau. Die Vorschau ist eine kleine
 * Namens-Pille am Zeiger — bewusst NICHT die ganze Zeitkonto-Pille, die
 * waere ueber den schmalen Rasterzellen nur im Weg.
 */
export function DienstplanDnd({
  aktiv,
  gezogen,
  onDragStart,
  onDragEnd,
  children,
}: {
  /** false = Kontext rendert nur die Kinder (z. B. reine Lese-Rolle). */
  aktiv: boolean;
  gezogen: PersonZug | null;
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  if (!aktiv) return <>{children}</>;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => onDragEnd({ over: null } as unknown as DragEndEvent)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {gezogen && (
          <span
            data-testid="dnd-vorschau"
            className="pointer-events-none inline-flex items-center gap-1.5 rounded-full border border-[#0f6e8c] bg-white py-1 pl-2 pr-3 text-xs font-semibold text-[#151515] shadow-[0_3px_8px_rgba(9,41,72,0.25)]"
          >
            <span className="h-2 w-2 rounded-full bg-[#0f6e8c]" aria-hidden="true" />
            {gezogen.name}
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}
