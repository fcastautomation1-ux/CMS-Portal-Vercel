# Module 07 — Tasks, Workflows & Notifications

---

## 1. What This Module Does

This is the most complex module in the CMS portal. It provides a full **task management system** (called "Todos" in the legacy UI) with:
- Task creation with rich metadata (KPI type, package, campaign assignment)
- Multi-level assignment chain (User → Supervisor → Manager)
- Approval workflow with multiple statuses
- Queue management (tasks can be queued/on-hold)
- File attachments stored in Google Drive
- Task sharing between users
- Full history tracking (every status change is logged)
- Email notifications triggered on status changes
- Daily reminders for overdue tasks (cron trigger at 8AM Karachi time)
- In-app notifications (stored in Supabase)
- Service worker for push notifications (web)

---

## 2. Task Status Model

### `task_status` — Overall completion state
| Value | Meaning |
|-------|---------|
| `pending` | Just created, not started |
| `in_progress` | Being worked on |
| `submitted` | User submitted for review |
| `approved` | Approved by reviewer |
| `rejected` | Sent back for revision |
| `completed` | Fully done |
| `cancelled` | Cancelled |

### `approval_status` — Review workflow state
| Value | Meaning |
|-------|---------|
| `not_submitted` | Not yet submitted for review |
| `awaiting_approval` | Submitted, waiting for review |
| `approved` | Approved at this level |
| `rejected` | Reviewer sent it back |
| `revision_requested` | Needs changes before re-review |

### `queue_status` — Queue position
| Value | Meaning |
|-------|---------|
| `active` | Actively being worked on |
| `queued` | In queue, not started |
| `on_hold` | Paused |
| `blocked` | Blocked by dependency |

---

## 3. Task Data Model

```sql
-- Table: todos
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
title               TEXT NOT NULL
description         TEXT
kpi_type            TEXT              -- 'conversion', 'traffic', 'awareness', etc.
package_id          UUID              -- FK → packages.id (optional)
package_name        TEXT              -- denormalized name for quick display
campaign_id         TEXT              -- Google Ads campaign ID
campaign_name       TEXT
customer_id         TEXT              -- FK → accounts.customer_id

-- Assignment Chain
assigned_to         TEXT              -- FK → users.username (primary assignee)
manager_id          TEXT              -- FK → users.username (reviewing manager)
supervisor_id       TEXT              -- FK → users.username (intermediate)
created_by          TEXT NOT NULL     -- FK → users.username (creator)
assignment_chain    JSONB DEFAULT '[]' -- history of reassignments

-- Status Fields
task_status         TEXT DEFAULT 'pending'
approval_status     TEXT DEFAULT 'not_submitted'
queue_status        TEXT DEFAULT 'active'
priority            TEXT DEFAULT 'medium'  -- 'low', 'medium', 'high', 'urgent'

-- Dates
due_date            TIMESTAMPTZ
start_date          TIMESTAMPTZ
completed_at        TIMESTAMPTZ
created_at          TIMESTAMPTZ DEFAULT now()
updated_at          TIMESTAMPTZ DEFAULT now()

-- Attachments
attachments         JSONB DEFAULT '[]'   -- array of {driveFileId, name, mimeType, url}
drive_folder_id     TEXT              -- Drive folder for this task's files

-- History & Notes
history             JSONB DEFAULT '[]'   -- array of {timestamp, user, action, note}
comments            JSONB DEFAULT '[]'   -- array of {id, user, text, timestamp}
notes               TEXT

-- Notifications
last_reminder_sent  TIMESTAMPTZ
reminder_enabled    BOOLEAN DEFAULT true

-- Metadata
tags                TEXT[]
is_archived         BOOLEAN DEFAULT false
```

```sql
-- Table: todo_shares
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
todo_id     UUID NOT NULL    -- FK → todos.id
shared_by   TEXT NOT NULL    -- FK → users.username
shared_with TEXT NOT NULL    -- FK → users.username
can_edit    BOOLEAN DEFAULT false
created_at  TIMESTAMPTZ DEFAULT now()

UNIQUE(todo_id, shared_with)
```

