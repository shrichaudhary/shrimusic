// Artist / Album detail screen — fetches the top tracks matching a name via YouTube Music
// search and offers a hero header with Play-all and Shuffle-play.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api";
import { AlbumArt } from "@/src/components/album-art";
import { makeStyles, useTheme } from "@/src/theme";

export type CatalogueEntry = { id: string; title: string; artist: string; art_url?: string | null };

type Props = {
  kind: "artist" | "album";
  name: string;
  seedArtUrl?: string | null;
  onBack: () => void;
  onPlay: (track: CatalogueEntry, queue: CatalogueEntry[]) => void;
  resolvingId: string | null;
  onOpenArtist: (name: string, art?: string | null) => void;
};

function shuffle<T>(list: T[]): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function CatalogueScreen({ kind, name, seedArtUrl, onBack, onPlay, resolvingId, onOpenArtist }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const [tracks, setTracks] = useState<CatalogueEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const query = kind === "artist" ? `${name} top songs` : `${name} full album`;
        const data = await apiRequest<{ tracks: CatalogueEntry[] }>(`/music/search?q=${encodeURIComponent(query)}`);
        if (active) setTracks(data.tracks);
      } catch {
        if (active) setTracks([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [kind, name]);

  const playAll = () => {
    if (!tracks.length) return;
    onPlay(tracks[0], tracks);
  };
  const shufflePlay = () => {
    if (!tracks.length) return;
    const shuffled = shuffle(tracks);
    onPlay(shuffled[0], shuffled);
  };

  // Pick a hero art — use provided seed art, or first track's art.
  const heroArt = seedArtUrl || tracks[0]?.art_url || null;

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 180 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { paddingTop: insets.top + 8 }]}>
          <View style={styles.heroTop}>
            <Pressable testID="catalogue-back" onPress={onBack} hitSlop={8} style={styles.backButton}>
              <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
            </Pressable>
            <Text style={[styles.heroKicker, { color: colors.muted }]}>{kind === "artist" ? "ARTIST" : "ALBUM"}</Text>
            <View style={styles.backButton} />
          </View>
          <View style={styles.heroContent}>
            <AlbumArt size={200} icon={kind === "artist" ? "account-music" : "album"} url={heroArt} style={styles.heroArt} />
            <Text numberOfLines={2} style={[styles.title, { color: colors.onSurface }]}>{name}</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              {loading ? "Fetching top tracks…" : `${tracks.length} tracks`}
            </Text>
          </View>
          <LinearGradient colors={[`${colors.surface}00`, colors.surface]} style={styles.heroFade} pointerEvents="none" />
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            testID="catalogue-play-all"
            onPress={playAll}
            disabled={!tracks.length}
            style={[styles.primaryButton, { backgroundColor: colors.brandPrimary }, !tracks.length && styles.disabled]}
          >
            <MaterialCommunityIcons name="play" size={18} color={colors.onBrandPrimary} />
            <Text style={[styles.primaryText, { color: colors.onBrandPrimary }]}>Play all</Text>
          </Pressable>
          <Pressable
            testID="catalogue-shuffle"
            onPress={shufflePlay}
            disabled={!tracks.length}
            style={[styles.outlineButton, { borderColor: colors.brandPrimary }, !tracks.length && styles.disabled]}
          >
            <MaterialCommunityIcons name="shuffle-variant" size={18} color={colors.brandPrimary} />
            <Text style={[styles.outlineText, { color: colors.brandPrimary }]}>Shuffle</Text>
          </Pressable>
        </View>

        <View style={styles.list}>
          {loading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 20 }} />
          ) : tracks.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <MaterialCommunityIcons name="music-note-off" size={28} color={colors.brandPrimary} />
              <Text style={[styles.emptyText, { color: colors.muted }]}>No tracks found for {name}.</Text>
            </View>
          ) : (
            tracks.map((item, idx) => {
              const busy = resolvingId === item.id;
              return (
                <View key={`${item.id}-${idx}`} style={styles.row}>
                  <Text style={[styles.index, { color: colors.muted }]}>{idx + 1}</Text>
                  <Pressable
                    testID={`catalogue-play-${item.id}`}
                    style={styles.rowMain}
                    onPress={() => onPlay(item, tracks)}
                    disabled={busy}
                  >
                    <AlbumArt size={44} icon="music-note" url={item.art_url} />
                    <View style={styles.rowCopy}>
                      <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.onSurface }]}>{item.title}</Text>
                      <Pressable onPress={() => onOpenArtist(item.artist, item.art_url)} disabled={!item.artist} hitSlop={4}>
                        <Text numberOfLines={1} style={[styles.rowArtist, { color: colors.muted }]}>{item.artist || "Unknown"}</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                  {busy ? <ActivityIndicator color={colors.brandPrimary} /> : <MaterialCommunityIcons name="play-circle" size={24} color={colors.brandPrimary} />}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1 },
  hero: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  heroKicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  heroContent: { alignItems: "center", gap: 10, marginTop: 8 },
  heroArt: { alignSelf: "center" },
  title: { fontSize: 26, fontWeight: "800", textAlign: "center", letterSpacing: -0.4 },
  meta: { fontSize: 13 },
  heroFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 40 },
  actionsRow: { flexDirection: "row", gap: 12, paddingHorizontal: 20, marginBottom: 16 },
  primaryButton: { flex: 1, minHeight: 48, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryText: { fontSize: 15, fontWeight: "800" },
  outlineButton: { flex: 1, minHeight: 48, borderRadius: 999, borderWidth: 1.5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  outlineText: { fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.5 },
  list: { paddingHorizontal: 20, gap: 4 },
  row: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  index: { fontSize: 13, width: 22, textAlign: "center" },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: "700" },
  rowArtist: { fontSize: 12, textDecorationLine: "underline" },
  empty: { padding: 20, borderRadius: 20, borderWidth: 1, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 13, textAlign: "center", maxWidth: 260 },
}));
