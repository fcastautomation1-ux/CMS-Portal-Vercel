/**
 * hall-scheduler.ts
 *
 * Pure, side-effect-free helpers for the hall task scheduler.
 * Safe to import on both client and server.
 *
 * Core responsibilities:
 *  - Count valid office-hour work minutes in a time range
 *  - Project when N work-minutes will finish (effective_due_at)
 *  - Real-time remaining-minutes calculation for the UI countdown
 *  - Human-readable duration formatting
 */

import {
  PAKISTAN_TIMEZONE,
  DEFAULT_OFFICE_HOURS,
  type HallOfficeHours,
} from './pakistan-time'

// ─── Scheduler State ──────────────────────────────────────────────────────────

/**
 * Fine-grained lifecycle state for hall-managed tasks.
 *
 * State transitions:
 *
 *   hall_inbox  →  (assigned by manager)  →  user_queue
 *   user_queue  →  (auto-start or manual) →  active
 *   active      →  (pause, requires queue) →  paused
 *   active      →  (block, any time)       →  blocked
 *   active      →  (complete)              →  completed
 *   paused      →  (auto-resume on next complete) → active
 *   paused      →  (manual resume)         →  active
 *   blocked     →  (unblock)               →  user_queue (re-enters queue)
 *   active      →  (submit for review)     →  waiting_review
 *   waiting_review → (approved/declined)   →  completed / active
 */
export type HallSchedulerState =
  | 'hall_inbox'      // Arrived via cross-hall send, not yet assigned
  | 'hall_queue'      // Assigned to hall dept queue but not yet to a user
  | 'user_queue'      // In user's personal queue, waiting for prior task to finish
  | 'active'          // User is actively working — countdown running
  | 'paused'          // Paused (countdown stopped); competes for re-activation
  | 'blocked'         // Explicitly blocked with a reason; NOT auto-re-activated
  | 'waiting_review'  // Submitted for review
  | 'completed'       // Done

export const HALL_SCHEDULER_ACTIVE_STATES: HallSchedulerState[] = ['active']
export const HALL_SCHEDULER_CANDIDATE_STATES: HallSchedulerState[] = ['user_queue', 'paused']
export const HALL_SCHEDULER_BLOCKED_STATES: HallSchedulerState[] = ['blocked']

// ─── Internal time helpers ────────────────────────────────────────────────────

/** Returns total minutes since midnight for a 'HH:MM' string. */
function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Returns 0=Sun 1=Mon … 5=Fri 6=Sat for a UTC Date expressed in PKT. */
function getPKTWeekday(date: Date): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: PAKISTAN_TIMEZONE,
    weekday: 'short',
  }).format(date)
  const MAP: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  return MAP[s] ?? 0
}

/** Returns the PKT hour (0–23) and minute (0–59) for a UTC Date. */
function getPKTHourMinute(date: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PAKISTAN_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  return {
    hour:   Number(parts.find((p) => p.type === 'hour')?.value   ?? 0),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? 0),
  }
}

/**
 * Returns true if the UTC timestamp `date` represents a valid work minute
 * under the given hall office-hours config.
 *
 * A minute is valid when:
 *  - It is NOT Saturday or Sunday (PKT)
 *  - It falls inside [office_start, office_end)
 *  - It does NOT fall inside the break window (Mon–Thu: break_start/end,
 *    Friday: friday_break_start/end)
 */
