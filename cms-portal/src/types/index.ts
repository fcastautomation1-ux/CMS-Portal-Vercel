// ============================================================
// Database Types — mirrors Supabase schema
// ============================================================

export type UserRole = 'Admin' | 'Super Manager' | 'Manager' | 'Supervisor' | 'User'
export type AccountStatus = 'Pending' | 'Running' | 'Success' | 'Error'
export type DriveAccessLevel = 'none' | 'view' | 'upload' | 'full'

// ─── Session / Auth ──────────────────────────────────────────
export interface SessionUser {
  username: string
  role: UserRole
  department: string | null
  email: string
  avatarData: string | null
  allowedAccounts: string[]
  allowedCampaigns: string[]
  allowedDriveFolders: string[]
  allowedLookerReports: string[]
  moduleAccess: ModuleAccess | null
  teamMembers: string[]
  managerId: string | null
  driveAccessLevel: DriveAccessLevel
  themePreference?: 'light' | 'dark' | null
}

export interface ModuleAccess {
  googleAccount?: { enabled: boolean; accessLevel: 'all' | 'specific'; accounts?: string[] }
  campaigns?: { enabled: boolean; accessLevel: 'all' | 'specific' }
  users?: { enabled: boolean; departmentRestricted: boolean }
  drive?: { enabled: boolean }
  looker?: { enabled: boolean }
  todos?: { enabled: boolean }
  packages?: { enabled: boolean }
}

// ─── Accounts ────────────────────────────────────────────────
export interface Account {
  customer_id: string
  account_name?: string | null
  google_sheet_link: string | null
  drive_code_comments: string | null
  enabled: boolean
  status: AccountStatus
  last_run: string | null
  workflow: string
  created_date: string
}

export type AccountFormData = {
  customer_id: string
  account_name?: string
  google_sheet_link: string
  drive_code_comments: string
  workflow: string
  enabled: boolean
}

export interface AccountFile {
  id: string
  account_id: string
  file_name: string
  file_size: number | null
  mime_type: string | null
  storage_path: string
  uploaded_by: string
  created_at: string
  file_url?: string | null
}

// ─── Users ───────────────────────────────────────────────────
export interface User {
  username: string
  email: string
  role: UserRole
  department: string | null
  password_hash: string | null
  password_salt: string | null
  password: string | null
  allowed_accounts: string
  allowed_campaigns: string
  allowed_drive_folders: string
  allowed_looker_reports: string
  drive_access_level: DriveAccessLevel
  module_access: ModuleAccess | null
  manager_id: string | null
  team_members: string
  avatar_data: string | null
  last_login: string | null
  email_notifications_enabled: boolean
  created_at: string
  updated_at: string
}

// ─── Departments ─────────────────────────────────────────────
export interface Department {
  id: string
  name: string
  description?: string | null
  created_at: string
}

// ─── Notifications ───────────────────────────────────────────
export interface Notification {
  id: string
  user_id: string
  title: string
  // DB schema (old system): message / read / link / created_by
  message: string | null
  body: string | null          // alias kept for new inserts
  type: string | null
  link: string | null          // old-system navigation link
  related_id: string | null
  read: boolean                // old DB column
  is_read: boolean             // alias kept for compat
  created_by: string | null
  sender_avatar: string | null
  metadata: Record<string, unknown> | string | null
  created_at: string
}

// ─── Packages ────────────────────────────────────────────────
export interface Package {
  id: string
  name: string
  app_name?: string | null
  department?: string | null
  playconsole_account?: string | null
  marketer?: string | null
  product_owner?: string | null
  monetization?: string | null
  admob?: string | null
  description: string | null
  category: string | null
  price: number | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  assigned_users_count?: number
}

