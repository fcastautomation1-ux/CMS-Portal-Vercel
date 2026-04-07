# CMS Portal — Deep System Analysis

> **Auto-maintained record.** Every time a module is changed or a new feature is added, update this document.
> This is the source-of-truth for how the portal works internally — used as a base for writing tests and avoiding regressions.

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Authentication & Session](#2-authentication--session)
3. [Task System — Core Concepts](#3-task-system--core-concepts)
4. [Department Queue System (Within-Hall)](#4-department-queue-system-within-hall)
5. [Cross-Hall Task System](#5-cross-hall-task-system)
6. [Hall Scheduler](#6-hall-scheduler)
7. [Assignment Flow & Chain](#7-assignment-flow--chain)
8. [Multi-Assignment](#8-multi-assignment)
9. [Notifications](#9-notifications)
10. [Sidebar & KPI Counts](#10-sidebar--kpi-counts)
11. [Role-Based Access Control (RBAC)](#11-role-based-access-control-rbac)
12. [File Attachments](#12-file-attachments)
13. [Realtime Subscriptions](#13-realtime-subscriptions)
14. [Cluster (Hall) Settings](#14-cluster-hall-settings)
15. [Changelog — Feature additions & fixes](#15-changelog)

---

## 1. Architecture Overview

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| DB / Auth | Supabase (PostgreSQL + Realtime) |
| Server Actions | `'use server'` functions in `src/app/dashboard/*/actions.ts` |
| Client State | `@tanstack/react-query` with custom `queryKeys` |
| Styling | Tailwind CSS |
| Realtime | Custom `subscribeToPostgresChanges` wrapper (`src/lib/realtime.ts`) |

### Key directories
```
src/app/dashboard/tasks/actions.ts   — All task server actions (3000+ lines)
src/components/tasks/task-card.tsx   — Individual task card (inline + queue views)
src/components/tasks/tasks-board.tsx — Board with filters, KPIs, realtime
src/components/tasks/task-detail-page.tsx — Full detail view
src/components/clusters/             — Hall/Cluster management UI
src/lib/                             — Utilities: auth, storage, pakistan-time, etc.
src/types/index.ts                   — All shared TypeScript types
```

---

## 2. Authentication & Session

- **Login**: `src/app/login/page.tsx` → calls `loginAction()` in `actions.ts`
- `loginAction` verifies password (bcrypt or legacy plain), creates a signed JWT session via `createSession()` (`src/lib/auth.ts`), and sets an httpOnly cookie.
- On success: `redirect('/dashboard')` is called server-side — **single click, no client-side redirect needed**.
- Session is read on every server action via `getSession()` which decodes the JWT cookie.
- `getNotificationUserKeys(user)` normalises username/email for multi-key notification lookup.

**Password handling** (`src/lib/password.ts`):
- Legacy: plain text stored in `password` column — still verified but upgraded to bcrypt on next login.
- Modern: `password_hash` (bcrypt) + `password_salt`.

---

## 3. Task System — Core Concepts

### Task (`todos` table) key fields
| Field | Meaning |
|---|---|
| `username` | Creator (never changes) |
| `assigned_to` | Current assignee (single) |
| `task_status` | `backlog / todo / in_progress / done` |
| `queue_status` | `null / queued / claimed` |
| `queue_department` | Department key the task is queued into |
| `assignment_chain` | JSONB array — full routing history |
| `cluster_id` | Linked to a Hall (cross-hall only) |
| `cluster_inbox` | boolean — true = task is in hall inbox waiting to be picked |
| `workflow_state` | `null / pending_dept_assignment / claimed_by_department / …` |
| `multi_assignment` | JSONB `{enabled, assignees[]}` |
| `archived` | Soft-delete |

### Task statuses visible to user
- **Pending**: assigned/created but not started, not overdue, not in queue
- **In Progress**: `task_status === 'in_progress'`
- **Completed**: globally done OR user-specific completion in chain/MA
- **Overdue**: due_date < now AND not completed
- **Queue**: `queue_status === 'queued'` — task sitting in a dept queue waiting to be picked

> **Critical rule**: A task with `queue_status === 'queued'` must NEVER appear in the Pending filter. It is counted exclusively in the Queue KPI/filter.

---

## 4. Department Queue System (Within-Hall)

This system allows tasks to be routed to a department queue **within a Hall**, where a manager or supervisor can pick them up or assign them to a team member.

### How it works (step by step)

1. **User creates or receives a task** and uses "Assign to Next → Department Queue" action.
2. Server action sets: `queue_status = 'queued'`, `queue_department = <dept_key>`, `assigned_to = null`.
3. The task disappears from the sender's "My Tasks" active list and appears in the **Queue** tab.
4. **Who can see the queue:**
   - Admin / Super Manager: always see all queued tasks system-wide.
   - Manager / Supervisor: see all queued tasks in their department(s).
   - Regular User: see only if cluster setting `allow_dept_users_see_queue = true` for the cluster that owns that task's dept.
   - **New toggle `allow_normal_users_see_queue`** (added Apr 3 2026): separate per-hall toggle — when OFF, even regular dept users are hidden from queue (only managers/supervisors of the hall see it).
5. **Pick Task button**: shown to any user who can see the queue **and is NOT the creator** of the task.
   - Exception: Manager / Supervisor **can** pick/assign even if they are the creator (forceful management override).
   - Admin / Super Manager: always bypass `!isCreator`.
6. On click "Pick Task": `claimQueuedTaskAction()` sets `assigned_to = currentUser`, `queue_status = 'claimed'`, `task_status = 'todo'`.
7. **Queue Assign** button (only if `enableQueueAssign` prop = true): Manager/Supervisor can assign the queue task to any of their team members.

### Claim button visibility logic (`task-card.tsx`)
```ts
const isManagementRole = role === 'Manager' || role === 'Supervisor' || role === 'Super Manager' || role === 'Admin'
const showClaimBtn =
  task.queue_status === 'queued' &&
  !task.assigned_to &&
  !isGloballyDone &&
  // Managers/Supervisors CAN pick even if they created it (management override)
  (!isCreator || isManagementRole) &&
  (isManagementRole || !queueDeptKey || userDeptKeys.includes(queueDeptKey))
```

### Cluster settings controlling dept-queue visibility
Stored in `cluster_settings` table:
- `allow_dept_users_see_queue`: Regular (User-role) dept members can see the queue.
- `allow_normal_users_see_queue` *(new toggle)*: If false, regular users are hidden regardless of `allow_dept_users_see_queue`. Only managers/supervisors see it.

---

## 5. Cross-Hall Task System

This is a **completely separate system** from the within-hall dept queue. Do not confuse them.

### How it works

1. Admin/Manager uses "Send to Hall" (route-cluster) action from the task creation or task-card menu.
2. Server writes: `cluster_id = <cluster>`, `cluster_inbox = true`, `workflow_state = 'pending_dept_assignment'`.
3. The task lands in the **Hall Inbox** (`cluster_inbox = true`) — visible via "Hall Queue" sidebar link.
4. A manager/supervisor of the **receiving** hall sees the task in Hall Queue.
5. They click "Pick Task" → `claimClusterInboxTaskAction()` → sets `cluster_inbox = false`, `assigned_to = manager`, `queue_status = 'claimed'`, `workflow_state = 'claimed_by_department'`.
6. OR they click "Assign to Team" → assigns it directly to a team member.
7. The task flows normally within the receiving hall after claim.

### Key difference from dept queue
| Aspect | Dept Queue (within-hall) | Cross-Hall |
|---|---|---|
| Field | `queue_status = 'queued'`, `queue_department` | `cluster_inbox = true`, `cluster_id` |
| Visibility | By dept match + cluster settings | By cluster membership of receiving hall |
| Creator can pick | Manager/Supervisor = YES | NO — cross-hall creator is always blocked |
| Sidebar link | Queue KPI + Queue tab | Hall Queue sidebar item |

### Cross-hall task visibility (`matchesPersonalScope`)
A cross-hall task is visible to the routing user via `cluster_routed_by` field match.

---

## 6. Hall Scheduler

Enabled per-cluster. Controls task flow **within** a hall.

- `single_active_task_per_user`: Only 1 active task at a time per user. Additional assignments go to `scheduler_state = 'user_queue'`.
- `auto_start_next_task`: When active task completes/is blocked, next queued auto-activates.
- `require_pause_reason`: Users must write a reason to pause.
- `scheduler_state` values: `active | user_queue | paused | blocked | waiting_review`

Scheduler logic lives in `src/lib/hall-scheduler.ts`.

---

## 7. Assignment Flow & Chain

Every routing action appends to `assignment_chain` (JSONB array):
```json
[
  { "user": "admin", "next_user": "dept-A", "role": "routed_to_department_queue", "timestamp": "..." },
  { "user": "manager-A", "next_user": "user-X", "role": "assigned_to_user", "timestamp": "..." }
]
```

`role` values:
- `routed_to_department_queue` / `queued_department` → Sent to dept queue
- `assigned_to_user` → Direct assignment
- `submitted_for_approval` → User submitted work
- `approved` / `rejected` → Approval actions
- `cross_hall_routed` → Sent to another hall

**WorkflowRail** (`task-card.tsx`): Renders the chain as a flat vertical stepper (dot + line + name + subtitle). Max 20 rows. Flat — no indentation.

---

## 8. Multi-Assignment

A task can be assigned to multiple users simultaneously.

- Stored as `multi_assignment: { enabled: true, assignees: [{ username, status, due_date }] }`
- Each assignee has their own `status`: `pending | in_progress | completed | accepted`
- MA labels: `pending → Pending`, `in_progress → In Progress`, `completed → Submitted`, `accepted → Accepted`
- Task is globally done when ALL assignees have `status === 'completed' || 'accepted'`
- Visibility: `rowTouchesCurrentUser` checks `multi_assignment.assignees` JSONB for current user.

---

## 9. Notifications

Table: `notifications` — `user_id`, `title`, `message`, `type`, `read`, `is_read`, `created_by`, `created_at`

- **Fetching**: `getNotifications()` uses `select('*')` (not explicit columns) to handle schema variance.
- **Unread count**: Two parallel queries (one for `read=false`, one for `is_read=false`) → `Math.max()` of both.
- **Desktop notifications**: Requested on bell button click (user gesture). Only fires for items created in last 2 minutes on mount.
- **Realtime**: Subscribed via `subscribeToPostgresChanges` on `notifications` table filtered by `user_id`.
- **Panel**: `notification-panel.tsx` — shows All/Unread/Read tabs. Mark-all-read stays on current tab (does not switch to Unread).

---

## 10. Sidebar & KPI Counts

### Server-side: `getSidebarTaskCounts()` in `actions.ts`
Runs 9 parallel DB queries. Returns `{ all, completed, in_progress, pending, overdue, queue }`.

**Queue count logic:**
- Fetches all `queue_status = 'queued'` tasks (filtered by user dept keys).
- Admin/SM: bypass dept filter.
- Manager/Supervisor: see tasks in their dept regardless of `allow_dept_users_see_queue`.
- User: see tasks in their dept ONLY if `allow_dept_users_see_queue = true` for the cluster.
- `allow_normal_users_see_queue = false` → regular users excluded even if dept matches.

**Pending count logic:**
- Must exclude tasks with `queue_status === 'queued'` — these belong in Queue, not Pending.
- Must exclude tasks with `task_status === 'in_progress'`.
- Must exclude overdue tasks.

### Client-side: `tasks-board.tsx`
- `matchesQueueVisibility()` → determines if a task shows in Queue KPI/tab
- `pending` filter: `!isCompleted && task_status !== 'in_progress' && queue_status !== 'queued' && !overdue && !archived`
- `queue` filter: `matchesQueueVisibility(task)`

---

## 11. Role-Based Access Control (RBAC)

| Role | Capabilities |
|---|---|
| Admin | Full access — bypass all dept/creator restrictions |
| Super Manager | Same as Admin for viewing/picking queues |
| Manager | See/pick dept queue tasks (including own created). Can forcefully assign. |
| Supervisor | Same as Manager for queue pick/assign |
| User | See queue only if cluster allows it. Cannot pick unless in their dept AND allowed |

**`canViewAllQueues`** (in `getTasks` action):
```ts
const canViewAllQueues = role === 'Admin' || role === 'Super Manager' || role === 'Manager' || role === 'Supervisor'
```

---

## 12. File Attachments

- Files stored in Supabase Storage.
- "Open File" button: `target="_blank"` — opens in new tab.
- "Download" button: Blob-fetch approach (not `<a download>`) — works for cross-origin Supabase URLs.
- Upload progress: shown in task detail page during upload.
- Create Task modal: pending attachments shown with progress bar while saving.

---

## 13. Realtime Subscriptions

`src/lib/realtime.ts` exports `subscribeToPostgresChanges()`.

Subscribed tables:
- `todos` — task changes for board refresh
- `notifications` — new notifications trigger panel refresh + desktop notification
- `cluster_members` — hall membership changes

Pattern:
```ts
return subscribeToPostgresChanges(
  `channel-name`,
  [{ table: 'todos', filter: buildRealtimeEqFilter('assigned_to', username) }],
  () => scheduleRefresh()
)
```

Multi-assigned tasks: also subscribed via `notifications` table `task_assigned` INSERT to trigger board refresh (since JSONB arrays are not indexable via realtime EQ filter).

---

## 14. Cluster (Hall) Settings

Stored in `cluster_settings` table. Per-cluster. Saved via `saveClusterSettingsAction()`.

| Setting | Default | Meaning |
|---|---|---|
| `allow_dept_users_see_queue` | false | Regular Users in dept can see the queue |
| `allow_normal_users_see_queue` | true | *(new Apr 3 2026)* If false, only managers/supervisors see the queue |
| `single_active_task_per_user` | false | Max 1 active task per user |
| `auto_start_next_task` | true | Next queued task auto-starts on completion |
| `require_pause_reason` | false | Must provide reason to pause |

UI: `src/components/clusters/hall-settings-extended.tsx`
SQL: `docs/supabase-hall-workflow.sql`

---

## 15. Changelog

| Date | Change | Files |
|---|---|---|
| Apr 3, 2026 | Login single-click fix — use server-side redirect() instead of client useEffect | `login/actions.ts`, `login/page.tsx` |
| Apr 3, 2026 | Notification panel: mark-all-read no longer switches tab, desktop permission via user gesture, no spam of old history | `notification-panel.tsx` |
| Apr 3, 2026 | getNotifications uses select('*') to fix empty panel bug | `notifications/actions.ts` |
| Apr 3, 2026 | File: Open File → new tab, Download → blob-fetch (works cross-origin) | `task-detail-page.tsx`, `task-detail-modal.tsx` |
| Apr 3, 2026 | WorkflowRail redesign — flat vertical stepper matching design reference | `task-card.tsx` |
| Apr 3, 2026 | Assignment Flow canvas: fixed 420px height, no longer grows with nodes | `task-detail-page.tsx` |
| Apr 3, 2026 | Queue visibility: issue 1 — Managers/Supervisors can pick even own-created dept queue tasks | `task-card.tsx` |
| Apr 3, 2026 | Queue visibility: issue 2 — Pending filter excludes queue_status=queued tasks | `tasks-board.tsx`, `actions.ts` |
| Apr 3, 2026 | Queue visibility: issue 3 — Sidebar queue count respects cluster settings for all roles | `actions.ts` |
| Apr 3, 2026 | New hall toggle: `allow_normal_users_see_queue` — hides queue from regular Users when off | `hall-settings-extended.tsx`, `actions.ts`, `types/index.ts` |

---

> **Instructions for AI agents**: When you modify any module described above, add a row to the Changelog table and update the relevant section to reflect the new behaviour. Never silently change behaviour documented here without updating this file.
