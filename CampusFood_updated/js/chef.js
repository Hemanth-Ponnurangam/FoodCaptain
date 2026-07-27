import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs
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
import { generateWeekSlots, findSlot, defaultSlotEligible, toISODate, SESSION_TYPES } from "./slots.js";

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
let lastStatsSnapshot = null; // { slot, rows: [{label, count}] } — kept in sync for Excel export

function switchChefTab(tabName) {
  document.querySelectorAll('.chef-subtab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.chefTab === tabName);
  });
  document.querySelectorAll('.chef-tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `chef-tab-${tabName}`);
  });
}

document.querySelectorAll('.chef-subtab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchChefTab(btn.dataset.chefTab));
});

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
  document.getElementById('chef-headcount-empty').classList.remove('hidden');
  lastStatsSnapshot = null;
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
  switchChefTab('sessions');

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
          const badge = frozen
            ? '<span class="chef-session-frozen-badge">Frozen</span>'
            : (eligible ? '' : '<span class="chef-session-off-badge">Off</span>');
          return `
            <button type="button" class="chef-session-pill ${active ? 'chef-session-active' : ''} ${frozen ? 'chef-session-frozen' : ''} ${eligible ? '' : 'chef-session-off'}" data-select-slot="${s.id}">
              <span class="chef-session-pill-name">${s.type}</span>${badge}
            </button>
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

document.getElementById('chef-calendar-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-select-slot]');
  if (!btn) return;
  selectChefSlot(btn.dataset.selectSlot);
});

document.getElementById('chef-eligible-checkbox').addEventListener('change', async (e) => {
  if (!selectedSlotId) return;
  const attempted = e.target.checked;
  showEligibilityError(null);
  try {
    await setSlotEligibleOverride(selectedSlotId, attempted);
  } catch (err) {
    console.error('Failed to update eligibility:', err);
    e.target.checked = !attempted;
    const reason = err && err.code === 'permission-denied'
      ? 'Firestore rules are blocking this write — redeploy firestore.rules (firebase deploy --only firestore:rules).'
      : (err && (err.code || err.message)) || 'unknown error';
    showEligibilityError(`Couldn't save that change: ${reason}`);
  }
});

function selectChefSlot(slotId) {
  selectedSlotId = slotId;
  renderChefCalendar();
  const slot = findSlot(weekSlots, slotId);
  if (!slot) return;

  document.getElementById('chef-headcount-empty').classList.add('hidden');
  document.getElementById('chef-freeze-panel').classList.remove('hidden');
  document.getElementById('chef-freeze-title').textContent = `${slot.dayLabel} · ${slot.type}`;

  startChefStats(slot);
  updateFreezePanelStatus();
  switchChefTab('headcount');
}

function updateFreezePanelStatus() {
  if (!selectedSlotId) return;
  const slot = findSlot(weekSlots, selectedSlotId);
  if (!slot) return;
  document.getElementById('chef-eligible-checkbox').checked = effectiveEligible(slot);
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
      const exportRows = [{ item: `Standard ${slot.type}`, count: baseCounts.usual }];
      extrasForSlot.forEach(opt => {
        const count = extraCounts[opt.id] || 0;
        const tag = opt.threshold ? (opt.type === 'main' ? ' [Main]' : ' [Side]') : '';
        const status = opt.threshold ? (count >= THRESHOLD_MIN ? ' — met' : ` — needs ${THRESHOLD_MIN}`) : '';
        rows.push(`<tr><td>${escapeHtml(opt.name)}${tag}${status}</td><td>${count}</td></tr>`);
        exportRows.push({ item: `${opt.name}${tag}${status}`, count });
      });
      rows.push(`<tr><td>Skip</td><td>${baseCounts.skip}</td></tr>`);
      exportRows.push({ item: 'Skip', count: baseCounts.skip });
      statsBody.innerHTML = rows.join('');
      lastStatsSnapshot = { slot, rows: exportRows, frozen: !!sessionStateFor(slot.id).frozen };
    },
    (err) => {
      console.error('Chef stats listener failed:', err);
      statsBody.innerHTML = `<tr><td colspan="2">Couldn't load stats (${err.code || err.message}).</td></tr>`;
    }
  );
}

