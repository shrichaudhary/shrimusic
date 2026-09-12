import Constants from "expo-constants";

import { storage } from "@/src/utils/storage";

const backendUrl = String(Constants.expoConfig?.extra?.backendUrl ?? process.env.EXPO_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");
export const SESSION_TOKEN_KEY = "shrimusic_session_token";

export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  if (!backendUrl) throw new Error("Backend URL is not configured");
  const response = await fetch(`${backendUrl}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.detail === "string" ? data.detail : "Something went wrong. Please try again.";
    throw new Error(message);
  }
  return data as T;
}

export async function getStoredToken(): Promise<string | null> {
  return storage.secureGet<string | null>(SESSION_TOKEN_KEY, null);
}

export async function saveStoredToken(token: string): Promise<void> {
  await storage.secureSet(SESSION_TOKEN_KEY, token);
}

export async function clearStoredToken(): Promise<void> {
  await storage.secureRemove(SESSION_TOKEN_KEY);
}