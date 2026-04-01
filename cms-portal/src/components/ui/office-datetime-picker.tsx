'use client'

import React from 'react'
import { cn } from '@/lib/cn'

interface OfficeDateTimePickerProps {
  value: string                        // "YYYY-MM-DDTHH:MM" or ""
  onChange: (value: string) => void
  min?: string                         // "YYYY-MM-DDTHH:MM"
  disabled?: boolean
  className?: string
}

// Office hours: 09 – 17 (18:00 is the exclusive end so last valid hour is 17)
const OFFICE_HOURS = Array.from({ length: 9 }, (_, i) => 9 + i)   // [9, 10, … 17]
const MINUTES      = Array.from({ length: 60 }, (_, i) => i)       // [0, 1, … 59]

/** Returns true if the date string (YYYY-MM-DD) falls on a Saturday or Sunday */
function isWeekend(dateStr: string): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr + 'T12:00:00') // noon to avoid timezone boundary issues
  const day = d.getDay()
  return day === 0 || day === 6 // 0 = Sunday, 6 = Saturday
}

/** Advance a YYYY-MM-DD string to the next Monday if it's a weekend */
function skipToMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  if (day === 6) d.setDate(d.getDate() + 2) // Saturday → Monday
  if (day === 0) d.setDate(d.getDate() + 1) // Sunday → Monday
  return d.toISOString().slice(0, 10)
}

function parseDT(v: string): { datePart: string; hour: number; minute: number } {
  const [datePart = '', timePart = ''] = (v || '').split('T')
  const [hStr, mStr] = timePart.split(':')
  const hour   = Number.isNaN(Number(hStr)) ? 9  : Math.max(9,  Math.min(17, Number(hStr)))
  const minute = Number.isNaN(Number(mStr)) ? 0  : Math.max(0,  Math.min(59, Number(mStr)))
  return { datePart, hour, minute }
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function OfficeDateTimePicker({
  value,
  onChange,
  min,
  disabled,
  className,
}: OfficeDateTimePickerProps) {
  const { datePart, hour, minute } = parseDT(value)
  const { datePart: minDate, hour: minHour, minute: minMinute } = parseDT(min || '')

  const emit = (dp: string, h: number, m: number) => {
    if (!dp) return
    onChange(`${dp}T${pad(h)}:${pad(m)}`)
  }

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let nd = e.target.value
    // Skip over weekends — advance to Monday automatically
    if (isWeekend(nd)) nd = skipToMonday(nd)
    // When picking an earlier date keep the same hour, or clamp to minHour on min date
    const safeH = nd === minDate ? Math.max(hour, minHour) : hour || 9
    const safeM = nd === minDate && safeH === minHour ? Math.max(minute, minMinute) : minute
    emit(nd, safeH, safeM)
  }

  const handleHourChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nh = Number(e.target.value)
    // If we move to the min hour on the min date, clamp minutes
    const safeM = datePart === minDate && nh === minHour ? Math.max(minute, minMinute) : minute
    emit(datePart, nh, safeM)
  }

  const handleMinuteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    emit(datePart, hour, Number(e.target.value))
  }

  const selectCls = cn(
    'rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-sm text-slate-700',
    'outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  )

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {/* Date */}
      <input
        type="date"
        value={datePart}
        min={minDate || undefined}
        onChange={handleDateChange}
        disabled={disabled}
        className={cn(
          'flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700',
          'outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      />

      {/* Hour — 09 to 17 (24-h, no AM/PM) */}
      <select
        value={hour}
        onChange={handleHourChange}
        disabled={disabled}
        className={cn(selectCls, 'w-16')}
      >
        {OFFICE_HOURS.map((h) => {
          const tooEarly = datePart === minDate && h < minHour
          return (
            <option key={h} value={h} disabled={tooEarly}>
              {pad(h)}
            </option>
          )
        })}
      </select>

      <span className="select-none text-slate-400 font-medium">:</span>

      {/* Minute — 00 to 59 */}
      <select
        value={minute}
        onChange={handleMinuteChange}
        disabled={disabled}
        className={cn(selectCls, 'w-16')}
      >
        {MINUTES.map((m) => {
          const tooEarly = datePart === minDate && hour === minHour && m < minMinute
          return (
            <option key={m} value={m} disabled={tooEarly}>
              {pad(m)}
            </option>
          )
        })}
      </select>
    </div>
  )
}