// --- Headcount Excel export ---
document.getElementById('chef-headcount-export-btn').addEventListener('click', () => {
  if (!lastStatsSnapshot || typeof XLSX === 'undefined') return;
  const { slot, rows, frozen } = lastStatsSnapshot;

  const sheetData = [
    ['Day', slot.dayLabel],
    ['Session', slot.type],
    ['Date', slot.date],
    ['Status', frozen ? 'Frozen' : 'Open for voting'],
    [],
    ['Item', 'Count'],
    ...rows.map(r => [r.item, r.count])
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = [{ wch: 28 }, { wch: 14 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Headcount');

  const fileName = `Headcount_${slot.date}_${slot.type}.xlsx`;
  XLSX.writeFile(workbook, fileName);
});

// --- Full Roster Excel export ---------------------------------------------
// One row per employee. One "Ticket" + "Ate" column pair per session
// (Breakfast/Lunch/Dinner), latest date nearest the Name column, walking
// backwards to ROSTER_START_DATE. "Ate" is a placeholder for a future
// feature (whether the employee actually showed up) — always left blank
// for now. "Ticket" reproduces the same chef-approved/confirmed menu text
// an employee would see on their own Ticket tab (see renderTicket in
// app.js), computed here from the raw votes + sessionStates instead of a
// live per-slot listener since this spans many sessions at once.
const ROSTER_START_DATE = '2025-07-25';

function dateRangeDescending(startIso, endIso) {
  const start = new Date(startIso + 'T00:00:00');
  const end = new Date(endIso + 'T00:00:00');
  const dates = [];
  for (let d = new Date(end); d >= start; d.setDate(d.getDate() - 1)) {
    dates.push(toISODate(d));
  }
  return dates;
}

// Mirrors the confirmed/pending ticket logic in app.js's renderTicket, but
// returns plain text for a spreadsheet cell instead of HTML.
function ticketTextFor(voteData, eligible, frozen, extraCounts) {
  if (!eligible) return 'Usual Menu';
  if (!frozen) return 'Pending (not frozen yet)';
  if (!voteData) return 'Skipped (no vote)';

  const baseId = voteData.base || voteData.option || null;
  if (baseId === 'skip') return 'Skipped';

  const extras = voteData.extras || [];
  const fallback = voteData.fallbackChoice || null;
  const explicitUsual = baseId === 'usual';

  const classified = extras.map(ex => {
    if (!ex.threshold) return { ...ex, status: 'plain' };
    const count = extraCounts[ex.id] || 0;
    return { ...ex, status: count >= THRESHOLD_MIN ? 'met' : 'unmet' };
  });
  const anyMainUnmet = classified.some(ex => ex.status === 'unmet' && ex.type === 'main');
  const usualApplies = explicitUsual || (anyMainUnmet && fallback === 'auto_regular');

  if (anyMainUnmet && fallback === 'skip') return 'Skipped (quota not met)';

  const survivors = classified.filter(ex => ex.status !== 'unmet');
  const parts = [
    ...(usualApplies ? [voteData.baseName || 'Usual Menu'] : []),
    ...survivors.map(ex => ex.name)
  ];
  return parts.length ? parts.join(' + ') : 'Skipped (nothing confirmed)';
}

async function buildRosterAoa() {
  const [usersSnap, votesSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'votes'))
  ]);

  const employees = [];
  usersSnap.forEach(docSnap => {
    const data = docSnap.data();
    if (data.role === 'chef') return;
    employees.push({ id: docSnap.id, name: data.name || docSnap.id });
  });
  employees.sort((a, b) => a.name.localeCompare(b.name));

  // Group votes by slotId, then by userId, and pre-aggregate the extras
  // counts per slot (same aggregation startChefStats does per-session).
  const votesBySlot = {};
  votesSnap.forEach(docSnap => {
    const data = docSnap.data();
    if (!data.slotId) return;
    (votesBySlot[data.slotId] ||= []).push(data);
  });

  const extraCountsBySlot = {};
  Object.entries(votesBySlot).forEach(([slotId, votes]) => {
    const counts = {};
    votes.forEach(v => {
      (v.extras || []).forEach(ex => {
        counts[ex.id] = (counts[ex.id] || 0) + 1;
      });
    });
    extraCountsBySlot[slotId] = counts;
  });

  const today = toISODate(new Date());
  const dates = dateRangeDescending(ROSTER_START_DATE, today);

  // Header row 1: Name (spans 2 rows) + one merged "<Date> <Session>" cell
  // per session (spans 2 columns). Header row 2: blank under Name, then
  // "Ticket"/"Ate" under each session.
  const headerRow1 = ['Name'];
  const headerRow2 = [''];
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }]; // Name spans both header rows

  dates.forEach((iso, dateIdx) => {
    SESSION_TYPES.forEach(type => {
      const col = 1 + (dateIdx * SESSION_TYPES.length + SESSION_TYPES.indexOf(type)) * 2;
      headerRow1.push(`${iso} ${type}`, '');
      headerRow2.push('Ticket', 'Ate');
      merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + 1 } });
    });
  });

  const rows = employees.map(emp => {
    const row = [emp.name];
    dates.forEach(iso => {
      const dayOfWeek = new Date(iso + 'T00:00:00').getDay();
      SESSION_TYPES.forEach(type => {
        const slotId = `${iso}_${type}`;
        const state = sessionStateFor(slotId);
        const eligible = (state.eligibleOverride !== undefined && state.eligibleOverride !== null)
          ? state.eligibleOverride
          : defaultSlotEligible(dayOfWeek, type, iso);
        const frozen = !!state.frozen;
        const voteData = (votesBySlot[slotId] || []).find(v => v.userId === emp.id) || null;
        const extraCounts = extraCountsBySlot[slotId] || {};
        row.push(ticketTextFor(voteData, eligible, frozen, extraCounts), ''); // Ate left blank for now
      });
    });
    return row;
  });

  return { aoa: [headerRow1, headerRow2, ...rows], merges, dateCount: dates.length };
}

