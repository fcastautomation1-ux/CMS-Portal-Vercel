/* ================================================================
   packages.js  —  App Packages Module
   Handles: listing packages, creating/editing, assigning users,
            department filtering, linking packages to tasks
   ================================================================ */

'use strict';

// ── API ──────────────────────────────────────────────────────────
const PackagesAPI = {

    async getAll() {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');
        const { data, error } = await client
            .from('packages')
            .select('*')
            .order('name', { ascending: true });
        if (error) throw new Error(error.message);
        return data || [];
    },

    async getAccessible() {
        const pkgs = await this.getAll();
        const me = window.currentUser;
        if (!me) return [];

        // Admins / Managers see all
        const isPriv = me.username === 'admin' || me.role === 'Admin' ||
            me.role === 'Manager' || me.role === 'Super Manager';
        if (isPriv) return pkgs;

        // Employees see packages in their department or assigned to them
        const myDept = (me.department || '').toLowerCase().trim();
        return pkgs.filter(p => {
            const pkgDept = (p.department || '').toLowerCase().trim();
            const assignedTo = (p.marketer || '').toLowerCase();
            return (myDept && pkgDept === myDept) ||
                assignedTo === me.username.toLowerCase();
        });
    },

    async save(data) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');

        const payload = {
            name: (data.name || '').trim(),
            app_name: (data.app_name || '').trim(),
            department: data.department || null,
            marketer: data.marketer || null,
            product_owner: data.product_owner || null,
            playconsole_account: data.playconsole_account || null,
            monetization: data.monetization || null,
            admob: data.admob || null,
            updated_at: new Date().toISOString()
        };

        if (!payload.name) throw new Error('Package name is required');

        if (data.id) {
            const { error } = await client
                .from('packages')
                .update(payload)
                .eq('id', data.id);
            if (error) throw new Error(error.message);
        } else {
            payload.created_at = new Date().toISOString();
            const { error } = await client
                .from('packages')
                .insert(payload);
            if (error) throw new Error(error.message);
        }
        return true;
    },

    async delete(id) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');
        const { error } = await client.from('packages').delete().eq('id', id);
        if (error) throw new Error(error.message);
        return true;
    },

    async assignUser(packageId, field, username) {
        // field = 'marketer' | 'product_owner'
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');
        const update = { [field]: username, updated_at: new Date().toISOString() };
        const { error } = await client.from('packages').update(update).eq('id', packageId);
        if (error) throw new Error(error.message);
        return true;
    }
};

// ── STATE ─────────────────────────────────────────────────────────
let _packagesCache = [];
let _packagesInitialized = false;

// ── PUBLIC INIT ───────────────────────────────────────────────────
window.initPackages = async function () {
    await loadPackages();
};

// ── LOAD & RENDER ─────────────────────────────────────────────────
async function loadPackages() {
    const container = document.getElementById('packagesContainer');
    if (!container) return;

    container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div></div>`;

    try {
        _packagesCache = await PackagesAPI.getAccessible();
        _packagesInitialized = true;
        renderPackagesTable(_packagesCache);
    } catch (e) {
        container.innerHTML = `<div class="error-message">Failed to load packages: ${e.message}</div>`;
    }
}

function renderPackagesTable(packages) {
    const container = document.getElementById('packagesContainer');
    if (!container) return;

    // Apply filters
    const searchVal = (document.getElementById('pkgSearch')?.value || '').toLowerCase().trim();
    const deptFilter = document.getElementById('pkgDeptFilter')?.value || '';

    let filtered = packages;
    if (searchVal) {
        filtered = filtered.filter(p =>
            (p.name || '').toLowerCase().includes(searchVal) ||
            (p.app_name || '').toLowerCase().includes(searchVal) ||
            (p.marketer || '').toLowerCase().includes(searchVal) ||
            (p.product_owner || '').toLowerCase().includes(searchVal)
        );
    }
    if (deptFilter) {
        filtered = filtered.filter(p =>
            (p.department || '').toLowerCase() === deptFilter.toLowerCase()
        );
    }

    const me = window.currentUser;
    const isPriv = me && (me.username === 'admin' || me.role === 'Admin' ||
        me.role === 'Manager' || me.role === 'Super Manager');

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <div class="empty-title">No packages found</div>
                <div class="empty-desc">
                    ${packages.length === 0 ? 'No packages yet. Add your first app package.' : 'No packages match your current filters.'}
                </div>
                ${isPriv ? `<button class="btn btn-primary" style="margin-top:14px" onclick="openAddPackageModal()">+ Add Package</button>` : ''}
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="table-wrapper">
            <table class="data-table" id="packagesTable">
                <thead>
                    <tr>
                        <th>Package Name</th>
                        <th>App Name</th>
                        <th>Department</th>
                        <th>Marketer</th>
                        <th>Product Owner</th>
                        <th>Play Console</th>
                        <th>Monetization</th>
                        <th>AdMob</th>
                        ${isPriv ? '<th>Actions</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${filtered.map(p => renderPackageRow(p, isPriv)).join('')}
                </tbody>
            </table>
        </div>`;
}

