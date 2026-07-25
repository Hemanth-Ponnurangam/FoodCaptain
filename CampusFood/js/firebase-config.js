// Firebase initialization
// Loaded directly from Google's CDN as ES modules, so no bundler/build step
// is required — this works as a plain static site on Firebase Hosting.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCVkr2atSSkOuJBXAZnefkCYffd4mF1hP8",
  authDomain: "foodcaptain-87c6c.firebaseapp.com",
  projectId: "foodcaptain-87c6c",
  storageBucket: "foodcaptain-87c6c.firebasestorage.app",
  messagingSenderId: "451323341365",
  appId: "1:451323341365:web:c01ed9b527b50b6e56df7c",
  measurementId: "G-G6MMZR21RS"
};


// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
