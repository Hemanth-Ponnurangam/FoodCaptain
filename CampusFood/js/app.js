import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { BASE_PRICES, WEEKLY_MENU, OTHER_OPTIONS, THRESHOLD_MIN } from "./menu-data.js";

const SESSION_KEY = 'campusfood_session'; // localStorage key for the logged-in user
let currentUserId = null;
let unsubscribeStats = null;

// --- Meal slot model ---------------------------------------------------
// A "slot" is one meal opportunity: a specific date + Breakfast/Lunch/Dinner.
// Only slots that actually need a headcount are votable ("eligible"):
//   - any Dinner, any day
//   - any session on a Sunday
//   - any session on a date listed in HOLIDAYS below
// Everything else is the regular canteen routine — no vote needed.

const SESSION_TYPES = ['Breakfast', 'Lunch', 'Dinner'];

// Add specific dates here (YYYY-MM-DD) to mark campus holidays as eligible
// for voting on all three sessions, e.g. "2026-08-15".
const HOLIDAYS = [];

const LOCK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

function pad(n) {
  return String(n).padStart(2, '0');
}

function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isSlotEligible(dayOfWeek, sessionType, iso) {
  if (HOLIDAYS.includes(iso)) return true;
  if (dayOfWeek === 0) return true; // Sunday
  if (sessionType === 'Dinner') return true;
  return false;
}

function generateWeekSlots(startDate = new Date()) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);

    const iso = toISODate(d);
    const dayOfWeek = d.getDay();
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    const sessions = SESSION_TYPES.map(type => ({
      id: `${iso}_${type}`,
      date: iso,
      dayLabel,
      dayOfWeek,
      type,
      eligible: isSlotEligible(dayOfWeek, type, iso)
    }));

    days.push({ iso, dayLabel, dayOfWeek, sessions });
  }
  return days;
}

let weekSlots = generateWeekSlots();
let currentSlotId = null;

function getSlotById(id) {
  return weekSlots.flatMap(d => d.sessions).find(s => s.id === id);
}

function pickDefaultSlot() {
  const flat = weekSlots.flatMap(d => d.sessions);
  return flat.find(s => s.eligible) || null;
}

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
  document.getElementById('header-actions').classList.remove('hidden');

  weekSlots = generateWeekSlots(); // refresh in case the date rolled over
  const defaultSlot = pickDefaultSlot();
  if (defaultSlot) {
    selectSlot(defaultSlot.id);
  } else {
    document.getElementById('session-banner-label').textContent = 'No sessions need voting this week';
    document.getElementById('session-locked-message').classList.remove('hidden');
    document.getElementById('vote-and-stats').classList.add('hidden');
  }
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
  currentSlotId = null;
  stopStatsListener();
  closeCalendar();
  document.getElementById('header-actions').classList.add('hidden');
  switchTab('login');
});

// --- Weekly Calendar ---
function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = weekSlots.map(day => `
    <div class="calendar-day">
      <div class="calendar-day-label">${day.dayLabel}</div>
      <div class="calendar-sessions">
        ${day.sessions.map(s => `
          <button
            type="button"
            class="calendar-session-btn ${s.eligible ? '' : 'locked'} ${s.id === currentSlotId ? 'active' : ''}"
            data-slot-id="${s.id}"
            ${s.eligible ? '' : 'disabled'}
          >
            ${s.eligible ? '' : LOCK_ICON_SVG}
            ${s.type}
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function openCalendar() {
  renderCalendar();
  document.getElementById('calendar-overlay').classList.remove('hidden');
}

function closeCalendar() {
  document.getElementById('calendar-overlay').classList.add('hidden');
}

document.getElementById('calendar-btn').addEventListener('click', openCalendar);
document.getElementById('calendar-close-btn').addEventListener('click', closeCalendar);
document.getElementById('calendar-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'calendar-overlay') closeCalendar();
});

document.getElementById('calendar-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.calendar-session-btn');
  if (!btn || btn.disabled) return;
  selectSlot(btn.dataset.slotId);
  closeCalendar();
});

function updateSessionBanner(slot) {
  document.getElementById('session-banner-label').textContent = `${slot.dayLabel} · ${slot.type}`;
}

// --- Menu rendering ------------------------------------------------------

// Every selectable vote option, keyed by the id stored in the radio's value
// and in the Firestore vote doc. Built fresh per slot since "usual" depends
// on which session (Breakfast/Lunch/Dinner) is selected.
// Breakfast is a plain headcount — no priced extras, just "are you eating
// the usual breakfast or not." The priced Other Items (biryani etc.) only
// make sense as add-ons to Lunch/Dinner.
function extrasAvailableFor(slot) {
  return slot.type !== 'Breakfast' ? OTHER_OPTIONS : [];
}

function buildOptionLookup(slot) {
  const lookup = {
    usual: { name: 'Usual Menu', price: BASE_PRICES[slot.type], threshold: false },
    skip: { name: 'Skip', price: 0, threshold: false }
  };
  extrasAvailableFor(slot).forEach(opt => {
    lookup[opt.id] = { name: opt.name, price: opt.price, priceLabel: opt.priceLabel, threshold: opt.threshold };
  });
  return lookup;
}

function formatPrice(entry) {
  return entry.priceLabel || (entry.price != null ? `Rs ${entry.price}` : '');
}

