// Firebase Web SDK bootstrap.
// Auth state is persisted with AsyncStorage on native and browser storage on web,
// so the app stays signed in across reloads and app restarts.
//
// The apiKey below is the Android platform key from google-services.json. It is
// a public client identifier — real access is guarded by Firebase Auth rules and
// backend Admin verification.

import { Platform } from "react-native";
import { getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const firebaseConfig = {
  apiKey: "AIzaSyB0UA_jmus1XNt0JhIB76--XayP32_3lIM",
  authDomain: "shrimusic.firebaseapp.com",
  projectId: "shrimusic",
  storageBucket: "shrimusic.firebasestorage.app",
  messagingSenderId: "502763525563",
  appId: "1:502763525563:android:122848dd6a100f18a2209e",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

let authInstance: Auth;
if (Platform.OS === "web") {
  authInstance = getAuth(app);
} else {
  // Native: initialize once with AsyncStorage-backed persistence.
  // getReactNativePersistence is only available from the firebase/auth entrypoint in RN builds.
  const rnAuth = require("firebase/auth") as typeof import("firebase/auth") & {
    getReactNativePersistence: (storage: unknown) => unknown;
    initializeAuth: (app: unknown, opts: { persistence: unknown }) => Auth;
  };
  try {
    authInstance = rnAuth.initializeAuth(app, {
      persistence: rnAuth.getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Already initialized in this JS runtime (hot reload) — fall back to getAuth.
    authInstance = getAuth(app);
  }
}

export const auth = authInstance;
