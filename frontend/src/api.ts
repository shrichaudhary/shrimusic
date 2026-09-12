import Constants from "expo-constants";

import { auth } from "@/src/firebase";

const backendUrl = String(Constants.expoConfig?.extra?.backendUrl ?? process.env.EXPO_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");

export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  if (!backendUrl) throw new Error("Backend URL is not configured");
  const idToken = token ?? (await auth.currentUser?.getIdToken().catch(() => null)) ?? undefined;
  const response = await fetch(`${backendUrl}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
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
