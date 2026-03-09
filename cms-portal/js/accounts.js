// ================================================================
// accounts.js
// Google Ads accounts API + UI.
// Depends on: supabase-client.js, auth.js, ui-helpers.js
// ================================================================

const accountsAPI = {

    async getAllAccountsForFrontend(token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        const all = await directDB.select('accounts');
        return all
            .filter(a => user.allowedAccounts.includes('*') || user.allowedAccounts.includes(a.customer_id))
            .map(a => ({
                customerId: a.customer_id,
                googleSheetLink: a.google_sheet_link,
                driveCodeComments: a.drive_code_comments,
                enabled: a.enabled,
                lastRun: a.last_run,
                status: a.status || 'Pending',
                createdDate: a.created_date,
                workflow: a.workflow || 'workflow-0'
            }));
    },

    async getAccountForFrontend(customerId, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        if (!user.allowedAccounts.includes('*') && !user.allowedAccounts.includes(customerId))
            throw new Error('Access denied');
        const data = await directDB.select('accounts', { customer_id: customerId });
        if (!data?.length) return null;
        const a = data[0];
        return {
            customerId: a.customer_id,
            googleSheetLink: a.google_sheet_link,
            driveCodeComments: a.drive_code_comments,
            enabled: a.enabled,
            lastRun: a.last_run,
            status: a.status || 'Pending',
            createdDate: a.created_date,
            workflow: a.workflow || 'workflow-0'
        };
    },

    async saveAccount(accountData, existingCustomerId, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        if (!user.allowedAccounts.includes('*') &&
            (!existingCustomerId || !user.allowedAccounts.includes(existingCustomerId)))
            throw new Error('Unauthorized');

        const payload = {
            customer_id: accountData.customerId.trim(),
            google_sheet_link: accountData.googleSheetLink.trim(),
            drive_code_comments: accountData.driveCodeComments || '',
            enabled: accountData.enabled,
            workflow: accountData.workflow || 'workflow-0'
        };

        if (existingCustomerId) {
            await directDB.update('accounts', payload, { customer_id: existingCustomerId });
        } else {
            payload.status = 'Pending';
            payload.created_date = new Date().toISOString();
            await directDB.upsert('accounts', payload);
        }
        return true;
    },

    async deleteAccount(customerId, token) {
        const user = await directAPI.validateToken(token);
        if (!user || !user.allowedAccounts.includes('*')) throw new Error('Unauthorized');
        await directDB.delete('accounts', { customer_id: customerId });
        return true;
    },

    async batchUpdateAccountStatus(customerIds, enabled, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        if (!user.allowedAccounts.includes('*')) {
            for (const id of customerIds)
                if (!user.allowedAccounts.includes(id)) throw new Error(`Unauthorized: ${id}`);
        }
        await directDB.updateIn('accounts', { enabled }, 'customer_id', customerIds);
        return { success: true };
    }
};

// ----------------------------------------------------------------
// ACCOUNTS UI
// ----------------------------------------------------------------
let _accountsData = [];
let _selectedAccountIds = new Set();

async function loadAccounts() {
    const token = getStoredToken();
    if (!token) return;

    const container = document.getElementById('accountsContainer');
    const tableBody = document.querySelector('#accountsTable tbody');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="7" class="loading-cell"><div class="loading-spinner"></div> Loading accounts...</td></tr>';

    try {
        _accountsData = await accountsAPI.getAllAccountsForFrontend(token);
        renderAccounts(_accountsData);
    } catch (e) {
        tableBody.innerHTML = `<tr><td colspan="7" class="error-cell">Error: ${e.message}</td></tr>`;
        showToast('Failed to load accounts: ' + e.message, 'error');
    }
}

