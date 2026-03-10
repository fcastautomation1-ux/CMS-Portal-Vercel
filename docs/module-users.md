# Module 02 — User Management

---

## 1. What This Module Does

Allows Admin, Super Manager, and Manager roles to:
- View list of all users (filtered by their own access level)
- Create new users
- Edit existing users (role, department, access settings)
- Delete users
- Configure which modules/accounts/campaigns/folders a user can access
- Upload and display profile pictures
- Assign users to managers

---

## 2. Who Can Do What

| Action | Admin | Super Manager | Manager | Supervisor | User |
|--------|-------|---------------|---------|------------|------|
| View all users | ✅ | ✅ | Department only (if module enabled) | ❌ | ❌ |
| Create users | ✅ | ✅ | Only User/Supervisor in own dept | ❌ | ❌ |
| Edit users | ✅ | ✅ | Own dept users only | ❌ | ❌ |
| Delete users | ✅ | ✅ | ❌ | ❌ | ❌ |
| Set role to Manager+ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Upload profile image | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 3. User List Filtering Rules

```
IF caller is Admin OR Super Manager:
  → Return ALL users

IF caller is Manager:
  → Read module_access.users:
    IF users.enabled = false → return empty list
    IF users.departmentRestricted = true → return only users in same department(s)
    IF users.departmentRestricted = false → return all users

IF caller is User/Supervisor:
  → Return empty (no access)
```

---

## 4. Save User Logic

When saving a user (create or update):

```
1. Validate token → get caller identity
2. Check caller permissions (role + module access)
3. If caller is Manager:
   a. Cannot set role to Admin/Super Manager/Manager
   b. New user's department must be within caller's own departments
4. If role upgrade from Manager → Super Manager:
   a. Only Admin or Super Manager can do this
5. Hash password (SHA-256 in legacy, bcrypt in new build)
6. Build payload:
   - username, role, email, department
   - password_hash, password_salt
   - allowed_accounts (CSV), allowed_campaigns (CSV)
   - allowed_drive_folders (CSV), allowed_looker_reports (CSV)
   - drive_access_level, module_access (JSONB)
   - manager_id, team_members
7. Upsert to `users` table
```

---

## 5. Profile Image

- Stored as base64 blob in `users.avatar_data` (legacy — very bad for performance)
- Fetched separately, never included in auth token validation queries
- Must be moved to Supabase Storage in new build
- Upload limit: ~500KB (raw base64)

---

## 6. Drive Access Update Logic

When a manager grants/revokes drive folder access to a user:

```
1. Validate token (Manager only)
2. Get current user row
3. Parse allowed_drive_folders CSV
4. Add or remove the folder ID
5. If granting: also call Google Drive API to share the folder with user's email
6. If revoking: also call Google Drive API to remove user's email from folder sharing
7. Write updated CSV back to DB
```

---

## 7. Supabase Table: `users` (Full Columns)

```sql
username                     TEXT PRIMARY KEY
role                         TEXT NOT NULL  -- Admin, Super Manager, Manager, Supervisor, User
email                        TEXT           -- comma-separated if multiple
department                   TEXT           -- comma-separated for multi-dept
password                     TEXT           -- legacy plain text (migrate away)
password_hash                TEXT
password_salt                TEXT
allowed_accounts             TEXT           -- CSV of customer_ids or 'All'
allowed_campaigns            TEXT           -- CSV of campaign names or 'All'
allowed_drive_folders        TEXT           -- CSV of Google Drive folder/file IDs
allowed_looker_reports       TEXT           -- CSV of looker_report IDs
drive_access_level           TEXT DEFAULT 'viewer'  -- 'viewer' | 'editor'
module_access                JSONB          -- per-module access config
manager_id                   TEXT           -- references users.username
team_members                 TEXT           -- JSON array or CSV
avatar_data                  TEXT           -- base64 (REPLACE WITH STORAGE URL)
last_login                   TIMESTAMPTZ
email_notifications_enabled  BOOLEAN DEFAULT true
created_at                   TIMESTAMPTZ DEFAULT now()
```

---

## 8. Frontend UI Elements

- **Users Table**: Shows username, role, department, last login, email
- **Add/Edit User Modal**: Full form with all fields
- **Access Tab inside modal**: Accounts/campaigns/folders/reports selector
- **Module Access Tab**: Toggle each module on/off with sub-settings
- **Profile Picture Upload**: Cropper or direct upload (image preview inline)
- **Department filter**: Filter user list by department
- **Role filter**: Filter user list by role

