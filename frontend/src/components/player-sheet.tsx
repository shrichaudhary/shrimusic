// Player sheet with real progress bar (drag-to-seek), lyrics tab, downloads,
// prev/next through the current queue, and like toggle.

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, LayoutChangeEvent, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { apiRequest } from "@/src/api";
import { AlbumArt } from "@/src/components/album-art";
import { makeStyles, useTheme } from "@/src/theme";
import { DownloadedTrack, downloadTrack, isDownloaded, removeDownload } from "@/src/utils/downloads";

export type PlayerTrack = { id: string; title: string; artist: string; stream_url?: string | null; art_url?: string | null; duration_seconds?: number | null };

type LyricsLine = { time: number; text: string };
type LyricsPayload = { synced: LyricsLine[] | null; plain: string | null; source: string };

type Props = {
  track: PlayerTrack | null;
  playing: boolean;
  currentTime: number; // seconds
  duration: number; // seconds
  liked: boolean;
  hasQueue: boolean;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onClose: () => void;
  onLike: () => void;
  onNext: () => void;
  onPrev: () => void;
  onAddToPlaylist: () => void;
  onOpenQueue: () => void;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function PlayerSheet(props: Props) {
  const { track, playing, currentTime, duration, liked, hasQueue, onToggle, onSeek, onClose, onLike, onNext, onPrev, onAddToPlaylist, onOpenQueue } = props;
  const { colors } = useTheme();
  const styles = useStyles();
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsPayload | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [download, setDownload] = useState<DownloadedTrack | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const lyricsScroll = useRef<ScrollView>(null);
  const dragOffset = useRef(0);

  // Reset lyrics + download state on track change
  useEffect(() => {
    setLyrics(null);
    setShowLyrics(false);
    setDownload(null);
    if (track) void isDownloaded(track.id).then(setDownload);
  }, [track?.id]);

  // Fetch lyrics when tab is opened
  useEffect(() => {
    if (!showLyrics || !track || lyrics) return;
    let active = true;
    setLyricsLoading(true);
    const params = new URLSearchParams({ title: track.title, artist: track.artist });
    if (track.duration_seconds) params.set("duration", String(track.duration_seconds));
    apiRequest<LyricsPayload>(`/music/lyrics/${encodeURIComponent(track.id)}?${params.toString()}`)
      .then((data) => {
        if (active) setLyrics(data);
      })
      .catch(() => {
        if (active) setLyrics({ synced: null, plain: null, source: "none" });
      })
      .finally(() => {
        if (active) setLyricsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showLyrics, track?.id, lyrics, track?.title, track?.artist, track?.duration_seconds]);

  // Autoscroll active synced lyric line into view
  const activeLineIndex = useMemo(() => {
    if (!lyrics?.synced?.length) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.synced.length; i += 1) {
      if (currentTime >= lyrics.synced[i].time) idx = i;
      else break;
    }
    return idx;
  }, [lyrics?.synced, currentTime]);

  useEffect(() => {
    if (!lyricsScroll.current || activeLineIndex < 0) return;
    lyricsScroll.current.scrollTo({ y: Math.max(0, activeLineIndex * 32 - 90), animated: true });
  }, [activeLineIndex]);

  const progressFraction = duration > 0 ? Math.min(1, Math.max(0, (dragging ?? currentTime) / duration)) : 0;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          if (trackWidth <= 0 || duration <= 0) return;
          const x = evt.nativeEvent.locationX;
          const seconds = Math.min(duration, Math.max(0, (x / trackWidth) * duration));
          dragOffset.current = seconds;
          setDragging(seconds);
        },
        onPanResponderMove: (evt) => {
          if (trackWidth <= 0 || duration <= 0) return;
          const x = Math.min(trackWidth, Math.max(0, evt.nativeEvent.locationX));
          const seconds = (x / trackWidth) * duration;
          dragOffset.current = seconds;
          setDragging(seconds);
        },
        onPanResponderRelease: () => {
          if (duration > 0) onSeek(dragOffset.current);
          setDragging(null);
        },
        onPanResponderTerminate: () => setDragging(null),
      }),
    [trackWidth, duration, onSeek],
  );

  const startDownload = async () => {
    if (!track?.stream_url) return;
    setDownloading(true);
    setDownloadProgress(0);
    const result = await downloadTrack(
      { id: track.id, title: track.title, artist: track.artist, art_url: track.art_url, stream_url: track.stream_url },
      setDownloadProgress,
    );
    setDownloading(false);
    setDownload(result);
  };

  const removeLocal = async () => {
    if (!track) return;
    await removeDownload(track.id);
    setDownload(null);
  };

  return (
    <View testID="player-sheet" style={[styles.overlay, { backgroundColor: colors.surface }]}>
      <View style={styles.top}>
        <Pressable testID="player-close" onPress={onClose} accessibilityRole="button" style={styles.iconButton}>
          <MaterialCommunityIcons name="chevron-down" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topText}>NOW PLAYING</Text>
        <Pressable testID="player-queue" onPress={onOpenQueue} accessibilityRole="button" style={styles.iconButton}>
          <MaterialCommunityIcons name="playlist-play" size={24} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {showLyrics ? (
          <View style={[styles.lyricsBox, { backgroundColor: colors.surfaceSecondary }]}>
            {lyricsLoading ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : lyrics?.synced?.length ? (
              <ScrollView ref={lyricsScroll} contentContainerStyle={styles.lyricsScroll} showsVerticalScrollIndicator={false}>
                {lyrics.synced.map((line, idx) => (
                  <Text
                    key={`${line.time}-${idx}`}
                    testID={`lyrics-line-${idx}`}
                    style={[styles.lyricsLine, idx === activeLineIndex ? { color: colors.brandPrimary, fontWeight: "800", fontSize: 17 } : { color: colors.muted }]}
                  >
                    {line.text || "♪"}
                  </Text>
                ))}
              </ScrollView>
            ) : lyrics?.plain ? (
              <ScrollView contentContainerStyle={styles.lyricsScroll} showsVerticalScrollIndicator={false}>
                <Text style={[styles.lyricsLine, { color: colors.onSurface }]}>{lyrics.plain}</Text>
              </ScrollView>
            ) : (
              <View style={styles.lyricsEmpty}>
                <MaterialCommunityIcons name="text-search" size={30} color={colors.muted} />
                <Text style={[styles.lyricsEmptyText, { color: colors.muted }]}>Lyrics not found for this track.</Text>
              </View>
            )}
          </View>
        ) : track ? (
          <AlbumArt size={280} icon="music-note" url={track.art_url} />
        ) : (
          <View style={[styles.emptyArt, { backgroundColor: colors.surfaceSecondary }]}>
            <MaterialCommunityIcons name="music-note-off" size={64} color={colors.brandPrimary} />
          </View>
        )}
        <View style={styles.titleBlock}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.onSurface }]}>{track?.title ?? "Nothing playing"}</Text>
          <Text numberOfLines={1} style={[styles.artist, { color: colors.muted }]}>{track?.artist ?? "Tap a song to start"}</Text>
        </View>

        <View
          style={styles.progressRow}
          onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)}
          {...panResponder.panHandlers}
          testID="progress-track"
        >
          <View style={[styles.progressBar, { backgroundColor: colors.surfaceTertiary }]}>
            <View style={[styles.progressFill, { backgroundColor: colors.brandPrimary, width: `${progressFraction * 100}%` }]} />
            <View style={[styles.progressKnob, { backgroundColor: colors.brandPrimary, left: `${progressFraction * 100}%` }]} />
          </View>
        </View>
        <View style={styles.timeRow}>
          <Text style={[styles.time, { color: colors.muted }]}>{formatTime(dragging ?? currentTime)}</Text>
          <Text style={[styles.time, { color: colors.muted }]}>{formatTime(duration)}</Text>
        </View>

        <View style={styles.controls}>
          <Pressable testID="player-like" onPress={onLike} disabled={!track} hitSlop={8}>
            <MaterialCommunityIcons name={liked ? "heart" : "heart-outline"} size={26} color={liked ? colors.brandPrimary : colors.muted} />
          </Pressable>
          <Pressable testID="player-prev" onPress={onPrev} disabled={!hasQueue} hitSlop={8}>
            <MaterialCommunityIcons name="skip-previous" size={34} color={hasQueue ? colors.onSurface : colors.muted} />
          </Pressable>
          <Pressable testID="player-toggle" onPress={onToggle} disabled={!track?.stream_url} style={[styles.playButton, { backgroundColor: colors.onSurface }, !track?.stream_url && styles.disabled]}>
            <MaterialCommunityIcons name={playing ? "pause" : "play"} size={30} color={colors.surface} />
          </Pressable>
          <Pressable testID="player-next" onPress={onNext} disabled={!hasQueue} hitSlop={8}>
            <MaterialCommunityIcons name="skip-next" size={34} color={hasQueue ? colors.onSurface : colors.muted} />
          </Pressable>
          <Pressable testID="player-repeat" hitSlop={8}>
            <MaterialCommunityIcons name="repeat" size={23} color={colors.muted} />
          </Pressable>
        </View>

        <View style={styles.actions}>
          <Pressable testID="player-lyrics" onPress={() => setShowLyrics((v) => !v)} style={[styles.actionButton, { backgroundColor: showLyrics ? colors.brandPrimary : colors.surfaceSecondary }]}>
            <MaterialCommunityIcons name="format-quote-close" size={18} color={showLyrics ? colors.onBrandPrimary : colors.onSurface} />
            <Text style={[styles.actionLabel, { color: showLyrics ? colors.onBrandPrimary : colors.onSurface }]}>{showLyrics ? "Cover" : "Lyrics"}</Text>
          </Pressable>
          <Pressable testID="player-add-playlist" onPress={onAddToPlaylist} disabled={!track} style={[styles.actionButton, { backgroundColor: colors.surfaceSecondary }, !track && styles.disabled]}>
            <MaterialCommunityIcons name="playlist-plus" size={18} color={colors.onSurface} />
            <Text style={[styles.actionLabel, { color: colors.onSurface }]}>Playlist</Text>
          </Pressable>
          {download ? (
            <Pressable testID="player-download-remove" onPress={removeLocal} style={[styles.actionButton, { backgroundColor: colors.brandTertiary }]}>
              <MaterialCommunityIcons name="check-circle" size={18} color={colors.onBrandTertiary} />
              <Text style={[styles.actionLabel, { color: colors.onBrandTertiary }]}>Saved</Text>
            </Pressable>
          ) : (
            <Pressable testID="player-download" onPress={startDownload} disabled={!track?.stream_url || downloading} style={[styles.actionButton, { backgroundColor: colors.surfaceSecondary }, (!track?.stream_url || downloading) && styles.disabled]}>
              {downloading ? (
                <>
                  <ActivityIndicator size="small" color={colors.brandPrimary} />
                  <Text style={[styles.actionLabel, { color: colors.onSurface }]}>{Math.round(downloadProgress * 100)}%</Text>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="download" size={18} color={colors.onSurface} />
                  <Text style={[styles.actionLabel, { color: colors.onSurface }]}>Download</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, paddingHorizontal: 22 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 18, minHeight: 48 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  topText: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  body: { flex: 1, alignItems: "center", justifyContent: "flex-start", gap: 10, paddingTop: 10 },
  emptyArt: { width: 280, height: 280, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  lyricsBox: { width: "100%", height: 280, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 20, alignItems: "center", justifyContent: "center" },
  lyricsScroll: { paddingVertical: 20, alignItems: "center" },
  lyricsLine: { fontSize: 15, lineHeight: 28, textAlign: "center", paddingHorizontal: 4 },
  lyricsEmpty: { alignItems: "center", gap: 8 },
  lyricsEmptyText: { fontSize: 13, textAlign: "center" },
  titleBlock: { alignItems: "center", gap: 4, marginTop: 14, alignSelf: "stretch" },
  title: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  artist: { fontSize: 14, textAlign: "center" },
  progressRow: { alignSelf: "stretch", marginTop: 12, height: 30, justifyContent: "center" },
  progressBar: { height: 4, borderRadius: 2, overflow: "visible" },
  progressFill: { height: 4, borderRadius: 2 },
  progressKnob: { position: "absolute", top: -6, marginLeft: -8, width: 16, height: 16, borderRadius: 8 },
  timeRow: { flexDirection: "row", justifyContent: "space-between", alignSelf: "stretch" },
  time: { fontSize: 11 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", alignSelf: "stretch", marginTop: 14, paddingHorizontal: 6 },
  playButton: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", justifyContent: "space-between", alignSelf: "stretch", gap: 10, marginTop: 16 },
  actionButton: { flex: 1, minHeight: 44, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10 },
  actionLabel: { fontSize: 12, fontWeight: "700" },
  disabled: { opacity: 0.4 },
}));
