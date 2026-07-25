import { auth } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- SPA Navigation ---
window.switchTab = function (tabName) {
  const views = {
    login: document.getElementById('login-view'),
    signup: document.getElementById('signup-view'),
    home: document.getElementById('home-view')
  };

  Object.values(views).forEach(v => v.classList.add('hidden'));
  if (views[tabName]) views[tabName].classList.remove('hidden');
};

function showError(elId, message) {
  const el = document.getElementById(elId);
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearError(elId) {
  const el = document.getElementById(elId);
  el.textContent = '';
  el.classList.add('hidden');
}

function friendlyAuthError(error) {
  switch (error.code) {
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account already exists with that email.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

// --- Auth state: keeps user logged in / routes to the right view ---
onAuthStateChanged(auth, (user) => {
  if (user) {
    const nameEl = document.getElementById('home-username');
    nameEl.textContent = user.displayName ? `, ${user.displayName}` : '';
    switchTab('home');
  } else {
    switchTab('login');
  }
});

// --- Login ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('login-error');

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    e.target.reset();
  } catch (err) {
    showError('login-error', friendlyAuthError(err));
  }
});

// --- Sign Up ---
document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('signup-error');

  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (name) {
      await updateProfile(cred.user, { displayName: name });
    }
    e.target.reset();
  } catch (err) {
    showError('signup-error', friendlyAuthError(err));
  }
});

// --- Logout ---
document.getElementById('logout-btn').addEventListener('click', async () => {
  await signOut(auth);
});
