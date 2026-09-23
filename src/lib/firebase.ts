
// src/lib/firebase.ts
import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import {
  getAuth,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  initializeAuth as initializeFirebaseAuth,
  Auth,
  setPersistence
} from "firebase/auth";
import { Capacitor } from '@capacitor/core';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCB_K8odTJ98LuCM5YGR6v8AbwykUzpaW4",
  authDomain: "hyroxedgeai.firebaseapp.com",
  projectId: "hyroxedgeai",
  storageBucket: "hyroxedgeai.firebasestorage.app",
  messagingSenderId: "321094496963",
  appId: "1:321094496963:web:7193225dfa2b160ddce876"
};

// Initialize Firebase app
const app: FirebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Enable IndexedDB offline persistence on the client; fall back to in-memory on the server.
// initializeFirestore must be called before any getFirestore call on the same app instance.
const db = (() => {
  if (typeof window !== 'undefined') {
    try {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch {
      // Already initialized (e.g. hot-reload) — reuse existing instance
      return getFirestore(app);
    }
  }
  return getFirestore(app);
})();

// Singleton promise to ensure auth is only initialized once
let authInstancePromise: Promise<Auth> | null = null;

// Function to get a specific cookie by name
const getCookie = (name: string): string | undefined => {
    if (typeof document === 'undefined') return undefined;
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift();
};


/**
 * Gets the initialized Firebase Auth instance using a promise-based singleton pattern.
 * Ensures persistence is set for PWA functionality and that it's only initialized once.
 */
const getAuthInstance = (): Promise<Auth> => {
  if (authInstancePromise) {
    return authInstancePromise;
  }

  authInstancePromise = new Promise(async (resolve) => {
    // No reject: every path below resolves, even on failure (falls back to a
    // bare getAuth(app)) — a caller awaiting this must never be left hanging.
    try {
      if (typeof window !== 'undefined') {
        const isNative = Capacitor.isNativePlatform();
        let auth: Auth;

        try {
          const persistenceOptions = isNative
            ? [indexedDBLocalPersistence]
            : [indexedDBLocalPersistence, browserLocalPersistence];

          auth = initializeFirebaseAuth(app, {
            persistence: persistenceOptions,
            popupRedirectResolver: undefined
          });

          if (isNative) {
            await setPersistence(auth, indexedDBLocalPersistence);
          }
          console.log(`✅ Firebase Auth initialized ${isNative ? '(Capacitor/Native)' : '(Web)'} with persistence`);

        } catch (initError: any) {
          if (initError.code === 'auth/already-initialized') {
            auth = getAuth(app);
          } else {
            throw initError;
          }
        }

        // The session management logic has been moved to layout.tsx for better control flow
        resolve(auth);
      } else {
        const auth = getAuth(app);
        resolve(auth);
      }
    } catch (error) {
      console.error("Firebase Auth initialization error:", error);
      const auth = getAuth(app);
      resolve(auth); // Resolve with the basic auth instance on error
    }
  });

  return authInstancePromise;
};


/**
 * Provides a comprehensive diagnosis of the current authentication state.
 * Safe to call from client-side components.
 */
export async function diagnoseAuth() {
    try {
        const auth = await getAuthInstance();
        const sessionCookie = getCookie('__session');
        const currentUser = auth.currentUser;

        return {
            timestamp: new Date().toISOString(),
            authProviderInitialized: !!auth,
            currentUser: currentUser ? {
                uid: currentUser.uid,
                email: currentUser.email,
                emailVerified: currentUser.emailVerified,
            } : null,
            cookies: {
                sessionCookieExists: !!sessionCookie,
                sessionCookieLength: sessionCookie?.length || 0,
                allCookies: typeof document !== 'undefined' ? document.cookie : 'N/A (server-side)',
            },
        };
    } catch (error) {
        console.error('Auth diagnosis failed:', error);
        return {
            error: true,
            errorMessage: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        };
    }
}


// Maintain a direct export for any legacy code that might still use it,
// but getAuthInstance is the preferred method.
const auth = getAuth(app);

export { app, db, auth, getAuthInstance };