---

## 9. Data Relationships

```
users.manager_id → users.username (self-join, who manages this user)
users.team_members → array of usernames managed by this user
user_packages.username → users.username (package assignments)
todos.username → users.username (task creator)
todos.assigned_to → users.username (task assignee)
```

---

## 10. AI Build Prompt

> **Use this prompt when building this module in Next.js + TypeScript:**

```
Build the User Management module for a CMS portal in Next.js 14 App Router + TypeScript.

PAGE: /dashboard/users
This page is only visible to Admin, Super Manager, and Manager roles.

FEATURES TO BUILD:

1. USER LIST TABLE
   - Columns: Avatar, Username, Role (badge with color), Department, Email, Last Login, Actions
   - Filterable by: Role, Department
   - Searchable by username/email
   - Pagination (25 per page)
   - Show count of total users
   - Manager sees only their department's users (filtered server-side)

2. CREATE USER MODAL (triggered by "+ Add User" button)
   Fields:
   - Username (required, alphanumeric + underscore + hyphen, 2-50 chars)
   - Password (required, min 8 chars, show/hide toggle)
   - Confirm Password
   - Role (dropdown: User, Supervisor, Manager — Admin/Super Manager only can set higher)
   - Email (optional, supports comma-separated multiple emails)
   - Department (dropdown or text, from departments list)
   - Manager (dropdown of Manager-role users in same department)
   Tabs inside modal:
   - "Basic Info" tab (fields above)
   - "Account Access" tab: multi-select list of Google Accounts (customer IDs + names)
   - "Campaign Access" tab: multi-select or "All Campaigns" toggle
   - "Drive Access" tab: list of Drive folders with add/remove, viewer/editor toggle
   - "Looker Reports" tab: multi-select of available reports
   - "Module Access" tab (Manager/Supervisor only): toggle each module with sub-settings

3. EDIT USER: Same modal as create, pre-filled, with same permission checks

4. DELETE USER: Confirmation dialog, soft-delete or hard delete

5. PROFILE PICTURE
   - Upload button in edit modal
   - Preview image
   - Crop to square (optional)
   - Store in Supabase Storage bucket: avatars/{username}/profile.jpg
   - Display everywhere using avatar_url from users table

6. MODULE ACCESS EDITOR (inside user modal, only for Manager/Supervisor roles)
   Render this as a visual toggle panel:
   - Google Accounts module: toggle + "All Accounts" or "Specific Accounts" selector
   - Campaigns module: toggle
   - Users module: toggle + "All Users" or "Department Restricted" toggle
   - Drive module: toggle
   - Looker Reports module: toggle
   - Tasks module: toggle
   - Packages module: toggle
   Save as JSONB to module_access column.

SERVER ACTIONS (src/app/dashboard/users/actions.ts):
- getUsers(filters): fetch with role/dept filtering
- saveUser(formData): create or update
- deleteUser(username): delete
- uploadAvatar(username, file): upload to Supabase Storage
- updateDriveAccess(username, folderId, grant, level): update CSV + call Drive API

TYPES (src/types/user.ts):
interface User {
  username: string
  role: 'Admin' | 'Super Manager' | 'Manager' | 'Supervisor' | 'User'
  email: string
  department: string
  allowedAccounts: string[]
  allowedCampaigns: string[]
  allowedDriveFolders: string[]
  allowedLookerReports: string[]
  driveAccessLevel: 'viewer' | 'editor'
  moduleAccess: ModuleAccess | null
  managerId: string | null
  avatarUrl: string | null
  lastLogin: string | null
  emailNotificationsEnabled: boolean
}

interface ModuleAccess {
  googleAccount?: { enabled: boolean; accessLevel: 'all' | 'specific'; accounts?: string[] }
  campaigns?: { enabled: boolean; accessLevel: 'all' | 'specific' }
  users?: { enabled: boolean; departmentRestricted: boolean }
  drive?: { enabled: boolean }
  looker?: { enabled: boolean }
  todos?: { enabled: boolean }
  packages?: { enabled: boolean }
}

VALIDATION: Use Zod schemas for all form inputs server-side.
STYLING: Use Tailwind CSS. Role badges: Admin=purple, Super Manager=red, Manager=blue, Supervisor=yellow, User=green.
RLS: Enforce in Supabase — managers can only UPDATE rows in their department.
```

---
