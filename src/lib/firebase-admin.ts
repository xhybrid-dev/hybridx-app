// src/lib/firebase-admin.ts
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getMessaging, Messaging } from 'firebase-admin/messaging';

let adminApp: App;
let adminDb: Firestore;
let adminAuth: Auth;
let adminMessaging: Messaging;

function initializeFirebaseAdmin(): App {
  if (getApps().length === 0) {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (!serviceAccountString) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not set. Admin SDK initialization failed.');
    }
    
    try {
        const serviceAccount = JSON.parse(serviceAccountString);
        adminApp = initializeApp({
            credential: cert(serviceAccount)
        });
        console.log('Firebase Admin SDK initialized successfully.');
    } catch (e) {
        throw new Error(`Failed to parse or use FIREBASE_SERVICE_ACCOUNT_KEY: ${e instanceof Error ? e.message : String(e)}`);
    }

  } else {
    adminApp = getApps()[0] as App;
  }
  
  return adminApp;
}

export function getAdminDb(): Firestore {
  if (!adminDb) {
    const app = initializeFirebaseAdmin();
    adminDb = getFirestore(app);
  }
  return adminDb;
}

export function getAdminAuth(): Auth {
  if (!adminAuth) {
    const app = initializeFirebaseAdmin();
    adminAuth = getAuth(app);
  }
  return adminAuth;
}

export function getAdminMessaging(): Messaging {
  if (!adminMessaging) {
    const app = initializeFirebaseAdmin();
    adminMessaging = getMessaging(app);
  }
  return adminMessaging;
}
