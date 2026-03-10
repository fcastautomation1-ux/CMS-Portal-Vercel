# Module 01 — Authentication & Role-Based Access Control (RBAC)

---

## 1. What This Module Does

This is the **security backbone** of the entire portal. It controls:
- Who can log in
- What role they have
- What sections/modules they can see
- What data they can read or write

Without this module working correctly, nothing else should be accessible.

---

## 2. User Roles (Hierarchy — High to Low)

| Role | Description |
|------|-------------|
| `Admin` | Full access to everything. No restrictions at all. |
| `Super Manager` | Full access. Can promote managers. Can see all users. |
| `Manager` | Can be limited by `module_access`. Manages teams within departments. |
| `Supervisor` | Mid-level role between Manager and User (created by Manager). |
| `User` | Regular user. Restricted to assigned accounts, campaigns, folders, reports. |

---

## 3. Login Flow (Step by Step)

```
1. User submits username + password
2. Frontend calls login(username, password) on backend
3. Backend fetches user row from Supabase `users` table
4. Password verified:
   a. If password_hash + password_salt exist → SHA-256 comparison
   b. If only plain password exists → direct compare (legacy, upgrades to hash)
5. On success:
   a. Generate token = Base64(username:timestamp:role)
   b. Return token + user profile object to frontend
   c. Frontend stores token in sessionStorage
6. Frontend uses token on every subsequent API call
```

---

## 4. Token Format (Legacy)

```
Base64( username + ":" + timestamp_ms + ":" + role )

Example decoded: ahsan:1741234567890:Manager
```

**Problems with this:**
- Not signed — can be forged
- No server-side revocation
- Expiry not enforced (commented out)

**New system must use:** Supabase Auth sessions (JWT) with HTTP-only cookies.

---

## 5. Password Hashing (Current Implementation)

```javascript
// Salt prefix: "GASv1_"
// Algorithm: SHA-256
// Format stored in DB: { password_hash, password_salt }

function hashPassword(password, salt) {
  combined = "GASv1_" + salt + password
  return SHA256(combined)
}
```

---

## 6. Module Access Control (JSONB Column: `module_access`)

Each Manager/Supervisor has a `module_access` JSON field that controls access per module:

```json
{
  "googleAccount": {
    "enabled": true,
    "accessLevel": "all"        // or "specific"
    "accounts": ["123-456-789"] // only used when accessLevel = "specific"
  },
  "campaigns": {
    "enabled": true,
    "accessLevel": "all"
  },
  "users": {
    "enabled": true,
    "departmentRestricted": true  // false = see all users
  },
  "drive": { "enabled": true },
  "looker": { "enabled": true },
  "todos": { "enabled": true },
  "packages": { "enabled": true }
}
```

**Rule:** If `module_access` is NULL → NO ACCESS for Manager/Supervisor roles.

---

## 7. Per-User Allow Lists

Regular Users have explicit allow-lists (stored as CSV strings in DB):

| DB Column | Meaning |
|-----------|---------|
| `allowed_accounts` | Comma-separated customer IDs. `All` = unrestricted. |
| `allowed_campaigns` | Comma-separated campaign names. `All` = unrestricted. |
| `allowed_drive_folders` | Comma-separated Google Drive folder/file IDs. |
| `allowed_looker_reports` | Comma-separated report IDs. |
| `drive_access_level` | `viewer` or `editor` |

---

## 8. Token Validation (Every API Call)

```
1. Decode Base64 token → extract username
2. Check in-memory TOKEN_CACHE (5 min TTL) → return cached if valid
3. If not cached:
   a. Fetch user from Supabase (minimal columns only, NO avatar_data)
   b. Build userObj with roles and permissions
   c. Store in TOKEN_CACHE
4. Return userObj or null
```

---

## 9. Supabase Table: `users`

Key auth-related columns:

