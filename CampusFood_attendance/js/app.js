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

let weekOffset = 0; // 0 = current week, +1 = next week, -1 = previous week, etc.
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
    weekOffset = 0;
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

  weekOffset = 0;
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
function weekStartDate(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset * 7);
  return d;
}

function rebuildWeekSlots() {
  weekSlots = generateWeekSlots(weekStartDate(weekOffset));
  renderCalendarWeekLabel();
}

function renderCalendarWeekLabel() {
  const labelEl = document.getElementById('calendar-week-label');
  if (!labelEl) return;
  if (weekOffset === 0) {
    labelEl.textContent = 'This Week';
    return;
  }
  const first = weekSlots[0];
  const last = weekSlots[weekSlots.length - 1];
  const range = first && last ? `${first.dayLabel} – ${last.dayLabel}` : '';
  labelEl.textContent = weekOffset > 0
    ? `${range} (+${weekOffset}w)`
    : `${range} (${weekOffset}w)`;
}

function goToCalendarWeek(offset) {
  weekOffset = offset;
  rebuildWeekSlots();
  renderCalendar();
}

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
  renderCalendarWeekLabel();
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

document.getElementById('calendar-week-prev').addEventListener('click', () => goToCalendarWeek(weekOffset - 1));
document.getElementById('calendar-week-next').addEventListener('click', () => goToCalendarWeek(weekOffset + 1));
document.getElementById('calendar-week-today').addEventListener('click', () => goToCalendarWeek(0));

document.getElementById('calendar-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.calendar-session-btn');
  if (!btn || btn.disabled) return;
  selectSlot(btn.dataset.slotId);
  closeCalendar();
});

// --- Session Subtabs (Ticket / Preference (Voting) / Headcounts) ---
function switchSessionTab(tabName) {
  document.querySelectorAll('.session-subtab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sessionTab === tabName);
  });
  document.querySelectorAll('.session-tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `session-tab-${tabName}`);
  });
}

