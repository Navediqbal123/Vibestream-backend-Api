import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDwjdZssUWXQgAXgFPiEHcYl4M1eLMsRCo",
  authDomain: "vibe-stream-backend-137f2.firebaseapp.com",
  projectId: "vibe-stream-backend-137f2",
  storageBucket: "vibe-stream-backend-137f2.firebasestorage.app",
  messagingSenderId: "100412197611",
  appId: "1:100412197611:web:fb3132cea3e5eac29d4cae",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
