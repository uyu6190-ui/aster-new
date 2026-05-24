import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { 
  getFirestore,
  initializeFirestore,
  enableIndexedDbPersistence,
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  updateDoc, 
  deleteDoc, 
  onSnapshot,
  writeBatch,
  getDocFromServer,
  getDocsFromServer
} from 'firebase/firestore';
import fallbackFirebaseConfig from '../../firebase-applet-config.json';

const firebaseConfigFromEnv = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasEnvFirebaseConfig = Object.values(firebaseConfigFromEnv).every(Boolean);
const firebaseConfig = hasEnvFirebaseConfig ? firebaseConfigFromEnv : fallbackFirebaseConfig;

if (!hasEnvFirebaseConfig) {
  console.warn('Firebase config environment variables are incomplete. Using firebase-applet-config.json fallback.');
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use initializeFirestore to allow enableIndexedDbPersistence
export const db = initializeFirestore(app, {
  localCache: undefined // Prevent conflicts with enableIndexedDbPersistence
},);

// Enable offline persistence to rescue stuck local data!
try {
  enableIndexedDbPersistence(db).catch((err) => {
      if (err.code === 'failed-precondition') {
          console.warn('Firestore persistence failed: Multiple tabs open');
      } else if (err.code === 'unimplemented') {
          console.warn('Firestore persistence failed: Browser not supported');
      } else {
          console.warn('Firestore persistence async error:', err);
      }
  });
} catch (syncErr) {
  console.warn('Firestore persistence sync error (likely Safari private mode / cross-site tracking):', syncErr);
}

const googleProvider = new GoogleAuthProvider();

export const signInWithGooglePopup = () => signInWithPopup(auth, googleProvider);
export const signInWithGoogleRedirect = () => signInWithRedirect(auth, googleProvider);
export const logout = () => signOut(auth);

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

export { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  updateDoc, 
  deleteDoc, 
  onSnapshot,
  writeBatch,
  getDocsFromServer
};
