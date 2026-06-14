import {
  useListTimeEntries,
  useListShifts,
  useCreateTimeEntry,
  ApiError,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/context/UserContext";
import { TimePickerField } from "@/components/TimePickerField";

type TimeEntry = {
  id: number;
  userId: number;
  shiftId?: number | null;
  actualStart: string;
  actualEnd: string;
  actualHours?: number;
  status: "pending" | "confirmed" | "rejected";
  notes?: string | null;
};

type Shift = {
  id: number;
  startTime: string;
  endTime: string;
  type: string;
};

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  pending: { label: "Offen", bg: "#FEF3C7", text: "#92400E" },
  confirmed: { label: "Bestatigt", bg: "#DCFCE7", text: "#166534" },
  rejected: { label: "Abgelehnt", bg: "#FEE2E2", text: "#991B1B" },
};

const DE_MONTHS = [
  "Januar","Februar","März","April","Mai","Juni",
  "Juli","August","September","Oktober","November","Dezember",
];

const SHIFT_TYPE_LABEL: Record<string, string> = {
  active: "Aktivdienst",
  standby: "Bereitschaftsdienst",
  night: "Nachtdienst",
  full_day: "24h-Dienst",
  work: "Arbeitszeit",
};

function shiftTypeLabel(type: string): string {
  return SHIFT_TYPE_LABEL[type] ?? "Dienst";
}

function isAbsenceType(type: string): boolean {
  return type === "vacation" || type === "sick";
}

