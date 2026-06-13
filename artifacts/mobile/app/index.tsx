import { Redirect } from "expo-router";
import { useCurrentUser } from "@/context/UserContext";
import { View, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";

export default function Index() {
  const { currentUser, isLoading } = useCurrentUser();
  const colors = useColors();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (currentUser) {
    return <Redirect href="/(tabs)/dienstplan" />;
  }

  return <Redirect href="/login" />;
}
