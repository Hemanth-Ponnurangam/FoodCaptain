import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { THRESHOLD_MIN } from "./menu-data.js";
import { onAuthChange } from "./auth.js";
import {
  onConfigChange,
  startConfigListener,
  saveConfigField,
  onSessionStatesChange,
  startSessionStatesListener,
  sessionStateFor,
  setSlotEligibleOverride,
  setSlotFrozen
} from "./config-store.js";
import { generateWeekSlots, findSlot, defaultSlotEligible } from "./slots.js";

startConfigListener();
startSessionStatesListener();

let chefUserId = null;
let chefUserName = null;
let weekOffset = 0; // 0 = current week, +1 = next week, -1 = previous week, etc.
let weekSlots = generateWeekSlots();
let selectedSlotId = null;
let unsubscribeChefStats = null;
let liveCfg = null;
let extrasDraft = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function weekStartDate(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset * 7);
  return d;
}

function rebuildWeekSlots() {
  weekSlots = generateWeekSlots(weekStartDate(weekOffset));
  renderChefWeekLabel();
}

function renderChefWeekLabel() {
  const labelEl = document.getElementById('chef-week-label');
  if (!labelEl) return;
  if (weekOffset === 0) {
    labelEl.textContent = 'Sessions This Week';
    return;
  }
  const first = weekSlots[0];
  const last = weekSlots[weekSlots.length - 1];
  const range = first && last ? `${first.dayLabel} – ${last.dayLabel}` : '';
  labelEl.textContent = weekOffset > 0
    ? `Sessions – ${range} (+${weekOffset}w)`
    : `Sessions – ${range} (${weekOffset}w)`;
}

function goToWeek(offset) {
  weekOffset = offset;
  selectedSlotId = null;
  document.getElementById('chef-freeze-panel').classList.add('hidden');
  stopChefStats();
  rebuildWeekSlots();
  renderChefCalendar();
}

document.getElementById('chef-week-prev').addEventListener('click', () => goToWeek(weekOffset - 1));
document.getElementById('chef-week-next').addEventListener('click', () => goToWeek(weekOffset + 1));
document.getElementById('chef-week-today').addEventListener('click', () => goToWeek(0));

function effectiveEligible(slot) {
  const override = sessionStateFor(slot.id).eligibleOverride;
  if (override !== undefined && override !== null) return override;
  return defaultSlotEligible(slot.dayOfWeek, slot.type, slot.date);
}

// --- Role-based routing ---------------------------------------------------

onAuthChange(user => {
  if (user && user.role === 'chef') {
    goChefHome(user.id, user.name);
  } else {
    chefUserId = null;
    chefUserName = null;
    selectedSlotId = null;
    stopChefStats();
  }
});

function goChefHome(id, name) {
  chefUserId = id;
  chefUserName = name;
  document.getElementById('chef-username').textContent = name ? `, ${name}` : '';
  document.getElementById('header-actions').classList.remove('hidden');
  document.getElementById('calendar-btn').classList.add('hidden'); // chef manages sessions inline instead
  window.switchTab('chef');

  weekOffset = 0;
  rebuildWeekSlots();
  renderChefCalendar();
  renderCutoffForm();
  renderPricesForm();
  loadMenuTextareaForSelection();
  renderExtrasEditor();
}

onConfigChange(cfg => {
  liveCfg = cfg;
  renderCutoffForm();
  renderPricesForm();
  renderExtrasEditor();
  if (chefUserId) loadMenuTextareaForSelection();
});

onSessionStatesChange(() => {
  if (chefUserId) renderChefCalendar();
  if (selectedSlotId) updateFreezePanelStatus();
});

// --- Sessions calendar: eligibility toggles + slot selection --------------

