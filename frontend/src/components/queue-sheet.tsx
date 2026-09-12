// Play Queue bottom sheet — drag to reorder, shuffle, clear, tap to jump.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AlbumArt } from "@/src/components/album-art";
import { makeStyles, useTheme } from "@/src/theme";

export type QueueTrack = { id: string; title: string; artist: string; art_url?: string | null };

type Props = {
  queue: QueueTrack[];
  currentIndex: number;
  onClose: () => void;
  onReorder: (next: QueueTrack[]) => void;
  onShuffle: () => void;
  onClear: () => void;
  onJumpTo: (index: number) => void;
  onRemove: (index: number) => void;
};

export function QueueSheet({ queue, currentIndex, onClose, onReorder, onShuffle, onClear, onJumpTo, onRemove }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const [local, setLocal] = useState<QueueTrack[]>(queue);

  useEffect(() => {
    setLocal(queue);
  }, [queue]);

  const upcoming = useMemo(() => local.slice(currentIndex + 1), [local, currentIndex]);
  const current = currentIndex >= 0 ? local[currentIndex] : null;

  const renderItem = ({ item, drag, isActive, getIndex }: RenderItemParams<QueueTrack>) => {
    const idx = getIndex();
    const absoluteIndex = typeof idx === "number" ? currentIndex + 1 + idx : -1;
    return (
      <View testID={`queue-item-${item.id}`} style={[styles.row, isActive && { backgroundColor: colors.surfaceTertiary, borderRadius: 12 }]}>
        <Pressable style={styles.rowMain} onPress={() => onJumpTo(absoluteIndex)}>
          <AlbumArt size={42} icon="music-note" url={item.art_url} />
          <View style={styles.rowCopy}>
            <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.onSurface }]}>{item.title || "Untitled"}</Text>
            <Text numberOfLines={1} style={[styles.rowArtist, { color: colors.muted }]}>{item.artist || "Unknown"}</Text>
          </View>
        </Pressable>
        <Pressable testID={`queue-remove-${item.id}`} hitSlop={6} onPress={() => onRemove(absoluteIndex)}>
          <MaterialCommunityIcons name="close" size={20} color={colors.muted} />
        </Pressable>
        <Pressable testID={`queue-drag-${item.id}`} onLongPress={drag} hitSlop={6} style={styles.dragHandle}>
          <MaterialCommunityIcons name="drag-horizontal-variant" size={22} color={colors.muted} />
        </Pressable>
      </View>
    );
  };

  return (
    <View testID="queue-sheet" style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.onSurface }]}>Play queue</Text>
          <View style={styles.actions}>
            <Pressable testID="queue-shuffle" onPress={onShuffle} hitSlop={6} style={[styles.actionButton, { backgroundColor: colors.surfaceSecondary }]}>
              <MaterialCommunityIcons name="shuffle-variant" size={18} color={colors.onSurface} />
            </Pressable>
            <Pressable testID="queue-clear" onPress={onClear} hitSlop={6} style={[styles.actionButton, { backgroundColor: colors.surfaceSecondary }]}>
              <MaterialCommunityIcons name="playlist-remove" size={18} color={colors.error} />
            </Pressable>
            <Pressable testID="queue-close" onPress={onClose} hitSlop={6} style={styles.actionButton}>
              <MaterialCommunityIcons name="chevron-down" size={22} color={colors.onSurface} />
            </Pressable>
          </View>
        </View>

        {current ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.brandPrimary }]}>NOW PLAYING</Text>
            <View style={styles.row}>
              <View style={styles.rowMain}>
                <AlbumArt size={42} icon="music-note" url={current.art_url} />
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.brandPrimary }]}>{current.title}</Text>
                  <Text numberOfLines={1} style={[styles.rowArtist, { color: colors.muted }]}>{current.artist}</Text>
                </View>
              </View>
              <MaterialCommunityIcons name="waveform" size={22} color={colors.brandPrimary} />
            </View>
          </View>
        ) : null}

        <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 8 }]}>UP NEXT · {upcoming.length}</Text>
        {upcoming.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="playlist-music-outline" size={30} color={colors.muted} />
            <Text style={[styles.emptyText, { color: colors.muted }]}>Queue is empty — play something from Home or Search to build one.</Text>
          </View>
        ) : (
          <View style={{ height: 320 }}>
            <DraggableFlatList
              data={upcoming}
              keyExtractor={(item, idx) => `${item.id}-${idx}`}
              renderItem={renderItem}
              onDragEnd={({ data }) => {
                const head = local.slice(0, currentIndex + 1);
                const merged = [...head, ...data];
                setLocal(merged);
                onReorder(merged);
              }}
              activationDistance={12}
              contentContainerStyle={{ paddingBottom: 12 }}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 40, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { maxHeight: "80%", paddingHorizontal: 18, paddingTop: 12, borderTopLeftRadius: 26, borderTopRightRadius: 26, gap: 6 },
  handle: { width: 42, height: 4, borderRadius: 2, backgroundColor: colors.muted, alignSelf: "center", opacity: 0.4 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  title: { fontSize: 20, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 8 },
  actionButton: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  section: { gap: 4, marginTop: 8 },
  sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4, paddingVertical: 4 },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: "700" },
  rowArtist: { fontSize: 11 },
  dragHandle: { padding: 6 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 30 },
  emptyText: { fontSize: 13, textAlign: "center", maxWidth: 280 },
}));
