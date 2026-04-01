'use client'

import React from 'react'
import { cn } from '@/lib/cn'

interface TimeSelectPickerProps {
  value: string                        // "HH:MM"
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}

const HOURS   = Array.from({ length: 10 }, (_, i) => 9 + i)  // 9–18
const MINUTES = Array.from({ length: 60 }, (_, i) => i)       // 0–59

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function parseTime(v: string): { hour: number; minute: number } {
  const [hStr, mStr] = (v || '').split(':')
  const hour   = Number.isNaN(Number(hStr)) ? 9 : Math.max(9, Math.min(18, Number(hStr)))
  const minute = Number.isNaN(Number(mStr)) ? 0 : Math.max(0, Math.min(59, Number(mStr)))
  return { hour, minute }
}

export function TimeSelectPicker({ value, onChange, disabled, className, style }: TimeSelectPickerProps) {
  const { hour, minute } = parseTime(value)

  const selectCls = cn(
    'rounded-lg px-2 py-1.5 text-sm outline-none transition',
    'focus:ring-2 focus:ring-blue-100 focus:border-blue-400',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  )

  return (
    <div className={cn('flex items-center gap-1', className)} style={style}>
      <select
        value={hour}
        onChange={(e) => onChange(`${pad(Number(e.target.value))}:${pad(minute)}`)}
        disabled={disabled}
        className={cn(selectCls, 'flex-1')}
        style={style}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>{pad(h)}</option>
        ))}
      </select>
      <span className="select-none text-slate-400 font-medium text-sm">:</span>
      <select
        value={minute}
        onChange={(e) => onChange(`${pad(hour)}:${pad(Number(e.target.value))}`)}
        disabled={disabled}
        className={cn(selectCls, 'flex-1')}
        style={style}
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>{pad(m)}</option>
        ))}
      </select>
    </div>
  )
}