function renderChefCalendar() {
  const grid = document.getElementById('chef-calendar-grid');
  grid.innerHTML = weekSlots.map(day => `
    <div class="chef-calendar-day">
      <div class="chef-calendar-day-label">${day.dayLabel}</div>
      <div class="chef-calendar-sessions">
        ${day.sessions.map(s => {
          const eligible = effectiveEligible(s);
          const frozen = !!sessionStateFor(s.id).frozen;
          const active = s.id === selectedSlotId;
          return `
            <div class="chef-session-cell ${active ? 'chef-session-active' : ''} ${frozen ? 'chef-session-frozen' : ''}">
              <label class="chef-session-toggle">
                <input type="checkbox" data-eligible-toggle="${s.id}" ${eligible ? 'checked' : ''}>
                Needs a vote
              </label>
              <button type="button" class="chef-session-select-btn" data-select-slot="${s.id}" ${eligible ? '' : 'disabled'}>
                ${s.type}${frozen ? ' <span class="chef-session-frozen-badge">FROZEN</span>' : ''}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function showEligibilityError(msg) {
  const el = document.getElementById('chef-eligibility-error');
  if (!el) return;
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

document.getElementById('chef-calendar-grid').addEventListener('change', async (e) => {
  const toggle = e.target.closest('[data-eligible-toggle]');
  if (!toggle) return;
  const slotId = toggle.dataset.eligibleToggle;
  const attempted = toggle.checked;
  showEligibilityError(null);
  try {
    await setSlotEligibleOverride(slotId, attempted);
  } catch (err) {
    console.error('Failed to update eligibility:', err);
    toggle.checked = !attempted;
    const reason = err && err.code === 'permission-denied'
      ? 'Firestore rules are blocking this write — redeploy firestore.rules (firebase deploy --only firestore:rules).'
      : (err && (err.code || err.message)) || 'unknown error';
    showEligibilityError(`Couldn't save that change: ${reason}`);
  }
});

document.getElementById('chef-calendar-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-select-slot]');
  if (!btn || btn.disabled) return;
  selectChefSlot(btn.dataset.selectSlot);
});

function selectChefSlot(slotId) {
  selectedSlotId = slotId;
  renderChefCalendar();
  const slot = findSlot(weekSlots, slotId);
  if (!slot) return;

  document.getElementById('chef-freeze-panel').classList.remove('hidden');
  document.getElementById('chef-freeze-title').textContent = `${slot.dayLabel} · ${slot.type}`;

  startChefStats(slot);
  updateFreezePanelStatus();
}

function updateFreezePanelStatus() {
  if (!selectedSlotId) return;
  const slot = findSlot(weekSlots, selectedSlotId);
  if (!slot) return;
  const frozen = !!sessionStateFor(slot.id).frozen;
  document.getElementById('chef-freeze-subtitle').textContent = frozen
    ? "Headcount is frozen. Employees now see their final ticket."
    : "Live headcount below. Freeze once you're ready to lock it in.";
  document.getElementById('chef-freeze-btn').classList.toggle('hidden', frozen);
  document.getElementById('chef-unfreeze-btn').classList.toggle('hidden', !frozen);
  document.getElementById('chef-freeze-status').textContent = frozen ? 'Status: Frozen' : 'Status: Open for voting';
}

document.getElementById('chef-freeze-btn').addEventListener('click', async () => {
  if (!selectedSlotId) return;
  try {
    await setSlotFrozen(selectedSlotId, true);
  } catch (err) {
    console.error('Freeze failed:', err);
  }
});

document.getElementById('chef-unfreeze-btn').addEventListener('click', async () => {
  if (!selectedSlotId) return;
  try {
    await setSlotFrozen(selectedSlotId, false);
  } catch (err) {
    console.error('Unfreeze failed:', err);
  }
});

function stopChefStats() {
  if (unsubscribeChefStats) {
    unsubscribeChefStats();
    unsubscribeChefStats = null;
  }
}

function startChefStats(slot) {
  stopChefStats();
  const statsBody = document.getElementById('chef-stats-body');
  const votesQuery = query(collection(db, 'votes'), where('slotId', '==', slot.id));

  unsubscribeChefStats = onSnapshot(
    votesQuery,
    (snapshot) => {
      const baseCounts = { usual: 0, skip: 0 };
      const extraCounts = {};

      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const baseId = data.base || data.option;
        if (baseId && baseCounts[baseId] !== undefined) baseCounts[baseId]++;
        (data.extras || []).forEach(ex => {
          extraCounts[ex.id] = (extraCounts[ex.id] || 0) + 1;
        });
      });

      const extrasForSlot = (liveCfg && slot.type !== 'Breakfast') ? (liveCfg.otherOptions || []) : [];
      const rows = [`<tr><td>Standard ${escapeHtml(slot.type)}</td><td>${baseCounts.usual}</td></tr>`];
      extrasForSlot.forEach(opt => {
        const count = extraCounts[opt.id] || 0;
        const status = opt.threshold ? (count >= THRESHOLD_MIN ? ' — met' : ` — needs ${THRESHOLD_MIN}`) : '';
        rows.push(`<tr><td>${escapeHtml(opt.name)}${status}</td><td>${count}</td></tr>`);
      });
      rows.push(`<tr><td>Skip</td><td>${baseCounts.skip}</td></tr>`);
      statsBody.innerHTML = rows.join('');
    },
    (err) => {
      console.error('Chef stats listener failed:', err);
      statsBody.innerHTML = `<tr><td colspan="2">Couldn't load stats (${err.code || err.message}).</td></tr>`;
    }
  );
}

// --- Deadlines form ---
function renderCutoffForm() {
  if (!liveCfg) return;
  const ct = liveCfg.cutoffTimes || {};
  document.getElementById('cutoff-breakfast').value = ct.Breakfast || '';
  document.getElementById('cutoff-lunch').value = ct.Lunch || '';
  document.getElementById('cutoff-dinner').value = ct.Dinner || '';
}

