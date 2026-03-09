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
    // If config already applied from env, it should be instant
    loadConfigFromEnv();
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
