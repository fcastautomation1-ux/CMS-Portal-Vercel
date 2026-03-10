# Migration Plan — Legacy GAS to Next.js + TypeScript

---

## 1. Why Migrate?

The legacy system is built on Google Apps Script (GAS) which has hard limits:
- 6-minute execution timeout per function
- Limited concurrency
- No proper TypeScript support
- No real-time capabilities
- Monolithic 36,000-line HTML file is unmaintainable
- No unit testing framework
- Slow UI (every action calls a GAS server round-trip)
- Session storage (lost on browser close)
- Custom base64 tokens (not industry-standard auth)

The new system targets:
- Sub-200ms page loads
- Real-time notifications (Supabase Realtime)
- Proper auth (Supabase Auth with JWT + refresh tokens)
- TypeScript end-to-end type safety
- Modular, maintainable codebase
- Vercel edge deployment
- Horizontal scalability

---

## 2. Target Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 App Router |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS + shadcn/ui |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Server Logic | Next.js Server Actions |
| Data Fetching | TanStack Query v5 |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| Email | Resend |
| Drive API | googleapis (Node.js) |
| Deployment | Vercel |
| Cron Jobs | Vercel Cron |

---

## 3. Migration Phases

### Phase 1 — Project Setup (Days 1–2)
```
1. Create Next.js project with TypeScript + Tailwind
2. Install and configure shadcn/ui
3. Set up Supabase project
4. Configure environment variables
5. Set up Supabase Auth
6. Create middleware.ts for route protection
7. Create base layout (sidebar + topbar placeholder)
8. Deploy to Vercel (blank project)
```

### Phase 2 — Database Migration (Days 3–4)
```
1. Create all 14 tables in Supabase (from module-supabase-data-layer.md)
2. Enable RLS on all tables
3. Create RLS policies
4. Add all recommended indexes
5. Seed: removal_condition_definitions (24 rows)
6. Seed: departments (default list)
7. Generate TypeScript types from Supabase schema
8. Test all tables via Supabase Table Editor
```

### Phase 3 — Auth & Users Module (Days 5–7)
```
1. Build /login page with email/password form
2. Implement Supabase Auth sign-in
3. Create middleware with session validation
4. Build /dashboard/users page:
   - User list table
   - Add/Edit user modal (6 tabs)
   - Delete user
   - Profile image upload (Supabase Storage)
   - Drive folder access assignment
   - Module access JSON editor
5. Build useCurrentUser hook
6. Build permissions.ts utility
7. Test all 5 user roles
```

### Phase 4 — Accounts Module (Days 8–9)
```
1. Build /dashboard/accounts page
2. Accounts table with all columns
3. Add/Edit account modal
4. Enable/disable toggle (optimistic)
5. Batch toggle selected accounts
6. Status badge component
7. Test filtering by user role
```

### Phase 5 — Campaigns Module (Days 10–12)
```
1. Build /dashboard/campaigns page
2. Google Sheets API integration (read campaign list)
3. Editable rules grid (TanStack Table with editable cells)
4. WORKFLOW_TABLES routing logic
5. Save rules (delete + insert full replace)
6. Removal condition definitions constant + info panel
7. Test with real Google Sheet data
```

### Phase 6 — Drive Manager (Days 13–15)
```
1. Set up googleapis service account
2. Build /dashboard/drive page
3. Folder browser grid/list
4. Breadcrumb navigation
5. Context menu (right-click/3-dot)
6. Upload with progress
7. New folder/file creation
8. Rename/delete/move operations
9. Share modal + get link
10. Search
11. Storage quota bar
12. isFolderAllowed() access control
13. Task Attachments folder setup
```

### Phase 7 — Looker Reports (Days 16–17)
```
1. Build /dashboard/looker page
2. Report cards grid
3. Iframe modal viewer
4. Add/Edit/Delete report
5. URL auto-convert to embed format
6. User access selector
7. Test iframe loading
```

### Phase 8 — Packages Module (Days 18–19)
```
1. Build /dashboard/packages page
2. Packages catalog table
3. Add/Edit/Delete package
4. User assignment (replace-all pattern)
5. My Packages view for regular users
6. Package selector integration in task creation
```

### Phase 9 — Tasks & Workflow (Days 20–25)
```
1. Build /dashboard/tasks page
2. Task list (table view)
3. Task board (Kanban view)
4. Create task modal (full form)
5. Task detail page (/dashboard/tasks/[id])
6. Status change actions (approve, reject, submit)
7. Comments system
8. File attachments (using Drive)
9. History timeline
10. Task sharing (todo_shares)
11. My Tasks / Team Tasks / Shared tabs
```