function renderPackageRow(p, isPriv) {
    const deptBadge = p.department
        ? `<span class="category-badge">${escHtml(p.department)}</span>` : '—';
    const monetBadge = p.monetization
        ? `<span class="badge">${escHtml(p.monetization)}</span>` : '—';
    const admobBadge = p.admob
        ? `<span class="badge badge-success">${escHtml(p.admob)}</span>` : '—';

    return `
        <tr>
            <td>
                <div style="font-weight:700;font-size:.875rem">${escHtml(p.name || '')}</div>
            </td>
            <td>
                <div style="font-size:.85rem;color:var(--text-secondary)">${escHtml(p.app_name || '—')}</div>
            </td>
            <td>${deptBadge}</td>
            <td>
                <div class="user-info">
                    ${p.marketer ? `<div class="user-avatar">${(p.marketer[0] || '?').toUpperCase()}</div>` : ''}
                    <span style="font-size:.82rem">${escHtml(p.marketer || '—')}</span>
                </div>
            </td>
            <td>
                <div class="user-info">
                    ${p.product_owner ? `<div class="user-avatar" style="background:linear-gradient(135deg,#22c55e,#16a34a)">${(p.product_owner[0] || '?').toUpperCase()}</div>` : ''}
                    <span style="font-size:.82rem">${escHtml(p.product_owner || '—')}</span>
                </div>
            </td>
            <td>
                <div style="font-family:monospace;font-size:.8rem;color:var(--text-muted)">${escHtml(p.playconsole_account || '—')}</div>
            </td>
            <td>${monetBadge}</td>
            <td>${admobBadge}</td>
            ${isPriv ? `
            <td>
                <div class="actions-cell">
                    <button class="btn-icon" title="Edit" onclick="openEditPackageModal(${JSON.stringify(p).replace(/"/g, '&quot;')})">✏️</button>
                    <button class="btn-icon btn-danger" title="Delete" onclick="deletePackage('${escHtml(p.id)}','${escHtml(p.name)}')">🗑️</button>
                </div>
            </td>` : ''}
        </tr>`;
}

// ── SECTION HEADER ─────────────────────────────────────────────────
window.renderPackagesSectionHeader = function () {
    const header = document.getElementById('packagesSectionHeader');
    if (!header) return;

    const me = window.currentUser;
    const isPriv = me && (me.username === 'admin' || me.role === 'Admin' ||
        me.role === 'Manager' || me.role === 'Super Manager');

    // Build unique dept list
    const depts = [...new Set(_packagesCache.map(p => p.department).filter(Boolean))].sort();
    const deptOptions = depts.map(d => `<option value="${escHtml(d)}">${escHtml(d)}</option>`).join('');

    header.innerHTML = `
        <div class="todos-toolbar">
            <div class="todos-filters">
                <input type="text" id="pkgSearch" class="form-control search-input"
                    placeholder="🔍 Search packages…"
                    oninput="renderPackagesTable(_packagesCache)">
                <select id="pkgDeptFilter" class="form-control filter-select"
                    onchange="renderPackagesTable(_packagesCache)">
                    <option value="">All Departments</option>
                    ${deptOptions}
                </select>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
                <span style="font-size:.82rem;color:var(--text-muted)">${_packagesCache.length} package${_packagesCache.length !== 1 ? 's' : ''}</span>
                ${isPriv ? `<button class="btn btn-primary btn-sm" onclick="openAddPackageModal()">+ Add Package</button>` : ''}
            </div>
        </div>`;
};

// ── MODALS ─────────────────────────────────────────────────────────
window.openAddPackageModal = function () {
    openPackageModal(null);
};

window.openEditPackageModal = function (pkg) {
    openPackageModal(pkg);
};

