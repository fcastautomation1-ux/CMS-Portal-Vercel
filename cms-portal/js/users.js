// ================================================================
// users.js
// User management API + UI.
// Depends on: supabase-client.js, auth.js, ui-helpers.js, departments.js
// ================================================================

const usersAPI = {

    async getAllUsers(token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        const data = await directDB.select('users');
        return (data || []).map(u => ({
            username: u.username,
            email: u.email || '',
            password: u.password,
            role: u.role,
            department: u.department,
            allowedAccounts: u.allowed_accounts,
            allowedCampaigns: u.allowed_campaigns,
            allowedDriveFolders: u.allowed_drive_folders,
            allowedLookerReports: u.allowed_looker_reports,
            driveAccessLevel: u.drive_access_level,
            moduleAccess: u.module_access,
            managerId: u.manager_id,
            teamMembers: u.team_members,
            createdDate: u.created_date,
            enabled: u.enabled
        }));
    },

    async saveUser(userData, token) {
        const caller = await directAPI.validateToken(token);
        const isAdmin = caller && (caller.username === 'admin' || caller.role === 'Admin');
        if (!caller || (!isAdmin && caller.role !== 'Manager' && caller.role !== 'Super Manager'))
            throw new Error('Unauthorized');

        if (!userData.username || !userData.username.trim()) throw new Error('Username is required');

        const payload = {
            username: userData.username.trim().toLowerCase(),
            email: (userData.email || '').trim() || null,
            role: userData.role || 'Employee',
            department: userData.department || null,
            allowed_accounts: userData.allowedAccounts || '',
            allowed_campaigns: userData.allowedCampaigns || '',
            allowed_drive_folders: userData.allowedDriveFolders || '',
            allowed_looker_reports: userData.allowedLookerReports || '',
            drive_access_level: userData.driveAccessLevel || 'view',
            module_access: userData.moduleAccess || null,
            manager_id: userData.managerId || null,
            team_members: userData.teamMembers || null,
            enabled: userData.enabled !== false
        };

        if (userData.password && userData.password.trim()) {
            payload.password = await hashPassword(userData.password.trim());
        }

        const existing = await directDB.select('users', { username: payload.username });
        if (existing?.length) {
            const updatePayload = { ...payload };
            delete updatePayload.username;
            if (!userData.password || !userData.password.trim()) delete updatePayload.password;
            await directDB.update('users', updatePayload, { username: payload.username });
        } else {
            if (!payload.password) throw new Error('Password is required for new users');
            payload.created_date = new Date().toISOString();
            await directDB.upsert('users', payload);
        }
        return true;
    },

    async deleteUser(username, token) {
        const caller = await directAPI.validateToken(token);
        const isAdmin = caller && (caller.username === 'admin' || caller.role === 'Admin');
        if (!caller || (!isAdmin && caller.role !== 'Manager' && caller.role !== 'Super Manager'))
            throw new Error('Unauthorized');
        if (username === 'admin') throw new Error('Cannot delete admin user');
        await directDB.delete('users', { username });
        return true;
    },

    async updateUserDriveAccess(username, itemId, grantAccess, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        const users = await directDB.select('users', { username });
        if (!users?.length) throw new Error('User not found');
        const u = users[0];

        const folders = (u.allowed_drive_folders || '').split(',').map(s => s.trim()).filter(Boolean);
        const normalized = folders.map(f => f.toLowerCase());
        const itemLower = itemId.toLowerCase();

        let updated;
        if (grantAccess && !normalized.includes(itemLower)) {
            updated = [...folders, itemId].join(',');
        } else if (!grantAccess) {
            updated = folders.filter(f => f.toLowerCase() !== itemLower).join(',');
        } else {
            return true; // Already in correct state
        }

        await directDB.update('users', { allowed_drive_folders: updated }, { username });
        return true;
    }
};

