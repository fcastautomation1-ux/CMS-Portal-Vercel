# Module 10 — Supabase Data Layer

---

## 1. Overview

The CMS portal uses **Supabase** (PostgreSQL) as its primary database. This document covers:
- All 14 tables
- Column definitions and types
- Foreign key relationships
- RLS (Row Level Security) strategy
- Indexes needed for performance
- Storage buckets
- Service role vs anon key usage
- Supabase client setup for Next.js

---

## 2. Complete Table List

| Table | Description |
|-------|-------------|
| `users` | All portal users — auth, roles, permissions |
| `accounts` | Google Ads customer accounts |
| `campaign_conditions` | Workflow-0 campaign rules |
| `workflow_1` | Workflow-1 campaign rules |
| `workflow_2` | Workflow-2 campaign rules |
| `workflow_3` | Workflow-3 campaign rules |
| `workflows` | Workflow definitions + enable/disable |
| `looker_reports` | Looker Studio report links |
| `removal_condition_definitions` | 24 hardcoded condition types |
| `todos` | Tasks with full workflow lifecycle |
| `todo_shares` | Task sharing between users |
| `notifications` | In-app notification records |
| `packages` | App/package catalog |
| `user_packages` | Package-to-user assignments |
| `departments` | Department list |
| `credentials` | Google Ads API credentials (sensitive) |

---

## 3. Full Table Schemas

### 3.1 users
```sql
CREATE TABLE users (
  username              TEXT PRIMARY KEY,
  email                 TEXT UNIQUE NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN ('Admin', 'Super Manager', 'Manager', 'Supervisor', 'User')),
  department            TEXT,
  password_hash         TEXT,
  password_salt         TEXT,
  password              TEXT,              -- legacy plaintext (migrate away)
  
  -- Permissions
  allowed_accounts      TEXT DEFAULT '',   -- CSV of customer IDs, '*' = all
  allowed_campaigns     TEXT DEFAULT '',   -- CSV of campaign names
  allowed_drive_folders TEXT DEFAULT '',   -- CSV of Drive folder IDs
  allowed_looker_reports TEXT DEFAULT '',  -- CSV of looker report IDs
  drive_access_level    TEXT DEFAULT 'none' CHECK (drive_access_level IN ('none','view','upload','full')),
  module_access         JSONB DEFAULT '{}',
  
  -- Relations
  manager_id            TEXT REFERENCES users(username),
  team_members          TEXT DEFAULT '',   -- CSV of usernames
  
  -- Profile
  avatar_data           TEXT,              -- base64 encoded image
  
  -- Metadata
  last_login            TIMESTAMPTZ,
  email_notifications_enabled BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 accounts
```sql
CREATE TABLE accounts (
  customer_id           TEXT PRIMARY KEY,
  google_sheet_link     TEXT,
  drive_code_comments   TEXT,
  enabled               BOOLEAN DEFAULT true,
  status                TEXT DEFAULT 'Pending',
  last_run              TIMESTAMPTZ,
  workflow              TEXT DEFAULT 'workflow-0',
  created_date          TIMESTAMPTZ DEFAULT now()
);
```

### 3.3 campaign_conditions (shared schema for all 4 workflow tables)
```sql
-- This same schema applies to: campaign_conditions, workflow_1, workflow_2, workflow_3
CREATE TABLE campaign_conditions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         TEXT NOT NULL REFERENCES accounts(customer_id),
  campaign_name       TEXT,
  campaign_id         TEXT,
  condition_id        INTEGER REFERENCES removal_condition_definitions(id),
  condition_value     NUMERIC,
  condition_operator  TEXT CHECK (condition_operator IN ('>', '<', '>=', '<=', '=')),
  enabled             BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
-- Repeat for: workflow_1, workflow_2, workflow_3
```

### 3.4 workflows
```sql
CREATE TABLE workflows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  is_enabled  BOOLEAN DEFAULT true,
  config      JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 3.5 looker_reports
