# Module 04 — Campaigns & Removal Rules

---

## 1. What This Module Does

Manages campaign removal rules (conditions) for Google Ads accounts. Each account is assigned to a workflow (0–3), and each workflow has its own table of condition rows. When automation runs, it checks these rules to decide whether to remove/pause a campaign.

There are also hardcoded "Removal Condition Definitions" (24 items) that map a condition ID to a human-readable name and description.

---

## 2. Four Workflow Tables

| Workflow | Supabase Table | Description |
|----------|---------------|-------------|
| Workflow 0 | `campaign_conditions` | Default workflow |
| Workflow 1 | `workflow_1` | Alternate automation set |
| Workflow 2 | `workflow_2` | Alternate automation set |
| Workflow 3 | `workflow_3` | Alternate automation set |

All four tables share the same schema (see Section 5 below).

---

## 3. Campaign Data Source

Campaigns are **not stored** in Supabase. They are read from the account's linked Google Sheet:
- Sheet must have a tab named `"Real Upload"` or `"Upload"`
- The function `getCampaignsForCustomer(customerId)` reads all rows from that tab
- Returns campaign names (and optionally IDs) to the frontend for display

```
syncCampaignsFromUpload:
1. Look up account.google_sheet_link for the customer_id
2. Open spreadsheet via SpreadsheetApp.openByUrl()
3. Get sheet named "Real Upload" or fall back to "Upload"
4. Read all rows (campaign names in a specific column)
5. Return array of campaign name strings
```

---

## 4. Removal Condition Definitions (24 hardcoded items)

These are hardcoded in `Code.gs`. They do NOT change. They define which conditions can be selected when creating a rule row.

| ID | Display Name | Description |
|----|-------------|-------------|
| 1 | Spend Over Budget | Campaign spend exceeds set threshold |
| 2 | Low CTR | Click-through rate below minimum |
| 3 | High CPC | Cost per click above maximum |
| 4 | Low Conversion Rate | Conversions below target |
| 5 | No Impressions | Zero impressions in period |
| 6 | High Bounce Rate | (Analytics bounce rate) |
| 7 | Low ROAS | Return on ad spend below target |
| 8 | Budget Not Spent | Budget not consumed in period |
| 9 | Low Quality Score | Average quality score below threshold |
| 10 | High CPM | Cost per thousand impressions too high |
| 11 | Low Engagement | Engagement rate below threshold |
| 12 | High CPA | Cost per acquisition too high |
| 13 | Low Click Share | Click share below target |
| 14 | Zero Conversions | No conversions in period |
| 15 | Impression Share Lost | Too much impression share lost |
| 16 | High Invalid Clicks | Invalid click rate above threshold |
| 17 | Ad Disapproval Rate | Too many disapproved ads |
| 18 | Low Search Impression Share | Falling below target |
| 19 | Budget Overage | Budget exceeded by percentage |
| 20 | High Cost No Results | High spend with zero results |
| 21 | Frequency Cap Reached | Campaign frequency cap hit |
| 22 | Negative Keyword Conflict | Blocking too much traffic |
| 23 | Ad Schedule Miss | Most traffic outside schedule |
| 24 | Low VTR | View-through rate below target |

> Note: The exact names/descriptions may differ. These 24 condition types are what appear in the condition dropdowns.

---

## 5. Campaign Rules Table Schema

```sql
-- All four tables share this schema
-- Tables: campaign_conditions, workflow_1, workflow_2, workflow_3

id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
customer_id         TEXT NOT NULL     -- FK → accounts.customer_id
campaign_name       TEXT              -- which campaign this rule applies to
campaign_id         TEXT              -- Google Ads campaign ID
condition_id        INTEGER           -- FK → removal_condition_definitions.id
condition_value     NUMERIC           -- the threshold value (e.g. 50 for 50%)
condition_operator  TEXT              -- '>', '<', '>=', '<=', '='
enabled             BOOLEAN DEFAULT true
created_at          TIMESTAMPTZ DEFAULT now()
updated_at          TIMESTAMPTZ DEFAULT now()
```

```sql
-- Table: removal_condition_definitions
id          INTEGER PRIMARY KEY
name        TEXT
description TEXT
```

---

## 6. Business Logic Flows

### 6.1 Fetching Campaigns For An Account
```
1. User selects an account from the dropdown in Campaigns section
2. Frontend calls getCampaignsForCustomer(customerId)
3. GAS reads the Google Sheet linked to that account
4. Returns all campaign names (optionally IDs)
5. Frontend displays them in the campaign name dropdown
```

### 6.2 Loading Existing Rules
```
1. User selects account
2. Frontend loads workflow tables for that account's assigned workflow
3. Queries Supabase: SELECT * FROM {workflow_table} WHERE customer_id = ?
4. Displays all rule rows in the UI
```

### 6.3 Saving Rules (Full Replace)
```
1. User makes changes to rules (add/edit/delete rows)
2. On Save:
   a. DELETE FROM {workflow_table} WHERE customer_id = ?
   b. INSERT all current rule rows for that account
3. This is a full replace — not partial update
```