export function isValidWorkMinute(date: Date, hallHours: HallOfficeHours = DEFAULT_OFFICE_HOURS): boolean {
  const weekday = getPKTWeekday(date)
  if (weekday === 0 || weekday === 6) return false

  const isFriday = weekday === 5
  const { hour, minute } = getPKTHourMinute(date)
  const totalMins = hour * 60 + minute

  const startMins = parseHHMM(hallHours.office_start)
  const endMins   = parseHHMM(hallHours.office_end)
  const brkStart  = parseHHMM(isFriday ? hallHours.friday_break_start : hallHours.break_start)
  const brkEnd    = parseHHMM(isFriday ? hallHours.friday_break_end   : hallHours.break_end)

  if (totalMins < startMins)                        return false
  if (totalMins >= endMins)                         return false
  if (totalMins >= brkStart && totalMins < brkEnd)  return false
  return true
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Count how many valid work-minutes fall within [fromIso, toIso).
 *
 * Used to calculate how many worker-minutes elapsed since `active_started_at`
 * so we can deduct them from `remaining_work_minutes` when pausing / blocking.
 *
 * Capped at 90 working days for safety.
 */
export function getWorkMinutesInRange(
  fromIso: string,
  toIso: string,
  hallHours: HallOfficeHours = DEFAULT_OFFICE_HOURS,
): number {
  const fromMs = new Date(fromIso).getTime()
  const toMs   = new Date(toIso).getTime()
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) return 0

  let count   = 0
  let cursor  = fromMs
  const capMs = fromMs + 90 * 24 * 60 * 60_000   // 90-day safety cap

  while (cursor < toMs && cursor < capMs) {
    if (isValidWorkMinute(new Date(cursor), hallHours)) count++
    cursor += 60_000
  }
  return count
}

/**
 * Given a start ISO timestamp and N work-minutes to consume, returns the
 * datetime when those N work-minutes will have elapsed (skipping off-hours,
 * weekends, and breaks).
 *
 * This is the formula for `effective_due_at`.
 *
 * @param startIso  - ISO string: when the work clock starts
 * @param workMinutes - Total estimated work minutes
 * @param hallHours - Hall office-hours config (defaults to standard PKT hours)
 * @returns UTC Date representing when the task will finish
 */
export function calculateEffectiveDueAt(
  startIso: string,
  workMinutes: number,
  hallHours: HallOfficeHours = DEFAULT_OFFICE_HOURS,
): Date {
  if (workMinutes <= 0) return new Date(startIso)

  let remaining = workMinutes
  // Start one minute AFTER startIso so the start minute itself is the 0-point
  let cursor    = new Date(startIso).getTime() + 60_000
  const maxMs   = cursor + 365 * 24 * 60 * 60_000   // 1-year safety cap

  while (remaining > 0 && cursor < maxMs) {
    if (isValidWorkMinute(new Date(cursor), hallHours)) remaining--
    if (remaining > 0) cursor += 60_000
  }

  return new Date(cursor)
}

/**
 * Real-time remaining work minutes for display in the UI.
 *
 * If task is active (activeStartedAt is set), subtracts the work minutes
 * that have elapsed since activation from the stored remaining count.
 * If not active, returns the stored value as-is.
 *
 * Never returns negative.
 */
export function getRealTimeRemainingMinutes(
  storedRemainingMinutes: number | null | undefined,
  activeStartedAt: string | null | undefined,
  hallHours: HallOfficeHours = DEFAULT_OFFICE_HOURS,
): number {
  const stored = storedRemainingMinutes ?? 0
  if (!activeStartedAt) return Math.max(0, stored)

  const elapsed = getWorkMinutesInRange(
    activeStartedAt,
    new Date().toISOString(),
    hallHours,
  )
  return Math.max(0, stored - elapsed)
}

/**
 * Formats a minute count as a concise human-readable string.
 * Examples: 90 → "1h 30m"  |  60 → "1h"  |  45 → "45m"  |  0 → "0m"
 */
export function formatWorkMinutes(minutes: number): string {
  if (minutes <= 0) return '0m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/**
 * Formats a minute count as "Xh Ym remaining" with urgency colour class.
 * Returns { text, colorClass } for use in UI badges.
 */
export function formatRemainingWithUrgency(minutes: number): {
  text: string
  colorClass: string
} {
  if (minutes <= 0)   return { text: 'Overdue',        colorClass: 'text-red-600' }
  if (minutes <= 30)  return { text: `${minutes}m left`, colorClass: 'text-red-500' }
  if (minutes <= 120) return { text: `${formatWorkMinutes(minutes)} left`, colorClass: 'text-amber-500' }
  return  { text: `${formatWorkMinutes(minutes)} left`, colorClass: 'text-green-600' }
}

/**
 * Checks whether the effective due date has passed.
 * Returns true when the task is overdue.
 */
export function isTaskOverdue(effectiveDueAt: string | null | undefined): boolean {
  if (!effectiveDueAt) return false
  return new Date(effectiveDueAt).getTime() < Date.now()
}
