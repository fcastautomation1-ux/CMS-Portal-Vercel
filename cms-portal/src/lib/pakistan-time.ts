export const PAKISTAN_TIMEZONE = 'Asia/Karachi'

// ─── Hall office-hours config ─────────────────────────────────────────────────
// All times are 'HH:MM' strings in PKT.
// Mon–Thu uses break_start / break_end.
// Friday uses friday_break_start / friday_break_end (Jumu'ah prayer — longer break).
export interface HallOfficeHours {
  office_start: string        // e.g. '09:00'
  office_end: string          // e.g. '18:00'
  break_start: string         // Mon–Thu, e.g. '13:00'
  break_end: string           // Mon–Thu, e.g. '14:00'
  friday_break_start: string  // e.g. '12:30'
  friday_break_end: string    // e.g. '14:30'
}

export const DEFAULT_OFFICE_HOURS: HallOfficeHours = {
  office_start: '09:00',
  office_end: '18:00',
  break_start: '13:00',
  break_end: '14:00',
  friday_break_start: '12:30',
  friday_break_end: '14:30',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getParts(date: Date, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PAKISTAN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...options,
  }).formatToParts(date)
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? ''
}

/** Returns total minutes since midnight for a HH:MM string */
function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Returns 0=Sun 1=Mon … 5=Fri 6=Sat in PKT */
function getPakistanWeekday(date: Date): number {
  const dayStr = new Intl.DateTimeFormat('en-US', {
    timeZone: PAKISTAN_TIMEZONE,
    weekday: 'short',
  }).format(date)
  const MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return MAP[dayStr] ?? 0
}

export function pakistanNowInputValue() {
  const parts = getParts(new Date(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return `${partValue(parts, 'year')}-${partValue(parts, 'month')}-${partValue(parts, 'day')}T${partValue(parts, 'hour')}:${partValue(parts, 'minute')}`
}

function buildInputValueFromDate(date: Date) {
  const parts = getParts(date, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${partValue(parts, 'year')}-${partValue(parts, 'month')}-${partValue(parts, 'day')}T${partValue(parts, 'hour')}:${partValue(parts, 'minute')}`
}

function getPakistanHourMinute(date: Date) {
  const parts = getParts(date, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return {
    hour: Number(partValue(parts, 'hour')),
    minute: Number(partValue(parts, 'minute')),
  }
}

/**
 * Returns true when `input` falls within office hours for the given hall config.
 * Weekends (Sat/Sun) are always outside office hours.
 * Friday uses the Jumu'ah break window; Mon–Thu use the standard break.
 */
export function isWithinPakistanOfficeHours(
  input: string | Date | null | undefined,
  hallHours?: HallOfficeHours,
): boolean {
  if (!input) return false
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return false

  const weekday = getPakistanWeekday(date)
  if (weekday === 0 || weekday === 6) return false   // Sun / Sat

  const hours = hallHours ?? DEFAULT_OFFICE_HOURS
  const isFriday = weekday === 5

  const { hour, minute } = getPakistanHourMinute(date)
  const totalMins = hour * 60 + minute

  const startMins = parseHHMM(hours.office_start)
  const endMins   = parseHHMM(hours.office_end)
  const brkStart  = parseHHMM(isFriday ? hours.friday_break_start : hours.break_start)
  const brkEnd    = parseHHMM(isFriday ? hours.friday_break_end   : hours.break_end)

  if (totalMins < startMins) return false
  if (totalMins >= endMins)  return false
  if (totalMins >= brkStart && totalMins < brkEnd) return false
  return true
}

/**
 * Returns an error string if the due date is invalid, or null if it's OK.
 * Pass `hallHours` to enforce a specific hall's schedule.
 */
export function validatePakistanOfficeDueDate(
  input: string | Date | null | undefined,
  hallHours?: HallOfficeHours,
): string | null {
  if (!input) return 'Due date is required.'
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return 'Invalid due date.'
  if (date.getTime() <= Date.now()) return 'Due date must be an upcoming Pakistan time.'
  if (!isWithinPakistanOfficeHours(date, hallHours)) {
    const hours = hallHours ?? DEFAULT_OFFICE_HOURS
    const isFriday = getPakistanWeekday(date) === 5
    const brkStart = isFriday ? hours.friday_break_start : hours.break_start
    const brkEnd   = isFriday ? hours.friday_break_end   : hours.break_end
    return `Due date must be within office hours (${hours.office_start}–${hours.office_end} PKT). Break: ${brkStart}–${brkEnd}.`
  }
  return null
}

/**
 * Returns the earliest datetime-local string that is inside office hours.
 * Pass `hallHours` to use a specific hall's schedule.
 * Scans ahead minute-by-minute up to 7 days.
 */
export function pakistanOfficeMinInputValue(hallHours?: HallOfficeHours): string {
  let cursor = new Date(Date.now() + 60_000)

  for (let i = 0; i < 60 * 24 * 7; i += 1) {
    if (isWithinPakistanOfficeHours(cursor, hallHours)) {
      return buildInputValueFromDate(cursor)
    }
    cursor = new Date(cursor.getTime() + 60_000)
  }

  return pakistanNowInputValue()
}

export function pakistanInputValue(value: string | Date | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = getParts(date, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return `${partValue(parts, 'year')}-${partValue(parts, 'month')}-${partValue(parts, 'day')}T${partValue(parts, 'hour')}:${partValue(parts, 'minute')}`
}

export function isPastPakistanDate(input: string | null | undefined) {
  if (!input) return false
  return new Date(input).getTime() < Date.now()
}

export function formatPakistanDate(value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PAKISTAN_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  }).format(date)
}

export function formatPakistanTime(value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PAKISTAN_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...options,
  }).format(date)
}

export function formatPakistanDateTime(value: string | Date | null | undefined) {
  if (!value) return '-'
  return `${formatPakistanDate(value)} at ${formatPakistanTime(value)} PKT`
}
