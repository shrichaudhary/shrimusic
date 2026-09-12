// Simple bottom sheet for "Add to playlist" and "Create new playlist" actions.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api";
import { makeStyles, useTheme } from "@/src/theme";

export type PlaylistItem = { id: string; name: string; track_count?: number };
export type PlaylistTrackPayload = { id: string; title: string; artist: string; art_url?: string | null };

type Props = {
  track: PlaylistTrackPayload;
  onClose: () => void;
  onAdded?: (playlistId: string, playlistName: string) => void;
};

export function AddToPlaylistSheet({ track, onClose, onAdded }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<{ playlists: PlaylistItem[] }>("/library/playlists")
      .then((d) => {
        if (active) setPlaylists(d.playlists);
      })
      .catch(() => {
        if (active) setPlaylists([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const addTo = async (playlist: PlaylistItem) => {
    setBusyId(playlist.id);
    try {
      await apiRequest(`/library/playlists/${encodeURIComponent(playlist.id)}/tracks`, {
        method: "POST",
        body: JSON.stringify({ track }),
      });
      setMessage(`Added to ${playlist.name}`);
      onAdded?.(playlist.id, playlist.name);
      setTimeout(onClose, 600);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not add track.");
    } finally {
      setBusyId(null);
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = await apiRequest<PlaylistItem>("/library/playlists", { method: "POST", body: JSON.stringify({ name }) });
      await addTo(created);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not create playlist.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <View testID="add-to-playlist-sheet" style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.surfaceSecondary, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.handle} />
        <Text style={[styles.title, { color: colors.onSurface }]}>Add to playlist</Text>
        <Text numberOfLines={1} style={[styles.subtitle, { color: colors.muted }]}>{track.title}</Text>

        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 20 }} />
        ) : (
          <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={styles.list}>
            {playlists.map((p) => (
              <Pressable
                key={p.id}
                testID={`add-to-${p.id}`}
                onPress={() => void addTo(p)}
                disabled={busyId === p.id}
                style={({ pressed }) => [styles.item, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="playlist-music" size={22} color={colors.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemTitle, { color: colors.onSurface }]}>{p.name}</Text>
                  <Text style={[styles.itemMeta, { color: colors.muted }]}>{p.track_count ?? 0} tracks</Text>
                </View>
                {busyId === p.id ? <ActivityIndicator color={colors.brandPrimary} /> : <MaterialCommunityIcons name="plus" size={22} color={colors.muted} />}
              </Pressable>
            ))}
            {playlists.length === 0 && !showCreate ? (
              <Text style={[styles.hint, { color: colors.muted }]}>No playlists yet. Create your first below.</Text>
            ) : null}
          </ScrollView>
        )}

        {showCreate ? (
          <View style={styles.createRow}>
            <TextInput
              autoFocus
              value={newName}
              onChangeText={setNewName}
              placeholder="Playlist name"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surfaceTertiary, color: colors.onSurface }]}
            />
            <Pressable testID="create-playlist-confirm" onPress={() => void createAndAdd()} disabled={creating} style={[styles.createButton, { backgroundColor: colors.brandPrimary }]}>
              {creating ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={[styles.createText, { color: colors.onBrandPrimary }]}>Create</Text>}
            </Pressable>
          </View>
        ) : (
          <Pressable testID="create-playlist-toggle" onPress={() => setShowCreate(true)} style={[styles.newButton, { borderColor: colors.brandPrimary }]}>
            <MaterialCommunityIcons name="plus-circle-outline" size={20} color={colors.brandPrimary} />
            <Text style={[styles.newButtonText, { color: colors.brandPrimary }]}>New playlist</Text>
          </Pressable>
        )}

        {message ? <Text style={[styles.message, { color: colors.brandPrimary }]}>{message}</Text> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 30, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { paddingHorizontal: 20, paddingTop: 12, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 12 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.muted, alignSelf: "center", opacity: 0.4 },
  title: { fontSize: 20, fontWeight: "800", marginTop: 6 },
  subtitle: { fontSize: 13 },
  list: { gap: 8, paddingBottom: 4 },
  item: { minHeight: 60, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  itemTitle: { fontSize: 14, fontWeight: "700" },
  itemMeta: { fontSize: 12, marginTop: 3 },
  pressed: { opacity: 0.75 },
  hint: { fontSize: 13, textAlign: "center", paddingVertical: 12 },
  createRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  input: { flex: 1, minHeight: 48, borderRadius: 12, paddingHorizontal: 14, fontSize: 15 },
  createButton: { minHeight: 48, paddingHorizontal: 18, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  createText: { fontSize: 14, fontWeight: "800" },
  newButton: { minHeight: 44, borderWidth: 1, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  newButtonText: { fontSize: 14, fontWeight: "800" },
  message: { fontSize: 13, textAlign: "center", fontWeight: "700" },
}));
