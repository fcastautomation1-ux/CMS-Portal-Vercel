# Google Stitch / AI UI Design Prompt
## CMS Portal (Funsol Central Configuration Portal) — Complete UI Design Specification

---

> **HOW TO USE THIS FILE:**
> Copy the entire content below the horizontal line and paste it into Google Stitch, Figma AI, v0.dev, or any AI UI design tool. It is a complete, self-contained design spec for the entire portal, written directly from the real source code.

---

---

## MASTER UI DESIGN PROMPT

Design a complete, production-ready **Central Configuration Portal** web application called **"Funsol"**.

This is an **internal B2B operations dashboard** for a digital marketing agency managing Google Ads accounts, campaign automation rules, user access, file management, task workflows, and analytics. There is NO public-facing UI — this is a private internal tool only.

---

### EXACT BRAND & VISUAL IDENTITY (from real source code)

**CSS Variables (use these exact values):**

```css
:root {
  --color-white: #FFFFFF;
  --color-off-white: #F8FAFC;
  --color-black: #0F172A;
  --color-dark-gray: #334155;
  --color-medium-gray: #64748B;
  --color-light-gray: #E2E8F0;
  --color-accent: #3B82F6;          /* Primary button color */
  --color-accent-hover: #2563EB;
  --color-accent-glow: rgba(59, 130, 246, 0.15);
  --color-success: #10B981;
  --color-error: #EF4444;
  --color-warning: #F59E0B;
  --sidebar-bg: linear-gradient(180deg, #0F172A 0%, #1E293B 100%);
  --card-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
  --card-shadow-hover: 0 10px 25px rgba(0,0,0,0.08), 0 4px 10px rgba(0,0,0,0.04);
}
```

**Typography:**
- **Body font**: `Inter` (weights: 300, 400, 500, 600, 700)
- **Heading font**: `Plus Jakarta Sans` (weights: 500, 600, 700, 800) — letter-spacing: -0.02em — used for all h1–h6
- **Monospace (IDs, codes)**: `JetBrains Mono`
- Load all three from Google Fonts

