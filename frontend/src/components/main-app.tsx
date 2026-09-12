import { MaterialCommunityIcons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AddToPlaylistSheet } from "@/src/components/add-to-playlist-sheet";
import { AlbumArt } from "@/src/components/album-art";
import { CatalogueScreen } from "@/src/components/catalogue-screen";
import { PlayerSheet, PlayerTrack } from "@/src/components/player-sheet";
import { PlaylistDetail } from "@/src/components/playlist-detail";
import { QueueSheet } from "@/src/components/queue-sheet";
import { makeStyles, setColorScheme, useTheme } from "@/src/theme";
import { DownloadedTrack, isDownloaded, listDownloads } from "@/src/utils/downloads";

type Tab = "Home" | "Search" | "Library" | "Settings";
type Track = { id: string; title: string; artist: string; stream_url?: string | null; art_url?: string | null; duration_seconds?: number | null };
type TrackFeed = { tracks: Track[]; message?: string | null };
type Provider = { endpoint: string; api_key: string; fallback_endpoint: string; connected: boolean };
type Playlist = { id: string; name: string; track_count?: number };

const navItems: { tab: Tab; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { tab: "Home", icon: "home-variant" },
  { tab: "Search", icon: "magnify" },
  { tab: "Library", icon: "bookshelf" },
  { tab: "Settings", icon: "cog-outline" },
];

const LOGO = require("../../assets/images/logo.webp");

