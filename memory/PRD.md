# ShriMusic PRD

## Problem statement
Spotify-inspired Expo mobile music streaming app powered by YouTube Music, Firebase Auth + Firestore, LRCLIB/KuGou lyrics, and native offline downloads.

## Architecture
- Frontend: Expo SDK 57, Expo Router, Firebase Web SDK, expo-audio, expo-image, expo-file-system, react-native-draggable-flatlist.
- Backend: FastAPI on 8001, firebase-admin (Firestore + token verification), httpx (YouTube Innertube WEB_REMIX + LRCLIB + KuGou), yt-dlp (stream URL resolution).
- Firestore model:
  - `users/{uid}` — profile
  - `users/{uid}/meta/provider` — optional custom endpoint
  - `users/{uid}/liked_songs/{id}` — saved tracks
  - `users/{uid}/history/*` — recent plays
  - `users/{uid}/playlists/{playlist_id}` with `tracks/{id}` subcollection (has `order` field for drag-reorder)

## Delivered so far
- Custom app icon + splash + in-app logo header.
- Firebase Email/Password auth (seeded test account: `preview.listener@example.com` / `ShriMusic@123`).
- Real YouTube Music search & home feed (WEB_REMIX Innertube) with clean artist labels.
- Direct audio streaming via `yt-dlp`, played through `expo-audio` with lock-screen metadata.
- Real progress bar with drag-to-seek and live time display.
- Synced LRCLIB/KuGou lyrics with auto-scroll and in-memory cache.
- Offline downloads with local playback and Library "Downloads" section.
- Playlist editor: bottom-sheet add, drag-to-reorder detail, remove tracks.
- **Play queue sheet** — swipeable up-next list, drag-to-reorder, shuffle, clear, tap-to-jump.
- **Artist / album detail pages** — tap any artist name to open a hero page with top tracks, Play-all, Shuffle.
- Firestore-backed liked songs, history, playlists.
- Sleep timer, light + dark theme, Piped/Invidious provider override.

## Backlog
- P1: Google Sign-In in native builds (needs deployed Android build using google-services.json).
- P1: Playing queue view / drag-reorder the play queue itself.
- P2: Playback speed + equalizer + crossfade.
- P2: Listening analytics dashboard.

## Test credentials
See `/app/memory/test_credentials.md`. Same email/password auto-seeded on backend startup.
