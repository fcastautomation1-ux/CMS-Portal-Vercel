// ================================================================
// supabase-client.js
// Supabase client factory + low-level CRUD helper (directDB)
// ================================================================

let _supabaseClient = null;
let _supabaseConfigSource = 'env';
let _supabaseConfigSynced = false;

// Column sets to minimize egress (no avatar_data on auth checks)
const USER_AUTH_COLUMNS = 'username,role,department,allowed_accounts,allowed_drive_folders,allowed_campaigns,allowed_looker_reports,drive_access_level,module_access,email_notifications_enabled,manager_id,team_members';
const USER_LIST_COLUMNS = 'username,role,department,email,password,allowed_accounts,allowed_drive_folders,allowed_campaigns,allowed_looker_reports,last_login,drive_access_level,module_access,manager_id,team_members';

/**
 * Returns a live Supabase client instance, creating one if needed.
 * Requires SUPABASE_CONFIG to be set via applySupabaseConfig().
 */
function getSupabase() {
    if (!_supabaseClient) {
        if (typeof supabase === 'undefined') {
            console.error('Supabase library not loaded');
            return null;
        }
        if (!SUPABASE_CONFIG || !SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
            console.error('Supabase config missing');
            return null;
        }
        if (!SUPABASE_CONFIG.url.includes('supabase.co')) {
            console.error('Invalid Supabase URL');
            return null;
        }
        try {
            _supabaseClient = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
                auth: {
                    storageKey: 'cms-portal-supabase-auth',
                    persistSession: false,
                    autoRefreshToken: false,
                    detectSessionInUrl: false
                }
            });
        } catch (err) {
            console.error('Failed to create Supabase client:', err);
            return null;
        }
    }
    return _supabaseClient;
}

/**
 * Ensure Supabase is ready before making requests.
 * Polls for up to timeoutMs.
 */
async function ensureSupabaseReady(timeoutMs = 2500) {
    const startedAt = Date.now();
    // 1) Try window.__ENV_LOCAL (local dev override in index.html)
    if (window.__ENV_LOCAL?.SUPABASE_URL && window.__ENV_LOCAL?.SUPABASE_ANON_KEY) {
        applySupabaseConfig({
            url: window.__ENV_LOCAL.SUPABASE_URL,
            anonKey: window.__ENV_LOCAL.SUPABASE_ANON_KEY
        }, 'local-dev');
    }

    // 2) Try standard window.__ENV (legacy path)
    loadConfigFromEnv();

    // 3) Fetch from Vercel serverless function /api/config
    if (!getSupabase()) {
        try {
            const resp = await fetch('/api/config');
            if (resp.ok) {
                const { url, key } = await resp.json();
                if (url && key) applySupabaseConfig({ url, anonKey: key }, 'vercel-api');
            }
        } catch { /* running locally without the API route — that's fine */ }
    }

    while (!getSupabase() && (Date.now() - startedAt) < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 140));
    }
    return getSupabase() !== null;
}

// ----------------------------------------------------------------
// directDB — Generic CRUD helpers
// All functions throw on error so callers can catch consistently.
// ----------------------------------------------------------------
const directDB = {
    async select(table, filters = {}, columns = '*') {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');
        let query = client.from(table).select(columns);
        for (const [k, v] of Object.entries(filters)) query = query.eq(k, v);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data;
    },

    async upsert(table, data, onConflict) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');
        let query = client
            .from(table)
            .upsert(Array.isArray(data) ? data : [data], onConflict ? { onConflict } : undefined);
        const { data: result, error } = await query.select();
        if (error) throw new Error(error.message);
        return result;
    },

    async update(table, data, filters) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');
        let query = client.from(table).update(data);
        for (const [k, v] of Object.entries(filters)) query = query.eq(k, v);
        const { data: result, error } = await query.select();
        if (error) throw new Error(error.message);
        return result;
    },

    async delete(table, filters) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');
        let query = client.from(table).delete();
        for (const [k, v] of Object.entries(filters)) query = query.eq(k, v);
        const { error } = await query;
        if (error) throw new Error(error.message);
        return true;
    },

    async updateIn(table, data, column, values) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');
        const { data: result, error } = await client
            .from(table)
            .update(data)
            .in(column, values)
            .select();
        if (error) throw new Error(error.message);
        return result;
    }
};

