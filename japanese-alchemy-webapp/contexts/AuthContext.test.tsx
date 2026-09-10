/* @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: null as unknown,
}));

vi.mock('@/lib/firebase', () => ({
  get auth() {
    return h.auth;
  },
}));

const onAuthStateChanged = vi.fn();
const createUserWithEmailAndPassword = vi.fn();
const signInWithEmailAndPassword = vi.fn();
const firebaseSignOut = vi.fn();
const signInWithPopup = vi.fn();

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChanged(...args),
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    createUserWithEmailAndPassword(...args),
  signInWithEmailAndPassword: (...args: unknown[]) =>
    signInWithEmailAndPassword(...args),
  signOut: (...args: unknown[]) => firebaseSignOut(...args),
  signInWithPopup: (...args: unknown[]) => signInWithPopup(...args),
  GoogleAuthProvider: class GoogleAuthProvider {},
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { AuthProvider, useAuth } from './AuthContext';

type AuthValue = ReturnType<typeof useAuth>;

function mount() {
  const sink = { current: null as AuthValue | null };
  function Probe() {
    sink.current = useAuth();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  return {
    sink,
    async render() {
      await act(async () => {
        root.render(
          <AuthProvider>
            <Probe />
          </AuthProvider>
        );
      });
    },
    async flush() {
      await act(async () => {});
    },
    unmount() {
      act(() => root.unmount());
    },
    v() {
      if (!sink.current) throw new Error('not mounted');
      return sink.current;
    },
  };
}

beforeEach(() => {
  h.auth = null;
  onAuthStateChanged.mockReset();
  createUserWithEmailAndPassword.mockReset();
  signInWithEmailAndPassword.mockReset();
  firebaseSignOut.mockReset();
  signInWithPopup.mockReset();
});

describe('AuthProvider — no Firebase config (auth === null)', () => {
  it('10/11. resolves loading=false and user=null without throwing', async () => {
    const m = mount();
    await m.render();
    await m.flush();
    expect(m.v().loading).toBe(false);
    expect(m.v().user).toBeNull();
    m.unmount();
  });

  it('12. never registers onAuthStateChanged', async () => {
    const m = mount();
    await m.render();
    await m.flush();
    expect(onAuthStateChanged).not.toHaveBeenCalled();
    m.unmount();
  });

  it('14. login / logout fail deterministically without leaking Firebase details', async () => {
    const m = mount();
    await m.render();
    await m.flush();

    await expect(m.v().signIn('a@b.c', 'pw')).rejects.toThrow('登入功能目前無法使用。');
    await expect(m.v().signUp('a@b.c', 'pw')).rejects.toThrow('登入功能目前無法使用。');
    await expect(m.v().signInWithGoogle()).rejects.toThrow('登入功能目前無法使用。');
    await expect(m.v().signOut()).rejects.toThrow('登入功能目前無法使用。');

    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
    expect(signInWithPopup).not.toHaveBeenCalled();
    expect(firebaseSignOut).not.toHaveBeenCalled();

    for (const err of [
      await m.v().signOut().catch((e: Error) => e),
    ]) {
      expect(String(err)).not.toMatch(/firebase|api-key|auth\//i);
    }
    m.unmount();
  });
});

describe('AuthProvider — Firebase configured (auth !== null)', () => {
  it('13. subscribes to onAuthStateChanged and resolves via its callback', async () => {
    const fakeAuth = { __brand: 'auth' };
    h.auth = fakeAuth;
    const unsubscribe = vi.fn();
    let cb: ((user: unknown) => void) | undefined;
    onAuthStateChanged.mockImplementation((_auth, callback) => {
      cb = callback as (user: unknown) => void;
      return unsubscribe;
    });

    const m = mount();
    await m.render();

    expect(onAuthStateChanged).toHaveBeenCalledTimes(1);
    expect(onAuthStateChanged.mock.calls[0][0]).toBe(fakeAuth);
    // loading stays true until the callback fires
    expect(m.v().loading).toBe(true);

    await act(async () => {
      cb?.({ uid: 'u1' });
    });
    expect(m.v().loading).toBe(false);
    expect(m.v().user).toEqual({ uid: 'u1' });

    m.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('delegates signIn / signOut to the Firebase SDK with the configured auth', async () => {
    const fakeAuth = { __brand: 'auth' };
    h.auth = fakeAuth;
    onAuthStateChanged.mockReturnValue(vi.fn());
    signInWithEmailAndPassword.mockResolvedValue(undefined);
    firebaseSignOut.mockResolvedValue(undefined);

    const m = mount();
    await m.render();

    await m.v().signIn('a@b.c', 'pw');
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(fakeAuth, 'a@b.c', 'pw');

    await m.v().signOut();
    expect(firebaseSignOut).toHaveBeenCalledWith(fakeAuth);

    m.unmount();
  });
});