```sql
-- Table: notifications
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id     TEXT NOT NULL    -- FK → users.username
title       TEXT NOT NULL
body        TEXT
type        TEXT             -- 'task_assigned', 'task_approved', 'task_rejected', 'reminder', 'mention'
related_id  TEXT             -- todo_id or other entity ID
is_read     BOOLEAN DEFAULT false
created_at  TIMESTAMPTZ DEFAULT now()
```

---

## 4. History JSONB Array

Every action on a task is logged to `todos.history`:

```json
[
  {
    "timestamp": "2024-01-15T10:30:00Z",
    "user": "john_doe",
    "action": "created",
    "note": "Task created"
  },
  {
    "timestamp": "2024-01-16T09:00:00Z",
    "user": "john_doe",
    "action": "status_change",
    "from": "pending",
    "to": "in_progress",
    "note": "Started working"
  },
  {
    "timestamp": "2024-01-17T14:00:00Z",
    "user": "manager_jane",
    "action": "approved",
    "note": "Good work!"
  }
]
```

---

## 5. Assignment Chain JSONB

Tracks how a task was passed between users:

```json
[
  { "user": "user_alice", "role": "assignee", "assignedAt": "2024-01-15T10:30:00Z" },
  { "user": "supervisor_bob", "role": "supervisor", "assignedAt": "2024-01-15T10:30:00Z" },
  { "user": "manager_jane", "role": "manager", "assignedAt": "2024-01-15T10:30:00Z" }
]
```

---

## 6. Workflow: Task Lifecycle

```
1. CREATION (by Manager or User):
   - Fill: title, description, KPI, package, campaign, assignee, due date, priority
   - Status: task_status=pending, approval_status=not_submitted, queue_status=active
   - Notify assigned_to via email + in-app notification

2. WORK IN PROGRESS (by Assignee):
   - Assignee sets task_status=in_progress
   - Can add comments, attach files (go to Drive)
   - Can update notes

3. SUBMISSION (by Assignee):
   - Assignee clicks "Submit for Review"
   - task_status=submitted, approval_status=awaiting_approval
   - Notify manager_id via email + in-app notification

4. REVIEW (by Manager/Supervisor):
   - Reviewer sees tasks awaiting_approval
   - Can: Approve → approval_status=approved, task_status=approved
   - Can: Reject → approval_status=rejected, task_status=rejected (notify assignee)
   - Can: Request Revision → approval_status=revision_requested (notify assignee)

5. APPROVED:
   - Manager clicks "Mark Complete" → task_status=completed, completed_at=now()
   - Notify everyone in assignment chain

6. CANCELLATION:
   - Any manager/creator can cancel → task_status=cancelled
```

---

## 7. Task Sharing

```
Manager can share a task with another user (read or edit):
1. Select task → Share button
2. Pick user from dropdown
3. Can_edit toggle (view-only vs edit)
4. INSERT INTO todo_shares
5. Shared user can see this task in their "Shared With Me" tab
```

---

## 8. Email Notification System

```
Triggers:
- Task assigned to user → email to assigned_to
- Task submitted → email to manager_id
- Task approved → email to assigned_to
- Task rejected → email to assigned_to + note
- Task overdue → daily email reminder

Email content includes:
- Task title
- Status change
- Who made the change
- Direct link to task (deep link URL)
- Due date if applicable

In legacy GAS: uses MailApp.sendEmail()
In Next.js: use Resend or Nodemailer with SMTP
```

---

## 9. Daily Reminder System

```
Legacy: GAS trigger runs checkAndSendTaskReminders() daily at 8AM (Asia/Karachi)
Logic:
  1. Get all tasks WHERE task_status NOT IN ('completed', 'cancelled', 'approved')
  2. For each task WHERE due_date < NOW():
     a. If reminder_enabled = true
     b. If last_reminder_sent is null OR > 24 hours ago
     c. Send email to assigned_to and manager_id
     d. Update last_reminder_sent = now()

In Next.js: use Vercel Cron Jobs (vercel.json: schedule = "0 3 * * *" UTC = 8AM PKT)
```