// ----------------------------------------------------------------
// directAPI — High-level API helpers
// validateToken, login, queueTaskToDepartment
// All callers across the codebase depend on this object.
// ----------------------------------------------------------------
const directAPI = {

    /**
     * Validate a base64 token and return the full user object.
     * Token format: base64(username:timestamp:role)
     */
    async validateToken(token) {
        if (!token) return null;
        try {
            const decoded = atob(token);
            const [username] = decoded.split(':');
            if (!username) return null;

            const users = await directDB.select('users', { username }, USER_AUTH_COLUMNS);
            if (!users?.length) return null;

            const user = { ...users[0] };

            // Parse allowedAccounts from comma-separated string
            if (typeof user.allowed_accounts === 'string') {
                user.allowedAccounts = user.allowed_accounts
                    .split(',').map(s => s.trim()).filter(Boolean);
            } else {
                user.allowedAccounts = [];
            }

            // Parse module_access from comma-separated string
            if (typeof user.module_access === 'string') {
                user.moduleAccess = user.module_access
                    .split(',').map(s => s.trim()).filter(Boolean);
            } else {
                user.moduleAccess = [];
            }

            return user;
        } catch {
            return null;
        }
    },

    /**
     * Authenticate a user by username + password.
     * Supports SHA-256 hashed passwords and legacy plaintext.
     * Returns { success, token, user } or throws on failure.
     */
    async login(username, password) {
        const cols = USER_AUTH_COLUMNS + ',password';
        const users = await directDB.select('users', { username }, cols);
        if (!users?.length) throw new Error('Invalid credentials');

        const user = users[0];
        let valid = false;

        if (user.password) {
            if (user.password.length === 64) {
                // SHA-256 hex hash
                const enc = new TextEncoder();
                const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(password));
                const hashArr = Array.from(new Uint8Array(hashBuf));
                const hashHex = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
                valid = hashHex === user.password;
            } else {
                // Legacy plaintext
                valid = password === user.password;
            }
        }

        if (!valid) throw new Error('Invalid credentials');

        // Update last_login (non-critical, fire-and-forget)
        try {
            await directDB.update('users', { last_login: new Date().toISOString() }, { username });
        } catch { /* non-critical */ }

        // Generate base64 token
        const token = btoa(`${username}:${Date.now()}:${user.role || 'Employee'}`);

        // Parse allowedAccounts
        if (typeof user.allowed_accounts === 'string') {
            user.allowedAccounts = user.allowed_accounts
                .split(',').map(s => s.trim()).filter(Boolean);
        } else {
            user.allowedAccounts = [];
        }

        // Parse moduleAccess
        if (typeof user.module_access === 'string') {
            user.moduleAccess = user.module_access
                .split(',').map(s => s.trim()).filter(Boolean);
        } else {
            user.moduleAccess = [];
        }

        // Remove raw password before returning
        const safeUser = { ...user };
        delete safeUser.password;

        return { success: true, token, user: safeUser };
    },

    /**
     * Queue a task to the given department.
     * Finds the least-loaded active user in that department and assigns them.
     * Returns { success, assignedTo }.
     */
    async queueTaskToDepartment(todoId, department, token) {
        const me = await this.validateToken(token);
        if (!me) throw new Error('Unauthorized');

        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');

        // Get all users in the target department
        const { data: deptUsers, error: uErr } = await client
            .from('users')
            .select('username')
            .eq('department', department);

        if (uErr) throw new Error(uErr.message);
        if (!deptUsers?.length) throw new Error('No users in department: ' + department);

        const usernames = deptUsers.map(u => u.username);

        // Count open tasks per user
        const { data: openTasks, error: tErr } = await client
            .from('todos')
            .select('assigned_to')
            .in('assigned_to', usernames)
            .eq('completed', false);

        if (tErr) throw new Error(tErr.message);

        const counts = {};
        usernames.forEach(u => { counts[u] = 0; });
        (openTasks || []).forEach(t => {
            if (t.assigned_to) counts[t.assigned_to] = (counts[t.assigned_to] || 0) + 1;
        });

        // Pick least-loaded user
        const assignTo = usernames.reduce((a, b) =>
            (counts[a] || 0) <= (counts[b] || 0) ? a : b
        );

        // Update the task
        const now = new Date().toISOString();
        const { error: updErr } = await client
            .from('todos')
            .update({
                assigned_to:      assignTo,
                queue_status:     'queued',
                queue_department: department,
                updated_at:       now
            })
            .eq('id', todoId);

        if (updErr) throw new Error(updErr.message);

        return { success: true, assignedTo: assignTo };
    }
};