// ─── Looker Reports ──────────────────────────────────────────
export interface LookerReport {
  id: string
  title: string
  report_url: string
  allowed_users: string
  created_by: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

// ─── Tasks / Todos ───────────────────────────────────────────

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done'
export type ApprovalStatus = 'approved' | 'pending_approval' | 'declined'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskWorkflowState =
  | 'queued_department'
  | 'claimed_by_department'
  | 'reassigned'
  | 'in_progress'
  | 'split_to_multi'
  | 'multi_accepted'
  | 'submitted_for_approval'
  | 'rework_required'
  | 'final_approved'

export const KPI_TYPES = [
  'Monitizations',
  'Store Graphics',
  'Creative Graphic',
  'Andriod Vitls',
  'Bugs',
  'New Feature',
  'SDK Updates',
  'Data Analysis',
  'Others',
] as const

export type KpiType = typeof KPI_TYPES[number]

export interface HistoryEntry {
  type: string
  user: string
  details: string
  timestamp: string
  icon?: string
  title?: string
  from?: string
  to?: string
  changes?: string[]
  unread_by?: string[]
  read_by?: string[]
  message_id?: string
  mention_users?: string[]
  edited_at?: string
  deleted_at?: string
  is_deleted?: boolean
}

/**
 * Represents a single step in the task assignment chain.
 *
 * Supports BOTH formats:
 *  - New Next.js format: { user (assigner), role, assignedAt, next_user (assignee), feedback }
 *  - Legacy GAS format:  { user (assignee who acted), action, timestamp, level, status, review_status, feedback }
 *
 * Use `normalizeAssignmentChain()` from actions.ts to convert old → new format.
 */
export interface AssignmentChainEntry {
  /** In new format: person who assigned. In old GAS format: person who completed the action. */
  user: string

  // ── New Next.js format fields ─────────────────────────────────────────────
  /** New: role type ('assignee', 'manager', 'claimed_from_department', 'routed_to_department_queue') */
  role?: string
  /** New: ISO timestamp when this assignment step was created */
  assignedAt?: string
  /** New: the user this step points to (the assignee receiving the work) */
  next_user?: string
  /** Feedback/notes for this handoff step */
  feedback?: string

