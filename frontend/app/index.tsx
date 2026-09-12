import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { LoginScreen } from "@/src/components/login-screen";
import { MainApp } from "@/src/components/main-app";
import { useAuth } from "@/src/auth";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { user, isLoading } = useAuth();
  const { colors } = useTheme();

  if (isLoading) {
    return <View style={[styles.loading, { backgroundColor: colors.surface }]}><ActivityIndicator color={colors.brandPrimary} size="large" /><Text style={[styles.loadingText, { color: colors.muted }]}>Tuning your listening space…</Text></View>;
  }
  if (!user) return <LoginScreen />;
  return <MainApp />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  loadingText: { fontSize: 14 },
});