---

## 10. Notifications System

```
In-app notifications stored in Supabase notifications table.
Types:
- task_assigned: "You have been assigned a new task"
- task_submitted: "Task submitted for your review"
- task_approved: "Your task has been approved"
- task_rejected: "Your task was rejected — review feedback"
- task_reminder: "Overdue task reminder"
- task_mention: "You were mentioned in a comment"

Polling: frontend polls /api/notifications every 30 seconds
OR: use Supabase Realtime subscription on notifications table

Notification bell icon in navbar:
- Shows unread count badge
- Dropdown shows last 10 notifications
- Mark as read on click
- "Mark all read" button
```

---

## 11. Task Analytics (Separate Section)

```
The portal has a "Task Analytics" section that shows:
- Tasks completed per user (bar chart)
- Tasks by status (pie/donut chart)
- Tasks by KPI type
- Average completion time
- Overdue rate

Data: Queried from todos table with aggregations
Charts: Chart.js or Recharts
```

---

## 12. Departments & Team Sections

These are lightweight sections:
- **Departments**: simple list of department names — used as options in user creation
- **Team**: shows a visual org chart or list of team members by department/role
- Departments are likely stored as a simple array in the frontend or a Supabase table

```sql
-- Table: departments (if exists, otherwise use hardcoded list)
id    UUID PRIMARY KEY
name  TEXT NOT NULL
```

---

## 13. Frontend UI Elements

- **Task Board**: Kanban view OR list view with status columns
- **Task Card**: title, assignee avatar, priority badge, due date, status badge
- **Task Detail Modal/Page**: full form with all fields, comments, history timeline, attachments
- **Filters**: by status, priority, assignee, campaign, due date range
- **My Tasks / Team Tasks / Shared tabs**: task list segmentation
- **Create Task Button**: full creation form modal
- **Notification Bell**: in navbar, with dropdown
- **Share Task Modal**: user picker + can_edit toggle
- **History Timeline**: ordered list of history events in task detail

---

## 14. AI Build Prompt

> **Use this prompt when building this module in Next.js + TypeScript:**

