import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import { apiRequest, clearStoredToken, getStoredToken, saveStoredToken } from "@/src/api";

WebBrowser.maybeCompleteAuthSession();

export type User = { user_id: string; email: string; name: string; picture?: string | null };
type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function extractSessionId(url: string): string | null {
  return url.match(/[?#&]session_id=([^&#]+)/)?.[1] ?? null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const handledIds = useRef(new Set<string>());

  const completeGoogleSession = useCallback(async (url: string) => {
    const sessionId = extractSessionId(url);
    if (!sessionId || handledIds.current.has(sessionId)) return false;
    handledIds.current.add(sessionId);
    try {
      const result = await apiRequest<{ session_token: string; user: User }>("/auth/session", {
        method: "POST",
        body: JSON.stringify({ session_id: decodeURIComponent(sessionId) }),
      });
      await saveStoredToken(result.session_token);
      setUser(result.user);
      setError(null);
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
        window.history.replaceState(window.history.state, "", cleanUrl);
      }
      return true;
    } catch (reason) {
      handledIds.current.delete(sessionId);
      setError(reason instanceof Error ? reason.message : "Google sign-in failed");
      return false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const listener = Linking.addEventListener("url", ({ url }) => {
      void completeGoogleSession(url);
    });
    const initialize = async () => {
      const initialUrl = Platform.OS === "web" && typeof window !== "undefined" ? window.location.href : await Linking.getInitialURL();
      const hasCallback = initialUrl ? await completeGoogleSession(initialUrl) : false;
      if (hasCallback) {
        if (mounted) setIsLoading(false);
        return;
      }
      const token = await getStoredToken();
      if (!token) {
        if (mounted) setIsLoading(false);
        return;
      }
      try {
        const me = await apiRequest<User>("/auth/me", {}, token);
        if (mounted) setUser(me);
      } catch {
        await clearStoredToken();
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    void initialize();
    return () => {
      mounted = false;
      listener.remove();
    };
  }, [completeGoogleSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const result = await apiRequest<{ session_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await saveStoredToken(result.session_token);
    setUser(result.user);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    setError(null);
    const result = await apiRequest<{ session_token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
    await saveStoredToken(result.session_token);
    setUser(result.user);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    const redirectUrl = Platform.OS === "web" && typeof window !== "undefined" ? `${window.location.origin}/` : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = authUrl;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    const eventUrl = await Linking.getInitialURL();
    const callbackUrl = result.type === "success" ? result.url : eventUrl;
    if (!callbackUrl || !(await completeGoogleSession(callbackUrl))) {
      setError("Google sign-in was cancelled or could not be completed.");
    }
  }, [completeGoogleSession]);

  const signOut = useCallback(async () => {
    const token = await getStoredToken();
    if (token) await apiRequest("/auth/logout", { method: "POST" }, token).catch(() => undefined);
    await clearStoredToken();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, isLoading, error, signIn, signUp, signInWithGoogle, signOut }), [user, isLoading, error, signIn, signUp, signInWithGoogle, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}