document.querySelectorAll('.session-subtab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchSessionTab(btn.dataset.sessionTab));
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

// Four independent dropdowns. Primary preference (the Regular/Usual menu)
// and Other Main Dish are mutually exclusive — picking one disables the
// other, so a vote never mixes "give me the regular meal" with "give me
// this other main dish" in the same submission. Secondary preference
// (Regular / Skip) is the ONLY place a regular-meal fallback can enter the
// picture once an Other Main Dish is chosen, and it's mandatory whenever
// that dish has a headcount minimum.
function renderVoteOptions(slot) {
  const container = document.getElementById('vote-options');
  if (!container) return;

  if (!liveCfg) {
    container.innerHTML = `<p>Loading menu…</p>`;
    return;
  }

  const usualPrice = liveCfg.basePrices[slot.type] ?? 0;
  const extras = extrasAvailableFor(slot);
  const mainExtras = extras.filter(opt => opt.type === 'main');
  const sideExtras = extras.filter(opt => opt.type !== 'main');

  const optionRow = (opt) => `
    <option value="${opt.id}">${escapeHtml(opt.name)}${opt.threshold ? ` (needs ${THRESHOLD_MIN}+ votes)` : ''}${formatPrice(opt) ? ` — ${escapeHtml(formatPrice(opt))}` : ''}</option>
  `;

  const progressBar = (id) => `
    <div class="threshold-progress hidden" id="progress-${id}">
      <div class="threshold-progress-track"><div class="threshold-progress-fill" style="width:0%"></div></div>
      <span class="threshold-progress-label">0/${THRESHOLD_MIN} votes reached</span>
    </div>
  `;

  container.innerHTML = `
    <div class="vote-group-label">Primary Preference (Regular Menu) <span class="optional-tag">Optional</span></div>
    <select id="primary-preference-select" class="fallback-select">
      <option value="">No preference</option>
      <option value="usual">Usual Menu — Rs ${usualPrice}</option>
      <option value="skip">Skip (not eating this session)</option>
    </select>

    ${mainExtras.length ? `
      <div class="vote-group-label">Other Main Dish</div>
      <select id="other-main-dish-select" class="fallback-select">
        <option value="">None</option>
        ${mainExtras.map(optionRow).join('')}
      </select>
      ${progressBar('main-dish')}

      <div id="secondary-preference-group" class="fallback-group hidden">
        <div class="vote-group-label">Secondary Preference (Regular / Skip) <span class="required-tag">Required</span></div>
        <p class="fallback-hint">If your Other Main Dish pick doesn't reach ${THRESHOLD_MIN} votes:</p>
        <select id="secondary-preference-select" class="fallback-select">
          <option value="">-- Choose one --</option>
          <option value="auto_regular">Give me the regular meal instead</option>
          <option value="skip">Skip me entirely</option>
        </select>
      </div>
    ` : ''}

    ${sideExtras.length ? `
      <div class="vote-group-label">Side Dish <span class="optional-tag">Optional</span></div>
      <select id="side-dish-select" class="fallback-select">
        <option value="">None</option>
        ${sideExtras.map(optionRow).join('')}
      </select>
      ${progressBar('side-dish')}
    ` : ''}
  `;

  container.addEventListener('change', (e) => {
    if (e.target.id === 'primary-preference-select') handlePrimaryPreferenceChange(slot);
    if (e.target.id === 'other-main-dish-select') handleOtherMainDishChange(slot);
    if (e.target.id === 'side-dish-select') applyThresholdProgress(slot);
  });

  applyThresholdProgress(slot);
}

// Primary preference and Other Main Dish are mutually exclusive: choosing
// one disables (and clears) the other, so the two can never be mixed in a
// single vote. Choosing "Skip" also clears/disables Side Dish, since
// skipping the session means no food at all.
function handlePrimaryPreferenceChange(slot) {
  const primarySelect = document.getElementById('primary-preference-select');
  const mainSelect = document.getElementById('other-main-dish-select');
  const sideSelect = document.getElementById('side-dish-select');
  const value = primarySelect ? primarySelect.value : '';

  if (mainSelect) {
    mainSelect.disabled = !!value;
    if (value) mainSelect.value = '';
  }
  const isSkip = value === 'skip';
  if (sideSelect) {
    sideSelect.disabled = isSkip;
    if (isSkip) sideSelect.value = '';
  }

  updateSecondaryPreferenceState(slot);
  applyThresholdProgress(slot);
}

function handleOtherMainDishChange(slot) {
  const primarySelect = document.getElementById('primary-preference-select');
  const mainSelect = document.getElementById('other-main-dish-select');
  const value = mainSelect ? mainSelect.value : '';

  if (primarySelect) {
    primarySelect.disabled = !!value;
    if (value) primarySelect.value = '';
  }

  updateSecondaryPreferenceState(slot);
  applyThresholdProgress(slot);
}

// Secondary preference only matters — and is only mandatory — when the
// chosen Other Main Dish carries a headcount minimum. A Main dish with no
// threshold has no quota risk, so there's nothing to fall back from.
function updateSecondaryPreferenceState(slot) {
  const group = document.getElementById('secondary-preference-group');
  if (!group) return; // no Main Dish items configured for this session
  const mainSelect = document.getElementById('other-main-dish-select');
  const secondarySelect = document.getElementById('secondary-preference-select');
  const lookup = allOptionsLookup(slot);
  const selected = mainSelect ? lookup[mainSelect.value] : null;
  const needsSecondary = !!(selected && selected.threshold);

  group.classList.toggle('hidden', !needsSecondary);
  if (secondarySelect) {
    secondarySelect.disabled = !needsSecondary;
    if (!needsSecondary) secondarySelect.value = '';
  }
}

function markSubmittedOptions(primaryId, mainId, sideId) {
  [
    ['primary-preference-select', primaryId],
    ['other-main-dish-select', mainId],
    ['side-dish-select', sideId]
  ].forEach(([elId, val]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.toggle('vote-select--submitted', !!val && el.value === val);
  });
}

function applyThresholdProgress(slot) {
  if (!latestExtraCounts) return;
  const lookup = allOptionsLookup(slot);

  const mainSelect = document.getElementById('other-main-dish-select');
  updateProgressBar('progress-main-dish', mainSelect ? lookup[mainSelect.value] : null);

  const sideSelect = document.getElementById('side-dish-select');
  updateProgressBar('progress-side-dish', sideSelect ? lookup[sideSelect.value] : null);
}

function updateProgressBar(elId, opt) {
  const bar = document.getElementById(elId);
  if (!bar) return;
  if (!opt || !opt.threshold) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const count = (latestExtraCounts && latestExtraCounts[opt.id]) || 0;
  const pct = Math.min(100, Math.round((count / THRESHOLD_MIN) * 100));
  const met = count >= THRESHOLD_MIN;
  bar.querySelector('.threshold-progress-fill').style.width = `${pct}%`;
  bar.querySelector('.threshold-progress-label').textContent = met
    ? `${count}/${THRESHOLD_MIN} votes — confirmed!`
    : `${count}/${THRESHOLD_MIN} votes reached`;
  bar.classList.toggle('threshold-progress--met', met);
}

function describeSelection(primaryId, mainExtra, sideExtra) {
  const slot = getSlotById(currentSlotId);
  const lookup = allOptionsLookup(slot);
  const parts = [];
  if (primaryId) parts.push((lookup[primaryId] && lookup[primaryId].name) || primaryId);
  if (mainExtra) parts.push(mainExtra.name);
  if (sideExtra) parts.push(sideExtra.name);
  return parts.length ? parts.join(' + ') : 'No selection';
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
  const container = document.getElementById('ticket-body');
  const titleEl = document.getElementById('ticket-title');
  const subtitleEl = document.getElementById('ticket-subtitle');
  if (!container) return;

  titleEl.textContent = frozen ? 'Your Ticket' : 'Your Ticket (Preview)';
  subtitleEl.textContent = frozen
    ? "Headcount is frozen — this order is final."
    : "This updates live — change your vote anytime from the Preference (Voting) tab.";

  getDoc(doc(db, 'votes', voteDocId()))
    .then(snap => {
      if (currentSlotId !== slot.id) return; // navigated away before this resolved

      if (!snap.exists()) {
        if (frozen) {
          container.innerHTML = `
            <div class="ticket-status-banner ticket-status-banner--skipped">No vote was recorded — this session is marked as skipped, no charge.</div>`;
        } else {
          container.innerHTML = `<p class="ticket-empty">You haven't voted yet — head to the Preference (Voting) tab to submit your choice. Your ticket will appear here.</p>`;
        }
        return;
      }

      const data = snap.data();
      const baseId = data.base || data.option || null; // legacy fallback; null = no explicit Primary preference

      if (baseId === 'skip') {
        const cls = frozen ? 'ticket-status-banner--confirmed' : 'ticket-status-banner--pending';
        container.innerHTML = `<div class="ticket-status-banner ${cls}">You opted to skip this session.</div>`;
        return;
      }

      const extras = data.extras || [];
      const fallback = data.fallbackChoice || null;
      const explicitUsual = baseId === 'usual';

      const classified = extras.map(ex => {
        if (!ex.threshold) return { ...ex, status: 'plain', count: null };
        const count = (latestExtraCounts && latestExtraCounts[ex.id]) || 0;
        return { ...ex, status: count >= THRESHOLD_MIN ? 'met' : 'unmet', count };
      });
      // Only a Main dish missing quota is "a problem" that falls back to the
      // employee's Secondary preference. A Side dish missing quota is never
      // a problem on its own — it's just quietly dropped below.
      const anyMainUnmet = classified.some(ex => ex.status === 'unmet' && ex.type === 'main');

      // The regular meal is only ever billed when it was the employee's
      // explicit Primary preference, OR when their Other Main Dish pick
      // missed quota and their Secondary preference asked for the regular
      // meal as a fallback. It is never billed alongside a surviving Other
      // Main Dish — that was the old "mixing" bug.
      const usualApplies = explicitUsual || (anyMainUnmet && fallback === 'auto_regular');

      if (frozen) {
        if (anyMainUnmet && fallback === 'skip') {
          container.innerHTML = `
            <div class="ticket-status-banner ticket-status-banner--skipped">Your main dish didn't meet the ${THRESHOLD_MIN}-vote minimum, so per your preference this order was skipped — no charge.</div>`;
          return;
        }

        const survivors = classified.filter(ex => ex.status !== 'unmet');
        const total = (usualApplies ? (data.basePrice || 0) : 0) + survivors.reduce((s, ex) => s + (ex.price || 0), 0);

        const rows = [
          ...(usualApplies ? [`<div class="ticket-row"><span><span class="ticket-row-status ticket-row-status--met">&#10003;</span>${escapeHtml(data.baseName || 'Usual Menu')}</span><span>Rs ${data.basePrice || 0}</span></div>`] : []),
          ...survivors.map(ex => `<div class="ticket-row"><span><span class="ticket-row-status ticket-row-status--met">&#10003;</span>${escapeHtml(ex.name)}</span><span>${ex.price != null ? `Rs ${ex.price}` : 'Actuals'}</span></div>`)
        ];

        if (!rows.length) {
          container.innerHTML = `
            <div class="ticket-status-banner ticket-status-banner--skipped">Nothing you picked was confirmed for this session — no charge.</div>`;
          return;
        }

        container.innerHTML = `
          <div class="ticket-status-banner ticket-status-banner--confirmed">&#10003; Confirmed by the Chef</div>
          <div class="ticket">
            <div class="ticket-header"><h3>Food<span class="logo-hq">HQ</span></h3><p>${escapeHtml(slot.dayLabel)} &middot; ${escapeHtml(slot.type)}</p></div>
            <div class="ticket-name">${escapeHtml(currentUserName || 'Guest')}</div>
            <div class="ticket-perforation"></div>
            <div class="ticket-lines">${rows.join('')}</div>
            <div class="ticket-divider"></div>
            <div class="ticket-total"><span>Total</span><span>Rs ${total}</span></div>
            <div class="ticket-perforation"></div>
            <div class="ticket-qr" id="ticket-qr"></div>
            <p class="ticket-qr-caption">Show this QR code at the counter to check in</p>
            ${data.ate ? '<p class="ticket-attendance-banner">&#10003; Already scanned — enjoy your meal!</p>' : ''}
            <p class="ticket-footer">Show this at the counter</p>
          </div>`;
        renderTicketQr(voteDocId());
      } else {
        // Preview total only ever includes the regular meal when it was
        // explicitly chosen as the Primary preference — an Other Main Dish
        // pick is priced on its own until quota is resolved at freeze time,
        // it's never assumed to also come with the regular meal.
        const total = (explicitUsual ? (data.basePrice || 0) : 0) + extras.reduce((s, ex) => s + (ex.price || 0), 0);

        const rows = [
          ...(explicitUsual ? [`<div class="ticket-row"><span>${escapeHtml(data.baseName || 'Usual Menu')}</span><span>Rs ${data.basePrice || 0}</span></div>`] : []),
          ...classified.map(ex => {
            const icon = ex.status === 'plain' ? ''
              : ex.status === 'met' ? '<span class="ticket-row-status ticket-row-status--pending">&#10003;</span>'
              : '<span class="ticket-row-status ticket-row-status--unmet">&#10007;</span>';
            const note = ex.status === 'unmet'
              ? ex.type === 'main'
                ? (fallback === 'skip'
                    ? ` <em>(${ex.count}/${THRESHOLD_MIN} votes — if it stays unmet, this session will be skipped)</em>`
                    : ` <em>(${ex.count}/${THRESHOLD_MIN} votes — if it stays unmet, you'll get the Usual Menu instead)</em>`)
                : ` <em>(${ex.count}/${THRESHOLD_MIN} votes — will just be dropped if unmet)</em>`
              : ex.status === 'met' ? ` <em>(met — awaiting freeze)</em>`
              : '';
            return `<div class="ticket-row"><span>${icon}${escapeHtml(ex.name)}${note}</span><span>${ex.price != null ? `Rs ${ex.price}` : 'Actuals'}</span></div>`;
          })
        ];

        container.innerHTML = `
          <div class="ticket-status-banner ticket-status-banner--pending">&#9888; Waiting for the Chef's count freeze</div>
          <div class="ticket">
            <div class="ticket-header"><h3>Food<span class="logo-hq">HQ</span></h3><p>${escapeHtml(slot.dayLabel)} &middot; ${escapeHtml(slot.type)}</p></div>
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
      container.innerHTML = `<p class="ticket-empty">Couldn't load your ticket. Please refresh.</p>`;
    });
}

// --- Voting ---
function voteDocId() {
  return `${currentSlotId}__${currentUserId}`;
}

// Draws a QR code encoding this ticket's vote-doc ID (the same ID the Chef's
// scanner reads to mark attendance) into the #ticket-qr container. Guards
// against the CDN script (loaded in index.html) not being available.
function renderTicketQr(ticketId) {
  const el = document.getElementById('ticket-qr');
  if (!el) return;
  el.innerHTML = '';
  if (typeof QRCode === 'undefined') {
    el.textContent = "(QR code unavailable — show your name at the counter instead)";
    return;
  }
  // eslint-disable-next-line no-undef
  new QRCode(el, {
    text: ticketId,
    width: 140,
    height: 140,
    colorDark: '#113f36',
    colorLight: '#ffffff'
  });
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

  const slot = getSlotById(currentSlotId);
  const primarySelect = document.getElementById('primary-preference-select');
  const mainSelect = document.getElementById('other-main-dish-select');
  const secondarySelect = document.getElementById('secondary-preference-select');
  const sideSelect = document.getElementById('side-dish-select');

  if (primarySelect) { primarySelect.value = ''; primarySelect.disabled = false; }
  if (mainSelect) { mainSelect.value = ''; mainSelect.disabled = false; }
  if (secondarySelect) secondarySelect.value = '';
  if (sideSelect) { sideSelect.value = ''; sideSelect.disabled = false; }
  if (slot) {
    handlePrimaryPreferenceChange(slot);
    updateSecondaryPreferenceState(slot);
  }

  if (!currentUserId || !currentSlotId) return;

  try {
    const voteRef = doc(db, 'votes', voteDocId());
    const existing = await getDoc(voteRef);

    if (existing.exists()) {
      const data = existing.data();
      const legacyBase = data.base || data.option || ''; // legacy fallback
      const extras = data.extras || [];
      const mainExtra = extras.find(ex => ex.type === 'main') || null;
      const sideExtra = extras.find(ex => ex.type !== 'main') || null;

      // Primary preference and Other Main Dish are mutually exclusive in the
      // saved record too — an Other Main Dish pick always wins over any
      // legacy/base value, since that's the employee's real intent.
      const primaryId = mainExtra ? '' : legacyBase;

      if (primarySelect) primarySelect.value = primaryId;
      if (slot) handlePrimaryPreferenceChange(slot);

      if (mainExtra && mainSelect && !mainSelect.disabled) mainSelect.value = mainExtra.id;
      if (sideExtra && sideSelect && !sideSelect.disabled) sideSelect.value = sideExtra.id;
      if (slot) updateSecondaryPreferenceState(slot);

      if (secondarySelect && !secondarySelect.disabled) secondarySelect.value = data.fallbackChoice || '';

      showVoteConfirmation(describeSelection(primaryId, mainExtra, sideExtra));
      markSubmittedOptions(primaryId, mainExtra ? mainExtra.id : '', sideExtra ? sideExtra.id : '');
    }
  } catch (err) {
    console.error('Loading vote failed:', err);
  }
}

document.getElementById('vote-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('vote-error');

  if (!currentUserId || !currentSlotId) {
    showError('vote-error', 'You need to be logged in to vote.');
    return;
  }

  const slot = getSlotById(currentSlotId);
  const lookup = allOptionsLookup(slot);

  const primarySelect = document.getElementById('primary-preference-select');
  const mainSelect = document.getElementById('other-main-dish-select');
  const secondarySelect = document.getElementById('secondary-preference-select');
  const sideSelect = document.getElementById('side-dish-select');

  const primaryId = (primarySelect && !primarySelect.disabled) ? primarySelect.value : '';
  const mainId = (mainSelect && !mainSelect.disabled) ? mainSelect.value : '';
  const sideId = (sideSelect && !sideSelect.disabled) ? sideSelect.value : '';

  // Belt-and-braces: the dropdowns already disable/clear each other so this
  // shouldn't be reachable, but never let a Primary preference and an Other
  // Main Dish land in the same vote.
  if (primaryId && mainId) {
    showError('vote-error', "Don't mix a Primary preference with an Other Main Dish — choose one. Use Secondary preference for the regular-meal/skip fallback instead.");
    return;
  }

  if (!primaryId && !mainId) {
    showError('vote-error', 'Please choose a Primary preference or an Other Main Dish before submitting.');
    return;
  }

  const mainEntry = mainId ? lookup[mainId] : null;
  const secondaryNeeded = !!(mainEntry && mainEntry.threshold);
  const secondaryId = secondaryNeeded && secondarySelect && !secondarySelect.disabled ? secondarySelect.value : '';

  if (secondaryNeeded && !secondaryId) {
    showError('vote-error', 'Secondary preference (Regular / Skip) is required when you pick an Other Main Dish.');
    return;
  }

  try {
    if (sessionStateFor(slot.id).frozen) {
      showError('vote-error', 'The Chef has already frozen the headcount for this session.');
      renderSlotView(slot);
      return;
    }

    const usualName = 'Usual Menu';
    const usualPrice = liveCfg.basePrices[slot.type] ?? 0;

    const extras = [];
    if (mainEntry) extras.push({ id: mainId, name: mainEntry.name, price: mainEntry.price, threshold: !!mainEntry.threshold, type: 'main' });
    const sideEntry = sideId ? lookup[sideId] : null;
    if (sideEntry) extras.push({ id: sideId, name: sideEntry.name, price: sideEntry.price, threshold: !!sideEntry.threshold, type: 'side' });

    const totalPrice = (primaryId === 'usual' ? usualPrice : 0) + extras.reduce((sum, ex) => sum + (ex.price || 0), 0);

    await setDoc(doc(db, 'votes', voteDocId()), {
      slotId: currentSlotId,
      base: primaryId || null,
      baseName: usualName,
      basePrice: usualPrice,
      extras,
      fallbackChoice: secondaryId || null,
      totalPrice,
      userId: currentUserId,
      updatedAt: serverTimestamp()
    });

    showVoteConfirmation(describeSelection(primaryId, mainEntry ? { ...mainEntry, id: mainId } : null, sideEntry ? { ...sideEntry, id: sideId } : null));
    markSubmittedOptions(primaryId, mainId, sideId);
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
