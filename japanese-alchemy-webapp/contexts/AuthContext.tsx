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
  // When Firebase is not configured (e.g. a static export built without
  // `.env.local`) there is nothing to wait for — start already resolved as
  // signed-out (user null, loading false) so the page prerenders / renders
  // deterministically. The effect below then does nothing in that mode.
  const [loading, setLoading] = useState<boolean>(auth !== null);

  useEffect(() => {
    if (!auth) {
      // No config: the initial state is already the correct signed-out state.
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
