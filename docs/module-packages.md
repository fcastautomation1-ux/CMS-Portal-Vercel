# Module 08 — Packages

---

## 1. What This Module Does

Manages a catalog of "packages" (app configurations, service bundles, or product packages). Packages can be:
- Created and managed in the catalog
- Assigned to specific users
- Used when creating tasks (as a selection field — "which package does this task relate to?")

---

## 2. Permission Model

| Action | Admin | Super Manager | Manager | Supervisor | User |
|--------|-------|---------------|---------|------------|------|
| View package catalog | ✅ | ✅ | ✅ | ❌ | Only assigned packages |
| Add package | ✅ | ✅ | ✅ | ❌ | ❌ |
| Edit package | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete package | ✅ | ✅ | ✅ | ❌ | ❌ |
| Assign packages to user | ✅ | ✅ | ✅ | ❌ | ❌ |
| View own packages | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 3. Data Model

```sql
-- Table: packages
id           UUID PRIMARY KEY DEFAULT gen_random_uuid()
name         TEXT NOT NULL UNIQUE
description  TEXT
category     TEXT              -- optional grouping
price        NUMERIC           -- optional price field
is_active    BOOLEAN DEFAULT true
created_by   TEXT              -- FK → users.username
created_at   TIMESTAMPTZ DEFAULT now()
updated_at   TIMESTAMPTZ DEFAULT now()
```

```sql
-- Table: user_packages
id         UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id    TEXT NOT NULL     -- FK → users.username
package_id UUID NOT NULL     -- FK → packages.id
assigned_by TEXT             -- FK → users.username
assigned_at TIMESTAMPTZ DEFAULT now()

UNIQUE(user_id, package_id)
```

---

## 4. Business Logic Flows

### 4.1 Package Assignment (Replace-All Pattern)
```
When Admin/Manager assigns packages to a user:
1. Receive: userId + list of packageIds (new desired set)
2. DELETE FROM user_packages WHERE user_id = userId
3. INSERT INTO user_packages all rows: (userId, packageId, assignedBy)
4. This is a full replace — the new list replaces everything
```

### 4.2 Getting My Packages
```
User/anyone calls getMyPackages(userId):
1. Query user_packages WHERE user_id = userId
2. JOIN with packages table to get names
3. Return list of {id, name, description} for this user
4. Used in task creation → the package dropdown is populated from this list
```

### 4.3 Getting All Packages (Catalog)
```
Admin/Manager calls getPackages():
1. SELECT * FROM packages WHERE is_active = true
2. For each package, optionally include count of assigned users
3. Return full catalog list
```

---

## 5. Relationship to Tasks

When a user creates a task:
- They see a **Package** dropdown
- This dropdown is populated from `getMyPackages(currentUser.id)`
- Only packages assigned to that user appear
- The task stores `package_id` and `package_name` (denormalized)

---

## 6. Frontend UI Elements

### Package Catalog Page
- **Packages Table**: name, description, category, active status, assigned users count, actions
- **Add Package Modal**: name, description, category, price, active toggle
- **Edit Package Modal**: same fields
- **Delete Package**: confirmation dialog
- **Search/Filter**: filter by name, category, status

### User Package Assignment (within Users module)
- In the Edit User modal (or separate section)
- Multi-select list of all packages
- Currently assigned packages are pre-checked
- Save button → triggers replace-all assignment

---

## 7. AI Build Prompt

> **Use this prompt when building this module in Next.js + TypeScript:**

```
Build the Packages module for a CMS portal in Next.js 14 App Router + TypeScript.

PAGE: /dashboard/packages

FEATURES:

1. PACKAGES CATALOG TABLE
   Columns: Name, Description, Category, Active (badge), Assigned Users (count), Actions
   Features:
   - Search by name
   - Filter by category, active status
   - Sort by name, created date
   - Add Package button (admin/manager only)
   - Edit/Delete per row (admin/manager only)

2. ADD/EDIT PACKAGE MODAL
   Fields:
   - Name (text, required, must be unique)
   - Description (textarea)
   - Category (text or dropdown from existing categories)
   - Price (number, optional)
   - Active (toggle, default true)

3. DELETE PACKAGE
   - Check if package is assigned to users before deleting
   - If assigned: warn "This package is assigned to X users. Remove assignments first?"
   - Or allow force delete (removes user_packages entries too)

4. USER PACKAGE ASSIGNMENT
   In the Users module (Edit User modal → Packages tab):
   - Fetch all packages from catalog
   - Show as checkboxes or multi-select
   - Pre-select packages currently assigned to that user
   - Save → triggers assignPackagesToUser (replace-all strategy)
   
   Also accessible from Packages page:
   - "Manage Users" button per package
   - Opens modal with user multi-select showing who has this package

5. MY PACKAGES VIEW (for regular users)
   - Simple list/grid of packages assigned to them
   - Name, description, category
   - Read-only (no add/remove)

SERVER ACTIONS (src/app/dashboard/packages/actions.ts):
- getPackages(filters?): all catalog packages with user count
- savePackage(data): upsert (insert or update)
- deletePackage(id): delete + remove user_packages entries
- assignPackagesToUser(userId, packageIds[]): DELETE then INSERT all
- getUserPackages(userId): packages for specific user
- getMyPackages(userId): for task creation dropdown
- getUsersForPackage(packageId): all users with this package
- getAllCategories(): distinct category values for filter

TYPES (src/types/package.ts):
interface Package {
  id: string
  name: string
  description?: string
  category?: string
  price?: number
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  assignedUsersCount?: number  // from JOIN
}

interface UserPackage {
  id: string
  userId: string
  packageId: string
  package?: Package  // populated on join
  assignedBy: string
  assignedAt: string
}

SUPABASE TABLES: packages, user_packages

RLS:
- All authenticated users can SELECT packages (catalog is public within app)
- Only Admin/Super Manager/Manager can INSERT, UPDATE, DELETE packages
- Users can SELECT their own user_packages rows
- Only Admin/Manager can INSERT/DELETE user_packages

INTEGRATION WITH TASK CREATION:
In the task creation form:
- Package field: <Select> populated by getMyPackages(currentUserId)
- When creating task as manager on behalf of user: use getMyPackages(assignedToUserId)
- Store selected packageId and packageName in task record
```

---
