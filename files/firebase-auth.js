/* ===================================================================
   Mess Hall — firebase-auth.js
   NON-FUNCTIONAL SCAFFOLD. Kept separate from app.js so auth logic
   has its own home once we wire up real Firebase Authentication.

   This file will eventually hold:
     - Firebase Auth initialization (Email/Password + Google Sign-In)
     - handleSignIn() / handleSignOut()
     - onAuthStateChanged() listener to persist login across visits
     - Passing the logged-in user's info to app.js for votes + tickets
=================================================================== */

// --- Placeholder auth state ---
// Real version will use firebase.auth() once the SDK is loaded.
let currentUser = null;

function handleSignIn() {
  // TODO: replace with real Firebase Auth call, e.g.
  // firebase.auth().signInWithPopup(googleProvider)
  console.log("TODO: sign in with Firebase Auth (Google or Email/Password)");
}

function handleSignOut() {
  // TODO: replace with real Firebase Auth call, e.g.
  // firebase.auth().signOut()
  console.log("TODO: sign out of Firebase Auth");
}

function onAuthChange(callback) {
  // TODO: replace with real listener, e.g.
  // firebase.auth().onAuthStateChanged(callback)
  console.log("TODO: watch auth state and keep users logged in on device");
}

/* ---------------------------------------------------------------
   NEXT STEPS (once we move past UI-only):
   1. Load the Firebase SDK + your project config (from app.js).
   2. Implement Google Sign-In and Email/Password sign-in.
   3. Persist session so peers stay logged in on their devices.
   4. Expose the current user to app.js for tagging votes/tickets.
------------------------------------------------------------------ */