  // ── Legacy fields written by the old Google Apps Script app ──────────────
  /** Old GAS: the action performed (e.g. 'complete_final', 'assigned', 'submit') */
  action?: string
  /** Old GAS: ISO timestamp (functionally equivalent to assignedAt) */
  timestamp?: string
  /** Old GAS: sequential chain depth level */
  level?: number
  /** Old GAS: completion status recorded by the assignee ('completed', 'pending') */
  status?: string
  /** Old GAS: approval review status ('pending', 'approved', 'declined') */
  review_status?: string
}

export interface ApprovalChainEntry {
  user: string
  status: 'pending' | 'approved' | 'declined'
  step: number
  requested_at?: string
  acted_at?: string
  acted_by?: string
  comment?: string
}

export interface MultiAssignmentSubEntry {
  username: string
  status?: string              // pending | in_progress | completed | accepted | rejected
  completed_at?: string
  notes?: string               // feedback note when submitting
  delegation_instructions?: string
  delegated_to?: MultiAssignmentSubEntry[]
}

export interface MultiAssignmentEntry {
  username: string
  status?: string              // pending | in_progress | completed | accepted | rejected
  assigned_at?: string
  completed_at?: string
  accepted_at?: string
  accepted_by?: string
  rejection_reason?: string
  actual_due_date?: string
  notes?: string               // feedback note
  delegated_to?: MultiAssignmentSubEntry[]
}

export interface MultiAssignment {
  enabled: boolean
  assignees: MultiAssignmentEntry[]
  created_by?: string
  completion_percentage?: number
  all_completed?: boolean
}

export interface Todo {
  id: string
  username: string               // creator
  title: string
  description: string | null
  our_goal: string | null        // HTML rich text
  completed: boolean
  task_status: TaskStatus
  priority: TaskPriority
  category: string | null        // department
  kpi_type: string | null
  due_date: string | null
  expected_due_date: string | null
  actual_due_date: string | null
  notes: string | null
  package_name: string | null
  app_name: string | null
  position: number
  archived: boolean
  queue_department: string | null
  queue_status: string | null
  multi_assignment: MultiAssignment | null
  assigned_to: string | null
  manager_id: string | null
  completed_by: string | null
  completed_at: string | null
  approval_status: ApprovalStatus
  workflow_state?: TaskWorkflowState | null
  pending_approver?: string | null
  approval_chain?: ApprovalChainEntry[]
  approval_requested_at?: string | null
  approval_sla_due_at?: string | null
  last_handoff_at?: string | null
  approved_at: string | null
  approved_by: string | null
  declined_at: string | null
  declined_by: string | null
  decline_reason: string | null
  assignment_chain: AssignmentChainEntry[]
  history: HistoryEntry[]
  created_at: string
  updated_at: string
  // Virtual fields added by getTodos
  is_shared?: boolean
  is_assigned_to_me?: boolean
  is_completed_by_me?: boolean
  is_managed?: boolean
  is_team_task?: boolean
  is_chain_member?: boolean
  is_multi_assigned?: boolean
  is_delegated_to_me?: boolean
  is_department_queue?: boolean
  creator_department?: string | null
  assignee_department?: string | null
  participant_avatars?: Record<string, string | null>
}

export interface TodoShare {
  id: string
  todo_id: string
  shared_by: string
  shared_with: string
  can_edit: boolean
  created_at: string
  avatar_data?: string | null
}

export interface TodoAttachment {
  id: string
  todo_id: string
  file_name: string
  file_size: number | null
  mime_type: string | null
  file_url: string
  storage_path?: string | null
  drive_file_id: string | null
  uploaded_by: string
  created_at: string
}

export interface TodoDetails extends Todo {
  shares: TodoShare[]
  attachments: TodoAttachment[]
  current_user_can_edit: boolean
  current_user_share_can_edit: boolean
  participant_avatars?: Record<string, string | null>
}

export interface TodoStats {
  total: number
  completed: number
  pending: number
  overdue: number
  highPriority: number
  dueToday: number
  shared: number
}

export type TaskRouting = 'self' | 'department' | 'manager' | 'multi'

export interface CreateTodoInput {
  title: string
  description?: string
  our_goal?: string
  kpi_type: string
  package_name?: string
  app_name?: string
  priority: TaskPriority
  due_date?: string
  category?: string
  notes?: string
  routing: TaskRouting
  assigned_to?: string
  manager_id?: string
  queue_department?: string
  multi_assignment?: MultiAssignment
}

// ─── Workflows ───────────────────────────────────────────────
export interface Workflow {
  workflow_name: string
  enabled: boolean
  schedule: string | null
  last_run: string | null
  description: string | null
}

// ─── Rules (Removal Condition Definitions) ───────────────────
export interface Rule {
  id: string
  name: string
  description: string | null
}

// ─── Campaigns ───────────────────────────────────────────────
export interface Campaign {
  id?: string
  customer_id: string
  campaign_name: string
  removal_conditions: string | null
  workflow: string
  enabled: boolean
}

// ─── Role helpers ────────────────────────────────────────────
export const ROLE_LEVELS: Record<UserRole, number> = {
  Admin: 1,
  'Super Manager': 2,
  Manager: 3,
  Supervisor: 4,
  User: 5,
}

export function isManagerOrAbove(role: UserRole): boolean {
  return ROLE_LEVELS[role] <= 3
}

export function canManageAccounts(user: SessionUser): boolean {
  const { role } = user
  if (role === 'Admin' || role === 'Super Manager') return true
  if (role === 'Manager') {
    if (!user.moduleAccess?.googleAccount) return false
    return user.moduleAccess.googleAccount.enabled === true
  }
  return false
}

export function canViewAccounts(user: SessionUser): boolean {
  const { role } = user
  if (role === 'Admin' || role === 'Super Manager') return true
  if (role === 'Manager' || role === 'Supervisor') {
    if (!user.moduleAccess?.googleAccount) return false
    return user.moduleAccess.googleAccount.enabled === true
  }
  return true // User role — filtered by allowedAccounts
}