**Additional colors used in source:**
- Navigation active items: `#6366F1` (Indigo-500) — NOT the same as the button blue
- Notification bell gradient: `#6366F1 → #4F46E5`
- KPI card gradients: indigo `#6366F1→#4F46E5`, blue `#2563EB→#1D4ED8`, green `#10B981→#059669`, amber `#F59E0B→#D97706`, red `#F43F5E→#E11D48`, purple `#8B5CF6→#7C3AED`, lime `#84CC16→#65A30D`
- Looker hero header gradient: `#4285F4 → #0D47A1 → #1565C0` (Google blue)
- Error/danger text color: `#F43F5E` (slightly different from --color-error which is #EF4444)
- Page main background: `#F8FAFC` (not white)
- Card backgrounds: `#FFFFFF` with border `1px solid #E2E8F0`

**Design style:** Clean, modern SaaS. Dense information display (this is a power-user internal tool, not a marketing site). Cards with subtle shadows. Smooth transitions. **No dark mode** — sidebar is always dark (`#0F172A → #1E293B`), main content is always light (`#F8FAFC`).

---

### APPLICATION SHELL — TWO-PANEL LAYOUT

```
+---------------------+------------------------------------------+
| SIDEBAR (260px)     |  MAIN CONTENT AREA                      |
| dark gradient       |  background: #F8FAFC                    |
| #0F172A → #1E293B   |  padding: 24px                          |
|                     |                                          |
| [Header]            |  PAGE TITLE + SUBTITLE                  |
|  🔐 Funsol + Bell   |  ─────────────────────────────────────  |
|  Live Sync dot      |  [Section toolbar: search + buttons]    |
|                     |  [Table / Cards / Grid / Kanban]        |
| [Nav Items List]    |                                          |
|                     |                                          |
| [Footer]            |                                          |
|  Avatar + User + ⋮  |                                          |
+---------------------+------------------------------------------+
```

**IMPORTANT:** There is NO separate topbar. The sidebar contains everything including the notification bell. Main content area starts directly at the top — no header bar above the content.

---

### SIDEBAR — EXACT SPEC

- **Width (expanded)**: 260px
- **Width (collapsed)**: 72px — collapses to icon-only by default
- **Hover behavior**: Hovering a collapsed sidebar expands it temporarily to ~280px
- **Lock**: A pin/lock icon makes sidebar stay expanded permanently
- **Background**: `linear-gradient(180deg, #0F172A 0%, #1E293B 100%)` — ALWAYS dark, no light mode
- **Right border**: `1px solid rgba(255,255,255,0.06)`
- **Box shadow**: `4px 0 24px rgba(0,0,0,0.12)`
- **Transition**: `width 0.25s cubic-bezier(0.4,0,0.2,1)`

**Sidebar Header (top section):**
- App name: `🔐 Funsol` — large bold white text
- Subtitle: `Central Configuration Portal` — small muted gray text below
- Live sync indicator: animated pulsing green dot `•` + text `"Live Sync Active"` (green text)
- **🔔 Notification Bell** — top-right corner of sidebar header (NOT in any separate topbar):
  - Button background: `linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)`
  - Border-radius: 12px, padding: 10px 12px
  - Bell icon: 🔔 emoji, ~24px
  - Red badge: absolute positioned over bell, gradient `#F43F5E → #DC2626`, animated pulsing
  - Hover: `translateY(-2px) scale(1.05)` with stronger drop shadow

**Navigation Items** (each 44px tall):
- Each item: icon + label text + optional badge count pill on right
- Hover state: semi-transparent light background
- **Active/selected state**: `rgba(99,102,241,0.15)` background + `3px solid #6366F1` left border + text color `#6366F1`
- Badge pill: rounded, small, white/light text on indigo/blue bg

| Emoji Icon | Label | Badge | Visibility |
|-----------|-------|-------|-----------|
| 📊 | Accounts | count | Always visible |
| 🎯 | Campaigns | count | Always visible |
| 👥 | Users | count | Always visible |
| ⚙️ | Workflows | count | Always visible |
| 📜 | Removal Rules | — | Role-controlled (hidden by default) |
| 📂 | Drive Manager | — | Role-controlled (hidden by default) |
| 📈 | Looker Studio | count | Role-controlled (hidden by default) |
| 📝 | To-Do List | count | Always visible |
| 🏢 | Departments | count | Role-controlled (hidden by default) |
| 👥 | My Team | count | Role-controlled (hidden by default) |
| 📊 | Task Analytics | — | Role-controlled (hidden by default) |
| 📦 | Packages | count | Role-controlled (hidden by default) |

**Sidebar Footer (user section at bottom):**
```
[ Avatar circle ]   username          [role pill]   [ ⋮ ]
```
- Avatar: 36px circle with gradient background, white initials fallback
- Username: bold white text
- Role: small colored pill badge
- **⋮ Three-dot menu** — clicking opens a popover UPWARD:
  - 📷 Change Photo
  - 🔐 Change Password
  - ─────────── (horizontal divider)
  - 🚪 Logout (red colored text)

---

### NOTIFICATION DROPDOWN

Clicking the sidebar bell opens a fixed dropdown panel (NOT inside sidebar):

```
┌────────────────────────────────────────────────────────────┐
│  [ Indigo gradient header — sticky ]                       │
│    🔔 Notifications              [ Mark all read button ]  │
│    [ All ]  [ Unread ]  [ Read ]   ← filter tabs          │
│    [ 🔍 Search notifications... ]                          │
├────────────────────────────────────────────────────────────┤
│  [●] Task assigned to you                                  │
│      "Update Q4 campaign rules"               2 min ago   │
├────────────────────────────────────────────────────────────┤
│  [●] Your task was approved                               │
│      "Review Looker reports"                  1 hr ago    │
├────────────────────────────────────────────────────────────┤
│  [ ] Overdue reminder                                      │
│      "Update campaign rules for..."           Yesterday   │
└────────────────────────────────────────────────────────────┘
```

- **Width**: 420px, max-width: `calc(100vw - 40px)`
- **Position**: `position: fixed`, top: 70px, right: 20px (viewport-relative, NOT sidebar-relative)
- **Background**: white, `border-radius: 20px`
- **Shadow**: `0 20px 60px rgba(0,0,0,0.3)`
- **Border**: `2px solid #E0E7FF`
- **Header**: `linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)`, sticky, padding 20px
- Filter buttons: All / Unread / Read (glassmorphism style — semi-transparent white bg)
- Search: text input inside the header area
- List: scrollable, `max-height: calc(100vh - 100px)`
- Blue dot = unread, gray dot = read

---

### PAGE 1: LOGIN

**Layout:** Full-page centered, single card (max-width: 420px), no large logo above.

```
          [ → Arrow icon in a white rounded box (48×48px, border-radius: 12px) ]

          Sign in with email
          (h1, 28px, font-weight: 700, color: #1E293B)

          Email or Username
          [ ✉  text input field                                    ]

          Password
          [ 🔒  password input field                  | 👁️ toggle ]

          [ Log in  ←  full-width button, background: #3B82F6     ]

          [ Error message area — hidden until error occurs        ]
            background: rgba(244,63,94,0.1)
            border: 1px solid rgba(244,63,94,0.2)
            color: #F43F5E, border-radius: 8px
```

**Exact text (must be accurate):**
- H1: **"Sign in with email"** — NOT "Welcome Back", NOT "Sign in to your account"
- Input label: **"Email or Username"** — NOT just "Email"
- Submit button: **"Log in"** — NOT "Sign In", NOT "Login"
- **NO** "Forgot password?" link (not in the actual source)
- **NO** social login buttons
- **NO** large app logo above the card — only the `→` arrow icon in a white box

---

### PAGE 2: ACCOUNTS MANAGEMENT (/dashboard/accounts)

**Page title:** `📊 Accounts Management`
**Subtitle:** `"Manage your Google Ads accounts and configurations"`

**Section toolbar:**
```
Left:   Accounts  [live refresh indicator]
Right:  [✅ Enable Selected]  [⏸️ Disable Selected]  [+ Add New Account]  [🔄 Refresh]
```
The Enable/Disable Selected bulk buttons appear ONLY when rows are checked.

**ACCOUNTS TABLE — 10 EXACT COLUMNS (in order):**

```
┌────┬──────────────┬──────────────────────┬───────────────┬───────────┬──────────┬─────────┬──────────┬────────┬─────────┐
│ ☐  │ Customer ID  │ Google Sheet Link    │ Drive Comments│ Campaigns │ Workflow │ Enabled │ Last Run │ Status │ Actions │
└────┴──────────────┴──────────────────────┴───────────────┴───────────┴──────────┴─────────┴──────────┴────────┴─────────┘
```

Column-by-column details:
1. **Checkbox** — row select checkbox
2. **Customer ID** — monospace font, copyable, e.g. `123-456-7890`
3. **Google Sheet Link** — truncated URL, clicking opens the sheet in a new tab
4. **Drive Comments** — short text excerpt from drive/comments field
5. **Campaigns** — number or list of linked campaigns
6. **Workflow** — colored badge: W0=gray "Default", W1=blue, W2=purple, W3=orange
7. **Enabled** — toggle switch: green ON, gray OFF — clicking triggers immediate API call
8. **Last Run** — relative time: "2 hours ago" / "Running..." / "Never" / "1 day ago"
9. **Status** — pill badge:
   - Pending → gray pill
   - Running → amber pill + animated spinner icon
   - ✓ Success → green pill
   - ✗ Error → red pill
10. **Actions** — Edit (pencil icon) + Delete (trash icon)

**Add/Edit Account Modal:**
- Title: "Add Account" or "Edit Account"
- Fields stacked vertically:
  - Customer ID (text, monospace font, disabled/read-only on edit)
  - Google Sheet Link (URL input)
  - Drive Code Comments (textarea, ~4 rows)
  - Workflow (select: W0 Default / W1 / W2 / W3)
  - Enabled (toggle switch)
- Footer buttons: [Cancel] [Save]

---

### PAGE 3: CAMPAIGN MANAGEMENT (/dashboard/campaigns)

**Page title:** `🎯 Campaign Management`
**Subtitle:** `"View and manage conditions for all campaigns across your accounts"`

**Section bar:** `All Campaigns` heading + [🔄 Refresh]

**Content layout:** Campaigns are displayed **grouped by account** — each account is a collapsible section/card header with its associated campaigns listed inside.

```
┌─────────────────────────────────────────────────────────────────┐
│ Account: 123-456-7890  (Workflow 0)                    [ ▼ ]   │
├────────────────────────┬────────────────┬──────────┬───────────┤
│ Campaign Name          │ Conditions     │ Status   │ Actions   │
├────────────────────────┼────────────────┼──────────┼───────────┤
│ Brand Campaign Q4 2025 │ 3 rules        │ Active   │ Edit      │
│ Awareness October      │ 1 rule         │ Active   │ Edit      │
└────────────────────────┴────────────────┴──────────┴───────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Account: 234-567-8901  (Workflow 1)                    [ ▼ ]   │
├────────────────────────┬────────────────┬──────────┬───────────┤
│ ...                    │ ...            │ ...      │ ...       │
└────────────────────────┴────────────────┴──────────┴───────────┘
```

---

### PAGE 4: WORKFLOW MANAGEMENT (/dashboard/workflows)

**Page title:** `⚙️ Workflow Management`
**Subtitle:** `"Monitor and manage automated workflows"`

**Table:** Workflow name, Description, Enabled toggle, Actions (Edit)

---

### PAGE 5: REMOVAL RULES MANAGER (/dashboard/rules)

**Page title:** `📜 Removal Rules Manager`
**Subtitle:** `"Define and manage campaign removal conditions"`

**Toolbar:**
```
[ + Add Rule ]   [ 🔄 Restore Defaults  (tooltip: restore defaults if list is empty) ]   [ 🔄 Refresh ]
```

**TABLE — 4 COLUMNS:**
```
┌────┬──────────────────────────────┬──────────────────────────────────────┬─────────┐
│ ID │ Name                         │ Description                          │ Actions │
├────┼──────────────────────────────┼──────────────────────────────────────┼─────────┤
│  1 │ Spend Over Budget            │ Campaign spend exceeds threshold      │ Edit Del│
│  2 │ Low CTR                      │ Click-through rate below minimum      │ Edit Del│
│ ..│ (approx 24 total rows)        │                                      │         │
└────┴──────────────────────────────┴──────────────────────────────────────┴─────────┘
```

---

### PAGE 6: USER MANAGEMENT (/dashboard/users)

**Page title:** `👥 User Management`

**Filter bar above table:**
```
[ 🔍 Search users... ]    [ All Roles ▼ ]    [ All Departments ▼ ]
```
Search input focuses with indigo border glow. Role dropdown: All / Admin / Super Manager / Manager / Supervisor / User.

**TABLE — 6 EXACT COLUMNS:**
```
┌──────────────────┬──────────────────────────┬──────────────┬──────────────────┬──────────────┬─────────┐
│ Username         │ Email                    │ Role         │ Allowed Accounts │ Last Login   │ Actions │
└──────────────────┴──────────────────────────┴──────────────┴──────────────────┴──────────────┴─────────┘
```

Note: The column is **"Allowed Accounts"** — NOT "Department". Department is a separate attribute visible on the user profile, not a table column.

**Role badge colors:**
- Admin → `#7C3AED` purple background, white text
- Super Manager → `#1D4ED8` blue
- Manager → `#059669` green
- Supervisor → `#D97706` orange
- User → `#6B7280` gray

**Add/Edit User Modal — 6 Tabs:**

```
[Basic Info] [Account Access] [Campaign Access] [Drive Access] [Looker Reports] [Module Access]

TAB 1 - BASIC INFO:
- Username (text)
- Full Name (text)
- Email (email)
- Role (select)
- Department (select)
- Manager (user picker — shows for non-admin)
- Password / Reset Password
- Profile Photo (upload + preview circle)
- Email notifications toggle

TAB 2 - ACCOUNT ACCESS:
- Access Type: [All Accounts] or [Specific Accounts]
- If specific: multi-select checklist of all accounts

TAB 3 - CAMPAIGN ACCESS:
- List of campaign names (text input, comma-separated)
- Or visual tag input

TAB 4 - DRIVE ACCESS:
- Drive Access Level: [None] [View] [Upload] [Full]
- Folder Restrictions: [All Folders] or [Specific Folders]
- If specific: paste folder IDs (one per line)

TAB 5 - LOOKER REPORTS:
- List of accessible report IDs or [All Reports]

TAB 6 - MODULE ACCESS:
- Toggle switches for each module:
  [Google Accounts] [Campaigns] [Users] [Drive] [Looker] [Tasks] [Packages]
- Each toggle: label + description + on/off switch
```

---

### PAGE 7: DRIVE MANAGER (/dashboard/drive)

```
TOOLBAR (sticky):
[ ← Back ]  [ My Drive > FolderA > SubFolder ]  [ New ▼ ]  [ Upload ]  [ Search ]  [ Grid|List ]
```
- Breadcrumb: each segment is clickable
- New dropdown: Folder / Sheet / Doc / Slides
- Grid/List toggle: icon-only buttons on right

**Storage Quota Bar (below toolbar):**
```
Used: ████████░░  12.4 GB / 15 GB (83%)
```
Progress bar fill + "X GB of Y GB used" text label

**Grid View (4 columns desktop, responsive):**
```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│   📁     │  │   📄     │  │   📊     │  │   📁     │
│ FolderA  │  │Report.pdf│  │Data.xlsx │  │ Designs  │
│ 2d ago   │  │ 2.4 MB   │  │ 450 KB   │  │ 5d ago   │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

**Right-click / three-dot context menu per item:**
- Open / Open in New Tab
- Rename
- Move to...
- Get shareable link ← copies to clipboard + shows toast
- Share with email addresses...
- Delete
- Properties

**File Viewer Modal (triggered on click):**
- `position: fixed`, full `100vw × 100vh`
- Background: `rgba(0,0,0,0.95)` + `backdrop-filter: blur(10px)`
- Header bar: file icon + filename + "Open in Drive ↗" button + close ✕
- Content: `<img>` for images (scroll-to-zoom), `<iframe>` for PDFs / Docs / Sheets / Slides

**Upload Progress Toast:**
```
📤 Uploading "report.pdf"
[████████░░]  78%
```

---

### PAGE 8: LOOKER STUDIO (/dashboard/looker)

**Gradient Hero Header (card with rounded corners):**
```css
background: linear-gradient(135deg, #4285F4 0%, #0D47A1 50%, #1565C0 100%)
border-radius: 24px
padding: 32px 40px
```
Content: animated floating semi-transparent white circles in background + `📈 Looker Studio Reports` title (white) + description subtitle (white semi-transparent).

**Action toolbar (below hero, white card):**
```
Left:  "Your Reports"  +  "Browse your available dashboards" subtitle
Right: [ + Add Report (green button) ]  [ 🔄 Refresh ]
```

**Reports Grid:**
```css
grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
gap: 20px;
```

Each report card (white bg, border-radius: 20px, hover lifts):
```
       [ 📊 large icon — 64px ]

       Report Name  (bold, 18px)
       Created by: username
       Date: Jan 15, 2025

       [ Open Report ▶ — primary button ]
                        [ ✏️ edit ]  [ 🗑️ delete ]
```

**Full-Screen Report Viewer (opens on "Open Report" click):**
```
position: fixed
width: 100vw
height: 100vh
z-index: 99999
background: rgba(0,0,0,0.95)

┌────────────────────────────────────────────────────────────────────────┐
│ [ Blue gradient header — same as hero ]                                │
│   📊  Report Name                                      [ ✕ Close ]    │
├────────────────────────────────────────────────────────────────────────┤
│ [ White sub-header bar ]  Report Title Text                            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  [ Looker Studio iframe — fills remaining height ]                     │
│    Loading spinner overlay while iframe loads                          │
│    "Dismiss Loading" button if it takes too long                       │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│  👤  Authorized Access For:  [ username — #3B82F6 bold ]              │
└────────────────────────────────────────────────────────────────────────┘
```

---

### PAGE 9: TO-DO LIST (/dashboard/tasks)

**Page title:** `📝 To-Do List`

This is the most feature-rich section of the entire portal. It has 3 view modes, 7 KPI stat cards, a comprehensive multi-layer filter system, a full task routing engine, approval chains, multi-assignment, delegation, department queues, attachments, draft auto-save, sharing, and export.

---

#### KPI STAT CARDS ROW (7 cards, top of page, each clickable to filter tasks)

```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ 📊              │ │ AS              │ │ ✅              │ │ ⏳              │
│     47          │ │     23          │ │     12          │ │      8          │
│ Total Tasks     │ │ Assigned To Me  │ │ Completed       │ │ Pending         │
│ indigo gradient │ │ blue gradient   │ │ green gradient  │ │ amber gradient  │
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ 🚀              │ │ ⏰              │ │ 📅              │
│      6          │ │      3          │ │      5          │
│ In Progress     │ │ Overdue         │ │ Due Today       │
│ lime gradient   │ │ red gradient    │ │ purple gradient │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

| Card | Gradient Colors |
|------|----------------|
| Total Tasks | `#6366F1 → #4F46E5` indigo |
| Assigned To Me | `#2563EB → #1D4ED8` blue |
| Completed | `#10B981 → #059669` green |
| Pending | `#F59E0B → #D97706` amber |
| In Progress | `#84CC16 → #65A30D` lime |
| Overdue | `#F43F5E → #E11D48` red |
| Due Today | `#8B5CF6 → #7C3AED` purple |

Card styling: `border-radius: 16px`, count number `font-size: 36px`, label below count, `cursor: pointer`, hover: `translateY(-2px)`.

---

#### QUICK FILTER DROPDOWN + TEAM FILTERS

```
[ 📋 My Pending ▼  (8) ]     [ 🏢 All Departments ▼ ]   [ 👤 All Members ▼ ]
```

Quick filter options (dropdown, default = "My Pending"):
- 🗂️ All Tasks
- 📋 My Pending ← **default**
- 📌 My Tasks
- 👥 Assigned By Me
- ✅ Need My Approval
- 🧾 Others' Approval

Department and Member dropdowns: shown only for Manager / Admin roles.

---

#### ACTION BAR (below filters)

**Left side (flex, wrapping):**
```
[ ➕ Add Task ]  [ 📄 Drafts ]  [ 🔄 Refresh ]  [ 📥 Dept Queue ]  (last: managers only)
[ ☐ Select All ]  → bulk actions appear: [ ✓ Complete ] [ 👥 Share ] [ 🗑️ Delete ] [ 📦 Archive ] [ ✕ Clear ]
[ 📋 Templates ▼ ]: 📅 Meeting Template  /  💼 Project Template  /  📞 Follow-up Template
[ 📋 List ] [ 📊 Kanban ] [ 📅 Calendar ]  ← 3 view toggle buttons (active = indigo background)
[ 📥 Export ▼ ]: 📊 Export CSV  /  📄 Export JSON
```

**Right side (filter bar):**
```
[ 🔍 Search (120px) ]  [ Smart List ▼ ]  [ Sort ▼ ]  [ Status ▼ ]  [ Priority ▼ ]  [ Date ▼ ]  [ Messages ▼ ]
```

**Smart List options:** All Tasks / Today / Upcoming / Overdue / This Week / This Month / My Approval Pending / Other Approval Pending

**Sort options:** Custom Order / Due Date / Priority / Created Date / Title

**Status filter:** All / Pending / Queue (Available to Pick) / In Progress / Completed / Overdue / Archived

**Priority filter:** 🔴 Urgent / 🟠 High / 🔵 Medium / ⚪ Low

**Date filter:** All / Today / Yesterday / Last 7 Days / Last 30 Days / This Week / Last Week / This Month / Last Month / This Year / Custom Range

**Messages filter:** All / 📬 Unread / ✅ Read

---

#### VIEW 1: LIST VIEW (default)

```
┌────────────────────────────────────────────────────────────────────────┐
│ [ ☐ ] [ • priority ] [ Task Title text              ] [avatar] [due] [ ⋮ ] │
│ [ ☐ ] [ 🔴 urgent ] Update campaign rules Q4         [JD]   Tmrw  [ ⋮ ] │
│ [ ☐ ] [ 🔵 medium ] Review Looker report links       [SA]   +3d   [ ⋮ ] │
│ [ ☐ ] [ 🟠 high  ] Fix account sync issue            [BJ]   +1d   [ ⋮ ] │
└────────────────────────────────────────────────────────────────────────┘
```

Empty state: `✨ No tasks yet — Create your first task to get started!`

---

#### VIEW 2: KANBAN VIEW

**Exactly 4 columns (use THESE EXACT COLUMN NAMES):**

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ ● Backlog Tasks  │  │ ● To Do Tasks    │  │ ● In Process     │  │ ● Done           │
│  (count)         │  │  (count)         │  │  (count)         │  │  (count)         │
├──────────────────┤  ├──────────────────┤  ├──────────────────┤  ├──────────────────┤
│ Task card        │  │ Task card        │  │ Task card        │  │ Task card        │
│ 🔴 High  Tmrw    │  │ 🔵 Med   +3d     │  │ 🟠 High  +1d     │  │ ✅ Completed     │
└──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘
```

**IMPORTANT — exact column names:** `Backlog Tasks` / `To Do Tasks` / `In Process` / `Done`
(NOT "Pending", NOT "In Progress", NOT "Submitted", NOT "Approved")

**DB `task_status` values mapped to columns:**
- `backlog` → Backlog Tasks column
- `todo` → To Do Tasks column
- `in_progress` → In Process column
- `done` → Done column

Each column: colored status dot + name + count in header, draggable task cards in body.

---

#### VIEW 3: CALENDAR VIEW

7-column weekly grid (Monday through Sunday). Each day cell shows task pills colored by priority for tasks due on that day. Clicking a task pill opens the task detail modal.

---

## TO-DO MODULE — COMPLETE DETAIL SPECIFICATION

### ADD / EDIT TASK MODAL (`todoModal`)

**Modal header:** `linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)`, sticky, contains:
- Title: `📝 Add New Task` (or `✏️ Edit Task`)
- Close ✕ button: `rgba(255,255,255,0.2)` bg, 36×36px, border-radius: 10px

**Modal size:** `max-width: 1100px`, `width: 92%`, `max-height: 90vh`, scrollable

---

#### FORM FIELDS — IN EXACT ORDER

**ROW 1: App/Game Name + Package Name (side by side, 45% / 45%)**

| Field | Type | ID | Required | Notes |
|-------|------|----|----------|-------|
| 📱 App / Game Name | `<select>` | `todoAppName` | No | Synced with Package — `onchange="syncAppNameToPackage()"`. Populated from packages DB. Default: `-- Select App / Game --` |
| 📦 Package Name | `<select>` | `todoPackage` | **Yes *** | Synced with App Name — `onchange="syncPackageToAppName(); updateQueueTarget()"`. Default: `-- Select Package --` |

- Sync behavior: selecting App/Game auto-sets Package Name, and vice versa
- Both are `<select>` dropdowns, 2px border, border-radius: 12px
- On focus: `borderColor: #3b82f6`; on blur: resets to `#e2e8f0`

---

**ROW 2: KPI's (full width)**

| Field | Type | ID | Required | Validation |
|-------|------|----|----------|-----------|
| KPI's | `<select>` | `todoKpiType` | **Yes *** | If empty, submit shows toast: **"Please select KPI's."** |

KPI dropdown options (exact values):
- `-- Select KPI --` (default, empty value)
- `Monitizations`
- `Store Graphics`
- `Creative Graphic`
- `Andriod Vitls`
- `Bugs`
- `New Feature`
- `SDK Updates`
- `Data Analysis`
- `Others`

---

**ROW 3: Subject (full width)**

| Field | Type | ID | Required | Constraints | Validation |
|-------|------|----|----------|-------------|-----------|
| Subject | `<input type="text">` | `todoTitle` | **Yes *** | `maxlength="30"` | If empty: toast **"Please enter a task title."**; if length < 3: inline error below field |

- Live character counter: `(0/30 characters)` — ID: `charCount`, updates on `oninput`
- Inline error element ID: `titleError` — shown (red `#F43F5E`) when length > 0 but < 3
- Error text: **"⚠️ Title must be between 3-30 characters"**
- `onfocus` → border turns `#3b82f6`; `onblur` → resets to `#e2e8f0`
- Placeholder: `"What needs to be done? (Max 30 characters)"`

---

**ROW 4: Description (full width)**

| Field | Type | ID | Required | Notes |
|-------|------|----|----------|-------|
| Description | `<textarea>` | `todoDescription` | No | 3 rows, placeholder: `"Add more details..."`. `onfocus` → indigo `#6366F1`; `onblur` → resets |

---

**ROW 5: Our Goal (full width, rich text editor)**

| Field | Type | ID | Required | Notes |
|-------|------|----|----------|-------|
| Our Goal | `contenteditable div` | `todoOurGoal` | No | Rich text with formatting toolbar |

Rich text toolbar (above editor, `background: #f8fafc` bar):
- **B** button → `execCommand('bold')`
- *I* button → `execCommand('italic')`
- U̲ button → `execCommand('underline')`
- `│` divider
- `• List` button → `execCommand('insertUnorderedList')`
- `1. List` button → `execCommand('insertOrderedList')`

Editor area: `min-height: 120px`, `padding: 14px 18px`, `font-size: 15px`
Placeholder: **"Enter your goal here... You can format text and create lists."** — shown as absolutely-positioned overlay when empty, pointer-events: none, color `#94a3b8`, italic

Hint text below: `💡 You can format text (bold, italic, underline) and create bullet or numbered lists`

---

**ROW 6: Priority + Due Date (side by side, 1fr / 1fr)**

| Field | Type | ID | Required | Default | Notes |
|-------|------|----|----------|---------|-------|
| Priority | `<select>` | `todoPriority` | No | `medium` selected | Options: ⚪ Low / 🔵 Medium (default) / 🟠 High / 🔴 Urgent |
| Due Date | `<input type="datetime-local">` | `todoDueDate` | **Conditional** | — | Required for non-self tasks; optional for Self Todo |

Due Date notes:
- `*` asterisk (red `#F43F5E`) shown in label — ID: `dueDateRequired` — **hidden** when Self Todo is selected
- Inline error below: `dueDateError` — **"⚠️ Due date must be in the future"** — shown on `onchange="validateDueDate()"` if date is past
- If non-self task and no due date: toast **"Please set a due date for this task."**

---

**ROW 7: 🚀 Task Routing (full width, card-based selector)**

This is a critical UI component. It shows 4 selectable routing cards with visual selection state.

**Label:** `🚀 Task Routing` (becomes `✏️ Update Task Routing / Assignees` in edit mode)

**The 4 routing cards (stacked vertically, each 44px+ tall):**

```
┌──────────────────────────────────────────────────────────────────────┐
│ 📝  Self Todo                                              [ ○ ]     │
│     Create this task for yourself                                     │
│     hover: amber border (#f59e0b) + bg (#fffbeb)                     │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ 🏢  Send to Department                                     [ ○ ]     │
│     Route to a department queue for auto-assignment                   │
│     hover: green border (#34d399) + bg (#f0fdf4)                     │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ 👤  Send to Manager Directly                               [ ○ ]     │
│     Assign directly to a team manager                                 │
│     hover: purple border (#a78bfa) + bg (#f5f3ff)                    │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ 👥  Multi-Assignment  [NEW]                                [ ○ ]     │
│     Send this task to multiple users at once                          │
│     hover: cyan border (#06b6d4) + bg (#ecfeff)                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Selected state per card:**
| Card | Selected border | Selected bg | Check color |
|------|----------------|-------------|-------------|
| Self Todo | `#f59e0b` (amber) | `#fffbeb` | `#f59e0b` |
| Send to Department | `#10b981` (green) | `#f0fdf4` | `#10b981` |
| Send to Manager | `#8b5cf6` (purple) | `#f5f3ff` | `#8b5cf6` |
| Multi-Assignment | `#06b6d4` (cyan) | `#ecfeff` | `#06b6d4` |

The circle indicator on the right turns into a filled circle with a white ✓ checkmark SVG when selected. Clicking the same card again **deselects** it (toggle behavior).

**Routing detail panels (shown below the selected card):**

*When "Send to Department" is selected:*
- Shows the hidden `todoDepartmentSection`: a `<select>` dropdown populated from the departments DB
- Shows a green info box: `📨 Task will be queued to: [Dept Name]` with auto-assignment note
- `updateQueueTarget()` fires on both department change and package change to update the info text

*When "Send to Manager Directly" is selected:*
- Shows `<select id="todoDirectManager">` with all users who are Manager/Super Manager role, OR have team members under them
- Hint text: `💡 Only showing users who manage at least one team member.`
- Filtered: the current logged-in user is excluded from the list
- Format: `👤 username (Department)`

*When "Multi-Assignment" is selected:*
- Shows user selector panel with:
  - 🔍 Search input (`maSearchInput`) — `oninput="maFilterUsers()"`
  - 🏢 Department filter dropdown (`maDeptFilter`) — filters user list
  - `✅ Select All` button (cyan bg) — selects all visible users
  - `🗑️ Clear` button (light gray) — clears all selections
  - Counter: `X selected` — ID: `maSelectedCount`
  - Scrollable user list (`maUserList`) — `max-height: 220px`; each row has avatar + username + role; checkbox on left

---

**ROW 8: Notes (full width)**

| Field | Type | ID | Required | Notes |
|-------|------|----|----------|-------|
| Notes | `<textarea>` | `todoNotes` | No | 2 rows, placeholder: `"Additional notes..."` |

---

**ROW 9: 📎 Attachments (full width)**

- Header: `📎 Attachments` + `(Optional)` — `➕ Add Files` button on right
- Hidden file input: `id="todoCreationAttachmentInput"`, `multiple`, `accept="*/*"`
- Hint: `💡 Upload files before saving the task (up to 2GB per file)`
- Upload progress list: ID `creationAttachmentUploadProgressList` — shows per-file progress bars
- Attachments container: ID `creationAttachmentsContainer` — shows uploaded file chips

---

**FORM FOOTER BUTTONS (2 columns, 2:1 ratio)**

| Button | Type | Style | Action |
|--------|------|-------|--------|
| 💾 Save Task | `submit` | `background: linear-gradient(135deg, #10b981 0%, #059669 100%)`, flex: 2, padding: 16px, font-weight: 700 | Calls `saveTodo(event)` |
| Cancel | `button` | white bg + `border: 2px solid #e2e8f0`, flex: 1, color `#475569` | Calls `closeTodoModal()` |

During save: button becomes disabled + shows `⏳ Saving...` text. On error: re-enabled + restored to `💾 Save Task`.

---

#### FORM VALIDATION — COMPLETE LIST

All validations fire in `saveTodo(event)`. Errors shown as **red toast notifications** (bottom-right) unless inline. In-order checks:

| # | Field | Condition | Error Message | Error Type |
|---|-------|-----------|--------------|-----------|
| 1 | KPI's | Empty | **"Please select KPI's."** | Toast (error) |
| 2 | Subject | Empty | **"Please enter a task title."** | Toast (error) |
| 2b | Subject | Length < 3 | **"⚠️ Title must be between 3-30 characters"** | Inline below field (red `#F43F5E`) — shows on keystroke |
| 3 | Due Date | Non-self task + no date | **"Please set a due date for this task."** | Toast (error) |
| 4 | Due Date | Date in the past | **"⚠️ Due date must be in the future"** | Inline below field |
| 5 | Package Name | Empty | Browser native required validation | Native HTML |
| 6 | Routing (new task only) | No routing option selected + not self | **"Please select a routing option: Self Todo, Department, Manager, or Multi-Assignment."** | Toast (error) |
| 7 | Multi-assignment | No users selected | **"Please select at least one user for multi-assignment."** | Toast (error) |
| 8 | Department routing | No dept selected | **"Please select a department to send this task to."** | Toast (error) |
| 9 | Manager routing | No manager selected | **"Please select a manager to send this task to."** | Toast (error) |

**Edit mode restrictions:**
- Only the task **creator** can edit. If others click Edit: toast **"Only the task creator can edit task information"**
- Cannot edit while `approval_status === 'pending_approval'`: toast **"Cannot edit task - waiting for creator approval"**

---

#### DRAFT AUTO-SAVE SYSTEM

- Auto-saves to `localStorage` while the modal is open (`startTodoDraftAutosave('new', '')`)
- On modal close: snapshot saved (`saveTodoDraftSnapshot()`)
- When modal reopens: if a draft exists, it is offered for restore (`maybeRestoreTodoDraft()`)
- **📄 Drafts button** in action bar: opens `todoDraftsModal` — lists all saved drafts with timestamps
  - Each draft row: task title preview + creation time + `▶ Resume` button + `✕ Discard` button
  - `🗑️ Clear All` button removes all drafts
  - `Close` button dismisses the modal

---

### TASK DETAIL MODAL (`todoDetailModal`)

Opens when a task row is clicked (NOT the edit pencil — that opens the edit form).

**Header:** `linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)`, sticky (`position: sticky, top: 0, z-index: 10`)
Title: `📋 Task Details`, Close ✕ button

**Content sections (stacked vertically):**

1. **Task info area** (`todoDetailContent`) — dynamically rendered: title, KPI, package, description, Our Goal, priority badge, due date, status badge, created date, assignee info
2. **🔗 Assignment Chain** — shows the sequential chain of users the task has been passed through, each as a card with: username / feedback given / status / timestamp
3. **📎 Attachments** — list of attached files with download links + `➕ Add Attachment` button (owner only)
4. **👥 Sharing** — list of users the task has been shared with, each showing username + `Remove` option
5. **Action buttons** (hidden unless user is creator):
   - `✏️ Edit Task` (green btn) → calls `editTodoFromDetail()`
   - `🗑️ Delete Task` (red btn) → calls `deleteTodoFromDetail()`

---

### TASK ACTION MODAL (`taskActionModal`)

Opens via `⚡ Task Action` button or specific row actions. **Purple gradient header** (`#8b5cf6 → #7c3aed`).

Shows 4 action type cards (same visual card pattern as routing):

| Card | Icon | Label | Description | Selected border |
|------|------|-------|-------------|----------------|
| 🔄 | purple | Assign to Next User | Pass this task to the next person with your feedback | `#a78bfa` |
| ✅ | green | Complete & Assign Next | Mark your part as done and pass to the next person | `#34d399` |
| 🏁 | indigo | Complete Task (Final) | Send for creator approval to finalize | `#818cf8` |
| ❓ | orange | Ask Question | Ask a task-related user — status stays the same | `#fb923c` |

**Always-visible field:**
- **Feedback / Notes** (`taskActionFeedback`, textarea, `*` required)
  - Placeholder: `"Describe what you did, results, progress, or handoff notes..."`
  - `onfocus` → purple `#8b5cf6`
  - Error: `taskActionFeedbackError` — **"⚠️ Feedback is required."**

**Conditionally shown fields:**

*For "Ask Question" only:*
- **Your Question** (`taskActionQuestion`, textarea, `*` required)
  - Error: `taskActionQuestionError` — **"⚠️ Please type your question."**
- **Send Question To** (`taskActionQuestionUser`, `<select>`) — all users dropdown
  - Error: `taskActionQuestionUserError` — **"⚠️ Please select a user to send the question to."**

*For "Assign to Next User" and "Complete & Assign Next":*
- **Dept filter** (`taskActionDepartmentFilter`, `<select>`) — filters the user list
- **Assign to Next User** (`taskActionUserSelect`, `<select>`)
  - Error: `taskActionUserError` — **"⚠️ Please select a user to assign to."**

**Footer buttons:**
- `Cancel` — gray outline
- `Select an action` (initially disabled, 50% opacity) → becomes active after action selection → purple gradient button

---

### COMPLETE TASK MODAL (`completeTaskModal`)

Triggered when non-owner marks task complete (or owner confirms). **Purple gradient header** (`#8b5cf6 → #7c3aed`).

- Shows task title: `id="completeTaskTitle"`
- **Completion Feedback** (`completeTaskFeedback`, textarea, `*` required)
  - Error: `completeTaskFeedbackError` — **"⚠️ Feedback is required before completing the task."**
- Info note: amber box — `💡 The task creator will be notified and may need to approve completion.`
- Buttons: `Cancel` | `✓ Complete Task` (purple gradient)

---

### CREATOR REVIEW MODAL (`creatorReviewModal`)

Opened by the task creator when notified that a task is ready for review. **Green gradient header** (`#059669 → #047857`).

- Title: `📋 Review Task Completion`
- Shows task name: `id="creatorReviewTitle"`
- **Level-wise review cards** (`creatorReviewChain`) — one card per assignee / assignment level
  - Each card shows: assignee avatar + username + their submitted feedback + completion timestamp
  - Per-card actions: `✅ Approve` / `🔓 Reopen` / `❌ Reject`
- Footer: `Close` | `✅ Approve All & Complete` (green) — enabled only when all are approved

---

### MULTI-ASSIGNMENT SUBMISSION MODAL (`maSubmissionFeedbackModal`)

Shown to an assignee when they click to submit their work. **Purple gradient header** (`#8b5cf6 → #7c3aed`).

- Task name: `id="maSubmissionTaskTitle"`
- **Work Completed & Feedback** (`maSubmissionFeedback`, textarea, `*` required, 4 rows)
  - Error: **"⚠️ Please provide your feedback before submitting"**
- Info box: amber — `💡 Your feedback will be visible to the task creator for review and approval.`
- Buttons: `Cancel` | `✓ Submit Feedback` (purple gradient)

---

### REOPEN FEEDBACK MODAL (`maReopenFeedbackModal`)

Creator requests re-work from a specific assignee. **Amber gradient header** (`#f59e0b → #d97706`).

- Assignee name: `id="maReopenAssigneeName"`
- **Reopen Feedback (Changes Required)** (`maReopenFeedback`, textarea, `*` required, 4 rows)
  - Error: **"⚠️ Please provide feedback about what needs to be changed"**
- Info box: amber — `💡 The assignee will see your feedback and can make the requested changes.`
- Buttons: `Cancel` | `✓ Reopen with Feedback` (amber gradient)

---

### REJECT SUBMITTED WORK MODAL (`maRejectFeedbackModal`)

Creator fully rejects an assignee's submission. **Red gradient header** (`#ef4444 → #dc2626`).

- Assignee name: `id="maRejectAssigneeName"`
- **Rejection Feedback (Required Changes)** (`maRejectFeedback`, textarea, `*` required, 4 rows)
  - Error: **"⚠️ Please provide feedback about what needs to be corrected"**
- Info box: red/light — `⚠️ The assignee will be notified and can make the requested changes before resubmitting.`
- Buttons: `Cancel` | `✓ Reject with Feedback` (red gradient)

---

### TASK DELEGATION MODAL (`maDelegationModal`)

An assignee reassigns the task to their sub-team. **Cyan gradient header** (`#06b6d4 → #0891b2`).

- Task name: `id="maDelegationTaskTitle"`
- Info box (blue, left-bordered): `ℹ️ How Delegation Works:` with 3 bullet points:
  - Selected users will complete this task and submit to you for approval
  - You must approve all delegated work before completing your own task
  - The original task creator can see the full delegation hierarchy
- **Search users** (`maDelegationUserSearch`, text input) — `oninput="filterMaDelegationUsers()"`
- `✓ Select All` (cyan) + `✗ Clear All` (gray) + selected count pill
- User list (`maDelegationUsersList`) — scrollable, `max-height: 280px`, user cards with checkboxes
- **Instructions for Delegated Users** (`maDelegationInstructions`, textarea, optional)
- Error: `maDelegationError` — **"⚠️ Please select at least one user to delegate to"** (red bg box)
- Buttons: `Cancel` | `🔄 Delegate Task` (cyan gradient)

---

### DECLINE COMPLETION MODAL (`declineTaskModal`)

Creator sends task back to assignee for more work. **Red gradient header** (`#ef4444 → #dc2626`).

- Task name: `id="declineTaskTitle"`
- **Reason for declining** (`declineReasonInput`, textarea, `*` required, 4 rows)
  - Placeholder: `"Explain why this task needs more work..."`
- Buttons: `Cancel` | `👎 Decline` (red gradient)

---

### UPDATE DUE DATE MODAL (`updateDueDateModal`)

Assignee updates their personal actual due date. **Amber gradient header** (`#f59e0b → #d97706`).

- Title: `📅 Update Due Date` / subtitle: `Set your actual completion date`
- Info note (amber left-border box): `💡 Note: As the assignee, you can update the actual due date... This can be done only one time per user for a task.`
- **New Due Date** (`newDueDateInput`, `datetime-local`, `*` required, amber focus border)
- Buttons: `Cancel` | `📅 Update Date` (amber gradient)

> **Restriction:** Assignee can only use this ONCE per task. After that, the button is hidden.

---

### SHARE TASK MODAL (`shareModal`)

Share a single task with a user (view-only). **Indigo gradient header** (`#6366F1 → #4F46E5`).

- **Select User** (`shareUserSelect`, `<select>`) — all users loaded dynamically
- **View only access** checkbox (`shareCanEdit`) — disabled/always checked — label: `"View only access"`
  - Note text: `"Shared users can only view task details."`
- Buttons: `💾 Share` (green) | `Cancel`

---

### DEPARTMENT QUEUE MODALS

**Department Queue Picker** (`deptQueuePickerModal`) — for managers to pick which dept to view:
- Cyan gradient header, title: `🏢 Select Department`
- Search input (`deptQueuePickerSearch`) — filters department list
- Department list (`deptQueuePickerList`) — scrollable cards, each shows dept name + task count badge
- Buttons: `Cancel` | `Open Queue` (cyan)

**Department Queue Manager** (`deptQueueModal`) — shows all queued tasks for a dept:
- Blue gradient header (`#0ea5e9 → #0284c7`), title: `📥 Department Queue`
- Content: list of queued task cards, each with: task title, KPI, package, creator, due date, `✅ Assign to Me` button
- Scrollable panel with `background: #f8fafc`

---

### BULK SHARE MODAL (`bulkShareModal`)

Share multiple selected tasks at once. Indigo gradient header.

- Info text shows count: `"Share X selected task(s)"`
- Search users input (`bulkShareUserSearch`) — `oninput="filterBulkShareUsers()"`
- User list (`bulkShareUsersList`) — scrollable checkboxes
- Buttons: `Cancel` | `👥 Share` (green)

---

## TASK WORKFLOW ENGINE — HOW IT WORKS (COMPLETE FLOW)

### DATABASE STATUS FIELDS

Every task has 2 status fields:

| Field | Values | Meaning |
|-------|--------|---------|
| `task_status` | `todo` / `backlog` / `in_progress` / `done` | Where task is in the workflow |
| `approval_status` | `approved` / `pending_approval` / `declined` | Creator's approval state |

---

### WORKFLOW 1: SELF TASK

```
Creator → "Self Todo" routing → Save
  │
  └─ task_status: 'todo', approval_status: 'approved'
       │
       └─ Creator marks complete (checkbox)
            │
            └─ confirm dialog: "Are you sure you want to mark this task as completed?"
                 │
                 ├─ Yes → task_status: 'done', completed: true
                 │         ✅ Toast: "Task completed! 🎉"
                 └─ No  → no change
```

---

### WORKFLOW 2: ASSIGNED TO MANAGER DIRECTLY

```
Creator → "Send to Manager" → selects manager from dropdown → Save
  │
  └─ task_status: 'backlog', assigned_to: managerUsername, manager_id: managerUsername
     Notification sent to manager: "Task Assigned to You"
     Toast: "Task created & sent to manager!"
       │
       └─ Manager sees task in Backlog column / list
            │
            └─ Manager opens Task Action Modal → picks action:
                 │
                 ├─ 🔄 Assign to Next User
                 │   Feedback required → select next user → submit
                 │   task passes to next user (new assignment chain entry)
                 │
                 ├─ ✅ Complete & Assign Next
                 │   Feedback required → select next user → submit
                 │   marks manager's part done, task passed forward
                 │
                 ├─ 🏁 Complete Task (Final)
                 │   Feedback required → submit
                 │   approval_status: 'pending_approval'
                 │   Notification sent to creator: "Task ready for your approval"
                 │   Toast: "Task submitted for approval! ⏳"
                 │     │
                 │     └─ Creator opens Creator Review Modal
                 │          ├─ ✅ Approve All & Complete
                 │          │   approval_status: 'approved', task_status: 'done'
                 │          │   completed: true
                 │          │   Toast: "Task approved and completed! 🎉"
                 │          │
                 │          └─ 👎 Decline (opens Decline Modal)
                 │              reason required → submit
                 │              approval_status: 'declined', task_status: 'in_progress'
                 │              Notification to assignee: "Task completion was declined"
                 │
                 └─ ❓ Ask Question
                     Question required → select target user → submit
                     status does NOT change
                     Notification sent to target user with the question
```

---

### WORKFLOW 3: SEND TO DEPARTMENT QUEUE

```
Creator → "Send to Department" → selects dept → Save
  │
  └─ queue_status: 'queued', queue_department: deptId
     Auto-assigned to first available member in dept
     Assigned member gets notification: "Task Assigned to You"
     Toast: "Task created & queued to department!"
       │
       └─ Same completion flow as Manager workflow above
          (assignee → Task Action Modal → Complete Final → Creator Review)
```

---

### WORKFLOW 4: MULTI-ASSIGNMENT

```
Creator → "Multi-Assignment" → selects multiple users → Save
  │
  └─ multi_assignment JSONB saved to DB:
     {
       enabled: true,
       created_by: "creator_username",
       assignees: [
         { username: "user1", status: "pending", assigned_at: "...", ... },
         { username: "user2", status: "pending", assigned_at: "...", ... }
       ],
       completion_percentage: 0,
       all_completed: false
     }
     Each assignee gets notification: "👥 Multi-Assignment Task"
       │
       └─ Each assignee works independently
            │
            └─ Assignee clicks "Submit Work" → opens maSubmissionFeedbackModal
                 Feedback required (textarea, 4 rows) → submit
                 That assignee's status → 'pending_approval'
                   │
                   └─ Creator reviews each assignee's submission via Creator Review Modal
                        Per-assignee actions:
                        ├─ ✅ Approve → that assignee.status = 'accepted'
                        ├─ 🔓 Reopen → opens maReopenFeedbackModal
                        │   Feedback required → submit
                        │   assignee.status = back to 'in_progress'
                        │   Assignee notified: "Your work needs changes"
                        ├─ ❌ Reject → opens maRejectFeedbackModal
                        │   Feedback required → submit
                        │   assignee.status = 'rejected'
                        │   Assignee notified: "Your work was rejected"
                        └─ 🔄 Reassign → opens maDelegationModal
                            Select sub-users → optional instructions → submit
                            Sub-assignees get their own tasks under this one
                              │
                              └─ When ALL assignees are 'accepted':
                                   all_completed: true
                                   Creator clicks "✅ Approve All & Complete"
                                   task_status: 'done', completed: true
```

---

### KANBAN DRAG-AND-DROP STATUS TRANSITIONS

Dragging a card between columns updates `task_status`:

| From column | To column | `task_status` saved |
|-------------|-----------|---------------------|
| Backlog Tasks | To Do Tasks | `todo` |
| To Do Tasks | In Process | `in_progress` |
| In Process | Done | triggers complete flow |
| Any | Any | direct DB update |

---

### NOTIFICATION TRIGGERS (task module)

| Event | Who receives | Notification title |
|-------|-------------|-------------------|
| Task assigned (manager route) | Manager | `"Task Assigned to You"` |
| Task assigned (multi) | Each assignee | `"👥 Multi-Assignment Task"` |
| Task queued to dept | Dept member | `"Task Assigned to You"` |
| Assignee submits for approval | Creator | `"Task ready for your approval"` |
| Creator approves | Assignee | `"Task completed! 🎉"` |
| Creator declines | Assignee | `"Task completion was declined"` |
| Creator reopens (MA) | That assignee | `"Your work needs changes"` |
| Creator rejects (MA) | That assignee | `"Your work was rejected"` |
| Ask Question action | Target user | The question text |

---

### PERMISSION / ROLE RULES IN TASK MODULE

| Action | Who can do it |
|--------|--------------|
| Create task | Any logged-in user |
| Edit task info | **Only the original creator** |
| Delete task | Only creator, only if NOT completed |
| Mark as complete (self task) | Only creator |
| Submit for approval (non-owner) | The current assignee |
| Approve completion | Only creator |
| Decline completion | Only creator |
| Reopen completed task | Only creator |
| Share task (view-only) | Only creator |
| View Department Queue button | Managers/Admins only |
| View "All Departments" filter | Managers/Admins only |
| View "All Members" filter | Managers/Admins only |
| Update due date | The assignee only, **once per task** |

---

### PAGE 10: TASK ANALYTICS (/dashboard/analytics)

**Page title:** `📊 Task Analytics`
**Subtitle:** `"View task statistics for all users"`
**Visibility:** Only shown to Super Manager and Admin roles.

**NOTE:** This section is a **simple table** (NOT charts/graphs — no donut charts, no bar charts, no line charts).

**Section bar:**
```
Left:  "User Task Statistics"  [ refresh indicator ]
Right: [ 🔍 Search user by name... ]  [ 🔄 Refresh ]
```

**Per-user stats table:**
```
┌─────────────────────────┬───────┬─────────┬─────────────┬───────────┬─────────┐
│ User (avatar + name)    │ Total │ Pending │ In Progress │ Completed │ Overdue │
├─────────────────────────┼───────┼─────────┼─────────────┼───────────┼─────────┤
│ [avatar] John Doe       │  24   │    8    │      6      │     9     │    1    │
│ [avatar] Sarah Ali      │  18   │    5    │      4      │     8     │    1    │
│ [avatar] Bob Johnson    │  11   │    3    │      2      │     6     │    0    │
└─────────────────────────┴───────┴─────────┴─────────────┴───────────┴─────────┘
```

---

### PAGE 11: MY TEAM (/dashboard/team)

**Page title:** `👥 My Team`

**Section filter bar:**
```
[ 🏢 All Departments ▼ ]     [ 📅 Task Date: Last 7 Days ▼ ]
```
Date range options: Today / Last 7 Days / Last 30 Days / This Month

**Team member cards grid:**
Each card:
- Avatar circle (60px) with initials or photo
- Full name (bold)
- Role badge (colored pill)
- Department name (muted text)
- Email address with ✉️ prefix
- Task statistics mini-row (small pills showing count per status)

---

### PAGE 12: DEPARTMENT MANAGEMENT (/dashboard/departments)

**Page title:** `🏢 Department Management`
**Subtitle:** `"Manage departments and organize users"`

**Toolbar:** `[ + Add Department ]  [ 🔄 Refresh ]`

**TABLE — 4 EXACT COLUMNS:**
```
┌──────────────────────────┬──────────────────────────┬─────────────┬─────────┐
│ Name                     │ Description              │ Users Count │ Actions │
├──────────────────────────┼──────────────────────────┼─────────────┼─────────┤
│ Marketing                │ ...                      │ 8           │ Rename  │
│ Development              │ ...                      │ 12          │ Rename  │
└──────────────────────────┴──────────────────────────┴─────────────┴─────────┘
```

---

### PAGE 13: PACKAGE MANAGEMENT (/dashboard/packages)

**Page title:** `📦 Package Management`
**Subtitle:** `"Manage packages and assign them to users"`

**Toolbar:** `[ + Add Package ]  [ 🔄 Refresh ]`

**TABLE columns:** Package Name, Category, Price, Active (toggle), Assigned (user count), Actions (Edit/Delete)

---

### SHARED UI COMPONENTS

#### Buttons

```
Primary (blue):    background: #3B82F6, hover: #2563EB, white text
Success (green):   background: #10B981, hover: #059669, white text
Danger (red):      background: #EF4444, hover: #DC2626, white text
Secondary (gray):  background: #E2E8F0, hover: #CBD5E1, text: #334155
Warning (amber):   background: #F59E0B, hover: #D97706, white text
```
All buttons: `padding: 10px 20px`, `border-radius: 8px`, `font-weight: 600`, `font-size: 14px`, hover: `translateY(-1px)`

#### Toast Notifications (fixed bottom-right, slide-up animation, auto-dismiss 3s)

```
✅  Account saved successfully            [✕]  ← green background
❌  Failed to save: Network error         [✕]  ← red background
⚠️  Warning: Missing required fields     [✕]  ← amber background
ℹ️  Refreshing data...                   [✕]  ← blue background
```

#### Confirm Delete Dialog

```
┌─────────────────────────────────────────────────────┐
│  ⚠️  Delete Account                                 │
│                                                     │
│  Are you sure you want to delete account            │
│  "123-456-7890"? This action cannot be undone.      │
│                                                     │
│                         [Cancel]  [Delete ← red]   │
└─────────────────────────────────────────────────────┘
```

#### Empty State (reusable pattern)

```
     [large emoji or illustration — ~80px]

     No [items] found

     [Helpful description text]

              [+ Add First Item  ← primary button]
```

#### Loading States

- Tables: skeleton shimmer rows (5 rows), animated pulse
- Cards/grids: skeleton shapes matching final layout
- Inline spinner: `border-top-color: #6366F1`, `animation: spin 0.8s linear infinite`

#### Refresh Indicator

Small inline element next to section titles — shows spinning icon or "Refreshing..." text while data is loading.

---

### MOBILE RESPONSIVE BEHAVIOR

| Breakpoint | Sidebar | Grid/Layout |
|-----------|---------|-------------|
| < 768px | Hidden, overlay via ☰ hamburger button | 1-col, card-per-row tables, full-screen modals |
| 768–1024px | 72px icon-only | 2–3 col grids |
| > 1024px | 72px default, hover-expand to 260px, lockable | Full tables, 4+ col grids |

Mobile specifics:
- Hamburger button (top-left) opens sidebar as dark overlay
- `rgba(0,0,0,0.5)` overlay covers main content when sidebar is open
- KPI cards: 2 per row on mobile, 4 per row on desktop
- Report cards: 1 col mobile, 2 tablet, auto-fill desktop
- Drive grid: 2 cols mobile, 3 tablet, 4 desktop

---

### ACCESSIBILITY

- All icon-only buttons have `title` attribute (hover tooltip)
- Keyboard-navigable (Tab / Enter / Space / Escape)
- Focus rings: `ring-2 ring-indigo-500` (visible on all interactive elements)
- `aria-label` on all icon buttons
- `role="dialog"` + focus trap on modals
- Error messages announced to screen readers via `role="alert"`
- Color is never the sole state indicator — text labels always accompany colors

---

### SUMMARY — WHAT TO BUILD

Build **13 internal pages** for `Funsol — Central Configuration Portal`:

1. **Login** — "Sign in with email", "Email or Username" label, "Log in" button, no forgot password, no social login
2. **Accounts Management** — 10-column table (incl. Drive Comments + Campaigns), workflow badges, enable toggles, bulk actions
3. **Campaign Management** — all campaigns grouped by account in collapsible sections
4. **Workflow Management** — enable/disable table of 4 workflows
5. **Removal Rules Manager** — ~24 condition rows, restore defaults button
6. **Drive Manager** — full file browser, storage bar, context menu, fullscreen file viewer, upload progress
7. **Looker Studio** — Google-blue gradient hero header, report card grid, fullscreen iframe viewer with "Authorized Access For:" footer
8. **User Management** — 6-column table (incl. Allowed Accounts), 6-tab modal with granular permissions
9. **To-Do List** — 7 KPI stat cards + 3 views (List/Kanban/Calendar) + rich filter system + templates + export
10. **My Team** — member cards with task stats, department filter, date range filter
11. **Task Analytics** — simple per-user stats table (admin/super manager only) — NOT charts
12. **Department Management** — table with Name/Description/Users Count columns
13. **Package Management** — package table with pricing and assignment tracking

**Non-negotiable accuracy rules:**
- App name: `🔐 Funsol` / subtitle `Central Configuration Portal`
- Sidebar: ALWAYS dark gradient `#0F172A → #1E293B`, width 260px/72px
- Notification bell: IN the sidebar header top-right (NO separate topbar anywhere)
- Primary button color: `#3B82F6` (blue) — active nav color: `#6366F1` (indigo)
- Fonts: Inter (body) + Plus Jakarta Sans (headings)
- Login: "Sign in with email" / "Email or Username" / "Log in"
- Accounts table has 10 columns including "Drive Comments" and "Campaigns"
- Kanban columns: **Backlog Tasks / To Do Tasks / In Process / Done** (exact names)
- Looker viewer: fixed 100vw×100vh overlay, "Authorized Access For: [username]" footer
- Task Analytics is a TABLE (not charts), admin/super manager only
