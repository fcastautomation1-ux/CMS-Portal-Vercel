# Module 06 — Looker Reports

---

## 1. What This Module Does

Manages Looker Studio (formerly Google Data Studio) report links. Each report is stored with:
- A title/name
- A Looker Studio URL (which is converted to embed URL)
- A list of allowed users (access control)

Users view reports as embedded iframes inside the portal. Access is controlled per report.

---

## 2. Permission Model

| Action | Admin | Super Manager | Manager | Supervisor | User |
|--------|-------|---------------|---------|------------|------|
| View all reports | ✅ | ✅ | Depends | ❌ | Only allowed reports |
| Add report | ✅ | ✅ | ✅ | ❌ | ❌ |
| Edit report | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete report | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage access | ✅ | ✅ | ✅ | ❌ | ❌ |

---

## 3. Access Control Logic

Each report has an `allowed_users` field — a CSV string of usernames who can see it.

```
IF report.allowed_users is empty OR '*' OR 'All':
  → Report is visible to everyone (based on role)

IF report.allowed_users has specific usernames:
  → Only those users can see the report

ADDITIONAL CHECK:
  → User must also have module_access.looker.enabled = true
  → Admins and Super Managers always see all reports
```

---

## 4. URL Conversion (Edit to Embed URL)

Looker Studio reports have two URL formats:
- **View URL**: `https://lookerstudio.google.com/reporting/REPORT_ID/page/PAGE_ID`
- **Embed URL**: `https://lookerstudio.google.com/embed/reporting/REPORT_ID/page/PAGE_ID`

When saving a report, the URL is automatically converted:
```
Input: https://lookerstudio.google.com/reporting/abc123/page/p1
Convert: replace "/reporting/" with "/embed/reporting/"
Output: https://lookerstudio.google.com/embed/reporting/abc123/page/p1
```

The embed URL is what gets stored in `looker_reports.report_url`.

---

## 5. Data Model

```sql
-- Table: looker_reports
id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
title         TEXT NOT NULL
report_url    TEXT NOT NULL           -- always the embed URL
allowed_users TEXT DEFAULT ''        -- CSV: 'username1,username2' or '' for all
created_by    TEXT                   -- username of creator
created_at    TIMESTAMPTZ DEFAULT now()
updated_at    TIMESTAMPTZ DEFAULT now()
sort_order    INTEGER DEFAULT 0      -- for display ordering
```

---

## 6. Business Logic Flows

### 6.1 Displaying Reports
```
1. Load all looker_reports from Supabase
2. For each report, check if current user can see it:
   a. Is module_access.looker.enabled?
   b. Is user in allowed_users OR allowed_users is empty/all?
3. Display accessible reports as a list of cards
4. Clicking a report card opens it in an iframe (or new tab)
```

### 6.2 Adding/Editing a Report
```
1. Admin/Manager fills form: title, URL, allowed_users list
2. Convert URL to embed format automatically on save
3. Upsert into looker_reports table
4. Refresh report list
```

### 6.3 Deleting a Report
```
1. Confirm dialog
2. DELETE FROM looker_reports WHERE id = ?
3. Refresh list
```

---

## 7. Frontend UI Elements

- **Report Cards Grid**: each card shows report title, preview thumbnail (if available), allowed users count
- **Open/Embed Button**: opens report in an iframe overlay or new tab
- **Iframe Modal**: full-screen overlay with the embedded report
- **Add Report Button**: opens add form modal
- **Edit/Delete**: per-card action buttons (visible to Admin/Manager only)
- **User Access Selector**: multi-select usernames for allowed_users field
- **Search/Filter**: filter cards by title
- **Sort**: by title, created date, sort_order

---

## 8. Iframe Embedding

```html
<!-- Looker Studio embed iframe -->
<iframe
  src={report.reportUrl}
  style="border:0"
  allowFullScreen
  sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
  width="100%"
  height="700px"
/>
```

The `sandbox` attribute is important — without the right permissions the report won't load.

---

## 9. AI Build Prompt

> **Use this prompt when building this module in Next.js + TypeScript:**

```
Build the Looker Reports module for a CMS portal in Next.js 14 App Router + TypeScript.

PAGE: /dashboard/looker

FEATURES TO BUILD:

1. REPORT CARDS GRID
   - Show all accessible reports as cards in a responsive grid (3 cols desktop, 2 tablet, 1 mobile)
   - Each card shows:
     - Report title (large text)
     - Created by / created date (small gray text)
     - "Open Report" button
     - Edit / Delete icons (visible to Admin/Manager only)
   - Search input above grid to filter by title
   - Empty state: "No reports available" with Add Report CTA for managers

2. REPORT VIEWER (IFRAME MODAL)
   - Clicking "Open Report" opens a full-screen modal (or slide-over panel)
   - Inside: Looker Studio iframe with the embed URL
   - "Open in new tab" button in modal header
   - Close button (X) to dismiss modal
   - Loading spinner while iframe loads
   - Error state if iframe fails to load
   Iframe attributes:
   - src = report.reportUrl (embed format)
   - sandbox = "allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
   - allowFullScreen
   - width: 100%, height: 80vh

3. ADD/EDIT REPORT MODAL
   Fields:
   - Title (text input, required)
   - Report URL (URL input, required — auto-converted to embed format on save)
   - Allowed Users (multi-select dropdown of all usernames — empty means all users can see it)
   - Sort Order (number, optional — for display ordering)
   On save: replace /reporting/ with /embed/reporting/ in URL
   Show validation error if URL doesn't look like a Looker Studio URL

4. DELETE REPORT
   - Confirmation dialog: "Delete report 'Title'? This cannot be undone."
   - On confirm: delete from DB, remove from UI

5. URL CONVERSION
   Utility function (src/lib/looker-utils.ts):
   function convertToEmbedUrl(url: string): string {
     return url.replace(
       'lookerstudio.google.com/reporting/',
       'lookerstudio.google.com/embed/reporting/'
     )
   }

SERVER ACTIONS (src/app/dashboard/looker/actions.ts):
- getLookerReports(userId, userRole): returns accessible reports filtered by allowed_users
- saveLookerReport(data): upsert (insert or update)
- deleteLookerReport(id): delete
- getAllUsernamesForAccessControl(): for the allowed users selector

TYPES (src/types/looker.ts):
interface LookerReport {
  id: string
  title: string
  reportUrl: string        // always embed URL
  allowedUsers: string[]   // empty = all users
  createdBy: string
  createdAt: string
  sortOrder: number
}

ACCESS CONTROL:
- Admin/Super Manager: see all, full CRUD
- Manager: see all (if module_access.looker.enabled), can add/edit/delete
- User: see only reports where their username is in allowedUsers (or allowedUsers is empty)
- If module_access.looker.enabled = false: show "Access denied" message

SUPABASE QUERY:
// For non-admin users:
const reports = await supabase
  .from('looker_reports')
  .select('*')
  .or(`allowed_users.eq.,allowed_users.ilike.%${username}%`)

STYLING:
- Cards: white background, subtle shadow, hover lift effect
- Report title: bold, 18px
- "Open Report" button: primary color
- Admin-only actions: icon buttons in card top-right corner
- Smooth modal animation when opening/closing iframe viewer
- Use Tailwind aspect-ratio or fixed height for iframe container
```

---
