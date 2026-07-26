// --- Shared auth: login / signup / logout / session restore ---------------
// Both app.js (Employee) and chef.js (Chef) import onAuthChange() to find
// out who's logged in and route to the right view based on `role`.
//
// NOTE ON SECURITY: there's no Firebase Auth here — just a name/password
// check against a plaintext field in Firestore (see firestore.rules for the
// full callout). Role is just a field on that same doc, so it has the same
// no-server-check tradeoff: anyone editing requests directly (not through
// this UI) could set their own role to "chef". Fine for a low-stakes
// internal tool; don't rely on this for anything sensitive.

import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SESSION_KEY = 'campusfood_session';
const authListeners = [];

// cb receives { id, name, role } on login/signup/restore, or null on logout.
export function onAuthChange(cb) {
  authListeners.push(cb);
}

function notify(user) {
  authListeners.forEach(cb => cb(user));
}

function currentSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved);
  } catch (e) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function nameToId(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

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

window.switchTab = function (tabName) {
  const views = {
    login: document.getElementById('login-view'),
    signup: document.getElementById('signup-view'),
    home: document.getElementById('home-view'),
    chef: document.getElementById('chef-view')
  };
  Object.values(views).forEach(v => v && v.classList.add('hidden'));
  if (views[tabName]) views[tabName].classList.remove('hidden');
};

// --- Sign Up ---
document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('signup-error');

  const name = document.getElementById('signup-name').value.trim();
  const password = document.getElementById('signup-password').value;
  const role = document.querySelector('input[name="signup-role"]:checked').value;

  if (!name || !password) return;

  const id = nameToId(name);

  try {
    const userRef = doc(db, 'users', id);
    const existing = await getDoc(userRef);

    if (existing.exists()) {
      showError('signup-error', 'That name is already taken. Try logging in instead.');
      return;
    }

    await setDoc(userRef, {
      name,
      password,
      role,
      createdAt: serverTimestamp()
    });

    const session = { id, name, role };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    e.target.reset();
    notify(session);
  } catch (err) {
    console.error('Sign up failed:', err);
    showError('signup-error', `Something went wrong (${err.code || err.message}). Please try again.`);
  }
});

// --- Login ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('login-error');

  const name = document.getElementById('login-name').value.trim();
  const password = document.getElementById('login-password').value;

  if (!name || !password) return;

  const id = nameToId(name);

  try {
    const userRef = doc(db, 'users', id);
    const existing = await getDoc(userRef);

    if (!existing.exists() || existing.data().password !== password) {
      showError('login-error', 'Incorrect name or password.');
      return;
    }

    const data = existing.data();
    // Accounts created before roles existed default to Employee.
    const session = { id, name: data.name, role: data.role || 'employee' };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    e.target.reset();
    notify(session);
  } catch (err) {
    console.error('Login failed:', err);
    showError('login-error', `Something went wrong (${err.code || err.message}). Please try again.`);
  }
});

// --- Logout ---
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem(SESSION_KEY);
  document.getElementById('header-actions').classList.add('hidden');
  switchTab('login');
  notify(null);
});

// --- Restore session on page load ---
// Deferred with setTimeout so app.js and chef.js (which both import this
// module and register onAuthChange listeners in their own top-level code)
// are guaranteed to have registered before the first notify() fires.
setTimeout(() => {
  const session = currentSession();
  if (session) {
    notify(session);
  } else {
    switchTab('login');
  }
}, 0);
