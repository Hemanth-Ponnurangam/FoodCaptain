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
import { THRESHOLD_MIN } from "./menu-data.js";
import { onAuthChange } from "./auth.js";
import {
  onConfigChange,
  startConfigListener,
  onSessionStatesChange,
  startSessionStatesListener,
  sessionStateFor,
  setSlotFrozen
} from "./config-store.js";
import {
  generateWeekSlots,
  findSlot,
  defaultSlotEligible,
  slotCutoffDate,
  formatCutoffLabel,
  formatCountdown
} from "./slots.js";

startConfigListener();
startSessionStatesListener();

let currentUserId = null;
let currentUserName = null;
let unsubscribeStats = null;
let autoFreezeTimer = null;

let weekSlots = generateWeekSlots();
let currentSlotId = null;

// Live, Chef-editable config — populated once config-store's listener fires.
// Everything menu/price/deadline related reads from this instead of static
// menu-data.js constants now.
let liveCfg = null;

const LOCK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

function getSlotById(id) {
  return findSlot(weekSlots, id);
}

// Effective eligibility = the Chef's explicit override if one exists,
// otherwise the default Dinner/Sunday/holiday rule.
function effectiveEligible(slot) {
  const override = sessionStateFor(slot.id).eligibleOverride;
  if (override !== undefined && override !== null) return override;
  return defaultSlotEligible(slot.dayOfWeek, slot.type, slot.date);
}

