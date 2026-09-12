# ShriMusic PRD

## Problem statement
Build ShriMusic, a Spotify-inspired mobile music streaming experience for iOS and Android, with real music catalog + streaming (YouTube Music), Firebase Auth + Firestore for accounts and library, synced lyrics (later), and a rich playback experience.

## Architecture
- Expo React Native (SDK 57) frontend with Expo Router, native components, `expo-audio` for playback, `expo-image` for artwork, and Firebase Web SDK for auth.
- FastAPI backend on port 8001, `firebase-admin` for ID-token verification and Firestore access, `httpx` for YouTube Music (Innertube WEB_REMIX) search + home, `yt-dlp` for direct audio stream URL resolution.
- Firestore data model:
  - `users/{uid}` — public profile (`email`, `name`, `picture`, `created_at`).
  - `users/{uid}/meta/provider` — optional custom Piped / Invidious endpoint.
  - `users/{uid}/liked_songs/{track_id}` — saved tracks with metadata.
  - `users/{uid}/playlists/{playlist_id}` and `.../tracks/{track_id}` — user playlists.
  - `users/{uid}/history/*` — recently played entries.

## Personas
- Listener: signs in, searches, plays, likes, and revisits history.
- Power listener: connects a custom Piped/Invidious endpoint, tweaks theme + sleep timer.

## Core requirements
- Dark-first Spotify-inspired theme (Green #1DB954) with a Light Mode toggle.
- Firebase Email/Password sign-in and sign-up; Google Sign-In stubbed for post-deploy builds.
- Real YouTube Music search + home feed backed by the WEB_REMIX Innertube client.
- Direct audio playback via yt-dlp-resolved stream URLs and `expo-audio` with lock-screen metadata.
- Liked songs and listening history persisted in Firestore.
- Mini-player, full-screen player sheet, sleep timer (Off / 15 / 30 / 60 min).

## Delivered in this session
- Firebase Admin bootstrap (`firebase_client.py`) with the shrimusic service account.
- Firebase Web SDK bootstrap (`src/firebase.ts`) with AsyncStorage persistence on native and browser storage on web.
- Auth flow rewrite (`src/auth.tsx`) — email/password via Firebase Web SDK; ID token auto-attached to every API call.
- Backend endpoints: `/auth/register`, `/auth/me`, `/auth/sync`, `/profile/provider`, `/music/home`, `/music/search`, `/music/stream/{id}`, `/library/liked`, `/library/history`, `/library/playlists`.
- YouTube Music client (`youtube_client.py`) — Innertube search + home fallback plus yt-dlp stream extraction.
- Auto-seeded test user in Firebase Auth on backend startup (see `test_credentials.md`).
- Real search results + playback wired into `main-app.tsx` (tap → resolve → play with lock-screen metadata).

## Prioritized backlog
- P1: Synced LRCLIB lyrics with KuGou fallback + offline lyrics cache.
- P1: Google Sign-In in native builds via Firebase Auth (needs deployed Android build with google-services.json OAuth).
- P1: Playback progress bar, seek, and queue (currently the mini/player-sheet shows a static bar).
- P2: Downloads for offline listening, listening analytics dashboard.
- P2: Equalizer, crossfade, and full tablet/Android TV layouts.

## Test credentials
See `/app/memory/test_credentials.md` — `preview.listener@example.com` / `ShriMusic@123` (seeded at startup).
