import type { Todo, TodoDetails, AssignmentChainEntry } from '@/types'

export interface NormalizedChainEntry {
  actor: string
  target: string
  role: string
  timestamp: string | null
  feedback: string
  originalIndex: number
}

export function normalizeAssignmentChain(task: Todo | TodoDetails): NormalizedChainEntry[] {
  const chain = task.assignment_chain || []
  if (!Array.isArray(chain)) return []
  
  const normalized: NormalizedChainEntry[] = []
  
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i] as any
    if (!entry) continue
    
    let actor = ''
    let target = ''
    let role = ''
    let timestamp: string | null = null
    let feedback = ''
    
    if (entry.next_user !== undefined) {
      // New format
      actor = String(entry.user || '').trim()
      target = String(entry.next_user || '').trim()
      role = String(entry.role || '').trim()
      timestamp = entry.assignedAt || null
      feedback = String(entry.feedback || '').trim()
    } else if (entry.action) {
      // Legacy format
      actor = String(entry.user || '').trim()
      role = String(entry.action || '').trim()
      timestamp = entry.timestamp || null
      feedback = String(entry.feedback || '').trim()
      
      if (role === 'assign_next') {
        const nextEntry = chain[i + 1] as any
        target = String(nextEntry?.user || task.assigned_to || '').trim()
      } else if (role === 'complete_final') {
        target = actor
      } else {
        target = String(task.assigned_to || '').trim()
      }
    } else {
      // unknown format, just preserve whatever we can
      actor = String(entry.user || '').trim()
      target = String(task.assigned_to || '').trim()
      timestamp = entry.assignedAt || entry.timestamp || null
      feedback = String(entry.feedback || '').trim()
    }
    
    if (!actor || !target) continue
    
    // Ignore pure self-assignments unless they signify a department step or are the final completion
    if (actor.toLowerCase() === target.toLowerCase() && role !== 'claimed_from_department' && role !== 'queued_department' && role !== 'complete_final') {
      continue
    }
    
    normalized.push({ actor, target, role, timestamp, feedback, originalIndex: i })
  }
  
  return normalized
}