function pickDefaultSlot() {
  const flat = weekSlots.flatMap(d => d.sessions);
  return flat.find(s => effectiveEligible(s)) || null;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Role-based routing ---------------------------------------------------

onAuthChange(user => {
  if (!user) {
    currentUserId = null;
    currentUserName = null;
    currentSlotId = null;
    stopStatsListener();
    stopAutoFreezeTimer();
    closeCalendar();
    return;
  }
  if (user.role === 'chef') return; // chef.js handles this case

  goHome(user.id, user.name);
});

function goHome(id, displayName) {
  currentUserId = id;
  currentUserName = displayName || null;
  const nameEl = document.getElementById('home-username');
  nameEl.textContent = displayName ? `, ${displayName}` : '';
  switchTab('home');
  document.getElementById('header-actions').classList.remove('hidden');
  document.getElementById('calendar-btn').classList.remove('hidden');

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

// Re-render whenever the Chef edits the menu/prices/deadlines, or when
// eligibility/freeze state changes for any session.
onConfigChange(cfg => {
  liveCfg = cfg;
  if (currentUserId && currentSlotId) {
    const slot = getSlotById(currentSlotId);
    if (slot) renderSlotView(slot);
  }
});

onSessionStatesChange(() => {
  if (!currentUserId) return;
  if (!currentSlotId) {
    // We may not have had an eligible slot the first time we looked (e.g.
    // this listener hadn't loaded yet) — try picking one again now.
    const defaultSlot = pickDefaultSlot();
    if (defaultSlot) selectSlot(defaultSlot.id);
    return;
  }
  const slot = getSlotById(currentSlotId);
  if (slot) renderSlotView(slot);
});

// --- Weekly Calendar ---
function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = weekSlots.map(day => `
    <div class="calendar-day">
      <div class="calendar-day-label">${day.dayLabel}</div>
      <div class="calendar-sessions">
        ${day.sessions.map(s => {
          const eligible = effectiveEligible(s);
          return `
            <button
              type="button"
              class="calendar-session-btn ${eligible ? '' : 'locked'} ${s.id === currentSlotId ? 'active' : ''}"
              data-slot-id="${s.id}"
              ${eligible ? '' : 'disabled'}
            >
              ${eligible ? '' : LOCK_ICON_SVG}
              ${s.type}
            </button>
          `;
        }).join('')}
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

// --- Menu rendering (all driven by liveCfg now, not static menu-data) -----

function extrasAvailableFor(slot) {
  if (!liveCfg) return [];
  return slot.type !== 'Breakfast' ? (liveCfg.otherOptions || []) : [];
}

function baseOptionsFor(slot) {
  const price = liveCfg ? (liveCfg.basePrices[slot.type] ?? 0) : 0;
  return [
    { id: 'usual', name: 'Usual Menu', price, threshold: false },
    { id: 'skip', name: 'Skip (not eating this session)', price: 0, threshold: false }
  ];
}

function allOptionsLookup(slot) {
  const lookup = {};
  baseOptionsFor(slot).forEach(opt => { lookup[opt.id] = opt; });
  extrasAvailableFor(slot).forEach(opt => { lookup[opt.id] = opt; });
  return lookup;
}

function formatPrice(entry) {
  return entry.priceLabel || (entry.price != null ? `Rs ${entry.price}` : '');
}

// Cache of the latest live vote counts per extra id for the *currently
// selected* slot. Lets a freshly-rendered progress bar / ticket status show
// real data immediately instead of waiting on the next Firestore snapshot.
let latestExtraCounts = null;

function renderUsualMenuDetail(slot) {
  const el = document.getElementById('usual-menu-detail');
  if (!el) return;
  if (!liveCfg) {
    el.innerHTML = `<p class="usual-menu-items">Loading menu…</p>`;
    return;
  }
  const items = (liveCfg.weeklyMenu[slot.dayOfWeek] && liveCfg.weeklyMenu[slot.dayOfWeek][slot.type]) || [];
  const price = liveCfg.basePrices[slot.type] ?? 0;
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

  if (!liveCfg) {
    container.innerHTML = `<p>Loading menu…</p>`;
    return;
  }

  const usualPrice = liveCfg.basePrices[slot.type] ?? 0;
  const extras = extrasAvailableFor(slot);
  // Other Menu items are grouped into two sections: Main Dish (paired with
  // the quota fallback question) and Side Dish (plain add-ons).
  const mainExtras = extras.filter(opt => opt.type === 'main');
  const sideExtras = extras.filter(opt => opt.type !== 'main');

  const baseRows = `
    <label class="vote-option">
      <input type="radio" name="meal-base" value="usual">
      <span class="vote-option-label">Usual Menu<span class="vote-option-price">Rs ${usualPrice}</span></span>
    </label>
    <label class="vote-option">
      <input type="radio" name="meal-base" value="skip">
      <span class="vote-option-label">Skip (not eating this session)</span>
    </label>
  `;

  const extraRow = (opt) => `
    <label class="vote-option vote-option-checkbox" data-extra-id="${opt.id}">
      <input type="checkbox" name="meal-extra" value="${opt.id}">
      <span class="vote-option-label">
        ${escapeHtml(opt.name)}
        ${opt.threshold ? `<span class="threshold-badge">Needs ${THRESHOLD_MIN}+ votes${opt.type === 'main' ? ' · Main' : ' · Side'}</span>` : ''}
        ${formatPrice(opt) ? `<span class="vote-option-price">${escapeHtml(formatPrice(opt))}</span>` : ''}
      </span>
      ${opt.threshold ? `
        <div class="threshold-progress" id="progress-${opt.id}">
          <div class="threshold-progress-track"><div class="threshold-progress-fill" style="width:0%"></div></div>
          <span class="threshold-progress-label">0/${THRESHOLD_MIN} votes reached</span>
        </div>
      ` : ''}
    </label>
  `;

  const mainRows = mainExtras.map(extraRow).join('');
  const sideRows = sideExtras.map(extraRow).join('');

  container.innerHTML = `
    <div class="vote-group-label">Preference</div>
    <div class="vote-options-base">${baseRows}</div>

    ${mainExtras.length ? `
      <div class="vote-group-label">Other Menu (Main Dish)</div>
      <div class="vote-options-extras">${mainRows}</div>
      <div id="fallback-group" class="fallback-group hidden">
        <div class="vote-group-label">If your Main Dish pick doesn't reach ${THRESHOLD_MIN} votes</div>
        <select id="fallback-select" class="fallback-select">
          <option value="auto_regular">Give me the regular meal instead</option>
          <option value="skip">Skip me entirely</option>
        </select>
      </div>
    ` : ''}

    ${sideExtras.length ? `
      <div class="vote-group-label">Other Menu (Side Dish)</div>
      <div class="vote-options-extras">${sideRows}</div>
    ` : ''}
  `;

  container.addEventListener('change', (e) => {
    if (e.target.name === 'meal-base') updateExtrasDisabledState();
    if (e.target.name === 'meal-base' || e.target.name === 'meal-extra') updateFallbackVisibility(slot);
  });

  applyThresholdProgress(slot);
}

function updateExtrasDisabledState() {
  const skipChecked = document.querySelector('input[name="meal-base"][value="skip"]:checked');
  document.querySelectorAll('input[name="meal-extra"]').forEach(cb => {
    cb.disabled = !!skipChecked;
    if (skipChecked) cb.checked = false;
  });
  document.querySelectorAll('.vote-option-checkbox').forEach(label => {
    label.classList.toggle('vote-option-disabled', !!skipChecked);
  });
}

// The fallback choice only matters if at least one selected extra is a
// Main dish with a headcount minimum — a Side dish missing quota is just
// quietly dropped from the ticket, so it never needs this question.
function updateFallbackVisibility(slot) {
  const group = document.getElementById('fallback-group');
  if (!group) return; // no Main Dish items configured for this session
  const lookup = allOptionsLookup(slot);
  const anyMainThresholdChecked = Array.from(document.querySelectorAll('input[name="meal-extra"]:checked'))
    .some(cb => lookup[cb.value] && lookup[cb.value].threshold && lookup[cb.value].type === 'main');
  group.classList.toggle('hidden', !anyMainThresholdChecked);
}

function markSubmittedOptions(baseId, extraIds) {
  document.querySelectorAll('#vote-options .vote-option').forEach(label => {
    const input = label.querySelector('input[name="meal-base"], input[name="meal-extra"]');
    if (!input) return;
    const isSubmittedBase = input.name === 'meal-base' && input.value === baseId;
    const isSubmittedExtra = input.name === 'meal-extra' && extraIds.includes(input.value);
    label.classList.toggle('vote-option--submitted', isSubmittedBase || isSubmittedExtra);
  });
}

function applyThresholdProgress(slot) {
  if (!latestExtraCounts) return;
  extrasAvailableFor(slot).filter(opt => opt.threshold).forEach(opt => {
    const bar = document.getElementById(`progress-${opt.id}`);
    if (!bar) return;
    const count = latestExtraCounts[opt.id] || 0;
    const pct = Math.min(100, Math.round((count / THRESHOLD_MIN) * 100));
    const met = count >= THRESHOLD_MIN;
    bar.querySelector('.threshold-progress-fill').style.width = `${pct}%`;
    bar.querySelector('.threshold-progress-label').textContent = met
      ? `${count}/${THRESHOLD_MIN} votes — confirmed!`
      : `${count}/${THRESHOLD_MIN} votes reached`;
    bar.classList.toggle('threshold-progress--met', met);
  });
}

function describeSelection(baseId, extras) {
  const slot = getSlotById(currentSlotId);
  const lookup = allOptionsLookup(slot);
  const baseName = (lookup[baseId] && lookup[baseId].name) || baseId;
  const extraNames = (extras || []).map(ex => ex.name);
  return extraNames.length ? `${baseName} + ${extraNames.join(', ')}` : baseName;
}

function selectSlot(slotId) {
  const slot = getSlotById(slotId);
  if (!slot) return;

  currentSlotId = slotId;
  updateSessionBanner(slot);

  if (effectiveEligible(slot)) {
    document.getElementById('session-locked-message').classList.add('hidden');
    document.getElementById('vote-and-stats').classList.remove('hidden');
    renderSlotView(slot);
    startStatsListener();
    startAutoFreezeTimer(slot);
  } else {
    document.getElementById('session-locked-message').classList.remove('hidden');
    document.getElementById('vote-and-stats').classList.add('hidden');
    stopStatsListener();
    stopAutoFreezeTimer();
  }
}

// Re-renders everything for the current slot without touching the stats
// listener — called whenever config or freeze/eligibility state changes.
function renderSlotView(slot) {
  renderUsualMenuDetail(slot);
  renderVoteOptions(slot);
  loadVote();
  refreshSessionUI(slot);
}

// --- Freeze-driven lock (Chef-controlled, with a best-effort auto-freeze
// at the general cutoff time) ------------------------------------------
// There's no server-side cron here (that's the still-open Cloud Functions
// item) — instead, whichever browser is open and notices the cutoff has
// passed writes frozen=true itself. Harmless if two clients race, since
// it's the same idempotent write either way.

function stopAutoFreezeTimer() {
  if (autoFreezeTimer) {
    clearInterval(autoFreezeTimer);
    autoFreezeTimer = null;
  }
}

function startAutoFreezeTimer(slot) {
  stopAutoFreezeTimer();
  checkAutoFreeze(slot);
  autoFreezeTimer = setInterval(() => checkAutoFreeze(slot), 30000);
}

function checkAutoFreeze(slot) {
  if (currentSlotId !== slot.id) {
    stopAutoFreezeTimer();
    return;
  }
  if (!liveCfg) return;
  if (sessionStateFor(slot.id).frozen) return;

  const cutoff = slotCutoffDate(slot, liveCfg.cutoffTimes);
  if (new Date() >= cutoff) {
    setSlotFrozen(slot.id, true).catch(err => console.error('Auto-freeze failed:', err));
  }
}

function refreshSessionUI(slot) {
  const voteSection = document.getElementById('vote-section');
  const banner = document.getElementById('cutoff-banner');
  const frozen = !!sessionStateFor(slot.id).frozen;

  if (frozen) {
    voteSection.classList.add('hidden');
    banner.classList.add('hidden');
  } else {
    voteSection.classList.remove('hidden');
    if (liveCfg) {
      const msLeft = slotCutoffDate(slot, liveCfg.cutoffTimes) - new Date();
      const countdown = formatCountdown(msLeft);
      banner.textContent = countdown
        ? `Deadline: ${formatCutoffLabel(slot, liveCfg.cutoffTimes)} — ${countdown} left`
        : `Deadline: ${formatCutoffLabel(slot, liveCfg.cutoffTimes)} (passed — waiting on the Chef to freeze)`;
      banner.classList.remove('hidden');
    }
  }

  renderTicket(slot, frozen);
}

// Renders the employee's ticket. Two modes:
//   - PREVIEW (not frozen): shown the moment a vote is saved, editable, with
//     a yellow "waiting for the Chef's freeze" banner. Threshold extras show
//     a red X below quota or a yellow check once they clear it.
//   - FINAL (frozen): green "confirmed" banner. Any extra that never
//     cleared quota disappears from the bill entirely (unless the
//     employee's fallback preference was "skip", in which case the whole
//     order is canceled).
function renderTicket(slot, frozen) {
  const section = document.getElementById('ticket-section');
  const container = document.getElementById('ticket-body');
  const titleEl = document.getElementById('ticket-title');
  const subtitleEl = document.getElementById('ticket-subtitle');
  if (!container) return;

  titleEl.textContent = frozen ? 'Your Ticket' : 'Your Ticket (Preview)';
  subtitleEl.textContent = frozen
    ? "Headcount is frozen — this order is final."
    : "You can still change your vote above — this updates live.";

  getDoc(doc(db, 'votes', voteDocId()))
    .then(snap => {
      if (currentSlotId !== slot.id) return; // navigated away before this resolved

      if (!snap.exists()) {
        if (frozen) {
          section.classList.remove('hidden');
          container.innerHTML = `
            <div class="ticket-status-banner ticket-status-banner--skipped">No vote was recorded — this session is marked as skipped, no charge.</div>`;
        } else {
          section.classList.add('hidden');
        }
        return;
      }

      section.classList.remove('hidden');
      const data = snap.data();
      const baseId = data.base || data.option; // legacy fallback

      if (baseId === 'skip') {
        const cls = frozen ? 'ticket-status-banner--confirmed' : 'ticket-status-banner--pending';
        container.innerHTML = `<div class="ticket-status-banner ${cls}">You opted to skip this session.</div>`;
        return;
      }

      const extras = data.extras || [];
      const fallback = data.fallbackChoice || 'auto_regular';

      const classified = extras.map(ex => {
        if (!ex.threshold) return { ...ex, status: 'plain', count: null };
        const count = (latestExtraCounts && latestExtraCounts[ex.id]) || 0;
        return { ...ex, status: count >= THRESHOLD_MIN ? 'met' : 'unmet', count };
      });
      // Only a Main dish missing quota is "a problem" that falls back to the
      // employee's regular-menu/skip preference. A Side dish missing quota
      // is never a problem on its own — it's just quietly dropped below.
      const anyMainUnmet = classified.some(ex => ex.status === 'unmet' && ex.type === 'main');

      if (frozen) {
        if (anyMainUnmet && fallback === 'skip') {
          container.innerHTML = `
            <div class="ticket-status-banner ticket-status-banner--skipped">Your main dish didn't meet the ${THRESHOLD_MIN}-vote minimum, so per your preference this order was skipped — no charge.</div>`;
          return;
        }

        const survivors = classified.filter(ex => ex.status !== 'unmet');
        const total = (data.basePrice || 0) + survivors.reduce((s, ex) => s + (ex.price || 0), 0);

        const rows = [
          `<div class="ticket-row"><span><span class="ticket-row-status ticket-row-status--met">&#10003;</span>${escapeHtml(data.baseName || 'Usual Menu')}</span><span>Rs ${data.basePrice || 0}</span></div>`,
          ...survivors.map(ex => `<div class="ticket-row"><span><span class="ticket-row-status ticket-row-status--met">&#10003;</span>${escapeHtml(ex.name)}</span><span>${ex.price != null ? `Rs ${ex.price}` : 'Actuals'}</span></div>`)
        ];

        container.innerHTML = `
          <div class="ticket-status-banner ticket-status-banner--confirmed">&#10003; Confirmed by the Chef</div>
          <div class="ticket">
            <div class="ticket-header"><h3>FoodHQ</h3><p>${escapeHtml(slot.dayLabel)} &middot; ${escapeHtml(slot.type)}</p></div>
            <div class="ticket-name">${escapeHtml(currentUserName || 'Guest')}</div>
            <div class="ticket-perforation"></div>
            <div class="ticket-lines">${rows.join('')}</div>
            <div class="ticket-divider"></div>
            <div class="ticket-total"><span>Total</span><span>Rs ${total}</span></div>
            <div class="ticket-perforation"></div>
            <p class="ticket-footer">Show this at the counter</p>
          </div>`;
      } else {
        const total = (data.basePrice || 0) + extras.reduce((s, ex) => s + (ex.price || 0), 0);

        const rows = [
          `<div class="ticket-row"><span>${escapeHtml(data.baseName || 'Usual Menu')}</span><span>Rs ${data.basePrice || 0}</span></div>`,
          ...classified.map(ex => {
            const icon = ex.status === 'plain' ? ''
              : ex.status === 'met' ? '<span class="ticket-row-status ticket-row-status--pending">&#10003;</span>'
              : '<span class="ticket-row-status ticket-row-status--unmet">&#10007;</span>';
            const note = ex.status === 'unmet'
              ? ex.type === 'main'
                ? ` <em>(${ex.count}/${THRESHOLD_MIN} votes — if it stays unmet, your fallback choice applies)</em>`
                : ` <em>(${ex.count}/${THRESHOLD_MIN} votes — will just be dropped if unmet)</em>`
              : ex.status === 'met' ? ` <em>(met — awaiting freeze)</em>`
              : '';
            return `<div class="ticket-row"><span>${icon}${escapeHtml(ex.name)}${note}</span><span>${ex.price != null ? `Rs ${ex.price}` : 'Actuals'}</span></div>`;
          })
        ];

        container.innerHTML = `
          <div class="ticket-status-banner ticket-status-banner--pending">&#9888; Waiting for the Chef's count freeze</div>
          <div class="ticket">
            <div class="ticket-header"><h3>FoodHQ</h3><p>${escapeHtml(slot.dayLabel)} &middot; ${escapeHtml(slot.type)}</p></div>
            <div class="ticket-name">${escapeHtml(currentUserName || 'Guest')}</div>
            <div class="ticket-perforation"></div>
            <div class="ticket-lines">${rows.join('')}</div>
            <div class="ticket-divider"></div>
            <div class="ticket-total"><span>Estimated Total</span><span>Rs ${total}</span></div>
            <div class="ticket-perforation"></div>
            <p class="ticket-footer">Totals may change if a special item doesn't meet quota</p>
          </div>`;
      }
    })
    .catch(err => {
      console.error('Ticket load failed:', err);
      section.classList.remove('hidden');
      container.innerHTML = `<p class="ticket-empty">Couldn't load your ticket. Please refresh.</p>`;
    });
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
  document.querySelectorAll('input[name="meal-base"]').forEach(r => r.checked = false);
  document.querySelectorAll('input[name="meal-extra"]').forEach(c => c.checked = false);
  updateExtrasDisabledState();

  if (!currentUserId || !currentSlotId) return;
  const slot = getSlotById(currentSlotId);

  try {
    const voteRef = doc(db, 'votes', voteDocId());
    const existing = await getDoc(voteRef);

    if (existing.exists()) {
      const data = existing.data();
      const baseId = data.base || data.option; // legacy fallback
      const extras = data.extras || [];
      const extraIds = extras.map(ex => ex.id);

      const baseRadio = document.querySelector(`input[name="meal-base"][value="${CSS.escape(baseId)}"]`);
      if (baseRadio) baseRadio.checked = true;
      extraIds.forEach(id => {
        const cb = document.querySelector(`input[name="meal-extra"][value="${CSS.escape(id)}"]`);
        if (cb) cb.checked = true;
      });
      updateExtrasDisabledState();
      if (slot) updateFallbackVisibility(slot);

      const fallbackSelect = document.getElementById('fallback-select');
      if (fallbackSelect) fallbackSelect.value = data.fallbackChoice || 'auto_regular';

      showVoteConfirmation(describeSelection(baseId, extras));
      markSubmittedOptions(baseId, extraIds);
    } else if (slot) {
      updateFallbackVisibility(slot);
    }
  } catch (err) {
    console.error('Loading vote failed:', err);
  }
}

