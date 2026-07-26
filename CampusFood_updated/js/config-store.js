// --- Live, Chef-editable config + per-session state ---------------------
// Two pieces of shared state live in Firestore so every employee's browser
// (and the Chef's) sees the same thing in real time:
//
//   config/menu           -> { basePrices, weeklyMenu, cutoffTimes, otherOptions }
//                             edited by the Chef dashboard, read by everyone.
//
//   sessionStates/{slotId} -> { eligibleOverride, frozen, frozenAt }
//                             one doc per meal slot (e.g. "2026-07-27_Dinner").
//                             eligibleOverride lets the Chef force a session
//                             on/off regardless of the Dinner/Sunday/holiday
//                             default rule. frozen is set either by the Chef
//                             clicking "Freeze Headcount", or automatically
//                             by whichever browser first notices the cutoff
//                             time has passed (there's no backend cron yet —
//                             see the Cloud Functions item still open).
//
// This module owns the Firestore reads/writes; app.js (employee) and
// chef.js (Chef dashboard) both just subscribe to it.

import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { DEFAULT_BASE_PRICES, DEFAULT_WEEKLY_MENU, DEFAULT_CUTOFF_TIMES, DEFAULT_OTHER_OPTIONS } from "./menu-data.js";

const CONFIG_REF = doc(db, 'config', 'menu');

export let liveConfig = null;
const configListeners = [];
let configListenerStarted = false;

export let sessionStates = {}; // slotId -> { eligibleOverride?, frozen?, frozenAt? }
const sessionStateListeners = [];
let sessionStateListenerStarted = false;

// --- Config (menu/prices/cutoffs/extras) ---------------------------------

async function ensureConfigSeeded() {
  const snap = await getDoc(CONFIG_REF);
  if (!snap.exists()) {
    await setDoc(CONFIG_REF, {
      basePrices: DEFAULT_BASE_PRICES,
      weeklyMenu: DEFAULT_WEEKLY_MENU,
      cutoffTimes: DEFAULT_CUTOFF_TIMES,
      otherOptions: DEFAULT_OTHER_OPTIONS
    });
  }
}

export function onConfigChange(cb) {
  configListeners.push(cb);
  if (liveConfig) cb(liveConfig);
}

export function startConfigListener() {
  if (configListenerStarted) return;
  configListenerStarted = true;

  ensureConfigSeeded()
    .catch(err => console.error('Seeding config/menu failed:', err))
    .finally(() => {
      onSnapshot(CONFIG_REF, snap => {
        if (!snap.exists()) return;
        liveConfig = snap.data();
        configListeners.forEach(cb => cb(liveConfig));
      }, err => console.error('Config listener failed:', err));
    });
}

// fieldPath supports dot notation, e.g. "basePrices" or "weeklyMenu.3.Lunch"
export async function saveConfigField(fieldPath, value) {
  await updateDoc(CONFIG_REF, { [fieldPath]: value });
}

// --- Per-session state (eligibility override + freeze) -------------------

export function onSessionStatesChange(cb) {
  sessionStateListeners.push(cb);
  cb(sessionStates);
}

export function startSessionStatesListener() {
  if (sessionStateListenerStarted) return;
  sessionStateListenerStarted = true;

  onSnapshot(collection(db, 'sessionStates'), snap => {
    const map = {};
    snap.forEach(d => { map[d.id] = d.data(); });
    sessionStates = map;
    sessionStateListeners.forEach(cb => cb(sessionStates));
  }, err => console.error('Session state listener failed:', err));
}

export function sessionStateFor(slotId) {
  return sessionStates[slotId] || {};
}

export async function setSlotEligibleOverride(slotId, eligible) {
  await setDoc(doc(db, 'sessionStates', slotId), { eligibleOverride: eligible }, { merge: true });
}

export async function setSlotFrozen(slotId, frozen) {
  await setDoc(
    doc(db, 'sessionStates', slotId),
    { frozen, frozenAt: frozen ? serverTimestamp() : null },
    { merge: true }
  );
}