function shiftTimeRange(shift: Shift): string {
  const s = new Date(shift.startTime);
  const e = new Date(shift.endTime);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(s.getHours())}:${pad(s.getMinutes())} – ${pad(e.getHours())}:${pad(e.getMinutes())}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatHours(start: string, end: string): string {
  const h = (new Date(end).getTime() - new Date(start).getTime()) / 3600000;
  return `${h.toFixed(2)} h`;
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTimeStr(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function buildISO(date: string, time: string): string {
  return `${date}T${time}:00`;
}

function addOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ZeiterfassungScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser } = useCurrentUser();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<number | null>(null);
  const [date, setDate] = useState(todayDateStr());
  const [startTime, setStartTime] = useState(nowTimeStr());
  const [endTime, setEndTime] = useState(nowTimeStr());
  const [endsNextDay, setEndsNextDay] = useState(false);
  const [notes, setNotes] = useState("");
  const [shiftPickerOpen, setShiftPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const {
    data: rawEntries,
    isLoading,
    isError,
    refetch,
  } = useListTimeEntries(
    { userId: currentUser?.id, month, year },
    { query: { enabled: !!currentUser } } as Parameters<typeof useListTimeEntries>[1]
  );

  const { data: rawShifts } = useListShifts(
    { userId: currentUser?.id, month, year },
    { query: { enabled: !!currentUser && modalVisible } } as Parameters<typeof useListShifts>[1]
  );

  const entries = (rawEntries ?? []) as TimeEntry[];
  const allShifts = (rawShifts ?? []) as Shift[];

  // Schichten, für die bereits eine Ist-Zeit erfasst wurde, sind nicht erneut
  // übernehmbar (verhindert Doppelbuchung). Abwesenheiten (Urlaub/Krank) werden
  // automatisch verbucht und daher nicht zur Übernahme angeboten.
  const bookedShiftIds = new Set(
    entries.map((e) => e.shiftId).filter((id): id is number => id != null)
  );
  const shifts = allShifts.filter(
    (s) => !isAbsenceType(s.type) && !bookedShiftIds.has(s.id)
  );

  const createEntry = useCreateTimeEntry();

  if (!currentUser) return <Redirect href="/login" />;

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  const openModal = () => {
    setDate(todayDateStr());
    setStartTime(nowTimeStr());
    setEndTime(nowTimeStr());
    setEndsNextDay(false);
    setNotes("");
    setSelectedShiftId(null);
    setError("");
    setModalVisible(true);
  };

  const handleShiftSelect = (shift: Shift) => {
    setSelectedShiftId(shift.id);
    const d = shift.startTime.slice(0, 10);
    setDate(d);
    const sH = new Date(shift.startTime);
    const eH = new Date(shift.endTime);
    setStartTime(`${String(sH.getHours()).padStart(2,"0")}:${String(sH.getMinutes()).padStart(2,"0")}`);
    setEndTime(`${String(eH.getHours()).padStart(2,"0")}:${String(eH.getMinutes()).padStart(2,"0")}`);
    setShiftPickerOpen(false);
  };

  const handleSubmit = async () => {
    if (!date || !startTime || !endTime) {
      setError("Bitte alle Pflichtfelder ausfullen.");
      return;
    }
    const actualStart = buildISO(date, startTime);
    // Nachtschichten/24h-Dienste laufen ueber Mitternacht: eine Endzeit
    // <= Startzeit gilt als am Folgetag, wenn eine Schicht gewaehlt ist ODER
    // der Nutzer den "endet am Folgetag"-Schalter aktiviert hat (manueller
    // Nacht-Eintrag ohne Schichtbezug). Ohne Schicht UND ohne Schalter ist eine
    // gleiche/fruehere Endzeit eine Fehleingabe und wird unten abgewiesen,
    // statt still einen kaputten 24h-Eintrag auf den Folgetag zu erzeugen.
    const endDate =
      (selectedShiftId || endsNextDay) && endTime <= startTime
        ? addOneDay(date)
        : date;
    const actualEnd = buildISO(endDate, endTime);
    if (new Date(actualEnd) <= new Date(actualStart)) {
      setError("Endzeit muss nach Startzeit liegen.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createEntry.mutateAsync({
        data: {
          userId: currentUser.id,
          actualStart,
          actualEnd,
          ...(selectedShiftId ? { shiftId: selectedShiftId } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalVisible(false);
      void refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Fur diese Schicht wurde bereits eine Zeit erfasst.");
      } else {
        setError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
      }
    } finally {
      setSaving(false);
    }
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 100 : insets.bottom + 90;

  const selectedShift = (shifts ?? []).find(
    (s) => s.id === selectedShiftId
  ) as Shift | undefined;

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
        <Text style={[styles.headerTitle, { color: colors.primaryForeground }]}>
          Zeiterfassung
        </Text>
        <Text style={[styles.headerSub, { color: colors.primaryForeground + "99" }]}>
          {currentUser.name}
        </Text>
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
      ) : (entries ?? []).length === 0 ? (
        <View style={styles.centered}>
          <Feather name="clock" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Keine Einträge in diesem Monat
          </Text>
          <TouchableOpacity
            style={[
              styles.emptyAddBtn,
              { backgroundColor: colors.primary, borderRadius: colors.radius },
            ]}
            onPress={openModal}
          >
            <Feather name="plus" size={16} color={colors.primaryForeground} />
            <Text style={[styles.emptyAddText, { color: colors.primaryForeground }]}>
              Eintrag hinzufugen
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={(entries ?? []) as TimeEntry[]}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => {
            const sc =
              STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
            return (
              <View
                style={[
                  styles.entryCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <View style={styles.entryHeader}>
                  <View style={styles.entryTimes}>
                    <Feather name="clock" size={14} color={colors.mutedForeground} />
                    <Text style={[styles.entryTime, { color: colors.foreground }]}>
                      {formatDateTime(item.actualStart)}
                    </Text>
                    <Text style={[styles.entryTimeSep, { color: colors.mutedForeground }]}>
                      –
                    </Text>
                    <Text style={[styles.entryTime, { color: colors.foreground }]}>
                      {formatDateTime(item.actualEnd)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: sc.bg, borderRadius: 6 },
                    ]}
                  >
                    <Text style={[styles.statusText, { color: sc.text }]}>
                      {sc.label}
                    </Text>
                  </View>
                </View>
                <View
                  style={[styles.entryDivider, { backgroundColor: colors.border }]}
                />
                <View style={styles.entryFooter}>
                  <Text style={[styles.entryHours, { color: colors.primary }]}>
                    {formatHours(item.actualStart, item.actualEnd)}
                  </Text>
                  {item.notes ? (
                    <Text
                      style={[styles.entryNotes, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {item.notes}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}

      <TouchableOpacity
        testID="add-entry-fab"
        style={[
          styles.fab,
          {
            backgroundColor: colors.accent,
            bottom: bottomPad - 50,
          },
        ]}
        onPress={openModal}
        activeOpacity={0.8}
      >
        <Feather name="plus" size={26} color={colors.accentForeground} />
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <View
          style={[styles.modal, { backgroundColor: colors.background }]}
        >
          <View
            style={[
              styles.modalHeader,
              { borderBottomColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Zeiteintrag
            </Text>
            <TouchableOpacity onPress={() => void handleSubmit()} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.saveBtn, { color: colors.primary }]}>
                  Speichern
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalBody}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            {error ? (
              <View
                style={[
                  styles.errorBox,
                  {
                    backgroundColor: "#FEE2E2",
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                SCHICHT (OPTIONAL)
              </Text>
              <TouchableOpacity
                style={[
                  styles.shiftSelector,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
                onPress={() => setShiftPickerOpen((v) => !v)}
              >
                <Text
                  style={[
                    styles.shiftSelectorText,
                    {
                      color: selectedShift
                        ? colors.foreground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {selectedShift
                    ? `${selectedShift.startTime.slice(0, 10)} — ${shiftTypeLabel(selectedShift.type)}`
                    : "Keine Schicht ausgewahlt"}
                </Text>
                <Feather
                  name={shiftPickerOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={colors.mutedForeground}
                />
              </TouchableOpacity>

              {shiftPickerOpen && (
                <View
                  style={[
                    styles.shiftDropdown,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  {(shifts ?? []).length === 0 ? (
                    <Text
                      style={[
                        styles.dropdownEmpty,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      Keine offenen Schichten
                    </Text>
                  ) : (
                    (shifts ?? []).map((shift) => (
                      <TouchableOpacity
                        key={shift.id}
                        style={[
                          styles.dropdownItem,
                          {
                            backgroundColor:
                              selectedShiftId === shift.id
                                ? colors.secondary
                                : "transparent",
                          },
                        ]}
                        onPress={() => handleShiftSelect(shift as Shift)}
                      >
                        <Text
                          style={[
                            styles.dropdownItemText,
                            { color: colors.foreground },
                          ]}
                        >
                          {shift.startTime.slice(0, 10)} · {shiftTypeLabel(shift.type)} · {shiftTimeRange(shift)}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                DATUM
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    color: colors.foreground,
                  },
                ]}
                value={date}
                onChangeText={setDate}
                placeholder="JJJJ-MM-TT"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>

            <View style={styles.timeRow}>
              <TimePickerField
                label="VON"
                value={startTime}
                onChange={setStartTime}
                testID="time-picker-start"
              />
              <TimePickerField
                label="BIS"
                value={endTime}
                onChange={setEndTime}
                testID="time-picker-end"
              />
            </View>

            {!selectedShiftId ? (
              <View
                style={[
                  styles.switchRow,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <View style={styles.switchTextWrap}>
                  <Text style={[styles.switchLabel, { color: colors.foreground }]}>
                    Endet am Folgetag
                  </Text>
                  <Text
                    style={[styles.switchHint, { color: colors.mutedForeground }]}
                  >
                    Für Nacht-Einträge über Mitternacht (z. B. 22:00–06:00)
                  </Text>
                </View>
                <Switch
                  testID="ends-next-day-switch"
                  value={endsNextDay}
                  onValueChange={setEndsNextDay}
                  trackColor={{ true: colors.primary }}
                />
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                NOTIZ (OPTIONAL)
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.inputMulti,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    color: colors.foreground,
                  },
                ]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Kurze Anmerkung..."
                placeholderTextColor={colors.mutedForeground}
                multiline
                numberOfLines={3}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
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
    fontFamily: "Poppins_700Bold",
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
  navBtn: { padding: 6 },
  monthLabel: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Poppins_600SemiBold",
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
  },
  emptyAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
    marginTop: 8,
  },
  emptyAddText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  list: {
    padding: 16,
    gap: 10,
  },
  entryCard: {
    borderWidth: 1,
    overflow: "hidden",
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    gap: 8,
  },
  entryTimes: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    flexWrap: "wrap",
  },
  entryTime: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
  entryTimeSep: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  entryDivider: { height: 1, marginHorizontal: 12 },
  entryFooter: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  entryHours: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Poppins_700Bold",
  },
  entryNotes: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
    fontStyle: "italic",
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Poppins_600SemiBold",
  },
  saveBtn: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  modalBody: { flex: 1 },
  modalContent: {
    padding: 20,
    gap: 20,
    paddingBottom: 40,
  },
  errorBox: {
    padding: 12,
  },
  errorText: {
    color: "#991B1B",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  fieldGroup: { gap: 6 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  shiftSelector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    padding: 12,
  },
  shiftSelectorText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  shiftDropdown: {
    borderWidth: 1,
    marginTop: 4,
    overflow: "hidden",
  },
  dropdownEmpty: {
    padding: 14,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  dropdownItem: {
    padding: 14,
  },
  dropdownItemText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  input: {
    borderWidth: 1,
    padding: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  inputMulti: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  timeRow: {
    flexDirection: "row",
    gap: 12,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  switchTextWrap: {
    flex: 1,
    gap: 2,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  switchHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
