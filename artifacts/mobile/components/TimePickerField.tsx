import { Feather } from "@expo/vector-icons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import React, { useState } from "react";
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseTime(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":");
  const hour = Number(h);
  const minute = Number(m);
  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 0,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0,
  };
}

function toDate(value: string): Date {
  const { hour, minute } = parseTime(value);
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

function fromDate(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TimePickerField({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testID?: string;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(() => toDate(value));

  const fieldLabel = (
    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
      {label}
    </Text>
  );

  // Web: natives HTML-Zeit-Eingabefeld (Browser-eigener Zeit-Picker).
  if (Platform.OS === "web") {
    return (
      <View style={styles.fieldGroup}>
        {fieldLabel}
        <View
          style={[
            styles.field,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          {React.createElement("input", {
            type: "time",
            value,
            "data-testid": testID,
            "aria-label": label,
            onChange: (e: { target: { value: string } }) =>
              onChange(e.target.value),
            style: {
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: colors.foreground,
              fontSize: 15,
              fontFamily: "Inter_500Medium",
            },
          })}
          <Feather name="clock" size={18} color={colors.mutedForeground} />
        </View>
      </View>
    );
  }

  const openPicker = () => {
    setTempDate(toDate(value));
    setOpen(true);
  };

  const trigger = (
    <View style={styles.fieldGroup}>
      {fieldLabel}
      <TouchableOpacity
        testID={testID}
        style={[
          styles.field,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
        onPress={openPicker}
        activeOpacity={0.7}
      >
        <Text style={[styles.fieldValue, { color: colors.foreground }]}>
          {value || "--:--"}
        </Text>
        <Feather name="clock" size={18} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );

  // Android: nativer Dialog-Picker (imperativ, eigene OK/Abbrechen-Buttons).
  if (Platform.OS === "android") {
    return (
      <>
        {trigger}
        {open && (
          <DateTimePicker
            mode="time"
            display="clock"
            is24Hour
            value={tempDate}
            onChange={(event: DateTimePickerEvent, date?: Date) => {
              setOpen(false);
              if (event.type === "set" && date) {
                onChange(fromDate(date));
              }
            }}
          />
        )}
      </>
    );
  }

  // iOS: nativer Spinner-Picker in einem Modal mit Fertig-Button.
  return (
    <>
      {trigger}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[
              styles.sheet,
              { backgroundColor: colors.background, borderRadius: colors.radius },
            ]}
          >
            <View
              style={[styles.sheetHeader, { borderBottomColor: colors.border }]}
            >
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Text
                  style={[styles.sheetAction, { color: colors.mutedForeground }]}
                >
                  Abbrechen
                </Text>
              </TouchableOpacity>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                {label}
              </Text>
              <TouchableOpacity
                testID="time-picker-confirm"
                onPress={() => {
                  onChange(fromDate(tempDate));
                  setOpen(false);
                }}
              >
                <Text style={[styles.sheetAction, { color: colors.primary }]}>
                  Fertig
                </Text>
              </TouchableOpacity>
            </View>

            <DateTimePicker
              mode="time"
              display="spinner"
              is24Hour
              value={tempDate}
              onChange={(_event: DateTimePickerEvent, date?: Date) => {
                if (date) setTempDate(date);
              }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fieldGroup: { gap: 6, flex: 1 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    padding: 12,
  },
  fieldValue: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    overflow: "hidden",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sheetTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  sheetAction: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
});
