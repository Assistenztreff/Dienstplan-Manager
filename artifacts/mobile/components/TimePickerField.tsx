import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const LIST_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

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

function WheelColumn({
  values,
  selected,
  onSelect,
  colors,
}: {
  values: number[];
  selected: number;
  onSelect: (value: number) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const ref = useRef<ScrollView>(null);

  useEffect(() => {
    const idx = values.indexOf(selected);
    if (idx >= 0) {
      ref.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: false });
    }
  }, [selected, values]);

  return (
    <ScrollView
      ref={ref}
      style={{ height: LIST_HEIGHT }}
      contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      onMomentumScrollEnd={(e) => {
        const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
        const clamped = Math.min(values.length - 1, Math.max(0, idx));
        const value = values[clamped];
        if (value !== selected) onSelect(value);
      }}
    >
      {values.map((value) => {
        const isActive = value === selected;
        return (
          <TouchableOpacity
            key={value}
            style={styles.wheelItem}
            activeOpacity={0.7}
            onPress={() => onSelect(value)}
          >
            <Text
              style={[
                styles.wheelItemText,
                {
                  color: isActive ? colors.foreground : colors.mutedForeground,
                  fontFamily: isActive
                    ? "Inter_700Bold"
                    : "Inter_400Regular",
                  fontSize: isActive ? 24 : 20,
                },
              ]}
            >
              {pad(value)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
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
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);

  const openPicker = () => {
    const parsed = parseTime(value);
    setHour(parsed.hour);
    setMinute(parsed.minute);
    setOpen(true);
  };

  const confirm = () => {
    onChange(`${pad(hour)}:${pad(minute)}`);
    setOpen(false);
  };

  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
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
              {
                backgroundColor: colors.background,
                borderRadius: colors.radius,
              },
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
              <TouchableOpacity onPress={confirm} testID="time-picker-confirm">
                <Text style={[styles.sheetAction, { color: colors.primary }]}>
                  Fertig
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.wheelRow}>
              <WheelColumn
                values={HOURS}
                selected={hour}
                onSelect={setHour}
                colors={colors}
              />
              <Text style={[styles.wheelSep, { color: colors.foreground }]}>
                :
              </Text>
              <WheelColumn
                values={MINUTES}
                selected={minute}
                onSelect={setMinute}
                colors={colors}
              />
              {/* Auswahl-Markierung in der Mitte der Räder */}
              <View
                pointerEvents="none"
                style={[
                  styles.selectionBand,
                  { borderColor: colors.border },
                ]}
              />
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
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
  wheelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 8,
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    width: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelItemText: {
    textAlign: "center",
  },
  wheelSep: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
  selectionBand: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 12 + ITEM_HEIGHT * 2,
    height: ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
});
