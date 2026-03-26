# Tasks Sidebar Section - Complete Exploration

## Overview
The Tasks management system uses a role-based filtering architecture with multiple scopes (quick filters) and status filters, combined with queue-based task assignment for department routing.

---

## 1. WHERE TASK FILTER TABS ARE RENDERED

### Primary Components
- **[src/components/tasks/tasks-board.tsx](src/components/tasks/tasks-board.tsx)** (Line 500-600): Main rendering component
  - Renders KPI stat cards (Total, Completed, Pending, Overdue) that act as clickable filters
  - Renders scope dropdown selector for changing task scope
  - Renders status filter via URL parameters

### Filter Rendering Locations

#### KPI Cards (Lines 507-545)
```tsx
// 4 clickable cards: Total Task, Completed Task, Pending, Overdue
[
  { label: 'Total Task', value, kpiKey: 'total' },
  { label: 'Completed Task', value, kpiKey: 'completed' },
  { label: 'Pending', value, kpiKey: 'pending' },
  { label: 'Overdue', value, kpiKey: 'overdue' },
]
```
- **File**: [src/components/tasks/tasks-board.tsx](src/components/tasks/tasks-board.tsx#L507-L545)
- **Triggering Function**: `applyKpiFilter(key)` at line 201
- **Data Source**: `scopedKpiStats` (computed from filtered tasks)

#### Scope Dropdown (Lines 553-600)
```tsx
// Button: "Assign to me tasks" or "My Created task" or "My Tasks"
// Dropdown Options:
// - Assign to me tasks (count)
// - My Created task (count)
```
- **File**: [src/components/tasks/tasks-board.tsx](src/components/tasks/tasks-board.tsx#L553-L600)
- **Default Scope**: `assigned_to_me`
- **URL Parameter**: `?scope=<value>&status=<value>`

#### Tab Types (Quick Filters)
The tabs work with these scopes:
- `my_all` - All tasks (created, assigned, completed, queue)
- `created_by_me` - Tasks I created
- `assigned_to_me` - Tasks assigned to me + queued department tasks
- `my_pending` - Tasks I'm currently working on (not completed/overdue)
- `assigned_by_me` - Tasks I created and assigned to others
- `my_approval` - Tasks awaiting my approval
- `other_approval` - Tasks I can see that need approval

---

## 2. HOW FILTERING WORKS (Based on task_status field)

### Task Status Field Values
- `backlog` - Pending, not started
- `todo` - Acknowledged, in backlog
- `in_progress` - Actively being worked on
- `done` - Completed

### Status Filter Values
- `all` - Show all statuses
- `pending` - Not completed, not overdue (`!completed && task_status !== 'done' && !isOverdue`)
- `completed` - Marked complete or `task_status === 'done'`
- `overdue` - Not completed and due date passed

### Filtering Logic

**File**: [src/components/tasks/tasks-board.tsx](src/components/tasks/tasks-board.tsx#L385-L430)

```typescript
const filteredTasks = useMemo(() => {
  const now = new Date()
  let list = [...tasks]
  
  // 1. Apply Quick Filter (scope)
  if (quickFilter === 'created_by_me') {
    list = list.filter(t => t.username === userLower)
  } else if (quickFilter === 'assigned_to_me') {
    list = list.filter(t => 
      isTaskAssignedByOthersToUser(t) || isQueuedTaskForDepartmentUser(t)
    )
  } else if (quickFilter === 'my_pending') {
    // Tasks I'm actively working on
    list = list.filter(t => {
      if (t.completed || t.archived) return false
      if (isTaskAssignedToUser(t)) return true
      if (t.username === userLower && !t.assigned_to) return true
      // ... multi-assignment logic
      return isQueuedTaskForDepartmentUser(t)
    })
  }
  // ... other scopes
  
  // 2. Apply Search
  if (search.trim()) {
    list = list.filter(t =>
      t.title.includes(search) ||
      t.package_name?.includes(search) ||
      t.app_name?.includes(search) ||
      t.assigned_to?.includes(search) ||
      t.username.includes(search)
    )
  }
  
  // 3. Apply Status Filter
  if (statusFilter !== 'all') {
    list = list.filter(t => {
      if (statusFilter === 'pending') {
        return !t.completed && t.task_status !== 'done' 
          && !(t.due_date && new Date(t.due_date) < now)
          && !t.archived
      }
      if (statusFilter === 'completed') {
        return t.completed || t.task_status === 'done'
      }
      if (statusFilter === 'overdue') {
        return !t.completed && t.due_date && new Date(t.due_date) < now
      }
    })
  }
  
  // 4. Apply Sort
  list.sort(...)
  return list
}, [tasks, quickFilter, search, statusFilter, ...])
```

---

## 3. HOW USER ROLES AFFECT TASK VISIBILITY

### Role-Based Filtering in getTodos()

**File**: [src/app/dashboard/tasks/actions.ts](src/app/dashboard/tasks/actions.ts#L600-L750)

#### Admin / Super Manager Role
```typescript
if (isAdminOrSM) {
  // Can see ALL tasks in system
  const { data } = await supabase
    .from('todos')
    .select(TASK_LIST_SELECT)
    .eq('archived', false)
  // Returns all non-archived tasks
}
```

#### Regular User / Manager / Supervisor Role
For non-admin users, tasks are fetched from multiple queries:

1. **Owned Tasks** (Line 650)
   - Tasks created by the user (`username = current_user`)

2. **Assigned Tasks** (Line 651)
   - Tasks assigned directly to user (`assigned_to = current_user`)

3. **Completed By Me** (Line 652)
   - Tasks the user completed (`completed_by = current_user`)

4. **Pending Approver** (Line 653)
   - Tasks awaiting user's approval (`pending_approver = current_user`)

5. **Department Queue Tasks** (Lines 654-659)
   - Tasks in queue (`queue_status = 'queued'`, `assigned_to IS NULL`)
   - **Only if user's department matches** `queue_department`

6. **Managed Tasks** (Lines 662-668)
   - Tasks where user is in `manager_id` field
   - Split by comma: `manager_id LIKE '%username%'`

7. **Team Tasks** (Lines 671-679)
   - Tasks created by team members
   - Tasks assigned to team members
   - Team membership determined by:
     - `u.manager_id` contains current user
     - OR `user.team_members` CSV contains team member

8. **Shared Tasks** (Lines 682-688)
   - Tasks shared via `todo_shares` table

9. **Multi-Assignment Tasks** (Lines 691-705)
   - Tasks where user is in `multi_assignment.assignees[]`
   - OR delegated to user via `delegated_to[]`

### Department-Based Queue Filtering

**File**: [src/app/dashboard/tasks/actions.ts](src/app/dashboard/tasks/actions.ts#L654-L668)

```typescript
const userDeptKeys = splitDepartmentsCsv(user.department)
  .map((dept) => canonicalDepartmentKey(dept))
  .filter(Boolean)

// Fetch queued tasks for user's departments
const { data: deptQueueRes } = user.department
  ? supabase
      .from('todos')
      .select(TASK_LIST_SELECT)
      .eq('queue_status', 'queued')
      .or('assigned_to.is.null,assigned_to.eq.')
  : Promise.resolve({ data: [] })

// Filter by department match
deptQueueRes.data?.forEach((r) => {
  const queueDept = String(r.queue_department || '')
  const queueDeptKey = canonicalDepartmentKey(queueDept)
  if (userDeptKeys.length === 0 || 
      (queueDeptKey && userDeptKeys.includes(queueDeptKey))) {
    addTask(r, { is_department_queue: true })
  }
})
```

### Team Member Detection

**File**: [src/app/dashboard/tasks/actions.ts](src/app/dashboard/tasks/actions.ts#L624-L642)

```typescript
// Team = Direct reports + explicit team_members list
const myTeamUsernames: string[] = []

// Find users who report to me
allUsers.forEach((u) => {
  const managers = String(u.manager_id).split(',')
    .map(m => m.trim().toLowerCase())
  if (managers.includes(user.username.toLowerCase())) {
    myTeamUsernames.push(String(u.username))
  }
})

// Add explicit team members
const explicitTeam = String(myRow?.team_members || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
myTeamUsernames.push(...explicitTeam)
```

---

## 4. QUEUE TASKS: STORAGE, FETCHING, AND FILTERING

### Queue Task Data Structure

**Database Table**: `todos`

Key Fields for Queuing:
```typescript
queue_status: 'queued' | 'claimed' | 'auto_assigned' | null
queue_department: string | null  // Target department name
assigned_to: string | null       // Claim: who picked it up
task_status: 'backlog' | 'todo' | 'in_progress' | 'done'
```

### Queue Task Storage

Queue tasks are created via **[sendTaskToDepartmentQueueAction](src/app/dashboard/tasks/actions.ts#L2906)**

**File**: [src/components/tasks/create-task-modal.tsx](src/components/tasks/create-task-modal.tsx#L147)

```typescript
if (editTask.queue_status === 'queued') return 'department'
// When routing task:
queue_department: routing === 'department' ? deptRoutingDept : undefined
```

### Queue Task Fetching

**Client-Side Detection**:

**File**: [src/components/tasks/tasks-board.tsx](src/components/tasks/tasks-board.tsx#L251-L266)

```typescript
const isQueuedTaskForDepartmentUser = useCallback(
  (task: Todo, username: string) => {
    if (username.toLowerCase() != currentUsername.toLowerCase()) return false
    if (task.queue_status !== 'queued') return false
    if (task.assigned_to && task.assigned_to.trim() !== '') return false
    
    const rawDept = currentUserDept ?? null
    if (!rawDept) return false
    
    const queueDeptKey = canonicalDepartmentKey(task.queue_department || '')
    if (!queueDeptKey) return false
    
    return splitDepartmentsCsv(rawDept)
      .map(d => canonicalDepartmentKey(d))
      .some(d => !!d && d === queueDeptKey)
  },
  [currentUserDept, currentUsername]
)
```

### Queue Task Filtering in Scopes

**File**: [src/components/tasks/tasks-board.tsx](src/components/tasks/tasks-board.tsx#L313-L343)

```typescript
if (quickFilter === 'assigned_to_me') {
  // Include queue tasks for user's department
  list = list.filter(t => 
    !t.archived && 
    (isTaskAssignedByOthersToUser(t, effectiveUser) || 
     isQueuedTaskForDepartmentUser(t, effectiveUser))
  )
}

if (quickFilter === 'my_pending') {
  // Include queue tasks
  return isQueuedTaskForDepartmentUser(t, effectiveUser)
}

if (quickFilter === 'my_all') {
  // Include queue tasks
  return isQueuedTaskForDepartmentUser(t, effectiveUser)
}
```

---

## 5. QUEUE ASSIGNMENT STRUCTURE

### Queue Action Types

**File**: [src/app/dashboard/tasks/actions.ts](src/app/dashboard/tasks/actions.ts) - Three main queue actions:

#### A. Claim Queued Task (Individual Pickup)

**Function**: [claimQueuedTaskAction](src/app/dashboard/tasks/actions.ts#L2660)

**When**: User from correct department picks task from queue
**Permissions**: Any user in matching department

**Changes**:
```typescript
{
  assigned_to: current_user,
  queue_status: 'claimed',
  task_status: 'todo',
  workflow_state: 'claimed_by_department',
  assignment_chain.push({
    user: current_user,
    role: 'claimed_from_department',
    assignedAt: now,
  })
}
```

**UI Component**: [src/components/tasks/task-card.tsx](src/components/tasks/task-card.tsx#L1020) - Show "Pick Task" button

---

#### B. Assign Queued Task to Team Member (Manager Assignment)

**Function**: [assignQueuedTaskToTeamMemberAction](src/app/dashboard/tasks/actions.ts#L2728)

**When**: Manager/Supervisor assigns department queue task to team member
**Permissions**: User must be manager of target team member

**Logic**:
```typescript
// 1. Check if assigner is manager of team member
const managedTeam = await getManagedTeamUsernames(supabase, user)
if (!managedTeam.includes(toUsername)) {
  return { error: 'You can only assign to your team members' }
}

// 2. Check department match
const taskDept = canonicalDepartmentKey(task.queue_department)
const userDepts = splitDepartmentsCsv(user.department)
if (!userDepts.includes(taskDept)) {
  return { error: 'Different department' }
}

// 3. Assign
{
  assigned_to: toUsername,
  manager_id: current_user,  // Assigner becomes manager
  queue_status: 'claimed',
  workflow_state: 'assigned_from_department_queue',
  assignment_chain.push({
    user: current_user,
    role: 'assigned_from_department_queue',
    assignedAt: now,
    next_user: toUsername,
  })
}
```

**UI Component**: [src/components/tasks/task-card.tsx](src/components/tasks/task-card.tsx#L1045) - "Assign to Team" button

---

#### C. Send Task to Department Queue

**Function**: [sendTaskToDepartmentQueueAction](src/app/dashboard/tasks/actions.ts#L2906)

**When**: Creator/Current assignee/Admin routes task to department queue
**Permissions**: Creator OR current assignee OR Admin/Super Manager

**Workflow**:
```typescript
// 1. Check permissions
const isCreator = task.username === user.username
const isCurrentAssignee = task.assigned_to === user.username
const isAdmin = ['Admin', 'Super Manager'].includes(user.role)
if (!isCreator && !isCurrentAssignee && !isAdmin) {
  return { error: 'Permission denied' }
}

// 2. Attempt auto-assignment via package ownership
const autoRoute = await resolvePackageAutoAssignment(
  supabase,
  task.package_name,
  targetDepartment
)

// 3a. If single auto-route: Direct assignment
if (autoRoute.type === 'single') {
  {
    assigned_to: autoRoute.username,
    queue_status: 'auto_assigned',
    workflow_state: 'claimed_by_department',
  }
}

// 3b. If multi auto-route: Multi-assignment
if (autoRoute.type === 'multi') {
  {
    multi_assignment: { enabled: true, assignees: [...] },
    queue_status: 'multi_assigned',
  }
}

// 3c. If no auto-route: Queue only
{
  queue_department: targetDepartment,
  queue_status: 'queued',
  assigned_to: null,
  workflow_state: 'queued_to_department',
}
```

**UI Component**: [src/components/tasks/task-handoff-dialog.tsx](src/components/tasks/task-handoff-dialog.tsx#L160-L195)

---

### Queue Task Chain in Assignment_Chain

**File**: [src/components/tasks/task-card.tsx](src/components/tasks/task-card.tsx#L289)

```typescript
const isDepartmentStep = [
  'routed_to_department_queue',
  'queued_department',
  'claimed_from_department',
  'assigned_from_department_queue',
  'auto_assigned_by_package'
].includes(String(entry.role || ''))

// Rendered in "Queue Task Chain" section of task card
```

---

## Summary File Paths and Key Implementation Patterns

| Aspect | File Path | Line Range |
|--------|-----------|-----------|
| **Filter Tabs Rendering** | [src/components/tasks/tasks-board.tsx](src/components/tasks/tasks-board.tsx) | 507-600 |
| **Status Filtering Logic** | [src/components/tasks/tasks-board.tsx](src/components/tasks/tasks-board.tsx) | 385-430 |
| **Role-Based Task Fetching** | [src/app/dashboard/tasks/actions.ts](src/app/dashboard/tasks/actions.ts) | 600-750 |
| **Queue Task Detection** | [src/components/tasks/tasks-board.tsx](src/components/tasks/tasks-board.tsx) | 251-266 |
| **Queue Task Filtering** | [src/components/tasks/tasks-board.tsx](src/components/tasks/tasks-board.tsx) | 318-344 |
| **Claim Queue Task Action** | [src/app/dashboard/tasks/actions.ts](src/app/dashboard/tasks/actions.ts) | 2660-2727 |
| **Assign Queue to Team** | [src/app/dashboard/tasks/actions.ts](src/app/dashboard/tasks/actions.ts) | 2728-2905 |
| **Send to Department Queue** | [src/app/dashboard/tasks/actions.ts](src/app/dashboard/tasks/actions.ts) | 2906-3100+ |
| **Queue UI Components** | [src/components/tasks/task-card.tsx](src/components/tasks/task-card.tsx) | 632-660, 1020-1050 |
| **Handoff Dialog** | [src/components/tasks/task-handoff-dialog.tsx](src/components/tasks/task-handoff-dialog.tsx) | 1-250 |

---

## Key Implementation Patterns

### Department Canonical Key Conversion
```typescript
// Convert department names to canonical keys for matching
const canonicalKey = canonicalDepartmentKey(dept)
// e.g., "Sales & Marketing" → "sales-marketing"
// Handles CSV departments: "IT,HR,Finance"
```

### Team Membership Resolution
```typescript
// Team = Manager's direct reports + explicit team_members CSV
const myTeamUsernames = [
  ...usersWhereUserIsInTheirManagerId,
  ...user.team_members.split(',').map(s => s.trim())
]
```

### Notification on Queue Actions
```typescript
// Every queue action notifies relevant users
await notifyUsers(supabase, [targetUser, taskCreator], {
  type: 'task_assigned',
  title: 'Queue Claim/Assignment',
  body: 'Action details...',
  relatedId: todoId
})
```

### History Tracking
```typescript
// All queue actions recorded in history array
history.push({
  type: 'assigned',
  user: current_user,
  details: 'Human readable action...',
  timestamp: now,
  icon: '📥' | '🤖',
  title: 'Task Claimed' | 'Auto-Assigned',
})
```

---

## Database Selection Pattern (TASK_LIST_SELECT)

**File**: [src/app/dashboard/tasks/actions.ts](src/app/dashboard/tasks/actions.ts#L40-L70)

```typescript
const TASK_LIST_SELECT = [
  'id', 'username', 'title', 'description', 'completed',
  'task_status', 'priority', 'category', 'kpi_type',
  'due_date', 'expected_due_date', 'actual_due_date',
  'notes', 'package_name', 'app_name', 'position',
  'archived',
  'queue_department', 'queue_status',  // Queue fields
  'multi_assignment', 'assigned_to',   // Assignment fields
  'manager_id', 'completed_by',
  'approval_status', 'workflow_state',
  'pending_approver', 'approved_at',
  'assignment_chain', 'history',       // Audit trail
  'created_at', 'updated_at',
].join(',')
```

