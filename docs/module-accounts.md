# Module 03 — Google Accounts

---

## 1. What This Module Does

Manages Google Ads advertiser accounts (customers). Each account:
- Has a unique `customer_id`
- Is linked to a Google Sheet (for campaign data upload)
- Has an optional Drive folder/file for code comments
- Has a workflow setting (which automation workflow runs for it)
- Has an enabled/disabled toggle
- Has a status and last run timestamp

---

## 2. Who Can Do What

| Action | Admin | Super Manager | Manager | Supervisor | User |
|--------|-------|---------------|---------|------------|------|
| View accounts | ✅ All | ✅ All | Depends on module_access | ❌ | Only allowed_accounts |
| Create account | ✅ | ✅ | ✅ | ❌ | ❌ |
| Edit account | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete account | ✅ | ✅ | ✅ | ❌ | ❌ |
| Toggle enabled | ✅ | ✅ | ✅ | ❌ | ❌ |
| Batch toggle | ✅ | ✅ | ✅ | ❌ | ❌ |

---

## 3. Account Filtering Rules

```
IF caller is Admin:
  → Return ALL accounts

IF caller is Super Manager:
  → Return ALL accounts

IF caller is Manager:
  → Read module_access.googleAccount:
    IF not configured → NO ACCESS
    IF enabled = false → NO ACCESS
    IF accessLevel = 'all' → return all
    IF accessLevel = 'specific' → return only accounts in .accounts array

IF caller is User:
  → Return only accounts in user.allowed_accounts CSV
  → If allowed_accounts contains '*' or 'All' → return all
```

---

## 4. Account Data Model

```sql
-- Table: accounts
customer_id        TEXT PRIMARY KEY    -- Google Ads customer ID (e.g. "123-456-7890")
google_sheet_link  TEXT                -- URL to linked Google Spreadsheet
drive_code_comments TEXT               -- comma-separated Drive folder/file IDs
enabled            BOOLEAN DEFAULT true
status             TEXT DEFAULT 'Pending'  -- 'Pending', 'Running', 'Success', 'Error'
last_run           TIMESTAMPTZ
workflow           TEXT DEFAULT 'workflow-0'  -- 'workflow-0', 'workflow-1', etc.
created_date       TIMESTAMPTZ DEFAULT now()
```

---

## 5. Workflow Assignment

Each account is assigned to ONE workflow:
- `workflow-0` → default (campaign_conditions table)
- `workflow-1` → workflow_1 table
- `workflow-2` → workflow_2 table
- `workflow-3` → workflow_3 table

The workflow determines which automation logic processes this account.

---

## 6. Status Values

| Status | Meaning |
|--------|---------|
| `Pending` | Never run |
| `Running` | Currently being processed |
| `Success` | Last run completed without errors |
| `Error` | Last run failed |

---

## 7. Batch Operations

Manager can select multiple accounts and:
- Enable all selected
- Disable all selected

```
Uses Supabase: accounts WHERE customer_id IN (id1, id2, ...) → PATCH enabled
```

---

## 8. Drive Code Comments Field

This field can store:
- Free text comments
- OR comma-separated Google Drive folder/file IDs

The frontend detects if the value contains `drive.google.com` or `/folders/` to determine if it is Drive links.

---

## 9. Frontend UI Elements

- **Accounts Table**: customer_id, status badge, workflow label, enabled toggle, last run, actions
- **Add/Edit Account Modal**: customer_id, sheet link, drive comments, workflow selector, enabled toggle
- **Status Indicator**: colored badge (green=success, yellow=running, red=error, gray=pending)
- **Batch Actions**: checkboxes + bulk enable/disable buttons
- **Account Search**: filter by customer_id
- **Enabled Filter**: show only active or all

---

## 10. Related Entities

```
accounts.customer_id → campaign_conditions.customer_id (campaign rules)
accounts.customer_id → workflow_1.customer_id
accounts.customer_id → workflow_2.customer_id
accounts.customer_id → workflow_3.customer_id
accounts.customer_id → users.allowed_accounts (access control CSV)
accounts.google_sheet_link → Google Sheets API (campaign sync)
```

---

## 11. AI Build Prompt

> **Use this prompt when building this module in Next.js + TypeScript:**

```
Build the Google Accounts module for a CMS portal in Next.js 14 App Router + TypeScript.

PAGE: /dashboard/accounts
This is the default landing page after login.

FEATURES TO BUILD:

1. ACCOUNTS TABLE
   Display columns:
   - Customer ID (monospace font, copyable)
   - Workflow (badge: W0=gray, W1=blue, W2=purple, W3=orange)
   - Status (badge: Pending=gray, Running=yellow, Success=green, Error=red)
   - Enabled (toggle switch, clickable to immediately toggle)
   - Last Run (relative time: "2 hours ago")
   - Actions (Edit button, Delete button)
   Features:
   - Search/filter by customer ID
   - Filter by status, workflow, enabled state
   - Select all checkbox for batch operations
   - Batch enable/disable button when items selected
   - Sort by last run date

2. ADD/EDIT ACCOUNT MODAL
   Fields:
   - Customer ID (required, text, immutable after creation — show as disabled on edit)
   - Google Sheet Link (required, URL input with validation)
   - Drive Code Comments (textarea — can be free text or paste Drive folder URLs)
   - Workflow (dropdown: Workflow 0 (Default), Workflow 1, Workflow 2, Workflow 3)
   - Enabled (checkbox toggle)

3. DELETE ACCOUNT
   - Confirmation dialog with customer ID shown
   - Cascade warning if account has campaign rules

4. STATUS BADGE COMPONENT
   Reusable component: <StatusBadge status="Success|Error|Running|Pending" />

5. ENABLED TOGGLE
   - Clicking toggle calls updateAccountStatus immediately (optimistic update)
   - Show loading spinner on toggle while saving

6. ACCOUNT DETAIL VIEW (optional, clicking customer ID)
   - Shows all campaigns linked to this account
   - Shows workflow assignment
   - Shows last run details

SERVER ACTIONS (src/app/dashboard/accounts/actions.ts):
- getAccounts(token, filters): filtered by user role + module access
- saveAccount(data, existingId): upsert
- deleteAccount(customerId): delete
- toggleAccount(customerId, enabled): patch enabled field
- batchToggleAccounts(customerIds, enabled): patch multiple rows

DATA TYPE (src/types/account.ts):
interface Account {
  customerId: string
  googleSheetLink: string
  driveCodeComments: string
  enabled: boolean
  status: 'Pending' | 'Running' | 'Success' | 'Error'
  lastRun: string | null
  workflow: 'workflow-0' | 'workflow-1' | 'workflow-2' | 'workflow-3'
  createdDate: string
}

PERMISSIONS:
- Admin/Super Manager: see all, full CRUD
- Manager: filtered by module_access.googleAccount config
- User: filtered by allowed_accounts CSV field
- Show/hide Add Account button based on role

STYLING: Tailwind CSS. Table with sticky header. Status badges are colored pills.
Use optimistic updates for toggle switch (don't wait for server to update UI).

SUPABASE TABLE: public.accounts
Ensure RLS:
- All authenticated users can SELECT (filtered by server-side logic)
- Only Admin/Super Manager/Manager roles can INSERT, UPDATE, DELETE
```

---
