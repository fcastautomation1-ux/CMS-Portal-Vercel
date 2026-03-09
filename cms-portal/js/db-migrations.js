/* ================================================================
   db-migrations.js  —  Auto schema migration & data backfills
   Runs once on startup after Supabase is ready.
   ================================================================ */

'use strict';

// ── SCHEMA MIGRATION ──────────────────────────────────────────────

const REQUIRED_MIGRATIONS = [
    // todos
    { table: 'todos', column: 'our_goal',          type: 'text',        default_val: "''" },
    { table: 'todos', column: 'task_status',        type: 'text',        default_val: "'todo'" },
    { table: 'todos', column: 'completed_by',       type: 'text',        default_val: null },
    { table: 'todos', column: 'completed_at',       type: 'timestamptz', default_val: null },
    { table: 'todos', column: 'approval_status',    type: 'text',        default_val: "'approved'" },
    { table: 'todos', column: 'approved_at',        type: 'timestamptz', default_val: null },
    { table: 'todos', column: 'approved_by',        type: 'text',        default_val: null },
    { table: 'todos', column: 'declined_at',        type: 'timestamptz', default_val: null },
    { table: 'todos', column: 'declined_by',        type: 'text',        default_val: null },
    { table: 'todos', column: 'decline_reason',     type: 'text',        default_val: null },
    { table: 'todos', column: 'manager_id',         type: 'text',        default_val: null },
    { table: 'todos', column: 'assignment_chain',   type: 'jsonb',       default_val: "'[]'::jsonb" },
    { table: 'todos', column: 'multi_assignment',   type: 'jsonb',       default_val: null },
    { table: 'todos', column: 'history',            type: 'jsonb',       default_val: "'[]'::jsonb" },
    { table: 'todos', column: 'queue_department',   type: 'text',        default_val: null },
    { table: 'todos', column: 'queue_status',       type: 'text',        default_val: null },
    { table: 'todos', column: 'expected_due_date',  type: 'timestamptz', default_val: null },
    { table: 'todos', column: 'actual_due_date',    type: 'timestamptz', default_val: null },
    { table: 'todos', column: 'kpi_type',           type: 'text',        default_val: null },
    { table: 'todos', column: 'app_name',           type: 'text',        default_val: null },
    // packages
    { table: 'packages', column: 'department',          type: 'text', default_val: null },
    { table: 'packages', column: 'app_name',            type: 'text', default_val: null },
    { table: 'packages', column: 'playconsole_account', type: 'text', default_val: null },
    { table: 'packages', column: 'marketer',            type: 'text', default_val: null },
    { table: 'packages', column: 'product_owner',       type: 'text', default_val: null },
    { table: 'packages', column: 'monetization',        type: 'text', default_val: null },
    { table: 'packages', column: 'admob',               type: 'text', default_val: null },
    // users
    { table: 'users', column: 'password_hash',   type: 'text', default_val: null },
    { table: 'users', column: 'password_salt',   type: 'text', default_val: null },
    { table: 'users', column: 'team_members',    type: 'text', default_val: null },
    { table: 'users', column: 'module_access',   type: 'text', default_val: null },
    { table: 'users', column: 'manager_id',      type: 'text', default_val: null },
];

/**
 * Attempt to add missing columns using the exec_sql RPC.
 * Falls back to per-column SELECT checks if RPC unavailable.
 */
async function ensureDatabaseSchema() {
    const client = getSupabase();
    if (!client) { console.warn('DB schema check skipped: Supabase not ready'); return; }

    const sqlStatements = REQUIRED_MIGRATIONS.map(m => {
        const def = m.default_val !== null ? ` DEFAULT ${m.default_val}` : '';
        return `ALTER TABLE public.${m.table} ADD COLUMN IF NOT EXISTS ${m.column} ${m.type}${def};`;
    }).join('\n');

    // Try RPC exec_sql first
    try {
        const { error } = await client.rpc('exec_sql', { query: sqlStatements });
        if (!error) { return; }
    } catch { /* RPC not available */ }

    // Fallback: test columns one by one
    const missing = [];
    for (const m of REQUIRED_MIGRATIONS) {
        const { error } = await client.from(m.table).select(m.column).limit(1);
        if (error && error.message?.includes(m.column)) {
            missing.push(`${m.table}.${m.column}`);
        }
    }

    if (missing.length > 0) {
        console.warn('Missing DB columns:', missing.join(', '));
        console.info('Run this SQL in Supabase SQL Editor:\n\n' + sqlStatements);
        if (window.showToast) {
            showToast('⚠️ Some DB columns are missing. Check console for migration SQL.', 'warning');
        }
    }
}

