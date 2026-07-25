import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SESSION_KEY = 'campusfood_session';
let currentUserId = null;
let unsubscribeStats = null;

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

// Normalize a name into a safe, unique-ish Firestore doc ID
function nameToId(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function goHome(id, displayName) {
  currentUserId = id;
  const nameEl = document.getElementById('home-username');
  nameEl.textContent = displayName ? `, ${displayName}` : '';
  switchTab('home');
  loadVote();
  startStatsListener();
}

// --- Restore session on page load ---
(function restoreSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    try {
      const { id, name } = JSON.parse(saved);
      goHome(id, name);
      return;
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
    }
  }
  switchTab('login');
})();

// --- Sign Up ---
document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('signup-error');

  const name = document.getElementById('signup-name').value.trim();
  const password = document.getElementById('signup-password').value;

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
      createdAt: serverTimestamp()
    });

    localStorage.setItem(SESSION_KEY, JSON.stringify({ id, name }));
    e.target.reset();
    goHome(id, name);
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

    localStorage.setItem(SESSION_KEY, JSON.stringify({ id, name: existing.data().name }));
    e.target.reset();
    goHome(id, existing.data().name);
  } catch (err) {
    console.error('Login failed:', err);
    showError('login-error', `Something went wrong (${err.code || err.message}). Please try again.`);
  }
});

// --- Logout ---
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem(SESSION_KEY);
  currentUserId = null;
  if (unsubscribeStats) {
    unsubscribeStats();
    unsubscribeStats = null;
  }
  switchTab('login');
});

// --- Voting ---
function showVoteConfirmation(option) {
  const el = document.getElementById('vote-confirmation');
  el.textContent = `Your vote is in: ${option}. You can change it anytime.`;
  el.classList.remove('hidden');
}

function clearVoteConfirmation() {
  const el = document.getElementById('vote-confirmation');
  el.textContent = '';
  el.classList.add('hidden');
}

async function loadVote() {
  clearVoteConfirmation();
  clearError('vote-error');
  document.querySelectorAll('input[name="meal-option"]').forEach(r => r.checked = false);

  if (!currentUserId) return;

  try {
    const voteRef = doc(db, 'votes', currentUserId);
    const existing = await getDoc(voteRef);

    if (existing.exists()) {
      const option = existing.data().option;
      const radio = document.querySelector(`input[name="meal-option"][value="${CSS.escape(option)}"]`);
      if (radio) radio.checked = true;
      showVoteConfirmation(option);
    }
  } catch (err) {
    console.error('Loading vote failed:', err);
  }
}

document.getElementById('vote-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('vote-error');

  const selected = document.querySelector('input[name="meal-option"]:checked');
  if (!selected) {
    showError('vote-error', 'Please choose an option before submitting.');
    return;
  }
  if (!currentUserId) {
    showError('vote-error', 'You need to be logged in to vote.');
    return;
  }

  try {
    await setDoc(doc(db, 'votes', currentUserId), {
      option: selected.value,
      userId: currentUserId,
      updatedAt: serverTimestamp()
    });
    showVoteConfirmation(selected.value);
  } catch (err) {
    console.error('Vote submission failed:', err);
    showError('vote-error', `Something went wrong (${err.code || err.message}). Please try again.`);
  }
});

// --- Live Stats ---
function startStatsListener() {
  if (unsubscribeStats) return; // already listening

  const statsBody = document.getElementById('stats-body');
  const optionNames = Array.from(document.querySelectorAll('input[name="meal-option"]'))
    .map(r => r.value);

  unsubscribeStats = onSnapshot(
    collection(db, 'votes'),
    (snapshot) => {
      const counts = {};
      optionNames.forEach(name => { counts[name] = 0; });

      snapshot.forEach(docSnap => {
        const option = docSnap.data().option;
        if (option in counts) {
          counts[option] += 1;
        } else if (option) {
          counts[option] = (counts[option] || 0) + 1;
        }
      });

      statsBody.innerHTML = Object.entries(counts)
        .map(([name, count]) => `<tr><td>${escapeHtml(name)}</td><td>${count}</td></tr>`)
        .join('');
    },
    (err) => {
      console.error('Stats listener failed:', err);
      statsBody.innerHTML = `<tr><td colspan="2">Couldn't load live stats (${err.code || err.message}).</td></tr>`;
    }
  );
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
