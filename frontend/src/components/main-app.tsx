import { MaterialCommunityIcons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AlbumArt } from "@/src/components/album-art";
import { makeStyles, setColorScheme, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

type Tab = "Home" | "Search" | "Library" | "Settings";
type Track = { id: string; title: string; artist: string; stream_url?: string | null; art_url?: string | null };
type TrackFeed = { tracks: Track[]; message?: string | null };
type Provider = { endpoint: string; api_key: string; fallback_endpoint: string; connected: boolean };

const navItems: { tab: Tab; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { tab: "Home", icon: "home-variant" },
  { tab: "Search", icon: "magnify" },
  { tab: "Library", icon: "bookshelf" },
  { tab: "Settings", icon: "cog-outline" },
];

export function MainApp() {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const { user, signOut } = useAuth();
  const styles = useStyles();
  const [tab, setTab] = useState<Tab>("Home");
  const [track, setTrack] = useState<Track | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [provider, setProvider] = useState<Provider>({ endpoint: "", api_key: "", fallback_endpoint: "", connected: false });
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<string[]>([]);
  const [playlistName, setPlaylistName] = useState("");
  const [showPlaylistInput, setShowPlaylistInput] = useState(false);
  const [sleepRemainingSeconds, setSleepRemainingSeconds] = useState(0);

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

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [savedProvider, savedPlaylists, likedFeed] = await Promise.all([
          apiRequest<Provider>("/profile/provider").catch(() => ({ endpoint: "", api_key: "", fallback_endpoint: "", connected: false })),
          storage.getItem<string>("shrimusic_playlists", ""),
          apiRequest<TrackFeed>("/library/liked").catch(() => ({ tracks: [] })),
        ]);
        if (!active) return;
        setProvider(savedProvider);
        setPlaylists(savedPlaylists ? savedPlaylists.split("\n").filter(Boolean) : []);
        setLikedIds(new Set(likedFeed.tracks.map((t) => t.id)));
      } catch {
        // non-fatal
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const playTrack = useCallback(
    async (item: Track) => {
      setResolving(item.id);
      try {
        const resolved = await apiRequest<Track>(`/music/stream/${encodeURIComponent(item.id)}`);
        setTrack({ ...item, ...resolved });
        // Record history (best-effort)
        void apiRequest("/library/history", { method: "POST", body: JSON.stringify({ track: { id: resolved.id, title: resolved.title, artist: resolved.artist, art_url: resolved.art_url } }) }).catch(() => undefined);
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
      // Auto-play once a new stream URL is loaded.
      try {
        player.setActiveForLockScreen(true, { title: track.title, artist: track.artist });
      } catch {
        // some platforms may not support metadata
      }
      player.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.stream_url]);

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
        // revert on failure
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

  const addPlaylist = async () => {
    const next = playlistName.trim();
    if (!next || playlists.includes(next)) return;
    const updated = [...playlists, next];
    setPlaylists(updated);
    setPlaylistName("");
    setShowPlaylistInput(false);
    await storage.setItem("shrimusic_playlists", updated.join("\n"));
  };

  const togglePlayback = () => {
    if (!track?.stream_url) return;
    if (playerStatus.playing) player.pause();
    else player.play();
  };
  const setSleepMinutes = (minutes: number) => setSleepRemainingSeconds(minutes * 60);

  const content =
    tab === "Home" ? (
      <HomeScreen userName={user?.name ?? "Listener"} onPlay={playTrack} resolvingId={resolving} likedIds={likedIds} onLike={toggleLike} />
    ) : tab === "Search" ? (
      <SearchScreen onPlay={playTrack} resolvingId={resolving} likedIds={likedIds} onLike={toggleLike} />
    ) : tab === "Library" ? (
      <LibraryScreen playlists={playlists} showInput={showPlaylistInput} name={playlistName} onName={setPlaylistName} onAdd={addPlaylist} onShowInput={() => setShowPlaylistInput(true)} onPlay={playTrack} resolvingId={resolving} />
    ) : (
      <SettingsScreen provider={provider} saving={providerSaving} message={providerMessage} setProvider={setProvider} saveProvider={saveProvider} scheme={scheme} onTheme={() => setColorScheme(scheme === "dark" ? "light" : "dark")} sleepRemainingSeconds={sleepRemainingSeconds} onSetSleepTimer={setSleepMinutes} onSignOut={() => void signOut()} />
    );

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 156 }]} showsVerticalScrollIndicator={false}>
        {content}
      </ScrollView>
      <View pointerEvents={tab === "Settings" ? "none" : "auto"} style={[styles.miniPlayer, { bottom: insets.bottom + 70 }]}>
        <Pressable testID="mini-player" onPress={() => setPlayerOpen(true)} accessibilityRole="button" style={({ pressed }) => [styles.miniPressable, pressed && styles.pressed]}>
          <AlbumArt size={42} icon={track ? "music-note" : "waveform"} url={track?.art_url} />
          <View style={styles.miniCopy}>
            <Text numberOfLines={1} style={styles.miniTitle}>{track?.title ?? "No track loaded"}</Text>
            <Text numberOfLines={1} style={styles.miniSubtitle}>{track?.artist ?? "Pick something to play"}</Text>
          </View>
        </Pressable>
        <Pressable testID="mini-player-toggle" onPress={togglePlayback} accessibilityRole="button" hitSlop={8} style={styles.miniAction}>
          <MaterialCommunityIcons name={playerStatus.playing ? "pause" : "play"} size={22} color={colors.onSurface} />
        </Pressable>
      </View>
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
          onToggle={togglePlayback}
          onClose={() => setPlayerOpen(false)}
          liked={track ? likedIds.has(track.id) : false}
          onLike={() => track && void toggleLike(track)}
        />
      ) : null}
    </View>
  );
}

