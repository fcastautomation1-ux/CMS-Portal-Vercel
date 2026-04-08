'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

export type DropdownOption = {
  value: string
  label: string
  count?: number
}

interface BaseProps {
  label: string
  options: DropdownOption[]
  placeholder?: string
  className?: string
  panelAlign?: 'left' | 'right'
}

interface MultiSelectProps extends BaseProps {
  selectedValues: string[]
  onChange: (next: string[]) => void
}

interface SingleSelectProps extends BaseProps {
  selectedValue: string
  onChange: (next: string) => void
}

function useOutsideClick<T extends HTMLElement>(
  ref: React.RefObject<T>,
  onOutside: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (ref.current && target && !ref.current.contains(target)) {
        onOutside()
      }
    }

    window.addEventListener('mousedown', handleMouseDown)
    return () => window.removeEventListener('mousedown', handleMouseDown)
  }, [active, onOutside, ref])
}

function DropdownShell({
  label,
  summary,
  open,
  onToggle,
  className,
  children,
}: {
  label: string
  summary: string
  open: boolean
  onToggle: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left transition-all',
          'bg-white hover:border-blue-300 hover:shadow-sm',
          open ? 'border-blue-500 shadow-[0_0_0_3px_rgba(43,127,255,0.08)]' : 'border-[var(--color-border)]',
        )}
        style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}
      >
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {summary}
          </p>
        </div>
        <ChevronDown size={15} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {children}
    </div>
  )
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

function OptionListItem({
  label,
  selected,
  count,
  onClick,
  multi,
}: {
  label: string
  selected: boolean
  count?: number
  onClick: () => void
  multi: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
        selected ? 'bg-blue-50/80' : 'hover:bg-slate-50',
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center border',
          multi ? 'rounded border' : 'rounded-full',
          selected ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300 bg-white text-transparent',
        )}
      >
        {multi ? (
          <Check size={11} />
        ) : selected ? (
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium" style={{ color: 'var(--color-text)' }}>
        {label}
      </span>
      {typeof count === 'number' && (
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
          {count}
        </span>
      )}
    </button>
  )
}

export function SearchableMultiSelectDropdown({
  label,
  options,
  selectedValues,
  onChange,
  placeholder = 'All',
  className,
  panelAlign = 'left',
}: MultiSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  useOutsideClick(rootRef, () => setOpen(false), open)

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((option) => option.label.toLowerCase().includes(q))
  }, [options, search])

  const selectedCount = selectedValues.length
  const firstSelectedLabel = selectedCount > 0
    ? options.find((option) => option.value === selectedValues[0])?.label
    : null

  const summary = selectedCount === 0
    ? placeholder
    : selectedCount === 1
      ? firstSelectedLabel ?? placeholder
      : `${firstSelectedLabel ?? 'Selected'} +${selectedCount - 1}`

  const toggleValue = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter((current) => current !== value))
    } else {
      onChange([...selectedValues, value])
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <DropdownShell
        label={label}
        summary={summary}
        open={open}
        onToggle={() => setOpen((current) => !current)}
      >
        {open && (
          <div className={cn('absolute top-[calc(100%+0.5rem)] z-30 w-[320px] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_18px_50px_rgba(15,23,42,0.14)]', panelAlign === 'right' ? 'right-0' : 'left-0')}>
            <SearchField value={search} onChange={setSearch} placeholder={`Search ${label.toLowerCase()}...`} />
            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              <span>{selectedCount} selected</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => onChange(options.map((option) => option.value))} className="text-blue-600 hover:text-blue-700">
                  Select All
                </button>
                <button type="button" onClick={() => onChange([])} className="text-slate-500 hover:text-slate-700">
                  Clear
                </button>
              </div>
            </div>
            <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
                  <OptionListItem
                    key={option.value}
                    label={option.label}
                    selected={selectedValues.includes(option.value)}
                    count={option.count}
                    onClick={() => toggleValue(option.value)}
                    multi
                  />
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">
                  No matches found
                </div>
              )}
            </div>
          </div>
        )}
      </DropdownShell>
    </div>
  )
}

export function SearchableSingleSelectDropdown({
  label,
  options,
  selectedValue,
  onChange,
  placeholder = 'All',
  className,
  panelAlign = 'left',
}: SingleSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  useOutsideClick(rootRef, () => setOpen(false), open)

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((option) => option.label.toLowerCase().includes(q))
  }, [options, search])

  const selectedLabel = options.find((option) => option.value === selectedValue)?.label ?? placeholder

  const selectValue = (value: string) => {
    onChange(value)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <DropdownShell
        label={label}
        summary={selectedLabel}
        open={open}
        onToggle={() => setOpen((current) => !current)}
      >
        {open && (
          <div className={cn('absolute top-[calc(100%+0.5rem)] z-30 w-[320px] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_18px_50px_rgba(15,23,42,0.14)]', panelAlign === 'right' ? 'right-0' : 'left-0')}>
            <SearchField value={search} onChange={setSearch} placeholder={`Search ${label.toLowerCase()}...`} />
            <div className="mt-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              <span>Choose one</span>
              <button type="button" onClick={() => selectValue('')} className="text-slate-500 hover:text-slate-700">
                Clear
              </button>
            </div>
            <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
                  <OptionListItem
                    key={option.value}
                    label={option.label}
                    selected={selectedValue === option.value}
                    count={option.count}
                    onClick={() => selectValue(option.value)}
                    multi={false}
                  />
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">
                  No matches found
                </div>
              )}
            </div>
          </div>
        )}
      </DropdownShell>
    </div>
  )
}
