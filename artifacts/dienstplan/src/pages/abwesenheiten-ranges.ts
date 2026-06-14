import { format } from "date-fns";

export type AbsenceType = "vacation" | "sick";

export type AbsenceShift = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
};

export type AbsenceRange = {
  key: string;
  userId: number;
  type: AbsenceType;
  startDate: Date;
  endDate: Date;
  days: number;
  shiftIds: number[];
};

export function dayKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Fasst einzelne Tageseinträge desselben Assistenten und Typs zu zusammenhängenden
// Zeiträumen zusammen, damit die Liste übersichtlich bleibt. Die Einträge werden
// pro (Assistent, Typ) gruppiert, damit verschachtelte Datensätze verschiedener
// Assistenten/Typen aufeinanderfolgende Tage nicht fälschlich auftrennen.
export function buildRanges(shifts: AbsenceShift[]): AbsenceRange[] {
  const sorted = [...shifts].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const ranges: AbsenceRange[] = [];
  // Offener Zeitraum je (Assistent, Typ), an den ein Folgetag angehängt werden kann.
  const openByGroup = new Map<string, AbsenceRange>();

  for (const shift of sorted) {
    const type = shift.type as AbsenceType;
    const date = new Date(shift.startTime);
    const groupKey = `${shift.userId}-${type}`;
    const open = openByGroup.get(groupKey);
    const isConsecutive = open && dayKey(addDays(open.endDate, 1)) === dayKey(date);

    if (open && isConsecutive) {
      open.endDate = date;
      open.days += 1;
      open.shiftIds.push(shift.id);
    } else {
      const range: AbsenceRange = {
        key: `${shift.userId}-${type}-${shift.id}`,
        userId: shift.userId,
        type,
        startDate: date,
        endDate: date,
        days: 1,
        shiftIds: [shift.id],
      };
      ranges.push(range);
      openByGroup.set(groupKey, range);
    }
  }

  return ranges.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
}
