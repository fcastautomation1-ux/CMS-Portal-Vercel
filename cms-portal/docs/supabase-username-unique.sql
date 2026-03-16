-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Enforce unique username in users table
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Check for any existing duplicate usernames BEFORE applying constraint.
-- If this query returns rows, resolve duplicates manually first.
SELECT username, COUNT(*) AS count
FROM users
GROUP BY username
HAVING COUNT(*) > 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Make username the PRIMARY KEY (if not already).
-- Only run ONE of the blocks below depending on your table setup.
-- ─────────────────────────────────────────────────────────────────────────────

-- Option A: If the table has NO primary key yet, promote username to primary key:
-- ALTER TABLE users ADD PRIMARY KEY (username);

-- Option B: If a primary key already exists on another column (e.g. id),
-- just add a UNIQUE constraint on username:
ALTER TABLE users
  ADD CONSTRAINT users_username_unique UNIQUE (username);

-- Step 3: (Optional but recommended) Also enforce unique email:
ALTER TABLE users
  ADD CONSTRAINT users_email_unique UNIQUE (email);

-- ─────────────────────────────────────────────────────────────────────────────
-- After running this, any INSERT or UPDATE that tries to use an existing
-- username or email will fail with a Postgres unique-violation error,
-- which the app's server actions already catch and return as a user-friendly
-- error message.
-- ─────────────────────────────────────────────────────────────────────────────
