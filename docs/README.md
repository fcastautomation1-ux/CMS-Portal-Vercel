# CMS Portal — Documentation Index

---

## What Is This Project?

A **Content Management & Operations Portal** originally built on Google Apps Script + Supabase.  
Being **migrated to Next.js 14 + TypeScript + Supabase** and deployed on Vercel.

The portal manages:
- Google Ads accounts and campaign removal rules
- User management with 5-tier RBAC
- Google Drive file management
- Looker Studio report embedding
- Task/workflow management with approvals
- Package catalog and assignments
- Analytics dashboards
- Email notifications and reminders

---

## User Roles

| Role | Level | Access Summary |
|------|-------|---------------|
| Admin | 1 (highest) | Full access to everything |
| Super Manager | 2 | Full access, cannot delete Admins |
| Manager | 3 | Module-restricted access |
| Supervisor | 4 | Read + limited task management |
| User | 5 (lowest) | Own tasks, assigned accounts only |

---

## Tech Stack (Target)

- **Frontend**: Next.js 14 App Router + React 18
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS + shadcn/ui
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth
- **Server Logic**: Next.js Server Actions
- **Data Fetching**: TanStack Query v5
- **Forms**: React Hook Form + Zod
- **Charts**: Recharts
- **Email**: Resend
- **Drive/Sheets API**: googleapis (Node.js)
- **Deployment**: Vercel

---

## Module Documentation

| File | Module | Key Topics |
|------|--------|-----------|
| [module-auth-and-rbac.md](./module-auth-and-rbac.md) | Auth & Permissions | Login flow, JWT, RBAC, module_access JSON, password hashing |
| [module-users.md](./module-users.md) | User Management | CRUD, permission matrix, profile images, drive access |
| [module-accounts.md](./module-accounts.md) | Google Accounts | Account CRUD, workflow assignment, status tracking |
| [module-campaigns-and-rules.md](./module-campaigns-and-rules.md) | Campaigns & Rules | 4 workflow tables, 24 removal conditions, rule editing |
| [module-drive-manager.md](./module-drive-manager.md) | Drive Manager | File browser, CRUD ops, folder access control |
| [module-looker-reports.md](./module-looker-reports.md) | Looker Reports | Iframe embed, URL conversion, per-report access |
| [module-tasks-workflow-notifications.md](./module-tasks-workflow-notifications.md) | Tasks & Notifications | Full task lifecycle, approvals, email, reminders |
| [module-packages.md](./module-packages.md) | Packages | Package catalog, user assignments, task integration |
| [module-frontend-architecture.md](./module-frontend-architecture.md) | Frontend Architecture | Next.js folder structure, layout, providers, middleware |
| [module-supabase-data-layer.md](./module-supabase-data-layer.md) | Supabase Data Layer | All 14 tables, schemas, RLS, indexes |
| [migration-plan-nextjs-typescript.md](./migration-plan-nextjs-typescript.md) | Migration Plan | 12-phase plan, data migration, security improvements |
| [google-stitch-ui-prompt.md](./google-stitch-ui-prompt.md) | UI Design Prompt | Full UI spec for Google Stitch / design tools |

---

## 14 Supabase Tables

`users`, `accounts`, `campaign_conditions`, `workflow_1`, `workflow_2`, `workflow_3`, `workflows`, `looker_reports`, `removal_condition_definitions`, `todos`, `todo_shares`, `notifications`, `packages`, `user_packages`, `departments`, `credentials`

---

## 13 Portal Sections (Pages)

| Route | Section |
|-------|---------|
| /login | Login |
| /dashboard/accounts | Google Accounts |
| /dashboard/campaigns | Campaigns & Rules |
| /dashboard/users | User Management |
| /dashboard/workflows | Workflows |
| /dashboard/rules | Rules |
| /dashboard/drive | Drive Manager |
| /dashboard/looker | Looker Reports |
| /dashboard/tasks | Tasks |
| /dashboard/departments | Departments |
| /dashboard/team | Team |
| /dashboard/analytics | Task Analytics |
| /dashboard/packages | Packages |

---

## Quick Answers

**Q: Can I provide Supabase URL + key so an AI can read the DB?**  
A: Yes! With your `NEXT_PUBLIC_SUPABASE_URL` and either:
- `anon key` — read data subject to RLS policies
- `service_role key` — unrestricted read/write (use with caution)

The AI can then query via REST: `GET {url}/rest/v1/{table}?apikey={key}`

**Q: Which module should be built first?**  
A: Auth → Users → Accounts → Tasks. Follow the migration plan phases.

**Q: Where are passwords stored?**  
A: Legacy: base64 encoded, some plaintext in `users.password`. New system: Supabase Auth handles hashing (bcrypt) — passwords never stored in `users` table.

---

## Legacy Source Files

| File | Lines | Description |
|------|-------|-------------|
| Code.gs | 2870 | Main GAS backend |
| DriveManager.gs | 1465 | Drive integration |
| Supabase.gs | ~200 | DB client for GAS |
| frontend.html | 36782 | Entire SPA frontend |
| drive.html | 754 | Drive UI section |

---