export function MainApp() {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const { user, signOut } = useAuth();
  const styles = useStyles();
  const [tab, setTab] = useState<Tab>("Home");
  const [track, setTrack] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [provider, setProvider] = useState<Provider>({ endpoint: "", api_key: "", fallback_endpoint: "", connected: false });
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [sleepRemainingSeconds, setSleepRemainingSeconds] = useState(0);
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState<Track | null>(null);
  const [openedPlaylist, setOpenedPlaylist] = useState<Playlist | null>(null);
  const [downloads, setDownloads] = useState<DownloadedTrack[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [openedCatalogue, setOpenedCatalogue] = useState<{ kind: "artist" | "album"; name: string; art?: string | null } | null>(null);

  const player = useAudioPlayer(track?.stream_url ?? undefined);
  const playerStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (sleepRemainingSeconds <= 0) return undefined;
    const timer = setInterval(() => {
      setSleepRemainingSeconds((remaining) => {
        if (remaining <= 1) {
          player.pause();
          return 0;
        }
        return remaining - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [player, sleepRemainingSeconds]);

  const refreshLibrary = useCallback(async () => {
    try {
      const [liked, dls] = await Promise.all([apiRequest<TrackFeed>("/library/liked").catch(() => ({ tracks: [] })), listDownloads()]);
      setLikedIds(new Set(liked.tracks.map((t) => t.id)));
      setDownloads(dls);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const savedProvider = await apiRequest<Provider>("/profile/provider").catch(() => ({ endpoint: "", api_key: "", fallback_endpoint: "", connected: false }));
        if (active) setProvider(savedProvider);
        if (active) await refreshLibrary();
      } catch {
        // silent
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshLibrary]);

  const playTrack = useCallback(
    async (item: Track, contextQueue?: Track[]) => {
      setResolving(item.id);
      try {
        // Serve from local download if available
        const local = await isDownloaded(item.id);
        let resolved: Track;
        if (local) {
          resolved = { id: local.id, title: local.title, artist: local.artist, art_url: local.art_url, stream_url: local.local_uri };
        } else {
          resolved = await apiRequest<Track>(`/music/stream/${encodeURIComponent(item.id)}`);
        }
        const nextTrack = { ...item, ...resolved };
        setTrack(nextTrack);
        if (contextQueue && contextQueue.length) {
          setQueue(contextQueue);
          setQueueIndex(contextQueue.findIndex((t) => t.id === item.id));
        }
        // Record history (best-effort)
        void apiRequest("/library/history", {
          method: "POST",
          body: JSON.stringify({ track: { id: nextTrack.id, title: nextTrack.title, artist: nextTrack.artist, art_url: nextTrack.art_url } }),
        }).catch(() => undefined);
      } catch (reason) {
        setProviderMessage(reason instanceof Error ? reason.message : "Could not load track.");
      } finally {
        setResolving(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (track?.stream_url) {
      try {
        player.setActiveForLockScreen(true, { title: track.title, artist: track.artist });
      } catch {
        // ignore
      }
      player.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.stream_url]);

  const playNext = useCallback(() => {
    if (queueIndex < 0 || queue.length === 0) return;
    const next = queueIndex + 1 < queue.length ? queueIndex + 1 : 0;
    void playTrack(queue[next], queue);
  }, [queueIndex, queue, playTrack]);

  const playPrev = useCallback(() => {
    if (queueIndex < 0 || queue.length === 0) return;
    const prev = queueIndex - 1 >= 0 ? queueIndex - 1 : queue.length - 1;
    void playTrack(queue[prev], queue);
  }, [queueIndex, queue, playTrack]);

  const shuffleQueue = useCallback(() => {
    if (queue.length <= 1) return;
    const rest = queue.filter((_, i) => i !== queueIndex);
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const current = queue[queueIndex];
    const next = current ? [current, ...rest] : rest;
    setQueue(next);
    setQueueIndex(current ? 0 : -1);
  }, [queue, queueIndex]);

  const clearQueue = useCallback(() => {
    if (queueIndex < 0) {
      setQueue([]);
      setQueueIndex(-1);
      return;
    }
    // Keep the currently-playing track so audio doesn't stop mid-song.
    const current = queue[queueIndex];
    setQueue(current ? [current] : []);
    setQueueIndex(current ? 0 : -1);
  }, [queue, queueIndex]);

  const reorderQueue = useCallback(
    (next: Track[]) => {
      const currentId = queueIndex >= 0 ? queue[queueIndex]?.id : null;
      const nextIndex = currentId ? next.findIndex((t) => t.id === currentId) : -1;
      setQueue(next);
      setQueueIndex(nextIndex);
    },
    [queue, queueIndex],
  );

  const jumpTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length) return;
      void playTrack(queue[index], queue);
    },
    [queue, playTrack],
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length || index === queueIndex) return;
      const next = queue.filter((_, i) => i !== index);
      const nextIndex = index < queueIndex ? queueIndex - 1 : queueIndex;
      setQueue(next);
      setQueueIndex(nextIndex);
    },
    [queue, queueIndex],
  );

  const toggleLike = useCallback(
    async (item: Track) => {
      const isLiked = likedIds.has(item.id);
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (isLiked) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      try {
        if (isLiked) {
          await apiRequest(`/library/liked/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        } else {
          await apiRequest("/library/liked", { method: "POST", body: JSON.stringify({ track: { id: item.id, title: item.title, artist: item.artist, art_url: item.art_url } }) });
        }
      } catch {
        setLikedIds((prev) => {
          const next = new Set(prev);
          if (isLiked) next.add(item.id);
          else next.delete(item.id);
          return next;
        });
      }
    },
    [likedIds],
  );

  const saveProvider = async () => {
    setProviderSaving(true);
    setProviderMessage(null);
    try {
      const saved = await apiRequest<Provider>("/profile/provider", {
        method: "PUT",
        body: JSON.stringify({ endpoint: provider.endpoint, api_key: provider.api_key, fallback_endpoint: provider.fallback_endpoint }),
      });
      setProvider(saved);
      setProviderMessage("Provider settings saved.");
    } catch (reason) {
      setProviderMessage(reason instanceof Error ? reason.message : "Could not save settings.");
    } finally {
      setProviderSaving(false);
    }
  };

  const togglePlayback = () => {
    if (!track?.stream_url) return;
    if (playerStatus.playing) player.pause();
    else player.play();
  };
  const setSleepMinutes = (minutes: number) => setSleepRemainingSeconds(minutes * 60);

  // If a playlist is opened, render its detail full-screen inside the main shell
  const openArtist = (artistName: string, art?: string | null) => setOpenedCatalogue({ kind: "artist", name: artistName, art });

  const overlays = (
    <>
      {playerOpen ? (
        <PlayerSheet
          track={track}
          playing={playerStatus.playing}
          currentTime={playerStatus.currentTime ?? 0}
          duration={playerStatus.duration || track?.duration_seconds || 0}
          liked={track ? likedIds.has(track.id) : false}
          hasQueue={queue.length > 1}
          onToggle={togglePlayback}
          onSeek={(sec) => {
            try {
              player.seekTo(sec);
            } catch {
              // ignore
            }
          }}
          onClose={() => setPlayerOpen(false)}
          onLike={() => track && void toggleLike(track)}
          onNext={playNext}
          onPrev={playPrev}
          onAddToPlaylist={() => track && setAddToPlaylistTrack(track)}
          onOpenQueue={() => setQueueOpen(true)}
        />
      ) : null}
      {queueOpen ? (
        <QueueSheet
          queue={queue}
          currentIndex={queueIndex}
          onClose={() => setQueueOpen(false)}
          onReorder={reorderQueue}
          onShuffle={shuffleQueue}
          onClear={clearQueue}
          onJumpTo={jumpTo}
          onRemove={removeFromQueue}
        />
      ) : null}
      {addToPlaylistTrack ? (
        <AddToPlaylistSheet track={addToPlaylistTrack} onClose={() => setAddToPlaylistTrack(null)} />
      ) : null}
    </>
  );

  if (openedCatalogue) {
    return (
      <View style={styles.root}>
        <CatalogueScreen
          kind={openedCatalogue.kind}
          name={openedCatalogue.name}
          seedArtUrl={openedCatalogue.art}
          onBack={() => setOpenedCatalogue(null)}
          onPlay={(t, ctx) => void playTrack(t, ctx)}
          resolvingId={resolving}
          onOpenArtist={openArtist}
        />
        <MiniPlayer track={track} playing={playerStatus.playing} onOpen={() => setPlayerOpen(true)} onToggle={togglePlayback} bottom={insets.bottom + 12} />
        {overlays}
      </View>
    );
  }

  if (openedPlaylist) {
    return (
      <View style={styles.root}>
        <PlaylistDetail
          playlistId={openedPlaylist.id}
          playlistName={openedPlaylist.name}
          onBack={() => setOpenedPlaylist(null)}
          onPlay={(item) => void playTrack(item)}
          resolvingId={resolving}
        />
        <MiniPlayer track={track} playing={playerStatus.playing} onOpen={() => setPlayerOpen(true)} onToggle={togglePlayback} bottom={insets.bottom + 12} />
        {overlays}
      </View>
    );
  }

  const content =
    tab === "Home" ? (
      <HomeScreen userName={user?.name ?? "Listener"} onPlay={playTrack} resolvingId={resolving} likedIds={likedIds} onLike={toggleLike} onAdd={setAddToPlaylistTrack} onArtistPress={openArtist} />
    ) : tab === "Search" ? (
      <SearchScreen onPlay={playTrack} resolvingId={resolving} likedIds={likedIds} onLike={toggleLike} onAdd={setAddToPlaylistTrack} onArtistPress={openArtist} />
    ) : tab === "Library" ? (
      <LibraryScreen
        onPlay={playTrack}
        resolvingId={resolving}
        onOpenPlaylist={(pl) => setOpenedPlaylist(pl)}
        downloads={downloads}
        onDownloadsChanged={refreshLibrary}
      />
    ) : (
      <SettingsScreen provider={provider} saving={providerSaving} message={providerMessage} setProvider={setProvider} saveProvider={saveProvider} scheme={scheme} onTheme={() => setColorScheme(scheme === "dark" ? "light" : "dark")} sleepRemainingSeconds={sleepRemainingSeconds} onSetSleepTimer={setSleepMinutes} onSignOut={() => void signOut()} />
    );

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 156 }]} showsVerticalScrollIndicator={false}>
        {content}
      </ScrollView>
      <MiniPlayer track={track} playing={playerStatus.playing} onOpen={() => setPlayerOpen(true)} onToggle={togglePlayback} bottom={insets.bottom + 70} disabled={tab === "Settings"} />
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10), backgroundColor: colors.surfaceSecondary, borderTopColor: colors.border }]}>
        {navItems.map((item) => {
          const active = item.tab === tab;
          return (
            <Pressable testID={`tab-${item.tab.toLowerCase()}`} key={item.tab} onPress={() => setTab(item.tab)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={({ pressed }) => [styles.tabItem, pressed && styles.pressed]}>
              <MaterialCommunityIcons name={item.icon} size={23} color={active ? colors.brandPrimary : colors.muted} />
              <Text style={[styles.tabLabel, { color: active ? colors.brandPrimary : colors.muted }]}>{item.tab}</Text>
            </Pressable>
          );
        })}
      </View>
      {playerOpen ? (
        <PlayerSheet
          track={track}
          playing={playerStatus.playing}
          currentTime={playerStatus.currentTime ?? 0}
          duration={playerStatus.duration || track?.duration_seconds || 0}
          liked={track ? likedIds.has(track.id) : false}
          hasQueue={queue.length > 1}
          onToggle={togglePlayback}
          onSeek={(sec) => {
            try {
              player.seekTo(sec);
            } catch {
              // ignore
            }
          }}
          onClose={() => setPlayerOpen(false)}
          onLike={() => track && void toggleLike(track)}
          onNext={playNext}
          onPrev={playPrev}
          onAddToPlaylist={() => track && setAddToPlaylistTrack(track)}
          onOpenQueue={() => setQueueOpen(true)}
        />
      ) : null}
      {queueOpen ? (
        <QueueSheet
          queue={queue}
          currentIndex={queueIndex}
          onClose={() => setQueueOpen(false)}
          onReorder={reorderQueue}
          onShuffle={shuffleQueue}
          onClear={clearQueue}
          onJumpTo={jumpTo}
          onRemove={removeFromQueue}
        />
      ) : null}
      {addToPlaylistTrack ? (
        <AddToPlaylistSheet track={addToPlaylistTrack} onClose={() => setAddToPlaylistTrack(null)} />
      ) : null}
    </View>
  );
}

function MiniPlayer({ track, playing, onOpen, onToggle, bottom, disabled }: { track: PlayerTrack | null; playing: boolean; onOpen: () => void; onToggle: () => void; bottom: number; disabled?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View pointerEvents={disabled ? "none" : "auto"} style={[styles.miniPlayer, { bottom }]}>
      <Pressable testID="mini-player" onPress={onOpen} accessibilityRole="button" style={({ pressed }) => [styles.miniPressable, pressed && styles.pressed]}>
        <AlbumArt size={42} icon={track ? "music-note" : "waveform"} url={track?.art_url} />
        <View style={styles.miniCopy}>
          <Text numberOfLines={1} style={styles.miniTitle}>{track?.title ?? "No track loaded"}</Text>
          <Text numberOfLines={1} style={styles.miniSubtitle}>{track?.artist ?? "Pick something to play"}</Text>
        </View>
      </Pressable>
      <Pressable testID="mini-player-toggle" onPress={onToggle} accessibilityRole="button" hitSlop={8} style={styles.miniAction}>
        <MaterialCommunityIcons name={playing ? "pause" : "play"} size={22} color={colors.onSurface} />
      </Pressable>
    </View>
  );
}

type TrackRowProps = { item: Track; onPlay: (t: Track) => void; resolvingId: string | null; liked: boolean; onLike?: (t: Track) => void; onAdd?: (t: Track) => void; onArtistPress?: (artist: string, art?: string | null) => void };
function TrackRow({ item, onPlay, resolvingId, liked, onLike, onAdd, onArtistPress }: TrackRowProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const busy = resolvingId === item.id;
  return (
    <View style={styles.trackRow}>
      <Pressable testID={`track-play-${item.id}`} onPress={() => onPlay(item)} onLongPress={() => onAdd?.(item)} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.trackPressable, pressed && styles.pressed]}>
        <AlbumArt size={52} icon="music-note" url={item.art_url} />
        <View style={styles.trackCopy}>
          <Text numberOfLines={1} style={styles.trackTitle}>{item.title || "Untitled"}</Text>
          {onArtistPress && item.artist ? (
            <Pressable testID={`track-artist-${item.id}`} hitSlop={4} onPress={() => onArtistPress(item.artist, item.art_url)}>
              <Text numberOfLines={1} style={[styles.trackArtist, { textDecorationLine: "underline" }]}>{item.artist}</Text>
            </Pressable>
          ) : (
            <Text numberOfLines={1} style={styles.trackArtist}>{item.artist || "Unknown"}</Text>
          )}
        </View>
        {busy ? <ActivityIndicator color={colors.brandPrimary} /> : <MaterialCommunityIcons name="play-circle" size={26} color={colors.brandPrimary} />}
      </Pressable>
      {onAdd ? (
        <Pressable testID={`track-add-${item.id}`} onPress={() => onAdd(item)} hitSlop={6} style={styles.trackAction}>
          <MaterialCommunityIcons name="playlist-plus" size={20} color={colors.muted} />
        </Pressable>
      ) : null}
      {onLike ? (
        <Pressable testID={`track-like-${item.id}`} onPress={() => onLike(item)} hitSlop={6} accessibilityRole="button" style={styles.trackAction}>
          <MaterialCommunityIcons name={liked ? "heart" : "heart-outline"} size={22} color={liked ? colors.brandPrimary : colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function HomeScreen({ userName, onPlay, resolvingId, likedIds, onLike, onAdd, onArtistPress }: { userName: string; onPlay: (t: Track, ctx?: Track[]) => void; resolvingId: string | null; likedIds: Set<string>; onLike: (t: Track) => void; onAdd: (t: Track) => void; onArtistPress: (artist: string, art?: string | null) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [feed, setFeed] = useState<Track[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await apiRequest<TrackFeed>("/music/home");
        if (!active) return;
        setFeed(result.tracks);
        setMessage(result.message ?? null);
      } catch (reason) {
        if (active) setMessage(reason instanceof Error ? reason.message : "Home feed unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  return (
    <View style={styles.section}>
      <View style={styles.topline}>
        <View style={styles.brandLine}>
          <Image source={LOGO} style={styles.brandLogo} contentFit="contain" transition={150} />
        </View>
        <View style={[styles.avatar, { backgroundColor: colors.brandPrimary }]}>
          <Text style={[styles.avatarText, { color: colors.onBrandPrimary }]}>{userName.slice(0, 1).toUpperCase()}</Text>
        </View>
      </View>
      <View>
        <Text style={styles.kicker}>GOOD EVENING</Text>
        <Text style={styles.heading}>{userName.split(" ")[0]}, ready to listen?</Text>
      </View>
      <LinearGradient colors={[colors.brandSecondary, colors.brandPrimary]} style={styles.hero}>
        <View style={styles.heroGlow}><MaterialCommunityIcons name="waveform" size={38} color={colors.onBrandPrimary} /></View>
        <Text style={[styles.heroEyebrow, { color: colors.onBrandPrimary }]}>SHRIMUSIC</Text>
        <Text style={[styles.heroTitle, { color: colors.onBrandPrimary }]}>Live lyrics + downloads + queue — all in one shelf.</Text>
      </LinearGradient>
      <Text style={styles.sectionTitle}>Trending now</Text>
      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={styles.loader} />
      ) : feed.length ? (
        <View style={styles.trackList}>
          {feed.slice(0, 15).map((item) => (
            <TrackRow key={item.id} item={item} onPlay={(t) => onPlay(t, feed)} resolvingId={resolvingId} liked={likedIds.has(item.id)} onLike={onLike} onAdd={onAdd} onArtistPress={onArtistPress} />
          ))}
        </View>
      ) : (
        <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <MaterialCommunityIcons name="radio-tower" size={30} color={colors.brandPrimary} />
          <Text style={styles.emptyText}>{message ?? "Could not reach YouTube Music."}</Text>
        </View>
      )}
    </View>
  );
}

function SearchScreen({ onPlay, resolvingId, likedIds, onLike, onAdd, onArtistPress }: { onPlay: (t: Track, ctx?: Track[]) => void; resolvingId: string | null; likedIds: Set<string>; onLike: (t: Track) => void; onAdd: (t: Track) => void; onArtistPress: (artist: string, art?: string | null) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [message, setMessage] = useState<string>("Search songs, artists, albums, and more.");
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setMessage("Searching…");
    try {
      const result = await apiRequest<TrackFeed>(`/music/search?q=${encodeURIComponent(query.trim())}`);
      setTracks(result.tracks);
      setMessage(result.message ?? `${result.tracks.length} results`);
    } catch (reason) {
      setTracks([]);
      setMessage(reason instanceof Error ? reason.message : "Search is unavailable.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.section}>
      <Text style={styles.kicker}>DISCOVER</Text>
      <Text style={styles.heading}>Find your sound</Text>
      <View style={[styles.searchBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <MaterialCommunityIcons name="magnify" size={22} color={colors.muted} />
        <TextInput testID="search-input" value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} returnKeyType="search" placeholder="What do you want to hear?" placeholderTextColor={colors.muted} style={styles.searchInput} />
        {query ? <Pressable testID="search-clear" onPress={() => { setQuery(""); setTracks([]); setMessage("Search songs, artists, albums, and more."); }} hitSlop={6}><MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} /></Pressable> : null}
      </View>
      {busy ? (
        <ActivityIndicator color={colors.brandPrimary} style={styles.loader} />
      ) : tracks.length ? (
        <View style={styles.trackList}>
          {tracks.map((item) => (
            <TrackRow key={item.id} item={item} onPlay={(t) => onPlay(t, tracks)} resolvingId={resolvingId} liked={likedIds.has(item.id)} onLike={onLike} onAdd={onAdd} onArtistPress={onArtistPress} />
          ))}
        </View>
      ) : (
        <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <MaterialCommunityIcons name="magnify-expand" size={30} color={colors.brandPrimary} />
          <Text style={styles.emptyText}>{message}</Text>
        </View>
      )}
    </View>
  );
}

function LibraryScreen({ onPlay, resolvingId, onOpenPlaylist, downloads, onDownloadsChanged }: { onPlay: (t: Track) => void; resolvingId: string | null; onOpenPlaylist: (pl: Playlist) => void; downloads: DownloadedTrack[]; onDownloadsChanged: () => Promise<void> }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [liked, setLiked] = useState<Track[]>([]);
  const [history, setHistory] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showInput, setShowInput] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [likedFeed, historyFeed, playlistData] = await Promise.all([
        apiRequest<TrackFeed>("/library/liked").catch(() => ({ tracks: [] })),
        apiRequest<TrackFeed>("/library/history").catch(() => ({ tracks: [] })),
        apiRequest<{ playlists: Playlist[] }>("/library/playlists").catch(() => ({ playlists: [] })),
      ]);
      setLiked(likedFeed.tracks);
      setHistory(historyFeed.tracks);
      setPlaylists(playlistData.playlists);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createPlaylist = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = await apiRequest<Playlist>("/library/playlists", { method: "POST", body: JSON.stringify({ name }) });
      setPlaylists((prev) => [created, ...prev]);
      setNewName("");
      setShowInput(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.topline}>
        <View>
          <Text style={styles.kicker}>YOUR SPACE</Text>
          <Text style={styles.heading}>Library</Text>
        </View>
        <Pressable testID="library-add-playlist" onPress={() => setShowInput(true)} accessibilityRole="button" style={[styles.addButton, { backgroundColor: colors.brandPrimary }]}>
          <MaterialCommunityIcons name="plus" size={21} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      {showInput ? (
        <View style={styles.playlistInputRow}>
          <TextInput autoFocus value={newName} onChangeText={setNewName} onSubmitEditing={createPlaylist} placeholder="Playlist name" placeholderTextColor={colors.muted} style={styles.playlistInput} />
          <Pressable testID="library-create-confirm" onPress={createPlaylist} disabled={creating} style={[styles.smallButton, { backgroundColor: colors.brandPrimary }]}>
            {creating ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={[styles.smallButtonText, { color: colors.onBrandPrimary }]}>Create</Text>}
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Playlists</Text>
      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={styles.loader} />
      ) : playlists.length ? (
        <View style={styles.trackList}>
          {playlists.map((pl) => (
            <Pressable key={pl.id} testID={`playlist-open-${pl.id}`} onPress={() => onOpenPlaylist(pl)} style={({ pressed }) => [styles.libraryRow, pressed && styles.pressed]}>
              <View style={[styles.rowIcon, { backgroundColor: colors.brandTertiary }]}>
                <MaterialCommunityIcons name="playlist-music" size={21} color={colors.onBrandTertiary} />
              </View>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{pl.name}</Text>
                <Text style={styles.rowSubtitle}>{pl.track_count ?? 0} tracks</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={21} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <MaterialCommunityIcons name="playlist-plus" size={30} color={colors.brandPrimary} />
          <Text style={styles.emptyText}>Create a playlist to start collecting tracks.</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Downloads</Text>
      {downloads.length ? (
        <View style={styles.trackList}>
          {downloads.slice(0, 8).map((d) => (
            <TrackRow
              key={d.id}
              item={{ id: d.id, title: d.title, artist: d.artist, art_url: d.art_url, stream_url: d.local_uri }}
              onPlay={onPlay}
              resolvingId={resolvingId}
              liked={false}
            />
          ))}
        </View>
      ) : (
        <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <MaterialCommunityIcons name="download" size={28} color={colors.brandPrimary} />
          <Text style={styles.emptyText}>Tap Download on any track to keep it offline.</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Liked songs</Text>
      {liked.length ? (
        <View style={styles.trackList}>
          {liked.slice(0, 10).map((item) => (
            <TrackRow key={item.id} item={item} onPlay={(t) => onPlay(t)} resolvingId={resolvingId} liked={true} />
          ))}
        </View>
      ) : (
        <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <MaterialCommunityIcons name="heart-outline" size={28} color={colors.brandPrimary} />
          <Text style={styles.emptyText}>Tap the heart on any track to save it here.</Text>
        </View>
      )}
      <Text style={styles.sectionTitle}>Recently played</Text>
      {history.length ? (
        <View style={styles.trackList}>
          {history.slice(0, 8).map((item, idx) => (
            <TrackRow key={`${item.id}-${idx}`} item={item} onPlay={(t) => onPlay(t)} resolvingId={resolvingId} liked={false} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SettingsScreen({ provider, saving, message, setProvider, saveProvider, scheme, onTheme, sleepRemainingSeconds, onSetSleepTimer, onSignOut }: { provider: Provider; saving: boolean; message: string | null; setProvider: (value: Provider) => void; saveProvider: () => Promise<void>; scheme: "light" | "dark"; onTheme: () => void; sleepRemainingSeconds: number; onSetSleepTimer: (minutes: number) => void; onSignOut: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const sleepLabel = sleepRemainingSeconds > 0 ? `${Math.ceil(sleepRemainingSeconds / 60)} min remaining` : "Off";
  return (
    <View style={styles.section}>
      <Text style={styles.kicker}>CONTROL ROOM</Text>
      <Text style={styles.heading}>Settings</Text>
      <Text style={styles.sectionTitle}>Custom provider (optional)</Text>
      <View style={[styles.settingsCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <View style={styles.settingsHeading}>
          <View>
            <Text style={styles.cardTitle}>Invidious / Piped endpoint</Text>
            <Text style={styles.cardSubtitle}>ShriMusic uses YouTube Music by default.</Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: provider.connected ? colors.brandPrimary : colors.muted }]} />
        </View>
        <TextInput autoCapitalize="none" value={provider.endpoint} onChangeText={(v) => setProvider({ ...provider, endpoint: v })} placeholder="https://your-piped-instance" placeholderTextColor={colors.muted} style={styles.settingsInput} />
        <TextInput autoCapitalize="none" value={provider.api_key} onChangeText={(v) => setProvider({ ...provider, api_key: v })} placeholder="API key (optional)" placeholderTextColor={colors.muted} style={styles.settingsInput} secureTextEntry />
        <TextInput autoCapitalize="none" value={provider.fallback_endpoint} onChangeText={(v) => setProvider({ ...provider, fallback_endpoint: v })} placeholder="Fallback endpoint (optional)" placeholderTextColor={colors.muted} style={styles.settingsInput} />
        <Pressable testID="provider-save" onPress={() => void saveProvider()} disabled={saving} accessibilityRole="button" style={[styles.primaryButton, { backgroundColor: colors.brandPrimary }]}>
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={[styles.primaryButtonText, { color: colors.onBrandPrimary }]}>Save connection</Text>}
        </Pressable>
        {message ? <Text style={[styles.message, { color: message.includes("saved") ? colors.success : colors.muted }]}>{message}</Text> : null}
      </View>
      <Text style={styles.sectionTitle}>Playback</Text>
      <View style={[styles.timerCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <View style={styles.settingsHeading}>
          <View>
            <Text style={styles.cardTitle}>Sleep timer</Text>
            <Text style={styles.cardSubtitle}>{sleepLabel === "Off" ? "Stop playback automatically" : sleepLabel}</Text>
          </View>
          <MaterialCommunityIcons name="timer-outline" size={23} color={colors.brandPrimary} />
        </View>
        <View style={styles.timerChips}>
          {[0, 15, 30, 60].map((minutes) => {
            const active = sleepLabel === (minutes === 0 ? "Off" : `${minutes} min remaining`);
            return (
              <Pressable key={minutes} testID={`sleep-${minutes}`} onPress={() => onSetSleepTimer(minutes)} accessibilityRole="button" style={[styles.timerChip, { backgroundColor: active ? colors.brandPrimary : colors.surfaceTertiary }]}>
                <Text style={[styles.timerChipText, { color: active ? colors.onBrandPrimary : colors.onSurfaceTertiary }]}>{minutes === 0 ? "Off" : `${minutes}m`}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Text style={styles.sectionTitle}>Experience</Text>
      <View style={[styles.optionRow, { borderBottomColor: colors.divider }]}>
        <View style={[styles.optionIcon, { backgroundColor: colors.brandTertiary }]}>
          <MaterialCommunityIcons name={scheme === "dark" ? "weather-night" : "white-balance-sunny"} size={20} color={colors.onBrandTertiary} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{scheme === "dark" ? "Dark theme" : "Light theme"}</Text>
          <Text style={styles.rowSubtitle}>Switch the look of ShriMusic</Text>
        </View>
        <Pressable testID="theme-toggle" onPress={onTheme} accessibilityRole="switch" style={[styles.toggle, { backgroundColor: scheme === "dark" ? colors.brandPrimary : colors.surfaceTertiary }]}>
          <View style={[styles.toggleKnob, { backgroundColor: scheme === "dark" ? colors.onBrandPrimary : colors.muted, alignSelf: scheme === "dark" ? "flex-end" : "flex-start" }]} />
        </Pressable>
      </View>
      <Pressable testID="sign-out" onPress={onSignOut} accessibilityRole="button" style={styles.signOut}>
        <MaterialCommunityIcons name="logout" size={19} color={colors.error} />
        <Text style={[styles.signOutText, { color: colors.error }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingHorizontal: 20 },
  section: { gap: 18 },
  brandLine: { flex: 1, alignItems: "flex-start" },
  brandLogo: { width: 170, height: 42 },
  topline: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kicker: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  heading: { color: colors.onSurface, fontSize: 26, fontWeight: "800", letterSpacing: -0.6, marginTop: 5 },
  avatar: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 17, fontWeight: "800" },
  hero: { borderRadius: 24, padding: 22, minHeight: 150, overflow: "hidden", justifyContent: "flex-end" },
  heroGlow: { position: "absolute", right: 24, top: 22, opacity: 0.65 },
  heroEyebrow: { fontSize: 11, letterSpacing: 1.5, fontWeight: "800" },
  heroTitle: { fontSize: 20, lineHeight: 26, fontWeight: "800", maxWidth: 280, marginTop: 8 },
  sectionTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800", marginTop: 4 },
  emptyCard: { borderWidth: 1, borderRadius: 20, padding: 22, alignItems: "center", gap: 8 },
  emptyText: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 300 },
  searchBox: { minHeight: 56, borderRadius: 16, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10 },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 16 },
  loader: { marginTop: 30 },
  addButton: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  trackList: { gap: 4 },
  trackRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 4 },
  trackPressable: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  trackCopy: { flex: 1, gap: 3 },
  trackTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  trackArtist: { color: colors.muted, fontSize: 12 },
  trackAction: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  libraryRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  rowIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  rowSubtitle: { color: colors.muted, fontSize: 12 },
  playlistInputRow: { flexDirection: "row", gap: 9 },
  playlistInput: { flex: 1, minHeight: 48, backgroundColor: colors.surfaceTertiary, borderRadius: 13, paddingHorizontal: 14, color: colors.onSurface, fontSize: 15 },
  smallButton: { minHeight: 48, borderRadius: 13, paddingHorizontal: 17, alignItems: "center", justifyContent: "center" },
  smallButtonText: { fontWeight: "800" },
  settingsCard: { borderWidth: 1, borderRadius: 20, padding: 17, gap: 11 },
  timerCard: { borderWidth: 1, borderRadius: 20, padding: 17, gap: 13 },
  timerChips: { flexDirection: "row", gap: 8 },
  timerChip: { minHeight: 38, flex: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  timerChipText: { fontSize: 12, fontWeight: "800" },
  settingsHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 3 },
  cardTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  cardSubtitle: { color: colors.muted, fontSize: 12, marginTop: 4, maxWidth: 240 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  settingsInput: { minHeight: 48, borderRadius: 13, backgroundColor: colors.surfaceTertiary, paddingHorizontal: 14, color: colors.onSurface, fontSize: 14 },
  primaryButton: { minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 3 },
  primaryButtonText: { fontSize: 14, fontWeight: "800" },
  message: { fontSize: 12, textAlign: "center" },
  optionRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1 },
  optionIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  toggle: { width: 45, height: 26, borderRadius: 999, padding: 3, justifyContent: "center" },
  toggleKnob: { width: 20, height: 20, borderRadius: 10 },
  signOut: { minHeight: 48, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 8 },
  signOutText: { fontSize: 14, fontWeight: "800" },
  miniPlayer: { position: "absolute", left: 12, right: 12, minHeight: 58, borderRadius: 17, backgroundColor: colors.surfaceInverse, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 10, elevation: 8, shadowColor: colors.surfaceInverse, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  miniPressable: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  miniCopy: { flex: 1, gap: 3 },
  miniTitle: { color: colors.onSurfaceInverse, fontSize: 13, fontWeight: "800" },
  miniSubtitle: { color: colors.muted, fontSize: 11 },
  miniAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  tabBar: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 66, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-around", paddingTop: 8 },
  tabItem: { minWidth: 64, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 3 },
  tabLabel: { fontSize: 10, fontWeight: "700" },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
}));