function renderAccounts(accounts) {
    const tableBody = document.querySelector('#accountsTable tbody');
    if (!tableBody) return;

    _selectedAccountIds.clear();
    document.getElementById('bulkActionsBar')?.classList.add('hidden');

    if (!accounts.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-cell">
                    <div class="empty-state">
                        <div class="empty-icon">📊</div>
                        <div class="empty-title">No accounts found</div>
                        <div class="empty-desc">Add your first Google Ads account to get started.</div>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tableBody.innerHTML = accounts.map(a => `
        <tr class="account-row ${a.enabled ? '' : 'disabled-row'}" data-id="${a.customerId}">
            <td>
                <input type="checkbox" class="account-checkbox" value="${a.customerId}"
                    onchange="toggleAccountSelection('${a.customerId}', this.checked)">
            </td>
            <td class="customer-id-cell">
                <span class="customer-id">${escapeHtml(a.customerId)}</span>
            </td>
            <td>
                ${a.googleSheetLink
                    ? `<a href="${a.googleSheetLink}" target="_blank" class="sheet-link" title="Open Sheet">📊 View Sheet</a>`
                    : '<span class="text-muted">—</span>'}
            </td>
            <td>
                <span class="status-badge status-${(a.status || 'pending').toLowerCase()}">
                    ${a.status || 'Pending'}
                </span>
            </td>
            <td>
                <label class="toggle-switch" title="${a.enabled ? 'Disable' : 'Enable'}">
                    <input type="checkbox" ${a.enabled ? 'checked' : ''}
                        onchange="toggleAccountEnabled('${a.customerId}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </td>
            <td class="text-muted small">${a.lastRun ? new Date(a.lastRun).toLocaleString() : '—'}</td>
            <td class="actions-cell">
                <button class="btn-icon" title="Edit" onclick="showAccountModal('${a.customerId}')">✏️</button>
                ${currentUser?.allowedAccounts?.includes('*')
                    ? `<button class="btn-icon btn-danger" title="Delete" onclick="deleteAccount('${a.customerId}')">🗑️</button>`
                    : ''}
            </td>
        </tr>
    `).join('');
}

function toggleAccountSelection(customerId, checked) {
    if (checked) {
        _selectedAccountIds.add(customerId);
    } else {
        _selectedAccountIds.delete(customerId);
    }
    const bar = document.getElementById('bulkActionsBar');
    if (bar) {
        bar.classList.toggle('hidden', _selectedAccountIds.size === 0);
        const countEl = bar.querySelector('.bulk-count');
        if (countEl) countEl.textContent = `${_selectedAccountIds.size} selected`;
    }
}

async function toggleAccountEnabled(customerId, enabled) {
    const token = getStoredToken();
    if (!token) return;
    try {
        await accountsAPI.batchUpdateAccountStatus([customerId], enabled, token);
        const account = _accountsData.find(a => a.customerId === customerId);
        if (account) account.enabled = enabled;
        const row = document.querySelector(`[data-id="${customerId}"]`);
        if (row) row.classList.toggle('disabled-row', !enabled);
        showToast(`Account ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
        loadAccounts(); // Revert
    }
}

async function bulkToggleAccounts(enabled) {
    const token = getStoredToken();
    if (!token || !_selectedAccountIds.size) return;
    try {
        await accountsAPI.batchUpdateAccountStatus([..._selectedAccountIds], enabled, token);
        showToast(`${_selectedAccountIds.size} accounts ${enabled ? 'enabled' : 'disabled'}`, 'success');
        loadAccounts();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

function showAccountModal(customerId = null) {
    const modal = document.getElementById('accountModal');
    if (!modal) return;

    const account = customerId ? _accountsData.find(a => a.customerId === customerId) : null;

    document.getElementById('accountModalTitle').textContent = account ? 'Edit Account' : 'Add Account';
    document.getElementById('accountCustomerId').value = account?.customerId || '';
    document.getElementById('accountSheetLink').value = account?.googleSheetLink || '';
    document.getElementById('accountDriveComments').value = account?.driveCodeComments || '';
    document.getElementById('accountEnabled').checked = account ? account.enabled : true;
    document.getElementById('accountWorkflow').value = account?.workflow || 'workflow-0';
    document.getElementById('existingAccountCustomerId').value = customerId || '';

    modal.classList.add('open');
}

function closeAccountModal() {
    document.getElementById('accountModal')?.classList.remove('open');
}

async function saveAccountFromModal() {
    const token = getStoredToken();
    if (!token) return;

    const existingCustomerId = document.getElementById('existingAccountCustomerId').value || null;
    const accountData = {
        customerId: document.getElementById('accountCustomerId').value.trim(),
        googleSheetLink: document.getElementById('accountSheetLink').value.trim(),
        driveCodeComments: document.getElementById('accountDriveComments').value.trim(),
        enabled: document.getElementById('accountEnabled').checked,
        workflow: document.getElementById('accountWorkflow').value
    };

    if (!accountData.customerId) {
        showToast('Customer ID is required', 'error');
        return;
    }

    const btn = document.getElementById('saveAccountBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
        await accountsAPI.saveAccount(accountData, existingCustomerId, token);
        closeAccountModal();
        showToast('Account saved successfully', 'success');
        loadAccounts();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Account'; }
    }
}

async function deleteAccount(customerId) {
    if (!confirm(`Delete account ${customerId}? This cannot be undone.`)) return;
    const token = getStoredToken();
    if (!token) return;
    try {
        await accountsAPI.deleteAccount(customerId, token);
        showToast('Account deleted', 'success');
        loadAccounts();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

function filterAccounts(searchTerm) {
    const lower = (searchTerm || '').toLowerCase();
    const filtered = _accountsData.filter(a =>
        !lower ||
        a.customerId.toLowerCase().includes(lower) ||
        (a.status || '').toLowerCase().includes(lower)
    );
    renderAccounts(filtered);
}