### Phase 10 — Notifications & Email (Days 26–27)
```
1. Supabase Realtime subscription for notifications
2. Notification bell component in TopBar
3. Notification dropdown
4. Mark as read / mark all read
5. Resend email setup
6. Email templates for all notification types
7. Trigger emails on task status changes
8. Daily reminder cron (Vercel Cron Job)
```

### Phase 11 — Analytics & Remaining Sections (Days 28–30)
```
1. /dashboard/analytics — task analytics charts (Recharts)
2. /dashboard/departments — CRUD for departments
3. /dashboard/team — team members list by department
4. /dashboard/workflows — workflow management
5. /dashboard/rules — rules section
```

### Phase 12 — Testing, Polish & Deployment (Days 31–35)
```
1. End-to-end testing for all 5 user roles
2. Mobile responsive testing
3. Performance optimization
4. Dark mode testing
5. Error boundary components
6. Loading states audit
7. Empty states audit
8. Final Vercel deployment with production env vars
9. DNS / custom domain setup (if needed)
10. Data migration from legacy DB (if needed)
```

---

## 4. Data Migration Strategy

### Option A: Zero Migration (Fresh Start)
- Start with empty database
- Admins manually re-enter accounts, users, etc.
- Fastest to deploy

### Option B: SQL Dump Migration
```
1. Export data from legacy Supabase (same DB — just add new columns/tables)
2. The existing tables already work as-is
3. Only need to:
   a. Add missing columns (assignment_chain, manager_id, etc.)
   b. Fill bcrypt password hashes from existing user data
   c. Migrate avatar_data from base64 text to Supabase Storage URLs
4. Passwords: on first login after migration, force reset (or keep old hash)
```

### Recommended: In-Place Migration (Best Option)
Since both legacy and new system can use the SAME Supabase database:
1. Keep all existing data
2. Add new columns as needed (with DEFAULT values — no data loss)
3. New Next.js app reads same tables
4. Run both old and new systems in parallel briefly
5. Switch DNS/URL when new system is verified

---

## 5. Auth Migration

Legacy uses: custom base64 token in `users` table  
New uses: Supabase Auth (JWT)

```
Migration steps:
1. For each existing user, create a Supabase Auth account via service_role:
   POST /auth/v1/admin/users
   { email, password: temporaryPassword, user_metadata: { username } }

2. Link Supabase Auth user to users table row:
   UPDATE users SET auth_id = auth.users.id WHERE email = auth.users.email

3. Update middleware to validate Supabase JWT (not custom token)

4. Optionally: let users reset their own passwords on first new login
```

---

## 6. Performance Targets

| Metric | Legacy | Target |
|--------|--------|--------|
| Page load (first) | 3-8s | < 2s |
| Navigation (SPA) | 0ms (instant) | < 100ms |
| API call (read) | 2-4s (GAS) | < 200ms |
| API call (write) | 2-4s (GAS) | < 300ms |
| Table render (500 rows) | Slow DOM | < 50ms (virtual list) |

---

## 7. Security Improvements

| Legacy Issue | New Solution |
|-------------|-------------|
| Plaintext passwords in DB | bcrypt hashing via Supabase Auth |
| Custom base64 tokens (insecure) | Supabase JWT (RS256) |
| No token expiry | 7-day JWT with refresh tokens |
| No HTTPS enforcement | Vercel enforces HTTPS |
| Service role key in GAS | Service role only in server actions |
| No CSRF protection | Next.js App Router handles CSRF |
| Base64 avatar stored in DB | Supabase Storage (CDN) |

---

## 8. File Structure Quick Reference

```
cms-portal/
├── src/
│   ├── app/
│   │   ├── login/page.tsx
│   │   ├── dashboard/
│   │   │   ├── layout.tsx       # Sidebar + TopBar
│   │   │   ├── accounts/
│   │   │   ├── campaigns/
│   │   │   ├── users/
│   │   │   ├── drive/
│   │   │   ├── looker/
│   │   │   ├── tasks/
│   │   │   ├── analytics/
│   │   │   ├── packages/
│   │   │   ├── departments/
│   │   │   ├── team/
│   │   │   ├── workflows/
│   │   │   └── rules/
│   │   └── api/
│   │       └── cron/
│   │           └── task-reminders/route.ts
│   ├── components/
│   │   ├── layout/
│   │   ├── shared/
│   │   └── [module]/
│   ├── lib/
│   │   ├── supabase/
│   │   ├── auth/
│   │   ├── email.ts
│   │   └── removal-conditions.ts
│   ├── hooks/
│   ├── types/
│   └── middleware.ts
├── public/
├── .env.local
├── next.config.ts
├── tailwind.config.ts
└── vercel.json          # cron job schedule
```

---
