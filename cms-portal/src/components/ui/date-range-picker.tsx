'use client'

import React, { useState, useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Calendar as CalendarIcon, RefreshCw } from 'lucide-react'
import { DayPicker, DateRange } from 'react-day-picker'
import { format, subDays, startOfMonth, startOfToday, isValid } from 'date-fns'
import 'react-day-picker/dist/style.css'
import { cn } from '@/lib/cn'

interface DateRangePickerProps {
  from?: string
  to?: string
  onFromChange: (val: string) => void
  onToChange: (val: string) => void
  onClear: () => void
}

const PRESETS = [
  { label: 'Today', getValue: () => ({ from: startOfToday(), to: startOfToday() }) },
  { label: 'Last 7 Days', getValue: () => ({ from: subDays(startOfToday(), 6), to: startOfToday() }) },
  { label: 'This Month', getValue: () => ({ from: startOfMonth(startOfToday()), to: startOfToday() }) },
  { label: 'Custom', getValue: () => undefined },
]

export function DateRangePicker({ from, to, onFromChange, onToChange, onClear }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)

  // Internal state for range
  const [range, setRange] = useState<DateRange | undefined>(() => {
    return {
      from: from && isValid(new Date(from)) ? new Date(from) : undefined,
      to: to && isValid(new Date(to)) ? new Date(to) : undefined,
    }
  })

  useEffect(() => {
    setRange({
      from: from && isValid(new Date(from)) ? new Date(from) : undefined,
      to: to && isValid(new Date(to)) ? new Date(to) : undefined,
    })
  }, [from, to])

  const [activePreset, setActivePreset] = useState<string>('Custom')

  useEffect(() => {
    if (!range?.from && !range?.to) setActivePreset('Custom')
  }, [range])

  const handleApply = () => {
    if (range?.from) onFromChange(format(range.from, 'yyyy-MM-dd'))
    else onClear()

    if (range?.to) onToChange(format(range.to, 'yyyy-MM-dd'))

    setOpen(false)
  }

  const formatDisplay = () => {
    if (range?.from && range?.to) {
      if (range.from.getTime() === range.to.getTime()) {
        return format(range.from, 'MMM dd, yyyy')
      }
      return `${format(range.from, 'MMM dd, yyyy')} - ${format(range.to, 'MMM dd, yyyy')}`
    }
    if (range?.from) return `${format(range.from, 'MMM dd, yyyy')} - ...`
    if (from || to) {
      if (from && to && from === to) return format(new Date(from), 'MMM dd, yyyy')
      if (from && to) return `${format(new Date(from), 'MMM dd, yyyy')} - ${format(new Date(to), 'MMM dd, yyyy')}`
      if (from) return `${format(new Date(from), 'MMM dd, yyyy')} - ...`
    }
    return 'Select dates...'
  }

  return (
    <div className="flex items-center gap-2">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            className={cn(
              "flex h-9 w-[260px] items-center gap-2 rounded-lg border px-3 text-xs outline-none transition-colors",
              (range?.from || from) ? "border-[#2B7FFF] bg-[rgba(43,127,255,0.04)] text-[var(--color-text)]" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]"
            )}
            title="Select date range"
          >
            <CalendarIcon size={14} className={range?.from ? "text-[#2B7FFF]" : "text-slate-400"} />
            <span className="flex-1 text-left font-medium">
              {formatDisplay()}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="z-50 mt-1 rounded-xl border bg-white p-3 shadow-lg outline-none max-w-[100vw] overflow-y-auto"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            align="end"
            sideOffset={4}
          >
            <div className="flex flex-col gap-3">
              {/* Presets */}
              <div className="flex items-center gap-1.5 border-b pb-3" style={{ borderColor: 'var(--color-border)' }}>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      setActivePreset(preset.label)
                      const val = preset.getValue()
                      if (val) setRange(val)
                    }}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                      activePreset === preset.label
                        ? "bg-[#2B7FFF] text-white shadow-sm"
                        : "bg-[rgba(100,116,139,0.05)] text-[var(--color-text-muted)] hover:bg-[rgba(100,116,139,0.1)]"
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="flex w-full items-start justify-center">
                <DayPicker
                  mode="range"
                  defaultMonth={range?.from}
                  selected={range}
                  onSelect={(r) => {
                    setRange(r)
                    setActivePreset('Custom')
                  }}
                  numberOfMonths={2}
                  showOutsideDays={false}
                  className="!m-0 border-none"
                  classNames={{
                    months: 'flex flex-row space-x-4',
                    month: 'space-y-4',
                    caption: 'flex justify-center pt-1 relative items-center',
                    caption_label: 'text-sm font-semibold',
                    nav: 'space-x-1 flex items-center',
                    nav_button: 'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 flex items-center justify-center rounded-md border',
                    nav_button_previous: 'absolute left-1',
                    nav_button_next: 'absolute right-1',
                    table: 'w-full border-collapse space-y-1',
                    head_row: 'flex',
                    head_cell: 'text-slate-500 rounded-md w-8 font-normal text-[0.8rem]',
                    row: 'flex w-full mt-2',
                    cell: 'text-center text-sm p-0 relative [&:has([aria-selected])]:bg-[rgba(43,127,255,0.1)] first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20',
                    day: 'h-8 w-8 p-0 font-normal rounded-md aria-selected:opacity-100 hover:bg-slate-100',
                    day_range_start: 'day-range-start bg-[#2B7FFF] text-white hover:bg-[#2B7FFF] hover:text-white',
                    day_range_end: 'day-range-end bg-[#2B7FFF] text-white hover:bg-[#2B7FFF] hover:text-white',
                    day_selected: 'bg-[rgba(43,127,255,0.1)] text-[#2B7FFF]',
                    day_today: 'bg-slate-100 text-slate-900',
                    day_outside: 'text-slate-400 opacity-50',
                    day_disabled: 'text-slate-400 opacity-50',
                    day_range_middle: 'aria-selected:bg-[rgba(43,127,255,0.1)] aria-selected:text-[#2B7FFF]',
                    day_hidden: 'invisible',
                  }}
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t mt-1" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-xs text-[var(--color-text-muted)] font-medium px-1">
                  {range?.from ? (
                    range.to ? (
                      `${format(range.from, 'MMM d, yyyy')} to ${format(range.to, 'MMM d, yyyy')}`
                    ) : (
                      `${format(range.from, 'MMM d, yyyy')} to ...`
                    )
                  ) : "Pick dates"}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setRange(undefined)
                      setActivePreset('Custom')
                    }}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 transition-colors"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleApply}
                    className="rounded-lg bg-[#2B7FFF] px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#1f6cef] transition-colors"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {(from || to) && (
        <button
          onClick={onClear}
          title="Reset filter"
          className="shrink-0 flex items-center justify-center h-9 w-9 rounded-lg border transition-colors hover:bg-slate-50"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)', background: 'var(--color-surface)' }}
        >
          <RefreshCw size={13} />
        </button>
      )}
    </div>
  )
}