### 6.4 Condition Builder UI
Each rule row has:
- Campaign selector (dropdown from sheet data)
- Condition type (dropdown from removal_condition_definitions)
- Operator (dropdown: >, <, >=, <=, =)
- Value (numeric input)
- Enable/disable toggle

---

## 7. Per-User Access Rules

```
IF caller is Admin / Super Manager:
  → Can view and edit campaigns for ALL accounts

IF caller is Manager:
  → module_access.campaigns must be enabled
  → account must be in their accessible accounts list

IF caller is User:
  → Reads user.allowed_campaigns (CSV or JSON list)
  → Only sees campaigns in that list
  → Cannot create/edit rules — READ ONLY for campaigns
```

---

## 8. Frontend UI Elements

- **Account Selector**: dropdown to pick which account's campaigns to view
- **Workflow Tab Switcher**: tabs for W0, W1, W2, W3 (if account is assigned to that workflow)
- **Rules Table**: shows all condition rows with inline editing
- **Add Rule Row Button**: adds a blank row to the table
- **Delete Row Button**: removes a row
- **Save All Button**: saves all rows for the selected account (full replace)
- **Condition Definitions Sidebar**: info panel showing what each condition means
- **Campaign Name Dropdown**: populated from the linked Google Sheet

---

## 9. AI Build Prompt

> **Use this prompt when building this module in Next.js + TypeScript:**

```
Build the Campaigns & Removal Rules module for a CMS portal in Next.js 14 App Router + TypeScript.

PAGE: /dashboard/campaigns

OVERVIEW:
This module lets managers configure "removal rules" for Google Ads campaigns.
Rules are per account. Each rule says: "If campaign X has condition Y at value Z, remove it."
There are 4 workflow tables (campaign_conditions, workflow_1, workflow_2, workflow_3).
An account is assigned to one workflow. Rules for that account live in that table.

FEATURES TO BUILD:

1. ACCOUNT SELECTOR
   - Dropdown to select which account to view/edit rules for
   - Filtered by user role (same access rules as Accounts module)
   - When selected, load campaigns + existing rules

2. CAMPAIGN SYNC
   - When account is selected, fetch campaign list from Google Sheet
   - The account has a google_sheet_link; read the "Real Upload" or "Upload" tab
   - For Next.js: create a server action that reads the Google Sheet using Google Sheets API
   - Return array of campaign names + IDs
   - Cache this list locally while editing rules for the same account

3. RULES TABLE (editable grid)
   Columns:
   - Campaign (dropdown — from sheet data)
   - Condition (dropdown — from REMOVAL_CONDITION_DEFINITIONS constant)
   - Operator (dropdown: >, <, >=, <=, =)
   - Value (number input)
   - Enabled (toggle)
   - Delete (trash icon button)
   
   Behavior:
   - Start with existing rows loaded from Supabase
   - Add Row button: appends blank row at bottom
   - Each field is immediately editable inline
   - No auto-save; must click Save button
   - Dirty state indicator (show "Unsaved changes" banner)

4. SAVE RULES
   - Single Save button saves ALL current rows for selected account
   - Uses full replace strategy: DELETE existing rows for customer_id, INSERT all rows
   - Show success/error toast

5. CONDITION DEFINITIONS PANEL
   - Info panel or modal showing all 24 condition types with descriptions
   - Accessible via "?" button
   - Useful for managers who don't know what each condition means

6. WORKFLOW TABS (optional enhancement)
   - If account has been assigned to a specific workflow, show which table is being edited
   - Admin can change account's workflow assignment from Accounts page

HARDCODED CONSTANT (src/lib/removal-conditions.ts):
export const REMOVAL_CONDITION_DEFINITIONS = [
  { id: 1, name: 'Spend Over Budget', description: '...' },
  { id: 2, name: 'Low CTR', description: '...' },
  // ... all 24
]

TYPES (src/types/campaign.ts):
interface CampaignRule {
  id?: string
  customerId: string
  campaignName: string
  campaignId?: string
  conditionId: number
  conditionValue: number
  conditionOperator: '>' | '<' | '>=' | '<=' | '='
  enabled: boolean
}

SERVER ACTIONS (src/app/dashboard/campaigns/actions.ts):
- getCampaignsFromSheet(accountId): hits Google Sheets API, returns campaign list
- getRulesForAccount(customerId, workflowTable): SELECT from correct table
- saveRulesForAccount(customerId, workflowTable, rules[]): DELETE then INSERT
- getRemovalConditionDefinitions(): returns static list (can be hardcoded)

PERMISSIONS:
- Admin/Super Manager: full access to all accounts
- Manager: filtered by module_access.campaigns enabled + allowed accounts
- User: read-only, filtered by allowed_campaigns

WORKFLOW TABLE MAPPING:
const WORKFLOW_TABLES = {
  'workflow-0': 'campaign_conditions',
  'workflow-1': 'workflow_1',
  'workflow-2': 'workflow_2',
  'workflow-3': 'workflow_3',
}

STYLING:
- Table is an editable data grid (consider using TanStack Table with editable cells)
- Highlight changed rows with subtle yellow background
- Mobile: make table horizontally scrollable
- Use shadcn/ui Select for dropdowns, Input for value fields
```

---
