'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { auth } from '@/lib/firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Always start "loading" regardless of whether Firebase is configured, so
  // the very first render (SSR and the initial client render before any
  // effect runs) is identical on server and client. Whether `auth` is
  // present is only acted on inside the effect below, after hydration.
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!auth) {
      // No config: resolve to the signed-out state on a microtask, so this
      // still reads as "reacting to an external system" rather than an
      // unconditional synchronous setState in the effect body.
      queueMicrotask(() => setLoading(false));
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const requireAuth = () => {
    if (!auth) {
      throw new Error('登入功能目前無法使用。');
    }
    return auth;
  };

  const signUp = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(requireAuth(), email, password);
  };

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(requireAuth(), email, password);
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(requireAuth(), provider);
  };

  const signOut = async () => {
    await firebaseSignOut(requireAuth());
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