```sql
username              TEXT PRIMARY KEY
role                  TEXT  -- 'Admin', 'Super Manager', 'Manager', 'Supervisor', 'User'
password              TEXT  -- legacy plain text (to be removed)
password_hash         TEXT  -- SHA-256 hash
password_salt         TEXT  -- UUID salt
module_access         JSONB
allowed_accounts      TEXT  -- CSV
allowed_campaigns     TEXT  -- CSV
allowed_drive_folders TEXT  -- CSV
allowed_looker_reports TEXT -- CSV
drive_access_level    TEXT  -- 'viewer' | 'editor'
department            TEXT  -- CSV (supports multi-department)
manager_id            TEXT  -- FK to users.username
team_members          TEXT  -- JSON or CSV
email                 TEXT
avatar_data           TEXT  -- base64 image (LARGE — avoid in auth queries)
last_login            TIMESTAMPTZ
email_notifications_enabled BOOLEAN DEFAULT true
```

---

## 10. Security Issues to Fix in New Build

| Issue | Fix |
|-------|-----|
| Unsigned base64 token | Use Supabase Auth JWT |
| Token expiry not enforced | Session expiry via Supabase |
| Plain text passwords in DB | Enforce hash-only, run migration |
| Supabase anon key exposed to browser | Use RLS + anon key only (no service key in browser) |
| Auth logic scattered everywhere | Centralize in one server-side policy module |
| Avatar blob in users table | Move to Supabase Storage |
| No audit log of login events | Add `auth_events` table |

---

## 11. AI Build Prompt

> **Use this prompt when building this module in Next.js + TypeScript:**

```
Build the Authentication and RBAC module for a CMS portal using Next.js 14 App Router and TypeScript.

AUTHENTICATION:
- Use Supabase Auth for session management
- Login with username + password (not email — username is the identifier)
- Store session in HTTP-only cookie using @supabase/ssr
- Middleware in middleware.ts should protect all /dashboard/* routes
- Redirect unauthenticated users to /login
- On login: fetch user profile from public.users table using username
- Return user object with: username, role, department, moduleAccess, allowedAccounts, allowedCampaigns, allowedDriveFolders, allowedLookerReports, driveAccessLevel

ROLES (in order of power):
  Admin > Super Manager > Manager > Supervisor > User

RBAC POLICY LAYER:
Create a file src/lib/permissions.ts that exports:
- canViewSection(user, sectionName): boolean
- canManageUsers(user): boolean
- canViewAccount(user, customerId): boolean
- canEditAccount(user): boolean
- canViewCampaign(user, campaignName): boolean
- canAccessDrive(user, folderId): boolean
- canViewLookerReport(user, reportId): boolean
- canManageTasks(user): boolean
- canViewAllUsers(user): boolean

MODULE ACCESS:
- Managers/Supervisors have a moduleAccess JSONB object in their user profile
- If moduleAccess is null → deny all module access for Manager/Supervisor
- Admin and Super Manager always have full access regardless of moduleAccess

PASSWORD:
- Hash with bcrypt (12 rounds) on new user creation/password change
- On login: bcrypt.compare(inputPassword, storedHash)
- Support migration from legacy SHA-256 hash during login (auto-upgrade to bcrypt on success)

TOKEN / SESSION:
- Use Supabase session tokens (no custom tokens)
- Session TTL: 24 hours with silent refresh

DATABASE TABLE: public.users
Columns needed: username (PK), role, department, email, password_hash, module_access (jsonb), 
allowed_accounts (text), allowed_campaigns (text), allowed_drive_folders (text), 
allowed_looker_reports (text), drive_access_level, manager_id, team_members (jsonb), 
avatar_url (text - Supabase Storage URL), last_login, email_notifications_enabled

RLS:
- Users can only read their own row
- Managers can read rows in their department
- Admin/Super Manager can read all rows
- Only Admin/Super Manager/Manager can write user rows

OUTPUT FILES:
- src/lib/auth.ts (session helpers)
- src/lib/permissions.ts (RBAC policy functions)
- src/middleware.ts (route protection)
- src/app/(auth)/login/page.tsx (login page)
- src/app/(auth)/login/actions.ts (server action for login)
- src/hooks/useCurrentUser.ts (client hook)
- src/types/auth.ts (TypeScript types for User, Role, ModuleAccess)
```

---