```sql
CREATE TABLE looker_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  report_url    TEXT NOT NULL,
  allowed_users TEXT DEFAULT '',       -- CSV of usernames, '' = all
  created_by    TEXT REFERENCES users(username),
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
```

### 3.6 removal_condition_definitions
```sql
CREATE TABLE removal_condition_definitions (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);
-- Seed with 24 rows (hardcoded values from Code.gs)
```

### 3.7 todos
```sql
CREATE TABLE todos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT NOT NULL,
  description         TEXT,
  kpi_type            TEXT,
  package_id          UUID REFERENCES packages(id),
  package_name        TEXT,
  campaign_id         TEXT,
  campaign_name       TEXT,
  customer_id         TEXT REFERENCES accounts(customer_id),
  assigned_to         TEXT REFERENCES users(username),
  manager_id          TEXT REFERENCES users(username),
  supervisor_id       TEXT REFERENCES users(username),
  created_by          TEXT NOT NULL REFERENCES users(username),
  assignment_chain    JSONB DEFAULT '[]',
  task_status         TEXT DEFAULT 'pending',
  approval_status     TEXT DEFAULT 'not_submitted',
  queue_status        TEXT DEFAULT 'active',
  priority            TEXT DEFAULT 'medium',
  due_date            TIMESTAMPTZ,
  start_date          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  attachments         JSONB DEFAULT '[]',
  drive_folder_id     TEXT,
  history             JSONB DEFAULT '[]',
  comments            JSONB DEFAULT '[]',
  notes               TEXT,
  tags                TEXT[],
  is_archived         BOOLEAN DEFAULT false,
  reminder_enabled    BOOLEAN DEFAULT true,
  last_reminder_sent  TIMESTAMPTZ
);
```

### 3.8 todo_shares
```sql
CREATE TABLE todo_shares (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id     UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  shared_by   TEXT NOT NULL REFERENCES users(username),
  shared_with TEXT NOT NULL REFERENCES users(username),
  can_edit    BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(todo_id, shared_with)
);
```

### 3.9 notifications
```sql
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL REFERENCES users(username),
  title       TEXT NOT NULL,
  body        TEXT,
  type        TEXT,
  related_id  TEXT,
  is_read     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 3.10 packages
```sql
CREATE TABLE packages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  category    TEXT,
  price       NUMERIC,
  is_active   BOOLEAN DEFAULT true,
  created_by  TEXT REFERENCES users(username),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### 3.11 user_packages
```sql
CREATE TABLE user_packages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL REFERENCES users(username),
  package_id  UUID NOT NULL REFERENCES packages(id),
  assigned_by TEXT REFERENCES users(username),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, package_id)
);
```

### 3.12 departments
```sql
CREATE TABLE departments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.13 credentials
```sql
CREATE TABLE credentials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service      TEXT NOT NULL,           -- 'google_ads', 'google_drive', etc.
  key_name     TEXT NOT NULL,
  key_value    TEXT NOT NULL,           -- encrypted / service_role only
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
-- IMPORTANT: This table should ONLY be accessible with service_role key
-- Never expose via anon key
```

---

## 4. Row Level Security (RLS) Strategy

```sql
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
-- ... (all tables)

-- Pattern 1: Self-read (users can read their own record)
CREATE POLICY "users_read_own" ON users
  FOR SELECT USING (username = auth.uid()::text);

-- Pattern 2: Admin can read all (for all tables)
CREATE POLICY "admins_read_all_users" ON users
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE username = auth.uid()::text AND role = 'Admin')
  );

-- Pattern 3: Todos — assignee or creator or manager can read
CREATE POLICY "todos_access" ON todos
  FOR SELECT USING (
    assigned_to = auth.uid()::text 
    OR created_by = auth.uid()::text 
    OR manager_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM todo_shares 
      WHERE todo_id = todos.id AND shared_with = auth.uid()::text
    )
  );

