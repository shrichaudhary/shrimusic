import { useEffect, useMemo, useState } from "react";
import { Appearance, StyleSheet } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  surface: "#121212",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#282828",
  onSurfaceSecondary: "#FFFFFF",
  surfaceTertiary: "#333333",
  onSurfaceTertiary: "#FFFFFF",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#121212",
  brand: "#1DB954",
  brandPrimary: "#1DB954",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#169C46",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#1FDF64",
  onBrandTertiary: "#121212",
  onBrand: "#FFFFFF",
  success: "#1DB954",
  onSuccess: "#FFFFFF",
  warning: "#FFA726",
  onWarning: "#121212",
  error: "#E53935",
  onError: "#FFFFFF",
  info: "#29B6F6",
  onInfo: "#121212",
  border: "#282828",
  borderStrong: "#1DB954",
  divider: "#222222",
  muted: "#B3B3B3",
};

const light = {
  ...dark,
  surface: "#FFFFFF",
  onSurface: "#121212",
  surfaceSecondary: "#F4F4F4",
  onSurfaceSecondary: "#121212",
  surfaceTertiary: "#EAEAEA",
  onSurfaceTertiary: "#333333",
  surfaceInverse: "#121212",
  onSurfaceInverse: "#FFFFFF",
  muted: "#6B6B6B",
  brandTertiary: "#DFF8E8",
  onBrandTertiary: "#169C46",
  border: "#E2E2E2",
  divider: "#E8E8E8",
};

export type ThemeColors = typeof dark;
export const defaultScheme = "dark" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark: ThemeColors } = { light, dark };
let activeScheme: ColorScheme = defaultScheme;
const schemeListeners = new Set<() => void>();

export function setColorScheme(scheme: ColorScheme | null) {
  activeScheme = scheme ?? defaultScheme;
  Appearance.setColorScheme?.(scheme ?? "unspecified");
  schemeListeners.forEach((listener) => listener());
}

setColorScheme(defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const [scheme, setScheme] = useState<ColorScheme>(activeScheme);
  useEffect(() => {
    const listener = () => setScheme(activeScheme);
    schemeListeners.add(listener);
    return () => {
      schemeListeners.delete(listener);
    };
  }, []);
  return { scheme, colors: themes[scheme] };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}