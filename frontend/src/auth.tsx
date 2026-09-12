import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";

import { apiRequest } from "@/src/api";
import { auth } from "@/src/firebase";

export type User = { user_id: string; email: string; name: string; picture?: string | null };

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toProfile(fbUser: FirebaseUser): User {
  return {
    user_id: fbUser.uid,
    email: fbUser.email ?? "",
    name: fbUser.displayName ?? (fbUser.email ? fbUser.email.split("@")[0] : "Listener"),
    picture: fbUser.photoURL ?? null,
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      const local = toProfile(fbUser);
      setUser(local);
      // Hydrate/sync the profile document on the backend (best-effort).
      try {
        const remote = await apiRequest<User>("/auth/me", {});
        setUser(remote);
      } catch (reason) {
        console.warn("auth/me sync failed", reason);
      } finally {
        setIsLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged will set the user
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    setError(null);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (name.trim()) {
      await updateProfile(cred.user, { displayName: name.trim() }).catch(() => undefined);
    }
    // Push initial profile to Firestore via backend (needs a fresh ID token).
    try {
      await apiRequest<User>("/auth/sync", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    } catch (reason) {
      console.warn("auth/sync failed", reason);
    }
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth).catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, error, signIn, signUp, signOut }),
    [user, isLoading, error, signIn, signUp, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
