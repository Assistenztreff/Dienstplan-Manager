import {
  useGetDashboardSummary,
  useListContracts,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
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

type DashboardSummary = {
  monthlyPlannedHours: number;
  monthlyActualHours: number;
  hoursBalance?: number;
  pendingTimeEntries: number;
};

type Contract = {
  id: number;
  userId: number;
  vacationDays: number;
  vacationDaysUsed: number;
  startDate: string;
  endDate?: string | null;
};

const DE_MONTHS = [
  "Januar","Februar","März","April","Mai","Juni",
  "Juli","August","September","Oktober","November","Dezember",
];

function fmtHours(n: number): string {
  return `${n.toFixed(2)} h`;
}

function fmtBalance(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)} h`;
}

// Wählt den am Stichtag (Monatsbeginn) gültigen Vertrag: gestartet und noch
// nicht beendet. Fällt sonst auf den zuletzt begonnenen Vertrag zurück.
function activeContract(contracts: Contract[], year: number, month: number): Contract | null {
  if (contracts.length === 0) return null;
  const ref = `${year}-${String(month).padStart(2, "0")}-01`;
  const matching = contracts
    .filter((c) => c.startDate <= ref && (!c.endDate || c.endDate >= ref))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  if (matching.length > 0) return matching[0];
  return [...contracts].sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
}

function StatCard({
  label,
  value,
  color,
  colors,
}: {
  label: string;
  value: string;
  color: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.statCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

export default function StundenstandScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser } = useCurrentUser();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const {
    data: rawSummary,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
  } = useGetDashboardSummary(
    { month, year },
    { query: { enabled: !!currentUser } } as Parameters<typeof useGetDashboardSummary>[1]
  );

  const {
    data: rawContracts,
    isLoading: contractsLoading,
    refetch: refetchContracts,
  } = useListContracts(
    { userId: currentUser?.id },
    { query: { enabled: !!currentUser } } as Parameters<typeof useListContracts>[1]
  );

  if (!currentUser) return <Redirect href="/login" />;

  const summary = rawSummary as DashboardSummary | undefined;
  const contracts = (rawContracts ?? []) as Contract[];

  const planned = summary?.monthlyPlannedHours ?? 0;
  const actual = summary?.monthlyActualHours ?? 0;
  const balance = summary?.hoursBalance ?? actual - planned;

  const contract = activeContract(contracts, year, month);
  const vacationTotal = contract?.vacationDays ?? 0;
  const vacationUsed = contract?.vacationDaysUsed ?? 0;
  const vacationRemaining = vacationTotal - vacationUsed;

  const isLoading = summaryLoading || contractsLoading;

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  const refetchAll = () => {
    void refetchSummary();
    void refetchContracts();
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 100 : insets.bottom + 90;

  const balanceColor =
    balance > 0 ? "#166534" : balance < 0 ? "#991B1B" : colors.foreground;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.primary, paddingTop: topPad + 12 },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.primaryForeground }]}>
          Stundenstand
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
      ) : summaryError ? (
        <View style={styles.centered}>
          <Feather name="alert-circle" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Fehler beim Laden
          </Text>
          <TouchableOpacity onPress={refetchAll}>
            <Text style={[styles.retryText, { color: colors.primary }]}>
              Erneut versuchen
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad, gap: 16 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetchAll}
              tintColor={colors.primary}
            />
          }
        >
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            ARBEITSZEIT DIESEN MONAT
          </Text>
          <View style={styles.statRow}>
            <StatCard label="Soll" value={fmtHours(planned)} color={colors.foreground} colors={colors} />
            <StatCard label="Ist" value={fmtHours(actual)} color={colors.foreground} colors={colors} />
          </View>
          <View
            style={[
              styles.balanceCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
              Differenz
            </Text>
            <Text style={[styles.balanceValue, { color: balanceColor }]}>
              {fmtBalance(balance)}
            </Text>
            <Text style={[styles.balanceHint, { color: colors.mutedForeground }]}>
              Ist minus Soll
            </Text>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            URLAUB
          </Text>
          {contract ? (
            <View style={styles.statRow}>
              <StatCard
                label="Resturlaub"
                value={`${vacationRemaining} Tage`}
                color={vacationRemaining <= 5 ? "#991B1B" : colors.foreground}
                colors={colors}
              />
              <StatCard
                label="Genommen"
                value={`${vacationUsed} / ${vacationTotal}`}
                color={colors.foreground}
                colors={colors}
              />
            </View>
          ) : (
            <View
              style={[
                styles.balanceCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Text style={[styles.emptyText, { color: colors.mutedForeground, textAlign: "left" }]}>
                Kein Vertrag hinterlegt
              </Text>
            </View>
          )}
        </ScrollView>
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
  navBtn: { padding: 6 },
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
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  statRow: {
    flexDirection: "row",
    gap: 12,
  },
  statCard: {
    flex: 1,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  balanceCard: {
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  balanceValue: {
    fontSize: 28,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  balanceHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
