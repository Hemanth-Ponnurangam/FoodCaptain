/* ===================================================================
   Mess Hall — app.js
   NON-FUNCTIONAL SCAFFOLD. No Firebase calls wired up yet.
   This file will eventually hold:
     - Firebase project config + initialization
     - Firestore reads/writes for menu, votes, and tickets
     - Cloud Function triggers for the 10-vote threshold nudge
     - Live Stats dashboard listener
   For now it just wires up the static UI you see on the page.
=================================================================== */

// --- Firebase config placeholder ---
// Will be filled in with your project's real keys when we move
// past the UI-only stage.
const firebaseConfig = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

// --- Static UI wiring only (no backend yet) ---
document.addEventListener("DOMContentLoaded", () => {
  console.log("Mess Hall UI scaffold loaded — no backend wired up yet.");

  // Sign-in button just logs for now
  const signInBtn = document.getElementById("signInBtn");
  if (signInBtn) {
    signInBtn.addEventListener("click", () => {
      console.log("TODO: call handleSignIn() from firebase-auth.js");
    });
  }

  // Meal option cards toggle a "selected" look, nothing is saved
  document.querySelectorAll(".vote-option").forEach((option) => {
    option.addEventListener("click", () => {
      document
        .querySelectorAll(".vote-option")
        .forEach((el) => el.classList.remove("selected"));
      option.classList.add("selected");
    });
  });

  // Confirm button is a placeholder — no order is actually created
  const confirmBtn = document.querySelector(".btn-primary");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      console.log("TODO: write vote + generate ticket in Firestore");
    });
  }
});

/* ---------------------------------------------------------------
   NEXT STEPS (once we move past UI-only):
   1. Initialize Firebase app + Firestore + Auth here.
   2. Read today's session + menu from Firestore instead of HTML.
   3. Write a vote doc when "Confirm my plate" is clicked.
   4. Listen live to vote counts for the threshold bar and stats.
   5. Cloud Function (separate file) handles the 1-hour-before nudge.
------------------------------------------------------------------ */
