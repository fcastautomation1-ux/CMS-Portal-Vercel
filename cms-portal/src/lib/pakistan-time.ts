export const PAKISTAN_TIMEZONE = 'Asia/Karachi'

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

export function pakistanNowInputValue() {
  const parts = getParts(new Date(), {
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
