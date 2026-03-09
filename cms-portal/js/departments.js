// ================================================================
// departments.js
// Department utilities + Supabase API for departments table.
// Depends on: supabase-client.js, auth.js
// ================================================================

// ----------------------------------------------------------------
// DEPARTMENT HELPERS (pure utility functions — no Supabase needed)
// ----------------------------------------------------------------

/**
 * Normalize a department name for fuzzy-safe comparison.
 * Strips leading "app/apps", apostrophes, and extra whitespace.
 */
function normalizeDepartmentName(value) {
    const raw = (value || '').toString().toLowerCase().trim();
    if (!raw) return '';
    return raw
        .replace(/['`]/g, '')           // app's -> apps
        .replace(/\s+/g, ' ')
        .replace(/^apps?\s+/, '')       // leading "app " / "apps "
        .replace(/\s+apps?$/, '')       // trailing " app" / " apps"
        .trim();
}

/**
 * Split a comma-separated department string into an array.
 */
function splitDepartmentValues(value) {
    if (!value) return [];
    return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Check whether a user object (or department string) belongs to the given department.
 */
function userBelongsToDepartment(userLike, departmentName) {
    const target = normalizeDepartmentName(departmentName);
    if (!target) return false;
    const raw = (typeof userLike === 'object' && userLike !== null)
        ? (userLike.department || '')
        : userLike;
    return splitDepartmentValues(raw).some(d => normalizeDepartmentName(d) === target);
}

/**
 * Get the first (primary) department for a given username from window.allUsers.
 */
function getPrimaryDepartmentForUsername(username) {
    const uLower = (username || '').toString().toLowerCase().trim();
    if (!uLower) return '';
    const row = (window.allUsers || []).find(u => (u.username || '').toLowerCase() === uLower);
    if (!row) return '';
    const parts = splitDepartmentValues(row.department || '');
    return parts[0] || '';
}

/**
 * Check if a task is queued to the given user's department.
 */
function isQueuedTaskForDepartmentUser(task, username) {
    if (!task || task.queue_status !== 'queued' || task.completed || task.archived) return false;
    const qDept = normalizeDepartmentName(task.queue_department);
    if (!qDept) return false;
    const userDept = getPrimaryDepartmentForUsername(username)
        || ((username || '').toLowerCase() === (currentUser?.username || '').toLowerCase()
            ? (currentUser?.department || '')
            : '');
    return qDept === normalizeDepartmentName(userDept);
}

/**
 * Build a deduplicated, alphabetically sorted list of department names.
 * Prefers official names from the departments table (departmentsCache),
 * falls back to user department values.
 */
function getLatestDepartmentNames() {
    const canonicalByNorm = new Map();

    const addNames = (values, isOfficial = false) => {
        (values || []).forEach(rawValue => {
            splitDepartmentValues(rawValue).forEach(name => {
                const clean = (name || '').toString().trim();
                if (!clean) return;
                const norm = normalizeDepartmentName(clean);
                if (!norm) return;
                const existing = canonicalByNorm.get(norm);
                if (!existing) {
                    canonicalByNorm.set(norm, { name: clean, official: !!isOfficial });
                    return;
                }
                // Official labels win over inferred ones
                if (isOfficial && !existing.official) {
                    canonicalByNorm.set(norm, { name: clean, official: true });
                }
            });
        });
    };

    const deptCacheRows = (window.departmentsCache?.data || []);
    addNames(deptCacheRows.map(d => (d && typeof d === 'object') ? (d.name || '') : d), true);

    if (canonicalByNorm.size === 0) {
        addNames((window.allUsers || []).map(u => u?.department || ''), false);
    }

    return Array.from(canonicalByNorm.values())
        .map(v => v.name)
        .sort((a, b) => a.localeCompare(b));
}

// ----------------------------------------------------------------
// DEPARTMENTS API (Supabase CRUD via directAPI)
// These are called from the main directAPI object in api.js.
// Exposed here as standalone functions for reuse.
// ----------------------------------------------------------------

const departmentsAPI = {
    async getAllDepartments(token) {
        const caller = await directAPI.validateToken(token);
        if (!caller) throw new Error('Unauthorized');
        try {
            return (await directDB.select('departments')) || [];
        } catch (e) {
            console.error('Error fetching departments:', e);
            return [];
        }
    },

    async saveDepartment(departmentData, token) {
        const user = await directAPI.validateToken(token);
        const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
        if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager')) {
            throw new Error('Unauthorized');
        }

        const payload = {
            name: departmentData.name.trim(),
            description: departmentData.description || ''
        };
        if (!payload.name) throw new Error('Department name is required');

        if (departmentData.id) {
            // Update existing — cascade rename to users & todos
            const client = getSupabase();
            if (!client) throw new Error('Supabase not configured');

            // Resolve old department row
            let existingDept = null;
            try {
                const byId = await client.from('departments').select('id, name').eq('id', departmentData.id).maybeSingle();
                existingDept = byId?.data || null;
            } catch (e) { existingDept = null; }
            if (!existingDept) {
                try {
                    const byName = await client.from('departments').select('id, name').eq('name', departmentData.id).maybeSingle();
                    existingDept = byName?.data || null;
                } catch (e) { existingDept = null; }
            }

            await directDB.update('departments', payload, existingDept ? { id: existingDept.id } : { name: departmentData.id });

            const oldName = String(existingDept?.name || '').trim();
            const newName = payload.name;

            // Sync users.department
            if (oldName) {
                const { data: allUsers } = await client.from('users').select('username, department').not('department', 'is', null);
                const userOps = [];
                for (const u of (allUsers || [])) {
                    const parts = splitDepartmentValues(u.department || '');
                    let changed = false;
                    const replaced = parts.map(part => {
                        if (normalizeDepartmentName(part) === normalizeDepartmentName(oldName)) {
                            if ((part || '').trim() !== newName) changed = true;
                            return newName;
                        }
                        return part;
                    });
                    if (!changed) continue;
                    const seen = new Set();
                    const deduped = [];
                    replaced.forEach(part => {
                        const key = normalizeDepartmentName(part);
                        if (!key || seen.has(key)) return;
                        seen.add(key);
                        deduped.push(part.trim());
                    });
                    userOps.push(client.from('users').update({ department: deduped.join(', ') || null }).eq('username', u.username));
                }
                for (let i = 0; i < userOps.length; i += 20) await Promise.all(userOps.slice(i, i + 20));

                // Sync queued todos.queue_department
                const { data: queuedTodos } = await client.from('todos').select('id, queue_department').not('queue_department', 'is', null);
                const todoOps = [];
                (queuedTodos || []).forEach(t => {
                    if (normalizeDepartmentName(t.queue_department) === normalizeDepartmentName(oldName)) {
                        if ((t.queue_department || '').trim() === newName) return;
                        todoOps.push(client.from('todos').update({ queue_department: newName }).eq('id', t.id));
                    }
                });
                for (let i = 0; i < todoOps.length; i += 20) await Promise.all(todoOps.slice(i, i + 20));
            }

            return { success: true, renamedFrom: oldName || null, renamedTo: newName };
        } else {
            await directDB.upsert('departments', payload);
            return { success: true, renamedFrom: null, renamedTo: null };
        }
    },

    async deleteDepartment(departmentId, token) {
        const user = await directAPI.validateToken(token);
        const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
        if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager')) {
            throw new Error('Unauthorized');
        }
        await directDB.delete('departments', { id: departmentId });
        return true;
    }
};