document.getElementById('chef-cutoff-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cutoffTimes = {
    Breakfast: document.getElementById('cutoff-breakfast').value,
    Lunch: document.getElementById('cutoff-lunch').value,
    Dinner: document.getElementById('cutoff-dinner').value
  };
  try {
    await saveConfigField('cutoffTimes', cutoffTimes);
    flashSaved('chef-cutoff-saved');
  } catch (err) {
    console.error('Saving deadlines failed:', err);
  }
});

// --- Base prices form ---
function renderPricesForm() {
  if (!liveCfg) return;
  const bp = liveCfg.basePrices || {};
  document.getElementById('price-breakfast').value = bp.Breakfast ?? '';
  document.getElementById('price-lunch').value = bp.Lunch ?? '';
  document.getElementById('price-dinner').value = bp.Dinner ?? '';
}

document.getElementById('chef-prices-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const basePrices = {
    Breakfast: Number(document.getElementById('price-breakfast').value) || 0,
    Lunch: Number(document.getElementById('price-lunch').value) || 0,
    Dinner: Number(document.getElementById('price-dinner').value) || 0
  };
  try {
    await saveConfigField('basePrices', basePrices);
    flashSaved('chef-prices-saved');
  } catch (err) {
    console.error('Saving prices failed:', err);
  }
});

// --- Regular weekly menu editor ---
function loadMenuTextareaForSelection() {
  if (!liveCfg) return;
  const day = document.getElementById('menu-day-select').value;
  const session = document.getElementById('menu-session-select').value;
  const items = (liveCfg.weeklyMenu && liveCfg.weeklyMenu[day] && liveCfg.weeklyMenu[day][session]) || [];
  document.getElementById('menu-items-textarea').value = items.join(', ');
}

document.getElementById('menu-day-select').addEventListener('change', loadMenuTextareaForSelection);
document.getElementById('menu-session-select').addEventListener('change', loadMenuTextareaForSelection);

document.getElementById('menu-items-save-btn').addEventListener('click', async () => {
  const day = document.getElementById('menu-day-select').value;
  const session = document.getElementById('menu-session-select').value;
  const items = document.getElementById('menu-items-textarea').value
    .split(',').map(s => s.trim()).filter(Boolean);
  try {
    await saveConfigField(`weeklyMenu.${day}.${session}`, items);
    flashSaved('chef-menu-saved');
  } catch (err) {
    console.error('Saving menu failed:', err);
  }
});

// --- Other Items (extras) editor ---
function renderExtrasEditor() {
  if (!liveCfg) return;
  extrasDraft = (liveCfg.otherOptions || []).map(opt => ({ ...opt }));
  paintExtrasRows();
}

function paintExtrasRows() {
  const container = document.getElementById('extras-editor-rows');
  container.innerHTML = extrasDraft.map((opt, i) => `
    <div class="extras-editor-row" data-index="${i}">
      <input type="text" class="extra-name-input" value="${escapeHtml(opt.name)}" placeholder="Item name">
      <input type="number" class="extra-price-input" value="${opt.price ?? ''}" placeholder="Price" min="0">
      <label><input type="checkbox" class="extra-threshold-input" ${opt.threshold ? 'checked' : ''}> Needs ${THRESHOLD_MIN}+ votes</label>
      <button type="button" class="extras-editor-remove-btn" data-remove="${i}">Remove</button>
    </div>
  `).join('');
}

document.getElementById('extras-add-btn').addEventListener('click', () => {
  extrasDraft.push({ id: `item-${Date.now()}`, name: '', price: 0, threshold: false });
  paintExtrasRows();
});

document.getElementById('extras-editor-rows').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  extrasDraft.splice(Number(btn.dataset.remove), 1);
  paintExtrasRows();
});

document.getElementById('extras-save-btn').addEventListener('click', async () => {
  const rows = document.querySelectorAll('#extras-editor-rows .extras-editor-row');
  const updated = Array.from(rows).map((row, i) => {
    const name = row.querySelector('.extra-name-input').value.trim();
    const priceRaw = row.querySelector('.extra-price-input').value;
    const threshold = row.querySelector('.extra-threshold-input').checked;
    const entry = {
      id: extrasDraft[i].id,
      name,
      price: priceRaw === '' ? null : Number(priceRaw),
      threshold
    };
    if (priceRaw === '') entry.priceLabel = 'Actuals';
    return entry;
  }).filter(opt => opt.name);

  try {
    await saveConfigField('otherOptions', updated);
    flashSaved('chef-extras-saved');
  } catch (err) {
    console.error('Saving other items failed:', err);
  }
});

function flashSaved(elId) {
  const el = document.getElementById(elId);
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2000);
}