-- Pattern 4: Service role bypasses all RLS
-- Server-side actions using SUPABASE_SERVICE_ROLE_KEY bypass RLS automatically
```

> **Recommendation**: Use `service_role` key in all server actions (Next.js server components and API routes). Use `anon` key only in client components where you want RLS filtering.

---

## 5. Recommended Indexes

```sql
-- Accounts
CREATE INDEX idx_accounts_enabled ON accounts(enabled);
CREATE INDEX idx_accounts_workflow ON accounts(workflow);

-- Campaign conditions (all 4 tables)
CREATE INDEX idx_campaign_conditions_customer ON campaign_conditions(customer_id);
-- Repeat for workflow_1, workflow_2, workflow_3

-- Todos (most queried table)
CREATE INDEX idx_todos_assigned_to ON todos(assigned_to);
CREATE INDEX idx_todos_manager_id ON todos(manager_id);
CREATE INDEX idx_todos_task_status ON todos(task_status);
CREATE INDEX idx_todos_due_date ON todos(due_date);
CREATE INDEX idx_todos_customer_id ON todos(customer_id);
CREATE INDEX idx_todos_created_at ON todos(created_at DESC);
CREATE INDEX idx_todos_archived ON todos(is_archived);

-- Notifications
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- todo_shares
CREATE INDEX idx_todo_shares_shared_with ON todo_shares(shared_with);
CREATE INDEX idx_todo_shares_todo_id ON todo_shares(todo_id);

-- user_packages
CREATE INDEX idx_user_packages_user_id ON user_packages(user_id);
```

---

## 6. Supabase Client Setup (Next.js)

```typescript
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createSupabaseServerClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } }
  )
}

// For admin/service operations (bypasses RLS):
export function createSupabaseServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { get: () => undefined } }
  )
}
```

```typescript
// src/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

---

## 7. Supabase Realtime (Notifications)

```typescript
// src/hooks/useNotifications.ts
const supabase = createSupabaseBrowserClient()

useEffect(() => {
  const channel = supabase
    .channel('user-notifications')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${currentUser.username}`
    }, (payload) => {
      // Add new notification to local state
      // Show toast or update bell badge
    })
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}, [currentUser.username])
```

---

## 8. AI Build Prompt

> **Use this prompt when setting up the Supabase data layer:**

```
Set up the complete Supabase data layer for a Next.js CMS portal.

1. Create all 14 tables with the schemas defined in module-supabase-data-layer.md

2. Run this migration SQL in Supabase SQL Editor to create all tables and seed data.

3. Enable RLS on all tables and create policies.

4. Create these utility functions in src/lib/supabase/:
   - server.ts: createSupabaseServerClient(), createSupabaseServiceClient()
   - client.ts: createSupabaseBrowserClient()

5. Create TypeScript types that mirror Supabase table structure.
   Run: npx supabase gen types typescript --local > src/types/database.types.ts
   Or manually create interface for each table.

6. Seed the removal_condition_definitions table with all 24 rows.
   Also seed departments with: Marketing, Development, Sales, Operations, Design, Analytics

7. Set up Supabase Storage buckets:
   - 'avatars': for user profile images (public)
   - 'task-attachments': for task files (private, auth required)

8. Create a seed SQL script (src/lib/supabase/seed.sql) with initial data.

9. Set up Supabase Auth:
   - Email + password sign-in method
   - JWT expiry: 7 days (604800 seconds)
   - Disable email confirmation for dev (or set up email templates)
   - Store custom user data in users table (NOT auth.users — use trigger or manual insert)

10. Create DB trigger to sync Supabase Auth user creation with users table:
    CREATE OR REPLACE FUNCTION handle_new_user()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO public.users (username, email, role)
      VALUES (NEW.email, NEW.email, 'User')
      ON CONFLICT DO NOTHING;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;

    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION handle_new_user();

IMPORTANT NOTES:
- NEVER use the service_role key in client-side code (browser)
- Use service_role only in server actions and API routes
- Test RLS policies carefully — use Supabase Policy Editor
- All server actions should use createSupabaseServiceClient() for reliability
- Client components that need real-time should use createSupabaseBrowserClient() + anon key
```

---