```
Build the Tasks & Workflow Notifications module for a CMS portal in Next.js 14 App Router + TypeScript.

PAGES:
- /dashboard/tasks — main task list/board
- /dashboard/tasks/[id] — task detail page
- /dashboard/analytics — task analytics charts
- /dashboard/departments — department management
- /dashboard/team — team members view

FEATURES:

1. TASK BOARD / LIST
   Two views (toggle):
   - List view: table with columns (title, assignee, status, priority, due date, actions)
   - Board view: Kanban columns by task_status (pending, in_progress, submitted, approved, completed)
   
   Tabs:
   - My Tasks (assigned to me)
   - Team Tasks (Admin/Manager sees all or their team)
   - Shared With Me (from todo_shares table)
   
   Filters:
   - Status (multi-select)
   - Priority (dropdown)
   - Assignee (user dropdown — managers only)
   - Due date range (date picker)
   - KPI type
   
   Sort: by due date, priority, created date

2. CREATE/EDIT TASK MODAL (full page form or large modal)
   Sections:
   a. Basic Info: Title (required), Description (rich text/textarea), Priority, Tags
   b. Assignment: Assign To (user picker), Supervisor (optional), Manager (auto from user's manager_id)
   c. Campaign Info: Customer Account (dropdown), Campaign (dropdown populated from account), KPI Type
   d. Package: Link a package (optional dropdown from packages table)
   e. Schedule: Start Date, Due Date
   f. Queue: Queue Status (Active/Queued/On Hold/Blocked)
   g. Notes: text area

3. TASK DETAIL VIEW (/dashboard/tasks/[id])
   Left panel (2/3 width):
   - Task title (editable by manager)
   - Description (editable)
   - Comments section: list of comments, text input to add comment
   - File Attachments: list of attached Drive files, upload new button
   - History Timeline: shows all history[] events in chronological order
   
   Right panel (1/3 width):
   - Status badges + action buttons:
     - If assignee viewing: "Start Work", "Submit for Review"
     - If manager viewing: "Approve", "Reject", "Request Revision", "Mark Complete"
   - Assignment info: assignee, supervisor, manager (with avatars)
   - Metadata: campaign, account, KPI type, package, priority, due date
   - Share button (opens share modal)
   - Danger zone: Cancel task, Archive task

4. HISTORY TIMELINE COMPONENT
   List of events from task.history JSONB array:
   - Icon based on action type (checkmark=approved, x=rejected, clock=created, etc.)
   - User name + avatar
   - Action description
   - Timestamp (relative: "2 hours ago")

5. NOTIFICATIONS
   - Bell icon in top navbar
   - Unread count badge (red pill)
   - Dropdown panel: last 10 notifications, mark as read on click
   - "View all notifications" link
   - "Mark all as read" button
   - Supabase Realtime subscription: subscribe to notifications WHERE user_id = currentUser
   
   Notification types with icons:
   - task_assigned: 📋 new task
   - task_approved: ✅ approved
   - task_rejected: ❌ rejected
   - task_reminder: ⏰ overdue

6. EMAIL NOTIFICATIONS
   Use Resend (npm install resend) or Nodemailer.
   Template: HTML email with task title, status, who changed it, link to task.
   Trigger from server actions on status changes.
   Check user.email_notifications_enabled before sending.

7. DAILY REMINDER CRON
   File: src/app/api/cron/task-reminders/route.ts
   Schedule in vercel.json: { "path": "/api/cron/task-reminders", "schedule": "0 3 * * *" }
   Logic: Find overdue non-completed tasks, send emails, update last_reminder_sent

8. TASK ANALYTICS PAGE (/dashboard/analytics)
   Charts (use Recharts):
   - Bar chart: tasks completed per user this month
   - Donut chart: task distribution by status
   - Line chart: tasks created vs completed over time (last 30 days)
   - Bar chart: tasks by KPI type
   Stats cards: total active, overdue count, completion rate, avg completion days

9. DEPARTMENTS
   Simple CRUD for department names.
   Table: departments (id, name)
   Used as select options in user creation.

TYPES (src/types/task.ts):
interface Task {
  id: string
  title: string
  description?: string
  kpiType?: string
  packageId?: string
  packageName?: string
  campaignId?: string
  campaignName?: string
  customerId?: string
  assignedTo: string
  managerId?: string
  supervisorId?: string
  createdBy: string
  assignmentChain: AssignmentChainItem[]
  taskStatus: 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'completed' | 'cancelled'
  approvalStatus: 'not_submitted' | 'awaiting_approval' | 'approved' | 'rejected' | 'revision_requested'
  queueStatus: 'active' | 'queued' | 'on_hold' | 'blocked'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueDate?: string
  startDate?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
  attachments: TaskAttachment[]
  driveFolderId?: string
  history: TaskHistoryEvent[]
  comments: TaskComment[]
  notes?: string
  tags?: string[]
  isArchived: boolean
  reminderEnabled: boolean
  lastReminderSent?: string
}

SERVER ACTIONS (src/app/dashboard/tasks/actions.ts):
- getTasks(filters, userId, role): with filtering
- getTask(id, userId): single task with access check
- createTask(data, creatorId): insert + send notification
- updateTask(id, data, userId): update + log to history
- changeTaskStatus(id, newStatus, userId, note): status transition + notify
- addComment(taskId, userId, text): append to comments JSONB
- uploadAttachment(taskId, file, userId): upload to Drive + update attachments JSONB
- shareTask(taskId, shareWithUserId, canEdit): insert todo_shares
- getSharedTasks(userId): tasks from todo_shares
- getNotifications(userId): get unread notifications
- markNotificationRead(notificationId): update is_read
- markAllNotificationsRead(userId): bulk update
- createNotification(userId, type, title, body, relatedId): insert notification
```

---
