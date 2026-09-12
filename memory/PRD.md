# ShriMusic PRD

## Problem statement
Build ShriMusic, a Spotify-inspired mobile music streaming experience for iOS and Android, with secure accounts, provider configuration, playback-ready controls, discovery, library, playlists, lyrics-ready architecture, and settings.

## Architecture
- Expo React Native SDK 57 frontend with Expo Router, themed native components, Expo Audio, SecureStore-backed sessions, and local preference storage.
- FastAPI backend on port 8001 with MongoDB through Motor, Pydantic response models, bcrypt passwords, token sessions, provider configuration, and Emergent-managed Google session exchange.
- Provider adapters are configuration-ready and intentionally wait for the user's Invidious/Piped/YouTube endpoint and key.

## Personas
- Listener: signs in, discovers music, plays tracks, manages favorites and playlists.
- Power listener: configures a preferred provider, fallback endpoint, themes, and background playback controls.

## Core requirements
- Dark-first Spotify-inspired theme with green accent and light-mode option.
- Email/password registration and login plus Google sign-in flow.
- Home, Search, Library, Settings, full player sheet, and persistent mini-player shell.
- Secure session persistence and logout.
- Provider endpoint, optional key, and fallback endpoint configuration.
- Background playback-ready Expo Audio setup with lock-screen metadata path.

## Implemented (2026-03-06)
- Replaced starter placeholder with authenticated ShriMusic mobile shell.
- Added backend auth, sessions, indexes, health check, provider persistence, home/search contracts, and CORS.
- Added dark/light theme tokens, responsive safe-area layouts, tab navigation, mini-player, player sheet, search state, local playlist creation, and settings controls.
- Added Expo Audio dependency/config plugin and background audio session configuration.
- Added Settings sleep timer controls for Off, 15m, 30m, and 60m with automatic pause when the countdown reaches zero.
- Verified registration, `/auth/me`, provider save, home API, sleep timer selection, and theme switching in preview.

## Prioritized backlog
- P0: Connect the user's Invidious/Piped/YouTube endpoint and implement its search/stream adapter.
- P0: Add real track selection, queue, seek position, and playback progress from provider responses.
- P1: Add LRCLIB lookup, synced lyrics, lyrics cache, favorites and playlist track persistence.
- P1: Add downloads/offline queue and listening history analytics.
- P2: Add equalizer, crossfade, visualizer, adaptive tablet layouts, and Android TV navigation.

## Next tasks
1. Collect the provider endpoint/key and map its response shape.
2. Implement real search, track metadata, audio stream URLs, and queue actions.
3. Add persisted library entities and LRCLIB lyrics.