document.getElementById('vote-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('vote-error');

  const baseInput = document.querySelector('input[name="meal-base"]:checked');
  if (!baseInput) {
    showError('vote-error', 'Please choose Usual Menu or Skip before submitting.');
    return;
  }
  if (!currentUserId || !currentSlotId) {
    showError('vote-error', 'You need to be logged in to vote.');
    return;
  }

  try {
    const slot = getSlotById(currentSlotId);
    if (sessionStateFor(slot.id).frozen) {
      showError('vote-error', 'The Chef has already frozen the headcount for this session.');
      renderSlotView(slot);
      return;
    }

    const lookup = allOptionsLookup(slot);
    const baseId = baseInput.value;
    const baseEntry = lookup[baseId] || { name: baseId, price: 0 };

    const extraIds = baseId === 'skip'
      ? []
      : Array.from(document.querySelectorAll('input[name="meal-extra"]:checked')).map(cb => cb.value);

    const extras = extraIds.map(id => {
      const entry = lookup[id] || { name: id, price: null, threshold: false, type: 'side' };
      return { id, name: entry.name, price: entry.price, threshold: !!entry.threshold, type: entry.type === 'main' ? 'main' : 'side' };
    });

    const fallbackSelect = document.getElementById('fallback-select');
    const fallbackChoice = fallbackSelect ? fallbackSelect.value : 'auto_regular';
    const totalPrice = (baseEntry.price || 0) + extras.reduce((sum, ex) => sum + (ex.price || 0), 0);

    await setDoc(doc(db, 'votes', voteDocId()), {
      slotId: currentSlotId,
      base: baseId,
      baseName: baseEntry.name,
      basePrice: baseEntry.price || 0,
      extras,
      fallbackChoice,
      totalPrice,
      userId: currentUserId,
      updatedAt: serverTimestamp()
    });

    showVoteConfirmation(describeSelection(baseId, extras));
    markSubmittedOptions(baseId, extraIds);
    renderTicket(slot, false);
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
  stopStatsListener();
  latestExtraCounts = null;

  if (!currentSlotId) return;

  const slot = getSlotById(currentSlotId);
  const statsBody = document.getElementById('stats-body');

  const votesQuery = query(collection(db, 'votes'), where('slotId', '==', currentSlotId));

  unsubscribeStats = onSnapshot(
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

      latestExtraCounts = extraCounts;

      const rows = [`<tr><td>Standard ${escapeHtml(slot.type)}</td><td>${baseCounts.usual}</td></tr>`];
      extrasAvailableFor(slot).forEach(opt => {
        rows.push(`<tr><td>${escapeHtml(opt.name)}</td><td>${extraCounts[opt.id] || 0}</td></tr>`);
      });
      statsBody.innerHTML = rows.join('');

      applyThresholdProgress(slot);
      if (currentSlotId === slot.id) renderTicket(slot, !!sessionStateFor(slot.id).frozen);
    },
    (err) => {
      console.error('Stats listener failed:', err);
      statsBody.innerHTML = `<tr><td colspan="2">Couldn't load live stats (${err.code || err.message}).</td></tr>`;
    }
  );
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
