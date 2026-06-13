import { useListUsers } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser, type AppUser } from "@/context/UserContext";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, setCurrentUser } = useCurrentUser();

  const { data: users, isLoading, isError } = useListUsers();

  if (currentUser) {
    return <Redirect href="/(tabs)/dienstplan" />;
  }

  const topPad =
    Platform.OS === "web" ? 67 : insets.top;

  const handleSelect = (user: AppUser) => {
    setCurrentUser(user);
    router.replace("/(tabs)/dienstplan");
  };

  const roleLabel = (role: string) =>
    role === "admin" ? "Admin" : "Assistent";

  const roleColor = (role: string) =>
    role === "admin" ? colors.accent : colors.primary;

  const roleTextColor = (role: string) =>
    role === "admin" ? colors.accentForeground : colors.primaryForeground;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: topPad },
      ]}
    >
      <View
        style={[styles.hero, { backgroundColor: colors.primary }]}
      >
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: colors.accent },
          ]}
        >
          <Feather name="calendar" size={32} color={colors.accentForeground} />
        </View>
        <Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>
          Dienstplan PA
        </Text>
        <Text style={[styles.heroSub, { color: colors.primaryForeground + "CC" }]}>
          Profil auswahlen
        </Text>
      </View>

      <View style={styles.listContainer}>
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : isError ? (
          <View style={styles.centered}>
            <Feather name="wifi-off" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Server nicht erreichbar
            </Text>
          </View>
        ) : !users?.length ? (
          <View style={styles.centered}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Keine Benutzer gefunden
            </Text>
          </View>
        ) : (
          <FlatList
            data={users}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
                onPress={() =>
                  handleSelect({
                    id: item.id,
                    name: item.name,
                    email: item.email,
                    role: item.role as "admin" | "assistant",
                  })
                }
                activeOpacity={0.75}
              >
                <View
                  style={[
                    styles.avatar,
                    {
                      backgroundColor: colors.secondary,
                      borderRadius: 24,
                    },
                  ]}
                >
                  <Text
                    style={[styles.avatarText, { color: colors.primary }]}
                  >
                    {item.name
                      .split(" ")
                      .map((n: string) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={[styles.cardName, { color: colors.foreground }]}>
                    {item.name}
                  </Text>
                  <Text
                    style={[styles.cardEmail, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {item.email}
                  </Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: roleColor(item.role),
                      borderRadius: 6,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      { color: roleTextColor(item.role) },
                    ]}
                  >
                    {roleLabel(item.role)}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hero: {
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 36,
    alignItems: "center",
    gap: 10,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  heroSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  listContainer: {
    flex: 1,
  },
  list: {
    padding: 16,
    gap: 10,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderWidth: 1,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  avatar: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardName: {
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  cardEmail: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 0,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
