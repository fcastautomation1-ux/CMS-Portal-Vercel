'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Command, Plus, Home, Settings, LogOut, X, ArrowRight, User, Terminal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/cn'

interface CommandItem {
  id: string
  label: string
  icon: React.ReactNode
  action: () => void
  category: string
  shortcut?: string
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const router = useRouter()
  const listRef = useRef<HTMLDivElement>(null)

  const commands: CommandItem[] = [
    { id: 'home', label: 'Go to Dashboard', icon: <Home size={16} />, action: () => router.push('/dashboard'), category: 'Navigation', shortcut: 'G D' },
    { id: 'tasks', label: 'View Tasks', icon: <Terminal size={16} />, action: () => router.push('/dashboard/tasks'), category: 'Navigation', shortcut: 'G T' },
    { id: 'create-task', label: 'Create New Task', icon: <Plus size={16} />, action: () => { setIsOpen(false); /* Trigger dashboard create modal if possible */ }, category: 'Actions', shortcut: 'C T' },
    { id: 'profile', label: 'Profile Settings', icon: <User size={16} />, action: () => router.push('/dashboard/profile'), category: 'Account' },
    { id: 'logout', label: 'Logout', icon: <LogOut size={16} />, action: () => router.push('/logout'), category: 'Account' },
  ]

  const filteredCommands = commands.filter(cmd => 
    cmd.label.toLowerCase().includes(search.toLowerCase()) || 
    cmd.category.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(prev => !prev)
      }
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => (prev + 1) % filteredCommands.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length)
    } else if (e.key === 'Enter') {
      filteredCommands[selectedIndex]?.action()
      setIsOpen(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-md"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200/50 bg-white/95 shadow-[0_32px_128px_-16px_rgba(0,0,0,0.3)] backdrop-blur-xl"
            onKeyDown={handleKeyDown}
          >
            {/* Search Bar */}
            <div className="flex items-center border-b border-slate-100 px-5 py-4">
              <Search className="mr-3 text-slate-400" size={20} />
              <input
                autoFocus
                type="text"
                placeholder="Search tasks, actions or navigate..."
                className="w-full bg-transparent text-lg text-slate-800 outline-none placeholder:text-slate-400"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setSelectedIndex(0)
                }}
              />
              <div className="ml-3 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-400">
                <Command size={10} />
                <span>K</span>
              </div>
            </div>

            {/* Content Area */}
            <div 
              ref={listRef}
              className="max-h-[60vh] overflow-y-auto p-2"
            >
              {filteredCommands.length > 0 ? (
                <div className="space-y-1">
                  {/* Grouped commands rendering */}
                  {Array.from(new Set(filteredCommands.map(c => c.category))).map(category => (
                    <div key={category} className="mb-4 last:mb-0">
                      <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        {category}
                      </div>
                      <div className="space-y-0.5">
                        {filteredCommands
                          .filter(c => c.category === category)
                          .map((cmd, idx) => {
                            const absoluteIndex = filteredCommands.indexOf(cmd)
                            const isSelected = absoluteIndex === selectedIndex
                            
                            return (
                              <button
                                key={cmd.id}
                                onClick={() => {
                                  cmd.action()
                                  setIsOpen(false)
                                }}
                                onMouseEnter={() => setSelectedIndex(absoluteIndex)}
                                className={cn(
                                  'flex w-full items-center gap-3 rounded-xl px-3 py-3 transition-all duration-150',
                                  isSelected 
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 ring-2 ring-blue-500 ring-offset-1' 
                                    : 'text-slate-600 hover:bg-slate-50'
                                )}
                              >
                                <div className={cn(
                                  'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                                  isSelected ? 'bg-white/20' : 'bg-slate-100 text-slate-400'
                                )}>
                                  {cmd.icon}
                                </div>
                                <span className={cn('flex-1 text-left text-sm font-semibold', isSelected ? 'text-white' : 'text-slate-700')}>
                                  {cmd.label}
                                </span>
                                {cmd.shortcut && (
                                  <div className={cn(
                                    'text-[10px] font-bold tracking-widest opacity-60',
                                    isSelected ? 'text-white' : 'text-slate-400'
                                  )}>
                                    {cmd.shortcut}
                                  </div>
                                )}
                                <ArrowRight className={cn('transition-transform duration-200', isSelected ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0')} size={14} />
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="rounded-full bg-slate-50 p-4 mb-4">
                    <Search className="text-slate-300" size={32} />
                  </div>
                  <p className="text-slate-400 font-medium">No results for "{search}"</p>
                  <p className="text-xs text-slate-300 mt-1">Try another keyword or navigation command.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-[11px] text-slate-400">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5"><ArrowRight size={10} className="rotate-90"/> Select</span>
                <span className="flex items-center gap-1.5"><ArrowRight size={10} className="rotate-180"/> Navigate</span>
                <span className="flex items-center gap-1.5"><kbd className="bg-slate-200 px-1 rounded">esc</kbd> Close</span>
              </div>
              <div className="italic font-medium">Powered by Antigravity</div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
