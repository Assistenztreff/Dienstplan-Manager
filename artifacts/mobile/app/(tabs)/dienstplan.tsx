import { useListShifts } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/context/UserContext";

type Shift = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
  notes?: string | null;
};

type ViewMode = "calendar" | "list";

const SHIFT_LABELS: Record<string, string> = {
  active: "Aktivdienst",
  standby: "Bereitschaft",
  night: "Nachtdienst",
  full_day: "24h-Dienst",
  vacation: "Urlaub",
  sick: "Krank",
};

const SHIFT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  active:   { bg: "#EEF2FF", text: "#3730A3", dot: "#6366F1" },
  standby:  { bg: "#FFFBEB", text: "#92400E", dot: "#F59E0B" },
  night:    { bg: "#F5F3FF", text: "#5B21B6", dot: "#8B5CF6" },
  full_day: { bg: "#ECFDF5", text: "#065F46", dot: "#10B981" },
  vacation: { bg: "#FEFCE8", text: "#713F12", dot: "#EAB308" },
  sick:     { bg: "#F8FAFC", text: "#475569", dot: "#94A3B8" },
};

const DE_MONTHS = [
  "Januar","Februar","März","April","Mai","Juni",
  "Juli","August","September","Oktober","November","Dezember",
];

// Week starts Monday (index 0 = Mo, … 6 = So)
const DE_WEEKDAYS_SHORT = ["Mo","Di","Mi","Do","Fr","Sa","So"];

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

// Returns number of days in a month
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// Returns weekday index 0=Mo … 6=So for a given date
function weekdayMon(year: number, month: number, day: number): number {
  const jsDay = new Date(year, month - 1, day).getDay(); // 0=Sun … 6=Sat
  return jsDay === 0 ? 6 : jsDay - 1;
}

