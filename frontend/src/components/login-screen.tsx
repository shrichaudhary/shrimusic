import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { useTheme } from "@/src/theme";

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { signIn, signUp, error } = useAuth();
  const [createAccount, setCreateAccount] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = async () => {
    setLocalError(null);
    if (!email.trim() || password.length < 6 || (createAccount && name.trim().length < 2)) {
      setLocalError(createAccount ? "Add your name and a 6-character password." : "Enter a valid email and password.");
      return;
    }
    setBusy(true);
    try {
      if (createAccount) await signUp(name.trim(), email.trim(), password);
      else await signIn(email.trim(), password);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "Unable to continue.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.surface }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 28 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <LinearGradient colors={[colors.brandPrimary, colors.brandSecondary]} style={styles.logo}><MaterialCommunityIcons name="waveform" size={28} color={colors.onBrandPrimary} /></LinearGradient>
          <View><Text style={[styles.brand, { color: colors.onSurface }]}>ShriMusic</Text><Text style={[styles.tagline, { color: colors.muted }]}>Music for every mood</Text></View>
        </View>
        <View style={[styles.heroCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Text style={[styles.eyebrow, { color: colors.brandPrimary }]}>YOUR SOUND, YOUR SPACE</Text>
          <Text style={[styles.title, { color: colors.onSurface }]}>{createAccount ? "Create your listening space" : "Welcome back to your sound"}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>Save your library, shape playlists, and pick up every session right where you left off.</Text>
        </View>
        {createAccount ? <TextInput testID="auth-name" value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={colors.muted} style={[styles.input, { color: colors.onSurface, backgroundColor: colors.surfaceTertiary, borderColor: colors.border }]} /> : null}
        <TextInput testID="auth-email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email address" placeholderTextColor={colors.muted} style={[styles.input, { color: colors.onSurface, backgroundColor: colors.surfaceTertiary, borderColor: colors.border }]} />
        <TextInput testID="auth-password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor={colors.muted} style={[styles.input, { color: colors.onSurface, backgroundColor: colors.surfaceTertiary, borderColor: colors.border }]} />
        {localError || error ? <Text style={[styles.error, { color: colors.error }]}>{localError || error}</Text> : null}
        <Pressable testID="auth-submit" onPress={submit} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.brandPrimary }, pressed && styles.pressed, busy && styles.disabled]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={[styles.primaryText, { color: colors.onBrandPrimary }]}>{createAccount ? "Create account" : "Sign in"}</Text>}
        </Pressable>
        <View style={[styles.googleNote, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <MaterialCommunityIcons name="google" size={18} color={colors.muted} />
          <Text style={[styles.googleNoteText, { color: colors.muted }]}>Google Sign-In activates in the installed build after deployment.</Text>
        </View>
        <Pressable testID="auth-mode-toggle" onPress={() => { setCreateAccount((value) => !value); setLocalError(null); }} accessibilityRole="button" style={styles.switchButton}><Text style={[styles.switchText, { color: colors.muted }]}>{createAccount ? "Already have an account? " : "New to ShriMusic? "}<Text style={{ color: colors.brandPrimary, fontWeight: "700" }}>{createAccount ? "Sign in" : "Create one"}</Text></Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, gap: 14 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  logo: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  brand: { fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  tagline: { fontSize: 13, marginTop: 2 },
  heroCard: { borderRadius: 24, borderWidth: 1, padding: 22, marginBottom: 8 },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4, marginBottom: 10 },
  title: { fontSize: 28, fontWeight: "800", lineHeight: 33, letterSpacing: -0.6 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 10 },
  input: { minHeight: 52, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, fontSize: 16 },
  primaryButton: { minHeight: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 2 },
  primaryText: { fontSize: 16, fontWeight: "800" },
  googleNote: { minHeight: 52, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10 },
  googleNoteText: { fontSize: 12, flex: 1, lineHeight: 16 },
  switchButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  switchText: { fontSize: 14 },
  error: { fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.65 },
});