// ── APP NAME SYNC BACKFILL ────────────────────────────────────────
async function syncAppNamesForExistingTasks() {
    const client = getSupabase();
    if (!client) return;

    try {
        const { data: packages } = await client.from('packages').select('name, app_name');
        if (!packages?.length) return;

        const pkgMap = {};
        packages.forEach(p => { if (p.name && p.app_name) pkgMap[p.name] = p.app_name; });

        const { data: todos } = await client
            .from('todos')
            .select('id, package_name, app_name')
            .not('package_name', 'is', null)
            .neq('package_name', '')
            .neq('package_name', 'Others');

        if (!todos?.length) return;

        let updated = 0;
        for (const todo of todos) {
            if (todo.app_name) continue;
            const appName = pkgMap[todo.package_name];
            if (appName) {
                await client.from('todos').update({ app_name: appName }).eq('id', todo.id);
                updated++;
            }
        }
        if (updated > 0) console.log(`✅ Synced app_name for ${updated} tasks`);
    } catch(e) {
        console.warn('App name sync skipped:', e.message);
    }
}

// ── ASSIGNEE OWNERSHIP BACKFILL ───────────────────────────────────
const ASSIGNEE_OWNERSHIP_BACKFILL_VERSION = '2026-03-04-v1';
let _assigneeOwnershipRunning = false;

async function backfillHistoricalAssigneeOwnership() {
    if (_assigneeOwnershipRunning) return;
    const me = window.currentUser;
    if (!me || (me.username !== 'admin' && me.role !== 'Admin' && me.role !== 'Super Manager')) return;

    const doneKey = `assignee_ownership_backfill_done_${ASSIGNEE_OWNERSHIP_BACKFILL_VERSION}`;
    if (localStorage.getItem(doneKey) === '1') return;

    const client = getSupabase();
    if (!client) return;

    _assigneeOwnershipRunning = true;
    const nowIso = new Date().toISOString();
    let scanned = 0, fixed = 0;

    try {
        let from = 0;
        const pageSize = 200;

        while (true) {
            const { data: rows, error } = await client
                .from('todos')
                .select('id, username, assigned_to, completed_by, approval_status, completed, task_status')
                .not('completed_by', 'is', null)
                .range(from, from + pageSize - 1);

            if (error || !rows?.length) break;
            scanned += rows.length;

            const updates = [];
            for (const row of rows) {
                const creator   = (row.username    || '').trim();
                const assigned  = (row.assigned_to || '').trim();
                const completer = (row.completed_by|| '').trim();
                if (!creator || !assigned || !completer) continue;
                if (assigned.toLowerCase() !== creator.toLowerCase()) continue;
                if (completer.toLowerCase() === creator.toLowerCase()) continue;

                const payload = { assigned_to: completer, updated_at: nowIso };
                if (row.approval_status === 'pending_approval' && !row.completed) {
                    const st = (row.task_status || '').toLowerCase();
                    if (!st || st === 'todo' || st === 'backlog') payload.task_status = 'in_progress';
                }
                updates.push({ id: row.id, data: payload });
            }

            for (let i = 0; i < updates.length; i += 15) {
                await Promise.all(
                    updates.slice(i, i + 15).map(u => client.from('todos').update(u.data).eq('id', u.id))
                );
                fixed += Math.min(15, updates.length - i);
            }

            from += rows.length;
            if (rows.length < pageSize) break;
        }

        localStorage.setItem(doneKey, '1');
        if (fixed > 0) {
            if (window.showToast) showToast(`Fixed assignment ownership on ${fixed} tasks`, 'success');
        }
    } catch(e) {
        console.warn('Assignee ownership backfill failed:', e.message);
    } finally {
        _assigneeOwnershipRunning = false;
    }
}

// ── ENTRY POINT ───────────────────────────────────────────────────
/**
 * Call this once after successful login / Supabase ready.
 */
window.scheduleDatabaseMigrations = function () {
    setTimeout(ensureDatabaseSchema, 1000);
    setTimeout(syncAppNamesForExistingTasks, 3000);
    setTimeout(backfillHistoricalAssigneeOwnership, 6500);
    // MA chain backfill is triggered from multi-assignment.js
    setTimeout(() => {
        if (window.queueHistoricalMaChainBackfill) window.queueHistoricalMaChainBackfill();
    }, 8000);
};
