import { LinearGradient } from "expo-linear-gradient";
import { StyleProp, StyleSheet, ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { useTheme } from "@/src/theme";

export function AlbumArt({ size, icon = "music-note", style }: { size: number; icon?: keyof typeof MaterialCommunityIcons.glyphMap; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <LinearGradient colors={[colors.brandSecondary, colors.surfaceInverse === colors.surface ? colors.surfaceTertiary : colors.surfaceInverse]} style={[styles.art, { width: size, height: size, borderRadius: Math.max(12, size * 0.16) }, style]}>
      <MaterialCommunityIcons name={icon} size={size * 0.34} color={colors.onBrandPrimary} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({ art: { alignItems: "center", justifyContent: "center" } });