import { useListShifts } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
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

const SHIFT_LABELS: Record<string, string> = {
  active: "Aktivdienst",
  standby: "Bereitschaft",
  night: "Nachtdienst",
  full_day: "24h-Dienst",
  vacation: "Urlaub",
  sick: "Krank",
};

const SHIFT_COLORS: Record<string, { bg: string; text: string; dot: string }> =
  {
    active: { bg: "#EEF2FF", text: "#3730A3", dot: "#6366F1" },
    standby: { bg: "#FFFBEB", text: "#92400E", dot: "#F59E0B" },
    night: { bg: "#F5F3FF", text: "#5B21B6", dot: "#8B5CF6" },
    full_day: { bg: "#ECFDF5", text: "#065F46", dot: "#10B981" },
    vacation: { bg: "#FEFCE8", text: "#713F12", dot: "#EAB308" },
    sick: { bg: "#F8FAFC", text: "#475569", dot: "#94A3B8" },
  };

const DE_MONTHS = [
  "Januar","Februar","März","April","Mai","Juni",
  "Juli","August","September","Oktober","November","Dezember",
];

const DE_DAYS = ["So","Mo","Di","Mi","Do","Fr","Sa"];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDayDate(iso: string): { weekday: string; day: number } {
  const d = new Date(iso);
  return { weekday: DE_DAYS[d.getDay()], day: d.getDate() };
}

function groupShiftsByDay(shifts: Shift[]): { date: string; shifts: Shift[] }[] {
  const map = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const key = shift.startTime.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(shift);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, shifts]) => ({ date, shifts }));
}

export default function DienstplanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser } = useCurrentUser();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: shifts, isLoading, isError, refetch } = useListShifts(
    { userId: currentUser?.id, month, year },
    { query: { enabled: !!currentUser } }
  );

  if (!currentUser) return <Redirect href="/login" />;

  const grouped = groupShiftsByDay((shifts ?? []) as Shift[]);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.primary,
            paddingTop: topPad + 12,
          },
        ]}
      >
        <Text
          style={[styles.headerTitle, { color: colors.primaryForeground }]}
        >
          Dienstplan
        </Text>
        <Text
          style={[styles.headerSub, { color: colors.primaryForeground + "99" }]}
        >
          {currentUser.name}
        </Text>
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={styles.navBtn}>
            <Feather name="chevron-left" size={22} color={colors.primaryForeground} />
          </TouchableOpacity>
          <Text
            style={[styles.monthLabel, { color: colors.primaryForeground }]}
          >
            {DE_MONTHS[month - 1]} {year}
          </Text>
          <TouchableOpacity onPress={nextMonth} style={styles.navBtn}>
            <Feather name="chevron-right" size={22} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>
      </View>

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
            <Text style={[styles.retryText, { color: colors.primary }]}>
              Erneut versuchen
            </Text>
          </TouchableOpacity>
        </View>
      ) : grouped.length === 0 ? (
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
            Platform.OS === "web" ? { paddingBottom: 100 } : {},
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => {
            const { weekday, day } = formatDayDate(item.date);
            const isToday = item.date === now.toISOString().slice(0, 10);
            return (
              <View style={styles.dayGroup}>
                <View style={styles.dayHeader}>
                  <View
                    style={[
                      styles.dayBadge,
                      {
                        backgroundColor: isToday
                          ? colors.accent
                          : colors.secondary,
                        borderRadius: 8,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayWeekday,
                        {
                          color: isToday
                            ? colors.accentForeground
                            : colors.mutedForeground,
                        },
                      ]}
                    >
                      {weekday}
                    </Text>
                    <Text
                      style={[
                        styles.dayNum,
                        {
                          color: isToday
                            ? colors.accentForeground
                            : colors.foreground,
                        },
                      ]}
                    >
                      {day}
                    </Text>
                  </View>
                  <View
                    style={[styles.dayLine, { backgroundColor: colors.border }]}
                  />
                </View>
                <View style={styles.shiftsColumn}>
                  {item.shifts.map((shift) => {
                    const sc =
                      SHIFT_COLORS[shift.type] ?? SHIFT_COLORS.active;
                    const isAbsence =
                      shift.type === "vacation" || shift.type === "sick";
                    return (
                      <View
                        key={shift.id}
                        style={[
                          styles.shiftCard,
                          {
                            backgroundColor: sc.bg,
                            borderRadius: colors.radius,
                            borderLeftWidth: 3,
                            borderLeftColor: sc.dot,
                          },
                        ]}
                      >
                        <View style={styles.shiftRow}>
                          <View
                            style={[
                              styles.dot,
                              { backgroundColor: sc.dot },
                            ]}
                          />
                          <Text
                            style={[styles.shiftType, { color: sc.text }]}
                          >
                            {SHIFT_LABELS[shift.type] ?? shift.type}
                          </Text>
                        </View>
                        {!isAbsence && (
                          <Text
                            style={[
                              styles.shiftTime,
                              { color: sc.text + "BB" },
                            ]}
                          >
                            {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                          </Text>
                        )}
                        {shift.notes ? (
                          <Text
                            style={[
                              styles.shiftNotes,
                              { color: colors.mutedForeground },
                            ]}
                            numberOfLines={1}
                          >
                            {shift.notes}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
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
    marginBottom: 16,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navBtn: {
    padding: 6,
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
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
  list: {
    padding: 16,
    gap: 16,
  },
  dayGroup: {
    gap: 8,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dayBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: "center",
    minWidth: 52,
  },
  dayWeekday: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dayNum: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    lineHeight: 24,
  },
  dayLine: {
    flex: 1,
    height: 1,
  },
  shiftsColumn: {
    gap: 6,
    paddingLeft: 4,
  },
  shiftCard: {
    padding: 12,
    gap: 4,
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
