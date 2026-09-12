import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StyleProp, StyleSheet, ViewStyle } from "react-native";

import { useTheme } from "@/src/theme";

export function AlbumArt({
  size,
  icon = "music-note",
  style,
  url,
}: {
  size: number;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  style?: StyleProp<ViewStyle>;
  url?: string | null;
}) {
  const { colors } = useTheme();
  const radius = Math.max(12, size * 0.16);
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={[styles.art, { width: size, height: size, borderRadius: radius }, style]}
        contentFit="cover"
        transition={200}
      />
    );
  }
  return (
    <LinearGradient
      colors={[colors.brandSecondary, colors.surfaceInverse === colors.surface ? colors.surfaceTertiary : colors.surfaceInverse]}
      style={[styles.art, { width: size, height: size, borderRadius: radius }, style]}
    >
      <MaterialCommunityIcons name={icon} size={size * 0.34} color={colors.onBrandPrimary} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({ art: { alignItems: "center", justifyContent: "center" } });