function groupByDay(shifts: Shift[]): Map<string, Shift[]> {
  const map = new Map<string, Shift[]>();
  for (const s of shifts) {
    const key = s.startTime.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return map;
}

// ─── Calendar Month Grid ──────────────────────────────────────────────────────

function CalendarView({
  year,
  month,
  shifts,
  selectedDate,
  onSelectDate,
  colors,
}: {
  year: number;
  month: number;
  shifts: Shift[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const byDay = useMemo(() => groupByDay(shifts), [shifts]);
  const totalDays = daysInMonth(year, month);
  const firstWeekday = weekdayMon(year, month, 1); // 0=Mo … 6=So

  const SCREEN_WIDTH = Dimensions.get("window").width;
  const CELL_WIDTH = Math.floor((SCREEN_WIDTH - 32) / 7);
  const CELL_HEIGHT = CELL_WIDTH + 10;

  // Build grid cells: leading empty + numbered days
  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: null });
  for (let d = 1; d <= totalDays; d++) cells.push({ day: d });

  return (
    <View style={{ paddingHorizontal: 16 }}>
      {/* Weekday headers */}
      <View style={styles.calWeekRow}>
        {DE_WEEKDAYS_SHORT.map((wd) => (
          <View key={wd} style={[styles.calWeekCell, { width: CELL_WIDTH }]}>
            <Text style={[styles.calWeekLabel, { color: colors.mutedForeground }]}>{wd}</Text>
          </View>
        ))}
      </View>

      {/* Day cells in rows of 7 */}
      {Array.from({ length: Math.ceil(cells.length / 7) }).map((_, rowIdx) => (
        <View key={rowIdx} style={styles.calWeekRow}>
          {cells.slice(rowIdx * 7, rowIdx * 7 + 7).map((cell, colIdx) => {
            if (!cell.day) {
              return <View key={`e-${colIdx}`} style={{ width: CELL_WIDTH, height: CELL_HEIGHT }} />;
            }
            const dateStr = isoDate(year, month, cell.day);
            const dayShifts = byDay.get(dateStr) ?? [];
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;

            return (
              <TouchableOpacity
                key={dateStr}
                onPress={() => onSelectDate(dateStr)}
                style={[
                  styles.calDayCell,
                  {
                    width: CELL_WIDTH,
                    height: CELL_HEIGHT,
                    backgroundColor: isSelected
                      ? colors.primary
                      : isToday
                      ? colors.secondary
                      : "transparent",
                    borderRadius: 8,
                  },
                ]}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.calDayNum,
                    {
                      color: isSelected
                        ? colors.primaryForeground
                        : isToday
                        ? colors.primary
                        : colors.foreground,
                      fontWeight: isToday || isSelected ? "700" : "400",
                    },
                  ]}
                >
                  {cell.day}
                </Text>
                {/* Shift dots — max 3 */}
                {dayShifts.length > 0 && (
                  <View style={styles.calDots}>
                    {dayShifts.slice(0, 3).map((s) => {
                      const sc = SHIFT_COLORS[s.type] ?? SHIFT_COLORS.active;
                      return (
                        <View
                          key={s.id}
                          style={[
                            styles.calDot,
                            {
                              backgroundColor: isSelected
                                ? colors.primaryForeground + "CC"
                                : sc.dot,
                            },
                          ]}
                        />
                      );
                    })}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── Shift Card ───────────────────────────────────────────────────────────────

function ShiftCard({ shift, colors }: { shift: Shift; colors: ReturnType<typeof useColors> }) {
  const sc = SHIFT_COLORS[shift.type] ?? SHIFT_COLORS.active;
  const isAbsence = shift.type === "vacation" || shift.type === "sick";
  return (
    <View
      style={[
        styles.shiftCard,
        {
          backgroundColor: sc.bg,
          borderLeftColor: sc.dot,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View style={styles.shiftRow}>
        <View style={[styles.dot, { backgroundColor: sc.dot }]} />
        <Text style={[styles.shiftType, { color: sc.text }]}>
          {SHIFT_LABELS[shift.type] ?? shift.type}
        </Text>
      </View>
      {!isAbsence && (
        <Text style={[styles.shiftTime, { color: sc.text + "BB" }]}>
          {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
        </Text>
      )}
      {shift.notes ? (
        <Text style={[styles.shiftNotes, { color: colors.mutedForeground }]} numberOfLines={1}>
          {shift.notes}
        </Text>
      ) : null}
    </View>
  );
}

// ─── List View ────────────────────────────────────────────────────────────────

function groupByDayArray(shifts: Shift[]): { date: string; shifts: Shift[] }[] {
  const map = groupByDay(shifts);
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, s]) => ({ date, shifts: s }));
}

const DE_DAYS_SHORT = ["So","Mo","Di","Mi","Do","Fr","Sa"];

function formatDayHeader(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const wd = DE_DAYS_SHORT[d.getDay()];
  return `${wd}, ${d.getDate()}. ${DE_MONTHS[d.getMonth()]}`;
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function DienstplanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser } = useCurrentUser();

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr);

  const { data: rawShifts, isLoading, isError, refetch } = useListShifts(
    { userId: currentUser?.id, month, year },
    { query: { enabled: !!currentUser } } as Parameters<typeof useListShifts>[1]
  );

  if (!currentUser) return <Redirect href="/login" />;

  const shifts = (rawShifts ?? []) as Shift[];
  const grouped = groupByDayArray(shifts);
  const byDay = groupByDay(shifts);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
    setSelectedDate(null);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const selectedShifts = selectedDate ? (byDay.get(selectedDate) ?? []) : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View style={[styles.header, { backgroundColor: colors.primary, paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: colors.primaryForeground }]}>
            Dienstplan
          </Text>
          {/* View toggle */}
          <View style={styles.viewToggle}>
            <TouchableOpacity
              onPress={() => setViewMode("calendar")}
              style={[
                styles.toggleBtn,
                viewMode === "calendar" && { backgroundColor: colors.accent },
              ]}
            >
              <Feather
                name="grid"
                size={16}
                color={viewMode === "calendar" ? colors.accentForeground : colors.primaryForeground + "AA"}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode("list")}
              style={[
                styles.toggleBtn,
                viewMode === "list" && { backgroundColor: colors.accent },
              ]}
            >
              <Feather
                name="list"
                size={16}
                color={viewMode === "list" ? colors.accentForeground : colors.primaryForeground + "AA"}
              />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.headerSub, { color: colors.primaryForeground + "99" }]}>
          {currentUser.name}
        </Text>

        {/* Month navigation */}
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={styles.navBtn}>
            <Feather name="chevron-left" size={22} color={colors.primaryForeground} />
          </TouchableOpacity>
          <Text style={[styles.monthLabel, { color: colors.primaryForeground }]}>
            {DE_MONTHS[month - 1]} {year}
          </Text>
          <TouchableOpacity onPress={nextMonth} style={styles.navBtn}>
            <Feather name="chevron-right" size={22} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Content ── */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Feather name="alert-circle" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Fehler beim Laden
          </Text>
          <TouchableOpacity onPress={() => void refetch()}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Erneut versuchen</Text>
          </TouchableOpacity>
        </View>
      ) : viewMode === "calendar" ? (
        /* ── CALENDAR VIEW ── */
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <CalendarView
            year={year}
            month={month}
            shifts={shifts}
            selectedDate={selectedDate}
            onSelectDate={(d) => setSelectedDate(selectedDate === d ? null : d)}
            colors={colors}
          />

          {/* Selected day details */}
          {selectedDate && (
            <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
              <View style={[styles.dayDetailHeader, { borderColor: colors.border }]}>
                <Text style={[styles.dayDetailTitle, { color: colors.foreground }]}>
                  {formatDayHeader(selectedDate)}
                </Text>
                <TouchableOpacity onPress={() => setSelectedDate(null)}>
                  <Feather name="x" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
              {selectedShifts.length === 0 ? (
                <View style={styles.noShiftsRow}>
                  <Feather name="calendar" size={20} color={colors.mutedForeground} />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground, textAlign: "left" }]}>
                    Keine Schichten
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 6 }}>
                  {selectedShifts.map((s) => (
                    <ShiftCard key={s.id} shift={s} colors={colors} />
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      ) : (
        /* ── LIST VIEW ── */
        grouped.length === 0 ? (
          <View style={styles.centered}>
            <Feather name="calendar" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Keine Schichten in diesem Monat
            </Text>
          </View>
        ) : (
          <FlatList
            data={grouped}
            keyExtractor={(item) => item.date}
            contentContainerStyle={[
              styles.list,
              Platform.OS === "web" ? { paddingBottom: 100 } : { paddingBottom: 120 },
            ]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isLoading}
                onRefresh={() => void refetch()}
                tintColor={colors.primary}
              />
            }
            renderItem={({ item }) => (
              <View style={styles.dayGroup}>
                <Text style={[styles.dayGroupHeader, { color: colors.mutedForeground }]}>
                  {formatDayHeader(item.date)}
                </Text>
                <View style={{ gap: 6 }}>
                  {item.shifts.map((shift) => (
                    <ShiftCard key={shift.id} shift={shift} colors={colors} />
                  ))}
                </View>
              </View>
            )}
          />
        )
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
    marginBottom: 12,
  },
  viewToggle: {
    flexDirection: "row",
    borderRadius: 8,
    overflow: "hidden",
    gap: 2,
  },
  toggleBtn: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navBtn: { padding: 6 },
  monthLabel: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  // States
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  retryText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },

  // Calendar grid
  calWeekRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  calWeekCell: {
    alignItems: "center",
    paddingVertical: 4,
  },
  calWeekLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  calDayCell: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    gap: 2,
  },
  calDayNum: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  calDots: {
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
  },
  calDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },

  // Selected day detail
  dayDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    paddingBottom: 10,
    marginBottom: 12,
  },
  dayDetailTitle: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  noShiftsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
  },

  // List view
  list: {
    padding: 16,
    gap: 16,
  },
  dayGroup: { gap: 8 },
  dayGroupHeader: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingLeft: 4,
  },
  shiftCard: {
    padding: 12,
    gap: 4,
    borderLeftWidth: 3,
  },
  shiftRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  shiftType: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  shiftTime: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingLeft: 16,
  },
  shiftNotes: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    paddingLeft: 16,
    fontStyle: "italic",
  },
});
