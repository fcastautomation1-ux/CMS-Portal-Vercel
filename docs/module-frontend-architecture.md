# Module 09 — Frontend Architecture

---

## 1. Legacy Architecture Overview

The legacy frontend is a **single monolithic HTML file** (~36,782 lines) containing:
- All HTML structure
- All CSS styles (inline `<style>` tag)
- All JavaScript logic (inline `<script>` tag)
- All 13 page sections rendered in the DOM simultaneously
- Only one section visible at a time (CSS `display: none/block`)
- Session management via `sessionStorage`
- Direct Supabase calls from the browser (hybrid: some via GAS, some direct)
- Service worker for push notifications
- Schema migration logic (runs on login to ensure DB has correct columns)

---

## 2. The 13 UI Sections (Sidebar Navigation)

| # | Section Key | Display Name | Route in Next.js |
|---|-------------|-------------|------------------|
| 1 | `accounts` | Google Accounts | /dashboard/accounts |
| 2 | `campaigns` | Campaigns | /dashboard/campaigns |
| 3 | `users` | Users | /dashboard/users |
| 4 | `workflows` | Workflows | /dashboard/workflows |
| 5 | `rules` | Rules | /dashboard/rules |
| 6 | `drive` | Drive Manager | /dashboard/drive |
| 7 | `looker` | Looker Reports | /dashboard/looker |
| 8 | `todos` | Tasks | /dashboard/tasks |
| 9 | `departments` | Departments | /dashboard/departments |
| 10 | `team` | Team | /dashboard/team |
| 11 | `taskAnalytics` | Task Analytics | /dashboard/analytics |
| 12 | `packages` | Packages | /dashboard/packages |
| 13 | (login) | Login | /login |

---

## 3. Session Management (Legacy)

```javascript
// Login stores in sessionStorage
sessionStorage.setItem('currentUser', JSON.stringify(user))
sessionStorage.setItem('authToken', token)
sessionStorage.setItem('userRole', role)

// On page load — restore session
const user = JSON.parse(sessionStorage.getItem('currentUser'))
if (!user) → show login section

// On logout — clear session
sessionStorage.clear()
location.reload()
```

---

## 4. Toast Notification System (Legacy)

```javascript
// Global toast function called everywhere
function showToast(message, type = 'info', duration = 3000) {
  // Creates a div with class 'toast'
  // type: 'success', 'error', 'warning', 'info'
  // Appends to body
  // Auto-removes after duration ms
  // CSS: fixed bottom-right, sliding animation
}
```

---

## 5. Cache Manager (Legacy)

```javascript
// Simple in-memory cache to avoid repeated API calls
const cache = {}

function setCache(key, data, ttlMs = 60000) {
  cache[key] = { data, expires: Date.now() + ttlMs }
}

function getCache(key) {
  const entry = cache[key]
  if (!entry) return null
  if (Date.now() > entry.expires) { delete cache[key]; return null }
  return entry.data
}
```

Keys used: `'accounts'`, `'users'`, `'looker_reports'`, `'packages'`, etc.

---

## 6. Hybrid Data Fetching Model (Legacy)

Some data is fetched via Google Apps Script (GAS) server:
```javascript
google.script.run.withSuccessHandler(cb).withFailureHandler(err).getFunctionName(args)
```

Some data is fetched directly from Supabase via the browser client:
```javascript
const { data, error } = await supabase.from('todos').select('*').eq('assigned_to', username)
```

---

## 7. Schema Migration Logic (Legacy)

On every login, the frontend calls:
```javascript
async function runSchemaBackfill() {
  // Adds missing columns via Supabase ALTER TABLE calls (through GAS)
  // Adds missing columns with DEFAULT values
  // Idempotent — safe to run multiple times
  // Runs: backfill of assignment_chain, manager_id, supervisor_id, etc.
}
```

---

## 8. Service Worker (Legacy)

- A service worker script is served by GAS (`serveServiceWorker()`)
- Used for: caching static assets, push notification subscription
- Route: `?service-worker=1`

---

## 9. Optimistic Updates Pattern (Legacy)

Many operations in the legacy code use optimistic updates:
1. Immediately update the UI (render new state)
2. Send request to server in background
3. If request fails: revert UI + show error toast
4. If request succeeds: optionally refresh data from server

---

## 10. Next.js Architecture Plan

### Folder Structure
```
src/
├── app/
│   ├── layout.tsx              # Root layout (fonts, providers)
│   ├── page.tsx                # Redirect to /dashboard or /login
│   ├── login/
│   │   └── page.tsx
│   └── dashboard/
│       ├── layout.tsx          # Dashboard layout (sidebar + topbar)
│       ├── page.tsx            # Redirect to /dashboard/accounts
│       ├── accounts/
│       │   ├── page.tsx
│       │   └── actions.ts
│       ├── campaigns/
│       │   ├── page.tsx
│       │   └── actions.ts
│       ├── users/
│       │   ├── page.tsx
│       │   └── actions.ts
│       ├── workflows/
│       │   ├── page.tsx
│       │   └── actions.ts
│       ├── drive/
│       │   ├── page.tsx
│       │   └── actions.ts
│       ├── looker/
│       │   ├── page.tsx
│       │   └── actions.ts
│       ├── tasks/
│       │   ├── page.tsx
│       │   ├── [id]/
│       │   │   └── page.tsx
│       │   └── actions.ts
│       ├── analytics/
│       │   ├── page.tsx
│       │   └── actions.ts
│       ├── departments/
│       │   ├── page.tsx
│       │   └── actions.ts
│       ├── team/
│       │   ├── page.tsx
│       │   └── actions.ts
│       ├── packages/
│       │   ├── page.tsx
│       │   └── actions.ts
│       └── rules/
│           ├── page.tsx
│           └── actions.ts
├── components/
│   ├── ui/                     # shadcn/ui primitives
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── TopBar.tsx
│   │   ├── NotificationBell.tsx
│   │   └── UserMenu.tsx
│   ├── shared/
│   │   ├── DataTable.tsx       # reusable TanStack Table
│   │   ├── StatusBadge.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── AvatarImage.tsx
│   │   ├── Toast.tsx
│   │   └── EmptyState.tsx
│   └── [module]/              # module-specific components
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # browser client
│   │   └── server.ts           # server client
│   ├── auth/
│   │   ├── session.ts
│   │   └── permissions.ts
│   ├── utils.ts
│   ├── constants.ts
│   ├── removal-conditions.ts  # 24 hardcoded conditions
│   └── email.ts               # Resend email helper
├── hooks/
│   ├── useCurrentUser.ts
│   ├── usePermissions.ts
│   └── useNotifications.ts
├── types/
│   ├── user.ts
│   ├── account.ts
│   ├── campaign.ts
│   ├── task.ts
│   ├── drive.ts
│   ├── looker.ts
│   └── package.ts
└── middleware.ts               # Auth + route protection
```

