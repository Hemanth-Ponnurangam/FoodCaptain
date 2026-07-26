// --- Shared meal-slot model ------------------------------------------------
// A "slot" is one session (Breakfast/Lunch/Dinner) on one date. Both the
// employee view and the Chef dashboard build the same 7-day list of slots
// from this module so their session IDs ("2026-07-27_Dinner") always match.

export const SESSION_TYPES = ['Breakfast', 'Lunch', 'Dinner'];

// Specific dates that count as holidays (and so need a vote like Sunday
// does) even though they fall on a weekday. Add ISO dates ("YYYY-MM-DD")
// here as needed — there's no Chef UI for this yet, just this list.
const HOLIDAYS = [];

function pad(n) {
  return String(n).padStart(2, '0');
}

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The DEFAULT eligibility rule, before any Chef override is applied:
// Dinners, all Sunday sessions, and any listed holiday need a vote.
// Breakfast/Lunch on a normal weekday run as usual with no vote needed.
export function defaultSlotEligible(dayOfWeek, sessionType, iso) {
  if (HOLIDAYS.includes(iso)) return true;
  if (dayOfWeek === 0) return true;
  if (sessionType === 'Dinner') return true;
  return false;
}

export function generateWeekSlots(startDate = new Date()) {
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
      type
    }));

    days.push({ iso, dayLabel, dayOfWeek, sessions });
  }
  return days;
}

export function findSlot(weekSlots, slotId) {
  for (const day of weekSlots) {
    const found = day.sessions.find(s => s.id === slotId);
    if (found) return found;
  }
  return null;
}

// --- Cutoff time helpers (the "in general" deadline per session type) -----

export function slotCutoffDate(slot, cutoffTimes) {
  const timeStr = (cutoffTimes && cutoffTimes[slot.type]) || '16:00';
  const [h, m] = timeStr.split(':').map(Number);
  const [y, mo, d] = slot.date.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
}

export function formatCutoffLabel(slot, cutoffTimes) {
  return slotCutoffDate(slot, cutoffTimes).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatCountdown(msRemaining) {
  if (msRemaining <= 0) return null;
  const totalMin = Math.ceil(msRemaining / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