// Password hashing (SHA-256 with salt, matches existing logic)
async function hashPassword(password) {
    const salt = 'cms_portal_salt_2024';
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ----------------------------------------------------------------
// USERS UI
// ----------------------------------------------------------------
let _allUsersData = [];

async function loadUsersSection() {
    const token = getStoredToken();
    if (!token) return;

    const tableBody = document.querySelector('#usersTable tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="8" class="loading-cell"><div class="loading-spinner"></div></td></tr>';

    try {
        _allUsersData = await usersAPI.getAllUsers(token);

        // Also save to window.allUsers for department functions
        window.allUsers = _allUsersData;
        renderUsersTable(_allUsersData);
    } catch (e) {
        tableBody.innerHTML = `<tr><td colspan="8" class="error-cell">Error: ${e.message}</td></tr>`;
        showToast('Failed to load users: ' + e.message, 'error');
    }
}

function renderUsersTable(users) {
    const tableBody = document.querySelector('#usersTable tbody');
    if (!tableBody) return;

    if (!users.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-cell">
                    <div class="empty-state">
                        <div class="empty-icon">👤</div>
                        <div class="empty-title">No users found</div>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tableBody.innerHTML = users.map(u => `
        <tr class="user-row ${u.enabled ? '' : 'disabled-row'}" data-username="${u.username}">
            <td>
                <div class="user-info">
                    <div class="user-avatar">${(u.username || '?')[0].toUpperCase()}</div>
                    <div>
                        <div class="user-name">${escapeHtml(u.username)}</div>
                    </div>
                </div>
            </td>
            <td>
                <span class="role-badge role-${(u.role || 'employee').toLowerCase().replace(/\s+/, '-')}">
                    ${escapeHtml(u.role || 'Employee')}
                </span>
            </td>
            <td class="text-muted">${escapeHtml(u.department || '—')}</td>
            <td>
                ${u.allowedAccounts === 'All' || u.allowedAccounts === '*'
                    ? '<span class="badge badge-success">All Accounts</span>'
                    : u.allowedAccounts
                        ? `<span class="badge">${u.allowedAccounts.split(',').length} accounts</span>`
                        : '<span class="text-muted">None</span>'}
            </td>
            <td class="text-muted">${escapeHtml(u.managerId || '—')}</td>
            <td>
                <span class="status-badge ${u.enabled ? 'status-active' : 'status-disabled'}">
                    ${u.enabled ? 'Active' : 'Disabled'}
                </span>
            </td>
            <td class="text-muted small">${u.createdDate ? new Date(u.createdDate).toLocaleDateString() : '—'}</td>
            <td class="actions-cell">
                <button class="btn-icon" title="Edit" onclick="showUserModal('${u.username}')">✏️</button>
                <button class="btn-icon btn-danger" title="Delete" onclick="deleteUserPrompt('${u.username}')">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function filterUsers(term) {
    const lower = (term || '').toLowerCase();
    const filtered = _allUsersData.filter(u =>
        !lower ||
        (u.username || '').toLowerCase().includes(lower) ||
        (u.role || '').toLowerCase().includes(lower) ||
        (u.department || '').toLowerCase().includes(lower)
    );
    renderUsersTable(filtered);
}

function showUserModal(username = null) {
    const modal = document.getElementById('userModal');
    if (!modal) return;

    const user = username ? _allUsersData.find(u => u.username === username) : null;
    document.getElementById('userModalTitle').textContent = user ? 'Edit User' : 'Add User';
    document.getElementById('editingUsername').value = user?.username || '';

    document.getElementById('userUsername').value = user?.username || '';
    document.getElementById('userUsername').readOnly = !!user;
    document.getElementById('userPassword').value = '';
    document.getElementById('userRole').value = user?.role || 'Employee';
    document.getElementById('userDepartment').value = user?.department || '';
    document.getElementById('userAllowedAccounts').value = user?.allowedAccounts || '';
    document.getElementById('userManagerId').value = user?.managerId || '';
    document.getElementById('userEnabled').checked = user ? user.enabled : true;
    document.getElementById('userDriveAccessLevel').value = user?.driveAccessLevel || 'view';

    // New fields
    const emailEl = document.getElementById('userEmail');
    if (emailEl) emailEl.value = user?.email || '';

    const teamEl = document.getElementById('userTeamMembers');
    if (teamEl) teamEl.value = user?.teamMembers || '';

    // Module access JSON editor
    const maEl = document.getElementById('userModuleAccess');
    if (maEl) {
        try {
            const ma = user?.moduleAccess
                ? (typeof user.moduleAccess === 'string'
                    ? JSON.parse(user.moduleAccess)
                    : user.moduleAccess)
                : {};
            maEl.value = JSON.stringify(ma, null, 2);
        } catch {
            maEl.value = user?.moduleAccess || '{}';
        }
    }

    modal.classList.add('open');
}

function closeUserModal() {
    document.getElementById('userModal')?.classList.remove('open');
}

async function saveUserFromModal() {
    const token = getStoredToken();
    if (!token) return;

    const editingUsername = document.getElementById('editingUsername').value;
    const userData = {
        username: document.getElementById('userUsername').value.trim(),
        email: (document.getElementById('userEmail')?.value || '').trim(),
        password: document.getElementById('userPassword').value,
        role: document.getElementById('userRole').value,
        department: document.getElementById('userDepartment').value.trim(),
        allowedAccounts: document.getElementById('userAllowedAccounts').value.trim(),
        managerId: document.getElementById('userManagerId').value.trim(),
        teamMembers: (document.getElementById('userTeamMembers')?.value || '').trim() || null,
        enabled: document.getElementById('userEnabled').checked,
        moduleAccess: document.getElementById('userModuleAccess')?.value?.trim() || null,
        driveAccessLevel: document.getElementById('userDriveAccessLevel').value
    };

    // Validate module access JSON if filled
    if (userData.moduleAccess) {
        try { JSON.parse(userData.moduleAccess); } catch {
            showToast('Module Access field contains invalid JSON', 'error');
            return;
        }
    }

    if (!userData.username) {
        showToast('Username is required', 'error');
        return;
    }

    const btn = document.getElementById('saveUserBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
        await usersAPI.saveUser(userData, token);
        closeUserModal();
        showToast('User saved successfully', 'success');
        loadUsersSection();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save User'; }
    }
}

async function deleteUserPrompt(username) {
    if (!confirm(`Are you sure you want to delete user "${username}"? This cannot be undone.`)) return;
    const token = getStoredToken();
    if (!token) return;
    try {
        await usersAPI.deleteUser(username, token);
        showToast('User deleted', 'success');
        loadUsersSection();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}
