// Authentication Service for Japanese Alchemy Chrome Extension
// Manages Firebase Authentication with Google Sign-In
//
// P7.3-H session model: firebaseAuth.currentUser (via authStateReady() /
// onAuthStateChanged, below) is the ONLY source of truth for authenticated
// state. The chrome.storage.local `user` profile is a display cache — useful
// for painting the UI immediately without waiting on Firebase Auth's restore
// — but a stored uid/email alone never satisfies isLoggedIn(). Must import
// from the SAME 'firebase/auth/web-extension' build firebaseApp.js uses
// (see that file's comment) — mixing it with the standard 'firebase/auth'
// build here would reintroduce a P7.3-E-style mismatched-instance bug.
import { signInWithCredential, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth/web-extension';
import { firebaseApp, firebaseAuth } from './firebaseApp.js';

class AuthService {
  constructor() {
    this.user = null;
    this.isAuthenticated = false;
    this.offscreenDocumentId = null;
    this.isOffscreenDocumentReady = false;
    // Shared with jaAlchemyApiService.js via firebaseApp.js — see that
    // module's header comment for why this must be a single shared instance.
    this.firebaseApp = firebaseApp;
    this.auth = firebaseAuth;
    this.init();
  }

  async init() {
    // Paint a cached display profile immediately — see the class-level
    // comment. This never sets isAuthenticated.
    await this.loadUserFromStorage();

    // Wait for Firebase Auth to finish restoring any persisted session
    // before trusting currentUser — it starts null and is populated
    // asynchronously from IndexedDB. Only after this resolves does
    // currentUser reliably reflect whether a session actually survived.
    await this.auth.authStateReady();
    this.syncAuthenticatedStateFromFirebase();

    // Keep isAuthenticated/user in sync with the real Auth session for the
    // rest of this document's lifetime (e.g. a later signInWithCredential
    // call during signInWithGoogle() below).
    onAuthStateChanged(this.auth, () => {
      this.syncAuthenticatedStateFromFirebase();
    });
  }

  // Load the cached display profile from chrome.storage.local. DISPLAY
  // CACHE ONLY (P7.3-H) — never sets isAuthenticated. Real authenticated
  // state comes exclusively from syncAuthenticatedStateFromFirebase().
  async loadUserFromStorage() {
    const result = await chrome.storage.local.get('user');
    const user = result?.user;
    if (user) {
      this.user = user;
      console.log('[AuthService] Cached profile loaded from storage:', this.user.email);
    }
    return this.user;
  }

  // The single source of truth for authenticated state (P7.3-H): whatever
  // firebaseAuth.currentUser actually is right now. Also keeps the
  // chrome.storage.local display cache in sync with it, so a future reload's
  // loadUserFromStorage() shows the right cached profile while waiting on
  // authStateReady() again.
  syncAuthenticatedStateFromFirebase() {
    const currentUser = this.auth.currentUser;
    this.isAuthenticated = currentUser !== null;
    if (currentUser) {
      this.user = {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName,
        photoURL: currentUser.photoURL,
      };
      chrome.storage.local.set({ user: this.user });
    } else {
      // No real session (e.g. a stored profile existed but did not survive
      // — Case 2 in P7.3-H): never let the stale cache imply authenticated.
      this.user = null;
      chrome.storage.local.remove('user');
    }
  }

  // Check if user is authenticated
  isLoggedIn() {
    return this.isAuthenticated && this.user !== null;
  }

  // Get current user
  getUser() {
    return this.user;
  }

  // Get Firebase Auth instance (for callable functions)
  getAuthInstance() {
    return this.auth;
  }

  // Get Firebase App instance
  getAppInstance() {
    return this.firebaseApp;
  }

  // Get auth from offscreen document
  async getAuthFromOffscreen() {
    return new Promise(async (resolve, reject) => {
      const auth = await chrome.runtime.sendMessage({
        type: 'firebase-auth',
        target: 'offscreen'
      });
      auth?.name !== 'FirebaseError' ? resolve(auth) : reject(auth);
    })
  }

  // Create an offscreen document for authentication
  async createOffscreenDocument() {
    console.log('[AuthService] Creating offscreen document...');

    // Check if offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen/offscreen.html')]
    });

    if (existingContexts.length > 0) {
      console.log('[AuthService] Offscreen document already exists');
      return;
    }

    // Create the offscreen document
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['IFRAME_SCRIPTING'],
      justification: 'Firebase Authentication requires an iframe in an offscreen document for sign-in with popup'
    });

    console.log('[AuthService] Offscreen document created');
  }

  // Ensure offscreen document is ready
  async ensureOffscreenDocumentReady() {
    if (this.isOffscreenDocumentReady) {
      return true;
    }

    // Create the offscreen document
    await this.createOffscreenDocument();

    const auth = await this.getAuthFromOffscreen();
    return auth !== null;
  }

  // Sign in with Google
  async signInWithGoogle() {
    console.log('[AuthService] Initiating Google sign-in...');

    try {
      // Ensure offscreen document is ready
      const isReady = await this.ensureOffscreenDocumentReady();
      if (!isReady) {
        throw new Error('Offscreen document failed to initialize');
      }

      // Send sign-in request to offscreen document
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Sign-in request timed out'));
        }, 60000); // 60 second timeout

        const listener = async (message) => {
          if (message.success === true && message.user) {
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(listener);

            // Cache the display profile immediately for a responsive UI.
            // Real authenticated state is set below, from Firebase Auth
            // itself (P7.3-H) — a popup-supplied uid never counts on its own.
            this.user = message.user;
            chrome.storage.local.set({ user: this.user });

            // Sign in with credential in this context for callable functions.
            // GoogleAuthProvider.credential(idToken, accessToken) is a STATIC
            // factory taking positional tokens (the SDK requires at least one
            // of the two) — not an instance method taking an { idToken } object.
            if (message.credential && (message.credential.idToken || message.credential.accessToken)) {
              try {
                const credential = GoogleAuthProvider.credential(
                  message.credential.idToken || null,
                  message.credential.accessToken || null
                );
                await signInWithCredential(this.auth, credential);
                console.log('[AuthService] Firebase Auth state established in sidepanel context');
              } catch (authError) {
                console.warn('[AuthService] Could not establish auth state in sidepanel:', authError);
                // This is not critical - we'll still use the user data
              }
            }
            // Reflect whatever Firebase Auth's real state is now, whether
            // signInWithCredential above succeeded or not (this can clear
            // this.user back to null if it never actually succeeded — see
            // Section B). Also covered by the onAuthStateChanged listener in
            // init(); calling it explicitly here removes any doubt about
            // listener ordering.
            this.syncAuthenticatedStateFromFirebase();

            // Resolve with what the popup itself reported — the person did
            // complete Google's sign-in — independent of whether the deeper
            // Firebase Auth linkage above happened to succeed. isLoggedIn()/
            // personal-save gating still depend solely on the real,
            // just-synced this.isAuthenticated, not on this resolved value.
            console.log('[AuthService] User signed in:', message.user.email);
            resolve(message.user);
          } else if (message.success === false) {
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(listener);
            const error = message.error || 'Unknown error';
            console.error('[AuthService] Sign-in failed:', error);
            reject(new Error(error));
          }
        };

        chrome.runtime.onMessage.addListener(listener);

        // Send sign-in request
        chrome.runtime.sendMessage({
          type: 'signInWithGoogle'
        });
      });
    } catch (error) {
      console.error('[AuthService] Sign-in error:', error);
      throw error;
    }
  }

  // Sign out
  async signOut() {
    console.log('[AuthService] Signing out...');

    try {
      // Ensure offscreen document is ready
      const isReady = await this.ensureOffscreenDocumentReady();
      if (!isReady) {
        throw new Error('Offscreen document failed to initialize');
      }

      // Send sign-out request to offscreen document
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Sign-out request timed out'));
        }, 10000); // 10 second timeout

        const listener = (message) => {
          if (message.action === 'signOut' && message.success === true) {
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(listener);

            // Clear user
            this.user = null;
            this.isAuthenticated = false;
            chrome.storage.local.remove('user');

            console.log('[AuthService] User signed out');
            resolve(true);
          } else if (message.action === 'signOut' && message.success === false) {
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(listener);
            const error = message.error || 'Unknown error';
            console.error('[AuthService] Sign-out failed:', error);
            reject(new Error(error));
          }
        };

        chrome.runtime.onMessage.addListener(listener);

        // Send sign-out request
        chrome.runtime.sendMessage({
          type: 'signOut'
        });
      });
    } catch (error) {
      console.error('[AuthService] Sign-out error:', error);
      throw error;
    }
  }

  // Get authentication token (for API calls)
  async getToken() {
    if (!this.isLoggedIn()) {
      throw new Error('User is not authenticated');
    }
    
    try {
      // Try to get token from Firebase Auth
      const currentUser = this.auth.currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        return token;
      }
    } catch (error) {
      console.warn('[AuthService] Could not get Firebase token:', error);
    }
    
    // Fallback: return UID (this won't work for callable functions that require auth)
    return this.user.uid;
  }
}

// Create a singleton instance
const authService = new AuthService();

// Export the singleton instance
export default authService;

// Also attach to window for global access
window.authService = authService;