---

## 11. Dashboard Layout Components

### Sidebar
- Fixed left sidebar (280px wide)
- Collapsible to icon-only mode (60px) on mobile
- Each nav item: icon + label
- Active item: highlighted background
- Items filtered by `module_access` permissions
- Bottom: user avatar, name, role badge, logout button
- Toggle button for collapse

### TopBar
- Breadcrumb showing current section
- Page title
- Notification bell (right side)
- User avatar dropdown (right side)
- Theme toggle (light/dark)

### Main Content Area
- Scrollable, fills remaining space
- Padding: 24px
- Max width: none (full width)

---

## 12. Global State & Providers

```typescript
// src/app/layout.tsx providers:
<SessionProvider>          // Supabase Auth session
  <QueryClientProvider>    // TanStack Query
    <ThemeProvider>        // dark/light theme
      <ToastProvider>      // toast notifications
        {children}
      </ToastProvider>
    </ThemeProvider>
  </QueryClientProvider>
</SessionProvider>
```

---

## 13. Middleware (Route Protection)

```typescript
// src/middleware.ts
export function middleware(request: NextRequest) {
  // Check for valid session token
  // If no token and route starts with /dashboard → redirect to /login
  // If has token and route is /login → redirect to /dashboard
  // Attach user info to request headers for server components
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
}
```

---

## 14. AI Build Prompt

> **Use this prompt when setting up the full Next.js architecture:**

```
Set up the complete Next.js 14 App Router architecture for a CMS portal with TypeScript.

PROJECT SETUP:
npx create-next-app@latest cms-portal --typescript --tailwind --app --src-dir

DEPENDENCIES TO INSTALL:
- @supabase/supabase-js @supabase/ssr
- @tanstack/react-query @tanstack/react-table
- zod react-hook-form @hookform/resolvers
- recharts (for analytics charts)
- resend (for email)
- googleapis (for Google Drive + Sheets API)
- date-fns (date formatting)
- lucide-react (icons)
- shadcn/ui components:
  Button, Input, Label, Select, Dialog, Sheet, Table, Badge,
  Avatar, Card, Tabs, Dropdown Menu, Popover, Tooltip,
  Switch, Checkbox, Textarea, Toast/Sonner, Separator,
  Command (for searchable selects), Calendar, Skeleton

CORE FILES TO CREATE:

1. src/middleware.ts
   - Protect all /dashboard routes (require valid Supabase session)
   - Redirect unauthenticated → /login
   - Redirect authenticated from /login → /dashboard

2. src/app/layout.tsx
   - Google font (Inter or Geist)
   - Providers: SessionProvider, QueryClientProvider, ThemeProvider, Sonner Toaster
   - Dark mode support via next-themes

3. src/app/dashboard/layout.tsx
   - Flex layout: sidebar (fixed, 280px) + main content (flex-1, overflow-y-auto)
   - Sidebar: nav items for all 13 sections filtered by user permissions
   - TopBar: breadcrumb, notification bell, user menu
   - Mobile: sidebar as Sheet (slide-over from left)

4. src/lib/supabase/server.ts
   - createServerClient() using @supabase/ssr
   - Used in server components and server actions

5. src/lib/supabase/client.ts
   - createBrowserClient() using @supabase/ssr
   - Used in client components

6. src/lib/auth/permissions.ts
   export function canAccess(user, module): boolean
   export function isAdmin(user): boolean
   export function isSuperManager(user): boolean
   export function isManager(user): boolean
   export function canEditUsers(currentUser, targetUser): boolean
   export function getAccessibleAccountIds(user): string[] | 'all'

7. src/hooks/useCurrentUser.ts
   - Returns current user from Supabase Auth + joined users table data
   - Includes role, module_access, allowed_accounts etc.

8. src/components/layout/Sidebar.tsx
   - Navigation items array with icon, label, href, requiredModule
   - Filter items by user.module_access
   - Active state by current pathname
   - Collapse animation

9. src/components/shared/DataTable.tsx
   - Reusable TanStack Table wrapper
   - Props: columns, data, loading, onAdd, searchKey
   - Built-in: search input, pagination, loading skeleton, empty state

ENVIRONMENT VARIABLES (.env.local):
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
RESEND_API_KEY=
CRON_SECRET=

STYLING CONVENTIONS:
- Tailwind CSS only (no separate CSS files except globals.css)
- Dark mode: class strategy (class="dark" on html element)
- Color palette: use CSS variables from shadcn/ui
- Border radius: rounded-lg consistently
- Spacing: consistent 4/8/12/16/24px scale
```

---