function TrackRow({ item, onPlay, resolvingId, liked, onLike }: { item: Track; onPlay: (t: Track) => void; resolvingId: string | null; liked: boolean; onLike?: (t: Track) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const busy = resolvingId === item.id;
  return (
    <View style={styles.trackRow}>
      <Pressable testID={`track-play-${item.id}`} onPress={() => onPlay(item)} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.trackPressable, pressed && styles.pressed]}>
        <AlbumArt size={52} icon="music-note" url={item.art_url} />
        <View style={styles.trackCopy}>
          <Text numberOfLines={1} style={styles.trackTitle}>{item.title || "Untitled"}</Text>
          <Text numberOfLines={1} style={styles.trackArtist}>{item.artist || "Unknown"}</Text>
        </View>
        {busy ? <ActivityIndicator color={colors.brandPrimary} /> : <MaterialCommunityIcons name="play-circle" size={26} color={colors.brandPrimary} />}
      </Pressable>
      {onLike ? (
        <Pressable testID={`track-like-${item.id}`} onPress={() => onLike(item)} hitSlop={8} accessibilityRole="button" style={styles.trackLike}>
          <MaterialCommunityIcons name={liked ? "heart" : "heart-outline"} size={22} color={liked ? colors.brandPrimary : colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function HomeScreen({ userName, onPlay, resolvingId, likedIds, onLike }: { userName: string; onPlay: (t: Track) => void; resolvingId: string | null; likedIds: Set<string>; onLike: (t: Track) => void }) {
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
        <View>
          <Text style={styles.kicker}>GOOD EVENING</Text>
          <Text style={styles.heading}>{userName.split(" ")[0]}, ready to listen?</Text>
        </View>
        <View style={[styles.avatar, { backgroundColor: colors.brandPrimary }]}>
          <Text style={[styles.avatarText, { color: colors.onBrandPrimary }]}>{userName.slice(0, 1).toUpperCase()}</Text>
        </View>
      </View>
      <LinearGradient colors={[colors.brandSecondary, colors.brandPrimary]} style={styles.hero}>
        <View style={styles.heroGlow}>
          <MaterialCommunityIcons name="waveform" size={38} color={colors.onBrandPrimary} />
        </View>
        <Text style={[styles.heroEyebrow, { color: colors.onBrandPrimary }]}>SHRIMUSIC</Text>
        <Text style={[styles.heroTitle, { color: colors.onBrandPrimary }]}>Your feed is live, powered by YouTube Music.</Text>
        <Text style={[styles.heroText, { color: colors.onBrandPrimary }]}>Trending tracks, quick picks, and a search that reaches millions of songs.</Text>
      </LinearGradient>
      <Text style={styles.sectionTitle}>Trending now</Text>
      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={styles.loader} />
      ) : feed.length ? (
        <View style={styles.trackList}>
          {feed.slice(0, 12).map((item) => (
            <TrackRow key={item.id} item={item} onPlay={onPlay} resolvingId={resolvingId} liked={likedIds.has(item.id)} onLike={onLike} />
          ))}
        </View>
      ) : (
        <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <MaterialCommunityIcons name="radio-tower" size={30} color={colors.brandPrimary} />
          <Text style={styles.emptyTitle}>Feed offline</Text>
          <Text style={styles.emptyText}>{message ?? "Could not reach YouTube Music. Try again in a moment."}</Text>
        </View>
      )}
    </View>
  );
}

function SearchScreen({ onPlay, resolvingId, likedIds, onLike }: { onPlay: (t: Track) => void; resolvingId: string | null; likedIds: Set<string>; onLike: (t: Track) => void }) {
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
        {query ? (
          <Pressable testID="search-clear" onPress={() => { setQuery(""); setTracks([]); setMessage("Search songs, artists, albums, and more."); }} hitSlop={6}>
            <MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {busy ? (
        <ActivityIndicator color={colors.brandPrimary} style={styles.loader} />
      ) : tracks.length ? (
        <View style={styles.trackList}>
          {tracks.map((item) => (
            <TrackRow key={item.id} item={item} onPlay={onPlay} resolvingId={resolvingId} liked={likedIds.has(item.id)} onLike={onLike} />
          ))}
        </View>
      ) : (
        <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <MaterialCommunityIcons name="magnify-expand" size={30} color={colors.brandPrimary} />
          <Text style={styles.emptyTitle}>Ready to search</Text>
          <Text style={styles.emptyText}>{message}</Text>
        </View>
      )}
    </View>
  );
}

function LibraryScreen({ playlists, showInput, name, onName, onAdd, onShowInput, onPlay, resolvingId }: { playlists: string[]; showInput: boolean; name: string; onName: (value: string) => void; onAdd: () => void; onShowInput: () => void; onPlay: (t: Track) => void; resolvingId: string | null }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [liked, setLiked] = useState<Track[]>([]);
  const [history, setHistory] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [likedFeed, historyFeed] = await Promise.all([
          apiRequest<TrackFeed>("/library/liked").catch(() => ({ tracks: [] })),
          apiRequest<TrackFeed>("/library/history").catch(() => ({ tracks: [] })),
        ]);
        if (!active) return;
        setLiked(likedFeed.tracks);
        setHistory(historyFeed.tracks);
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
        <View>
          <Text style={styles.kicker}>YOUR SPACE</Text>
          <Text style={styles.heading}>Library</Text>
        </View>
        <Pressable testID="library-add-playlist" onPress={onShowInput} accessibilityRole="button" style={[styles.addButton, { backgroundColor: colors.brandPrimary }]}>
          <MaterialCommunityIcons name="plus" size={21} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
      <Text style={styles.sectionTitle}>Liked songs</Text>
      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={styles.loader} />
      ) : liked.length ? (
        <View style={styles.trackList}>
          {liked.slice(0, 10).map((item) => (
            <TrackRow key={item.id} item={item} onPlay={onPlay} resolvingId={resolvingId} liked={true} />
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
          {history.slice(0, 8).map((item) => (
            <TrackRow key={`${item.id}-${item.title}`} item={item} onPlay={onPlay} resolvingId={resolvingId} liked={false} />
          ))}
        </View>
      ) : (
        <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <MaterialCommunityIcons name="history" size={28} color={colors.brandPrimary} />
          <Text style={styles.emptyText}>Your recent plays will appear here.</Text>
        </View>
      )}
      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>Playlists</Text>
        <Text style={styles.count}>{playlists.length} created</Text>
      </View>
      {showInput ? (
        <View style={styles.playlistInputRow}>
          <TextInput autoFocus value={name} onChangeText={onName} onSubmitEditing={onAdd} placeholder="Playlist name" placeholderTextColor={colors.muted} style={styles.playlistInput} />
          <Pressable onPress={onAdd} accessibilityRole="button" style={[styles.smallButton, { backgroundColor: colors.brandPrimary }]}>
            <Text style={[styles.smallButtonText, { color: colors.onBrandPrimary }]}>Add</Text>
          </Pressable>
        </View>
      ) : null}
      {playlists.length ? (
        playlists.map((item) => (
          <View key={item} style={styles.libraryRow}>
            <View style={[styles.rowIcon, { backgroundColor: colors.brandTertiary }]}>
              <MaterialCommunityIcons name="playlist-music" size={21} color={colors.onBrandTertiary} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{item}</Text>
              <Text style={styles.rowSubtitle}>Empty playlist</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={21} color={colors.muted} />
          </View>
        ))
      ) : (
        <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <MaterialCommunityIcons name="playlist-plus" size={30} color={colors.brandPrimary} />
          <Text style={styles.emptyTitle}>Make it yours</Text>
          <Text style={styles.emptyText}>Create a playlist for a mood or a moment.</Text>
          <Pressable onPress={onShowInput} accessibilityRole="button" style={[styles.outlineButton, { borderColor: colors.brandPrimary }]}>
            <Text style={[styles.outlineText, { color: colors.brandPrimary }]}>New playlist</Text>
          </Pressable>
        </View>
      )}
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
            <Text style={styles.cardSubtitle}>ShriMusic uses YouTube Music by default. Point here to override.</Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: provider.connected ? colors.brandPrimary : colors.muted }]} />
        </View>
        <TextInput autoCapitalize="none" value={provider.endpoint} onChangeText={(value) => setProvider({ ...provider, endpoint: value })} placeholder="https://your-piped-instance" placeholderTextColor={colors.muted} style={styles.settingsInput} />
        <TextInput autoCapitalize="none" value={provider.api_key} onChangeText={(value) => setProvider({ ...provider, api_key: value })} placeholder="API key (optional)" placeholderTextColor={colors.muted} style={styles.settingsInput} secureTextEntry />
        <TextInput autoCapitalize="none" value={provider.fallback_endpoint} onChangeText={(value) => setProvider({ ...provider, fallback_endpoint: value })} placeholder="Fallback endpoint (optional)" placeholderTextColor={colors.muted} style={styles.settingsInput} />
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
      <View style={[styles.optionRow, { borderBottomColor: colors.divider }]}>
        <View style={[styles.optionIcon, { backgroundColor: colors.brandTertiary }]}>
          <MaterialCommunityIcons name="lock-outline" size={20} color={colors.onBrandTertiary} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>Background playback</Text>
          <Text style={styles.rowSubtitle}>Lock-screen controls are enabled</Text>
        </View>
        <MaterialCommunityIcons name="check-circle" size={22} color={colors.brandPrimary} />
      </View>
      <Pressable testID="sign-out" onPress={onSignOut} accessibilityRole="button" style={styles.signOut}>
        <MaterialCommunityIcons name="logout" size={19} color={colors.error} />
        <Text style={[styles.signOutText, { color: colors.error }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function PlayerSheet({ track, playing, onToggle, onClose, liked, onLike }: { track: Track | null; playing: boolean; onToggle: () => void; onClose: () => void; liked: boolean; onLike: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View testID="player-sheet" style={[styles.playerOverlay, { backgroundColor: colors.surface }]}>
      <View style={[styles.playerTop, { paddingTop: 18 }]}>
        <Pressable testID="player-close" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
          <MaterialCommunityIcons name="chevron-down" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.playerTopText}>NOW PLAYING</Text>
        <MaterialCommunityIcons name="dots-horizontal" size={24} color={colors.onSurface} />
      </View>
      <View style={styles.playerBody}>
        {track ? (
          <AlbumArt size={280} icon="music-note" url={track.art_url} />
        ) : (
          <View style={[styles.playerEmptyArt, { backgroundColor: colors.surfaceSecondary }]}>
            <MaterialCommunityIcons name="music-note-off" size={64} color={colors.brandPrimary} />
          </View>
        )}
        <Text style={styles.playerTitle}>{track?.title ?? "Nothing playing"}</Text>
        <Text style={styles.playerArtist}>{track?.artist ?? "Tap a song to start"}</Text>
        <View style={[styles.progress, { backgroundColor: colors.surfaceTertiary }]}>
          <View style={[styles.progressFill, { backgroundColor: colors.brandPrimary, width: track ? "42%" : "0%" }]} />
        </View>
        <View style={styles.controls}>
          <Pressable onPress={onLike} disabled={!track} hitSlop={8}>
            <MaterialCommunityIcons name={liked ? "heart" : "heart-outline"} size={26} color={liked ? colors.brandPrimary : colors.muted} />
          </Pressable>
          <Pressable testID="player-toggle" onPress={onToggle} disabled={!track?.stream_url} style={[styles.playButton, { backgroundColor: colors.onSurface }, !track?.stream_url && styles.disabled]}>
            <MaterialCommunityIcons name={playing ? "pause" : "play"} size={30} color={colors.surface} />
          </Pressable>
          <MaterialCommunityIcons name="repeat" size={23} color={colors.muted} />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingHorizontal: 20 },
  section: { gap: 18 },
  topline: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kicker: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  heading: { color: colors.onSurface, fontSize: 28, fontWeight: "800", letterSpacing: -0.7, marginTop: 5 },
  avatar: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 17, fontWeight: "800" },
  hero: { borderRadius: 24, padding: 22, minHeight: 200, overflow: "hidden", justifyContent: "flex-end" },
  heroGlow: { position: "absolute", right: 24, top: 22, opacity: 0.65 },
  heroEyebrow: { fontSize: 11, letterSpacing: 1.5, fontWeight: "800" },
  heroTitle: { fontSize: 22, lineHeight: 28, fontWeight: "800", maxWidth: 280, marginTop: 8 },
  heroText: { fontSize: 13, lineHeight: 19, maxWidth: 280, marginTop: 8, opacity: 0.9 },
  sectionTitle: { color: colors.onSurface, fontSize: 19, fontWeight: "800", marginTop: 4 },
  emptyCard: { borderWidth: 1, borderRadius: 20, padding: 23, alignItems: "center", gap: 9 },
  emptyTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyText: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 300 },
  outlineButton: { minHeight: 42, borderRadius: 999, borderWidth: 1, paddingHorizontal: 17, alignItems: "center", justifyContent: "center", marginTop: 7 },
  outlineText: { fontWeight: "800", fontSize: 13 },
  searchBox: { minHeight: 56, borderRadius: 16, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10 },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 16 },
  loader: { marginTop: 30 },
  addButton: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  trackList: { gap: 4 },
  trackRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 6 },
  trackPressable: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  trackCopy: { flex: 1, gap: 3 },
  trackTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  trackArtist: { color: colors.muted, fontSize: 12 },
  trackLike: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  libraryRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 8 },
  rowIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, gap: 4 },
  rowTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  rowSubtitle: { color: colors.muted, fontSize: 12 },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  count: { color: colors.muted, fontSize: 12 },
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
  disabled: { opacity: 0.5 },
  playerOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, paddingHorizontal: 24 },
  playerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeButton: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" },
  playerTopText: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  playerBody: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  playerEmptyArt: { width: 280, height: 280, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  playerTitle: { color: colors.onSurface, fontSize: 23, fontWeight: "800", textAlign: "center", marginTop: 10 },
  playerArtist: { color: colors.muted, fontSize: 14, textAlign: "center" },
  progress: { height: 4, borderRadius: 2, alignSelf: "stretch", marginTop: 24, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  controls: { width: "78%", flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20 },
  playButton: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
}));