document.getElementById('chef-roster-export-btn').addEventListener('click', async () => {
  const btn = document.getElementById('chef-roster-export-btn');
  const status = document.getElementById('chef-roster-export-status');
  if (typeof XLSX === 'undefined') return;

  btn.disabled = true;
  btn.textContent = 'Building…';
  status.classList.add('hidden');

  try {
    const { aoa, merges, dateCount } = await buildRosterAoa();

    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet['!merges'] = merges;
    worksheet['!cols'] = [{ wch: 22 }, ...Array(dateCount * SESSION_TYPES.length * 2).fill({ wch: 14 })];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Roster');
    XLSX.writeFile(workbook, `Roster_${ROSTER_START_DATE}_to_${toISODate(new Date())}.xlsx`);
  } catch (err) {
    console.error('Roster export failed:', err);
    status.textContent = `Couldn't build the roster export (${err.code || err.message}).`;
    status.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download Roster Excel';
  }
});

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
      <label class="extras-editor-type">Type
        <select class="extra-type-input">
          <option value="side" ${opt.type !== 'main' ? 'selected' : ''}>Side dish</option>
          <option value="main" ${opt.type === 'main' ? 'selected' : ''}>Main dish</option>
        </select>
      </label>
      <button type="button" class="extras-editor-remove-btn" data-remove="${i}">Remove</button>
    </div>
  `).join('');
}

document.getElementById('extras-add-btn').addEventListener('click', () => {
  extrasDraft.push({ id: `item-${Date.now()}`, name: '', price: 0, threshold: false, type: 'side' });
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
    const type = row.querySelector('.extra-type-input').value === 'main' ? 'main' : 'side';
    const entry = {
      id: extrasDraft[i].id,
      name,
      price: priceRaw === '' ? null : Number(priceRaw),
      threshold,
      type
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