function openPackageModal(pkg) {
    // Build user options
    const users = window.allUsers || [];
    const userOptions = users.map(u =>
        `<option value="${escHtml(u.username)}">${escHtml(u.username)}${u.department ? ` (${u.department})` : ''}</option>`
    ).join('');

    // Department options
    const depts = getLatestDepartmentNames ? getLatestDepartmentNames() : [];
    const deptOptions = depts.map(d =>
        `<option value="${escHtml(d)}"${pkg?.department === d ? ' selected' : ''}>${escHtml(d)}</option>`
    ).join('');

    const modal = document.getElementById('packageModal');
    const body = document.getElementById('packageModalBody');
    const title = document.getElementById('packageModalTitle');
    if (!modal || !body) return;

    title.textContent = pkg ? 'Edit Package' : 'Add Package';

    body.innerHTML = `
        <div class="form-grid-2">
            <div class="form-group">
                <label class="form-label required">Package Name</label>
                <input id="pkgName" class="form-control" placeholder="com.example.app"
                    value="${escHtml(pkg?.name || '')}">
            </div>
            <div class="form-group">
                <label class="form-label">App Name</label>
                <input id="pkgAppName" class="form-control" placeholder="My App"
                    value="${escHtml(pkg?.app_name || '')}">
            </div>
            <div class="form-group">
                <label class="form-label">Department</label>
                <select id="pkgDept" class="form-control">
                    <option value="">— Select —</option>
                    ${deptOptions}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Marketer</label>
                <select id="pkgMarketer" class="form-control">
                    <option value="">— None —</option>
                    ${userOptions}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Product Owner</label>
                <select id="pkgProductOwner" class="form-control">
                    <option value="">— None —</option>
                    ${userOptions}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Play Console Account</label>
                <input id="pkgPlayconsole" class="form-control" placeholder="Account ID or name"
                    value="${escHtml(pkg?.playconsole_account || '')}">
            </div>
            <div class="form-group">
                <label class="form-label">Monetization</label>
                <select id="pkgMonetization" class="form-control">
                    <option value="">— None —</option>
                    <option value="IAP" ${pkg?.monetization === 'IAP' ? 'selected' : ''}>IAP</option>
                    <option value="Ads" ${pkg?.monetization === 'Ads' ? 'selected' : ''}>Ads</option>
                    <option value="Subscription" ${pkg?.monetization === 'Subscription' ? 'selected' : ''}>Subscription</option>
                    <option value="IAP + Ads" ${pkg?.monetization === 'IAP + Ads' ? 'selected' : ''}>IAP + Ads</option>
                    <option value="Free" ${pkg?.monetization === 'Free' ? 'selected' : ''}>Free</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">AdMob</label>
                <select id="pkgAdmob" class="form-control">
                    <option value="">— None —</option>
                    <option value="Enabled" ${pkg?.admob === 'Enabled' ? 'selected' : ''}>Enabled</option>
                    <option value="Disabled" ${pkg?.admob === 'Disabled' ? 'selected' : ''}>Disabled</option>
                    <option value="Restricted" ${pkg?.admob === 'Restricted' ? 'selected' : ''}>Restricted</option>
                </select>
            </div>
        </div>
        <input type="hidden" id="pkgId" value="${escHtml(pkg?.id || '')}">`;

    // Set current values for selects
    if (pkg) {
        setTimeout(() => {
            const marketerEl = document.getElementById('pkgMarketer');
            const ownerEl = document.getElementById('pkgProductOwner');
            if (marketerEl && pkg.marketer) marketerEl.value = pkg.marketer;
            if (ownerEl && pkg.product_owner) ownerEl.value = pkg.product_owner;
        }, 0);
    }

    openModal('packageModal');
}

window.submitPackageForm = async function () {
    const id = document.getElementById('pkgId')?.value;
    const name = document.getElementById('pkgName')?.value?.trim();
    if (!name) { showToast('Package name is required', 'error'); return; }

    const data = {
        id: id || undefined,
        name,
        app_name: document.getElementById('pkgAppName')?.value?.trim() || '',
        department: document.getElementById('pkgDept')?.value || null,
        marketer: document.getElementById('pkgMarketer')?.value || null,
        product_owner: document.getElementById('pkgProductOwner')?.value || null,
        playconsole_account: document.getElementById('pkgPlayconsole')?.value?.trim() || null,
        monetization: document.getElementById('pkgMonetization')?.value || null,
        admob: document.getElementById('pkgAdmob')?.value || null
    };

    const btn = document.getElementById('packageSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        await PackagesAPI.save(data);
        showToast(id ? 'Package updated ✓' : 'Package added ✓', 'success');
        closeModal('packageModal');
        await loadPackages();
        renderPackagesSectionHeader();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Package'; }
    }
};

window.deletePackage = async function (id, name) {
    if (!confirm(`Delete package "${name}"?\n\nThis cannot be undone.`)) return;
    try {
        await PackagesAPI.delete(id);
        showToast('Package deleted', 'success');
        await loadPackages();
        renderPackagesSectionHeader();
    } catch (e) {
        showToast('Failed to delete: ' + e.message, 'error');
    }
};

// ── EXPORTS (used by todo-forms.js to populate package picker) ────
window.PackagesAPI = PackagesAPI;
window.getPackagesCache = () => _packagesCache;

// ── HELPERS ───────────────────────────────────────────────────────
function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
