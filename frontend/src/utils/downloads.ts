// Offline downloads helper — persists YouTube-resolved audio to the app document dir
// and remembers which tracks are downloaded via a small manifest in storage.
//
// The stream URL from YouTube is time-limited (~6h), so the first play resolves + caches;
// after that we serve the local file:// URI to expo-audio.

import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

const MANIFEST_KEY = "shrimusic_downloads_manifest";
const DIR = (FileSystem.documentDirectory ?? "") + "shrimusic_downloads/";

export type DownloadedTrack = {
  id: string;
  title: string;
  artist: string;
  art_url?: string | null;
  local_uri: string;
  downloaded_at: number;
};

async function loadManifest(): Promise<Record<string, DownloadedTrack>> {
  if (Platform.OS === "web") return {};
  const raw = await storage.getItem<string>(MANIFEST_KEY, "");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, DownloadedTrack>;
  } catch {
    return {};
  }
}

async function saveManifest(manifest: Record<string, DownloadedTrack>): Promise<void> {
  await storage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
}

async function ensureDir(): Promise<void> {
  if (Platform.OS === "web") return;
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

export async function isDownloaded(trackId: string): Promise<DownloadedTrack | null> {
  const manifest = await loadManifest();
  const entry = manifest[trackId];
  if (!entry) return null;
  if (Platform.OS === "web") return entry;
  const info = await FileSystem.getInfoAsync(entry.local_uri);
  return info.exists ? entry : null;
}

export async function listDownloads(): Promise<DownloadedTrack[]> {
  const manifest = await loadManifest();
  return Object.values(manifest).sort((a, b) => b.downloaded_at - a.downloaded_at);
}

export async function downloadTrack(
  track: { id: string; title: string; artist: string; art_url?: string | null; stream_url: string },
  onProgress?: (fraction: number) => void,
): Promise<DownloadedTrack | null> {
  if (Platform.OS === "web") return null; // Downloads are native-only
  await ensureDir();
  const dest = `${DIR}${track.id}.m4a`;
  const resumable = FileSystem.createDownloadResumable(
    track.stream_url,
    dest,
    {},
    (progress) => {
      if (onProgress && progress.totalBytesExpectedToWrite > 0) {
        onProgress(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
      }
    },
  );
  try {
    const result = await resumable.downloadAsync();
    if (!result?.uri) return null;
    const manifest = await loadManifest();
    const entry: DownloadedTrack = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      art_url: track.art_url ?? null,
      local_uri: result.uri,
      downloaded_at: Date.now(),
    };
    manifest[track.id] = entry;
    await saveManifest(manifest);
    return entry;
  } catch (error) {
    console.warn("download failed", error);
    return null;
  }
}

export async function removeDownload(trackId: string): Promise<void> {
  if (Platform.OS === "web") return;
  const manifest = await loadManifest();
  const entry = manifest[trackId];
  if (!entry) return;
  try {
    await FileSystem.deleteAsync(entry.local_uri, { idempotent: true });
  } catch {
    // ignore
  }
  delete manifest[trackId];
  await saveManifest(manifest);
}
