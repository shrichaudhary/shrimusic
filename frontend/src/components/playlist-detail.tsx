import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api";
import { AlbumArt } from "@/src/components/album-art";
import { makeStyles, useTheme } from "@/src/theme";

export type PlaylistTrack = { id: string; title: string; artist: string; art_url?: string | null };

type Props = {
  playlistId: string;
  playlistName: string;
  onBack: () => void;
  onPlay: (track: PlaylistTrack) => void;
  resolvingId: string | null;
};

export function PlaylistDetail({ playlistId, playlistName, onBack, onPlay, resolvingId }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await apiRequest<{ tracks: PlaylistTrack[] }>(`/library/playlists/${encodeURIComponent(playlistId)}/tracks`);
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
  }, [playlistId]);

  const persistOrder = async (next: PlaylistTrack[]) => {
    setTracks(next);
    try {
      await apiRequest(`/library/playlists/${encodeURIComponent(playlistId)}/reorder`, {
        method: "POST",
        body: JSON.stringify({ track_ids: next.map((t) => t.id) }),
      });
    } catch {
      // Refresh from server if reorder fails
    }
  };

  const removeTrack = async (trackId: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
    try {
      await apiRequest(`/library/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`, { method: "DELETE" });
    } catch {
      // silent
    }
  };

  const renderItem = ({ item, drag, isActive, getIndex }: RenderItemParams<PlaylistTrack>) => {
    const idx = getIndex();
    const busy = resolvingId === item.id;
    return (
      <View testID={`playlist-track-${item.id}`} style={[styles.row, isActive && { backgroundColor: colors.surfaceSecondary, borderRadius: 12 }]}>
        <Text style={[styles.index, { color: colors.muted }]}>{typeof idx === "number" ? idx + 1 : ""}</Text>
        <Pressable style={styles.rowMain} onPress={() => onPlay(item)} disabled={busy}>
          <AlbumArt size={44} icon="music-note" url={item.art_url} />
          <View style={styles.rowCopy}>
            <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.onSurface }]}>{item.title || "Untitled"}</Text>
            <Text numberOfLines={1} style={[styles.rowArtist, { color: colors.muted }]}>{item.artist || "Unknown"}</Text>
          </View>
        </Pressable>
        {busy ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : editing ? (
          <>
            <Pressable testID={`playlist-remove-${item.id}`} hitSlop={6} onPress={() => void removeTrack(item.id)}>
              <MaterialCommunityIcons name="minus-circle-outline" size={22} color={colors.error} />
            </Pressable>
            <Pressable testID={`playlist-drag-${item.id}`} onLongPress={drag} hitSlop={6} style={styles.dragHandle}>
              <MaterialCommunityIcons name="drag-horizontal-variant" size={22} color={colors.muted} />
            </Pressable>
          </>
        ) : (
          <MaterialCommunityIcons name="play-circle" size={24} color={colors.brandPrimary} />
        )}
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.surface, paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Pressable testID="playlist-back" onPress={onBack} hitSlop={8} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kicker, { color: colors.brandPrimary }]}>PLAYLIST</Text>
          <Text numberOfLines={1} style={[styles.title, { color: colors.onSurface }]}>{playlistName}</Text>
        </View>
        <Pressable testID="playlist-edit-toggle" onPress={() => setEditing((v) => !v)} accessibilityRole="button" style={[styles.editButton, { backgroundColor: editing ? colors.brandPrimary : colors.surfaceSecondary }]}>
          <Text style={[styles.editText, { color: editing ? colors.onBrandPrimary : colors.onSurface }]}>{editing ? "Done" : "Edit"}</Text>
        </Pressable>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 24 }} />
      ) : tracks.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <MaterialCommunityIcons name="playlist-music-outline" size={30} color={colors.brandPrimary} />
          <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>No tracks yet</Text>
          <Text style={[styles.emptyText, { color: colors.muted }]}>Tap the + on any song to add it to this playlist.</Text>
        </View>
      ) : (
        <DraggableFlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onDragEnd={({ data }) => void persistOrder(data)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 160 }}
          activationDistance={editing ? 10 : 10000}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  title: { fontSize: 24, fontWeight: "800", marginTop: 3 },
  editButton: { minHeight: 36, paddingHorizontal: 16, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  editText: { fontSize: 13, fontWeight: "800" },
  row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 6, paddingVertical: 8 },
  index: { fontSize: 13, width: 22, textAlign: "center" },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 14, fontWeight: "700" },
  rowArtist: { fontSize: 12 },
  dragHandle: { padding: 6 },
  empty: { marginTop: 20, padding: 24, borderRadius: 20, borderWidth: 1, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "800" },
  emptyText: { fontSize: 14, textAlign: "center", lineHeight: 20, ...StyleSheet.flatten({ maxWidth: 280 }) },
  __unused: {},
}));