function renderUsualMenuDetail(slot) {
  const el = document.getElementById('usual-menu-detail');
  if (!el) return;
  const items = (WEEKLY_MENU[slot.dayOfWeek] && WEEKLY_MENU[slot.dayOfWeek][slot.type]) || [];
  const price = BASE_PRICES[slot.type];
  el.innerHTML = `
    <div class="usual-menu-header">
      <h4>${slot.type} — Usual Menu</h4>
      <span class="usual-menu-price">Rs ${price}</span>
    </div>
    <p class="usual-menu-items">${items.map(escapeHtml).join(' &middot; ') || 'Menu not available for this day yet.'}</p>
  `;
}

function renderVoteOptions(slot) {
  const container = document.getElementById('vote-options');
  if (!container) return;

  const usualPrice = BASE_PRICES[slot.type];

  const rows = [
    { id: 'usual', label: `Usual Menu`, price: `Rs ${usualPrice}`, threshold: false },
    ...extrasAvailableFor(slot).map(opt => ({
      id: opt.id,
      label: opt.name,
      price: formatPrice(opt),
      threshold: opt.threshold
    })),
    { id: 'skip', label: 'Skip (not eating this session)', price: '', threshold: false }
  ];

  container.innerHTML = rows.map(row => `
    <label class="vote-option">
      <input type="radio" name="meal-option" value="${row.id}">
      <span class="vote-option-label">
        ${escapeHtml(row.label)}
        ${row.threshold ? `<span class="threshold-badge">Needs ${THRESHOLD_MIN}+ votes</span>` : ''}
        ${row.price ? `<span class="vote-option-price">${escapeHtml(row.price)}</span>` : ''}
      </span>
    </label>
  `).join('');
}

// Visually marks which option is the currently-saved vote (green/"submitted"
// state), separate from whichever radio the user has clicked but not yet
// submitted (blue/"selecting" state, styled in CSS).
function markSubmittedOption(optionId) {
  document.querySelectorAll('#vote-options .vote-option').forEach(label => {
    const input = label.querySelector('input[name="meal-option"]');
    label.classList.toggle('vote-option--submitted', !!input && input.value === optionId);
  });
}

function selectSlot(slotId) {
  const slot = getSlotById(slotId);
  if (!slot) return;

  currentSlotId = slotId;
  updateSessionBanner(slot);

  if (slot.eligible) {
    document.getElementById('session-locked-message').classList.add('hidden');
    document.getElementById('vote-and-stats').classList.remove('hidden');
    renderUsualMenuDetail(slot);
    renderVoteOptions(slot);
    loadVote();
    startStatsListener();
  } else {
    document.getElementById('session-locked-message').classList.remove('hidden');
    document.getElementById('vote-and-stats').classList.add('hidden');
    stopStatsListener();
  }
}

// --- Voting ---
function voteDocId() {
  return `${currentSlotId}__${currentUserId}`;
}

function showVoteConfirmation(optionName) {
  const el = document.getElementById('vote-confirmation');
  el.textContent = `Your vote is in: ${optionName}. You can change it anytime.`;
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

  if (!currentUserId || !currentSlotId) return;

  try {
    const voteRef = doc(db, 'votes', voteDocId());
    const existing = await getDoc(voteRef);

    if (existing.exists()) {
      const option = existing.data().option;
      const radio = document.querySelector(`input[name="meal-option"][value="${CSS.escape(option)}"]`);
      if (radio) radio.checked = true;
      const optionName = existing.data().optionName || option;
      showVoteConfirmation(optionName);
      markSubmittedOption(option);
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
  if (!currentUserId || !currentSlotId) {
    showError('vote-error', 'You need to be logged in to vote.');
    return;
  }

  try {
    const slot = getSlotById(currentSlotId);
    const lookup = buildOptionLookup(slot);
    const entry = lookup[selected.value] || { name: selected.value, price: null, threshold: false };

    await setDoc(doc(db, 'votes', voteDocId()), {
      slotId: currentSlotId,
      option: selected.value,
      optionName: entry.name,
      price: entry.price,
      requiresThreshold: !!entry.threshold,
      userId: currentUserId,
      updatedAt: serverTimestamp()
    });
    showVoteConfirmation(entry.name);
    markSubmittedOption(selected.value);
  } catch (err) {
    console.error('Vote submission failed:', err);
    showError('vote-error', `Something went wrong (${err.code || err.message}). Please try again.`);
  }
});

// --- Live Stats ---
function stopStatsListener() {
  if (unsubscribeStats) {
    unsubscribeStats();
    unsubscribeStats = null;
  }
}

function startStatsListener() {
  stopStatsListener(); // always re-subscribe scoped to the currently selected slot

  if (!currentSlotId) return;

  const slot = getSlotById(currentSlotId);
  const lookup = buildOptionLookup(slot);
  const statsBody = document.getElementById('stats-body');

  const votesQuery = query(collection(db, 'votes'), where('slotId', '==', currentSlotId));

  unsubscribeStats = onSnapshot(
    votesQuery,
    (snapshot) => {
      const counts = {};
      Object.keys(lookup).forEach(id => { counts[id] = 0; });

      snapshot.forEach(docSnap => {
        const option = docSnap.data().option;
        if (option) counts[option] = (counts[option] || 0) + 1;
      });

      statsBody.innerHTML = Object.entries(counts)
        // Skip isn't prep work for the kitchen — leave it out of the headcount table.
        .filter(([id]) => id !== 'skip')
        .map(([id, count]) => {
          const name = (lookup[id] && lookup[id].name) || id;
          return `<tr><td>${escapeHtml(name)}</td><td>${count}</td></tr>`;
        })
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
