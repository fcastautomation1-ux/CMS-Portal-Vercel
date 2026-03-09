// ================================================================
// campaigns.js
// Campaigns API + UI — removal conditions, workflow management.
// Depends on: supabase-client.js, auth.js
// ================================================================

const campaignsAPI = {

    async getCampaignsForCustomer(customerId, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        const tables = ['campaign_conditions', 'workflow_1', 'workflow_2', 'workflow_3'];
        const all = [];
        for (const t of tables) {
            try {
                const d = await directDB.select(t, { customer_id: customerId });
                d?.forEach(r => all.push({
                    campaignName: r.campaign_name || 'Unnamed',
                    removalConditions: r.removal_conditions || [],
                    workflow: r.workflow || (t === 'campaign_conditions' ? 'workflow-0' : t.replace('_', '-')),
                    enabled: r.enabled !== false
                }));
            } catch { /* table may not exist for this account */ }
        }
        return all;
    },

    async getAllCampaignsForFrontend(token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        const allAccounts = await directDB.select('accounts');
        const accessible = allAccounts.filter(a =>
            user.allowedAccounts.includes('*') ||
            user.allowedAccounts.includes(a.customer_id)
        );

        const tables = ['campaign_conditions', 'workflow_1', 'workflow_2', 'workflow_3'];

        const results = await Promise.all(accessible.map(async (account) => {
            const tableResults = await Promise.all(tables.map(async (t) => {
                try {
                    const d = await directDB.select(t, { customer_id: account.customer_id });
                    return (d || []).map(r => ({
                        campaignName: r.campaign_name || 'Unnamed',
                        removalConditions: r.removal_conditions || '',
                        workflow: r.workflow || (t === 'campaign_conditions' ? 'workflow-0' : t.replace('_', '-')),
                        enabled: r.enabled !== false
                    }));
                } catch { return []; }
            }));

            const campaigns = tableResults.flat();
            return campaigns.length > 0 ? { customerId: account.customer_id, campaigns } : null;
        }));

        return results.filter(r => r !== null);
    },

    async saveCampaignRemovalConditions(customerId, campaignName, conditions, workflow, enabled = true) {
        const workflowNum = (workflow || '').replace('workflow-', '');
        const table = workflowNum === '1' ? 'workflow_1'
            : workflowNum === '2' ? 'workflow_2'
                : workflowNum === '3' ? 'workflow_3'
                    : 'campaign_conditions';

        let formattedConditions = '';
        if (Array.isArray(conditions) && conditions.length > 0) {
            formattedConditions = '• ' + conditions.join('\n• ');
        } else if (typeof conditions === 'string') {
            formattedConditions = conditions.trim();
        }

        const existing = await directDB.select(table, { customer_id: customerId, campaign_name: campaignName });
        if (existing && existing.length > 0) {
            await directDB.update(table, {
                removal_conditions: formattedConditions,
                workflow: workflow || 'workflow-0',
                enabled
            }, { customer_id: customerId, campaign_name: campaignName });
        } else {
            await directDB.upsert(table, {
                customer_id: customerId,
                campaign_name: campaignName,
                removal_conditions: formattedConditions,
                workflow: workflow || 'workflow-0',
                enabled
            }, 'customer_id,campaign_name');
        }
        return true;
    },

    async batchSaveCampaignRemovalConditions(customerId, list, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        if (!user.allowedAccounts.includes('*') && !user.allowedAccounts.includes(customerId))
            throw new Error('Access denied');

        let success = 0, failed = 0;
        const errors = [];
        for (const item of list) {
            try {
                await this.saveCampaignRemovalConditions(
                    customerId, item.campaignName,
                    item.removalConditions, item.workflow, item.enabled
                );
                success++;
            } catch (e) {
                failed++;
                errors.push(`${item.campaignName}: ${e.message}`);
            }
        }
        return { success, failed, errors };
    }
};

// ----------------------------------------------------------------
// CAMPAIGNS UI
// ----------------------------------------------------------------
let _allCampaigns = [];
let _currentCampaignAccount = null;

async function loadAllCampaigns() {
    const token = getStoredToken();
    if (!token) return;

    const container = document.getElementById('campaignsContainer');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner"></div>';

    try {
        _allCampaigns = await campaignsAPI.getAllCampaignsForFrontend(token);
        renderAllCampaigns(_allCampaigns);
    } catch (e) {
        container.innerHTML = `<div class="error-message">Error: ${e.message}</div>`;
        showToast('Failed to load campaigns: ' + e.message, 'error');
    }
}

function renderAllCampaigns(accountCampaigns) {
    const container = document.getElementById('campaignsContainer');
    if (!container) return;

    if (!accountCampaigns.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📈</div>
                <div class="empty-title">No campaigns found</div>
                <div class="empty-desc">Campaigns will appear here once accounts are configured.</div>
            </div>`;
        return;
    }

    container.innerHTML = accountCampaigns.map(ac => `
        <div class="account-campaigns-group">
            <div class="account-group-header">
                <h3 class="account-group-title">📊 ${escapeHtml(ac.customerId)}</h3>
                <span class="campaign-count">${ac.campaigns.length} campaigns</span>
                <button class="btn btn-sm btn-primary" onclick="openBatchConditionsModal('${ac.customerId}')">
                    Edit Conditions
                </button>
            </div>
            <div class="campaigns-table-wrapper">
                <table class="campaigns-table">
                    <thead>
                        <tr>
                            <th>Campaign Name</th>
                            <th>Workflow</th>
                            <th>Status</th>
                            <th>Removal Conditions</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ac.campaigns.map(c => `
                            <tr class="${c.enabled ? '' : 'disabled-row'}">
                                <td class="campaign-name">${escapeHtml(c.campaignName)}</td>
                                <td><span class="workflow-badge">${escapeHtml(c.workflow)}</span></td>
                                <td>
                                    <span class="status-badge ${c.enabled ? 'status-active' : 'status-disabled'}">
                                        ${c.enabled ? 'Active' : 'Disabled'}
                                    </span>
                                </td>
                                <td class="conditions-cell">
                                    ${c.removalConditions
                                        ? `<span class="conditions-preview">${escapeHtml(String(c.removalConditions).substring(0, 60))}${String(c.removalConditions).length > 60 ? '...' : ''}</span>`
                                        : '<span class="text-muted">—</span>'}
                                </td>
                                <td>
                                    <button class="btn-icon" title="Edit conditions"
                                        onclick="openSingleConditionModal('${ac.customerId}', '${escapeHtml(c.campaignName)}')">✏️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `).join('');
}

function searchCampaigns(term) {
    const lower = (term || '').toLowerCase();
    if (!lower) {
        renderAllCampaigns(_allCampaigns);
        return;
    }
    const filtered = _allCampaigns.map(ac => ({
        ...ac,
        campaigns: ac.campaigns.filter(c =>
            c.campaignName.toLowerCase().includes(lower) ||
            ac.customerId.toLowerCase().includes(lower)
        )
    })).filter(ac => ac.campaigns.length > 0);
    renderAllCampaigns(filtered);
}

// ----------------------------------------------------------------
// SINGLE CONDITION MODAL
// ----------------------------------------------------------------
window.openSingleConditionModal = function(customerId, campaignName) {
    _currentCampaignAccount = customerId;
    const acGroup = _allCampaigns.find(ac => ac.customerId === customerId);
    const campaign = acGroup?.campaigns.find(c => c.campaignName === campaignName);

    const existing = campaign?.removalConditions || '';

    const modal = document.getElementById('singleConditionModal');
    if (!modal) {
        // Create modal inline if it doesn't already exist in DOM
        _createSingleConditionModal();
    }

    document.getElementById('scmCustomerId').textContent   = customerId;
    document.getElementById('scmCampaignName').textContent = campaignName;
    document.getElementById('scmConditionsText').value     = typeof existing === 'string' ? existing : '';
    document.getElementById('scmWorkflow').value           = campaign?.workflow || 'workflow-0';
    document.getElementById('scmEnabled').checked          = campaign?.enabled !== false;

    window._scmCampaignName = campaignName;
    openModal('singleConditionModal');
};

function _createSingleConditionModal() {
    const div = document.createElement('div');
    div.innerHTML = `
        <div id="singleConditionModal" class="modal-backdrop" onclick="if(event.target===this)closeModal('singleConditionModal')">
            <div class="modal-content" style="max-width:560px">
                <div class="modal-header">
                    <h3 class="modal-title">✏️ Edit Removal Conditions</h3>
                    <button class="modal-close" onclick="closeModal('singleConditionModal')">✕</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="form-label">Account</label>
                        <div class="text-secondary" id="scmCustomerId"></div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Campaign</label>
                        <div class="text-secondary" id="scmCampaignName"></div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Removal Conditions</label>
                        <textarea id="scmConditionsText" class="form-control" rows="6"
                            placeholder="Enter conditions, one per line…"></textarea>
                    </div>
                    <div class="form-row" style="display:flex;gap:16px">
                        <div class="form-group" style="flex:1">
                            <label class="form-label">Workflow</label>
                            <select id="scmWorkflow" class="form-control">
                                <option value="workflow-0">Workflow 0</option>
                                <option value="workflow-1">Workflow 1</option>
                                <option value="workflow-2">Workflow 2</option>
                                <option value="workflow-3">Workflow 3</option>
                            </select>
                        </div>
                        <div class="form-group" style="flex:1;display:flex;align-items:flex-end;gap:8px;padding-bottom:4px">
                            <input type="checkbox" id="scmEnabled" style="width:16px;height:16px;accent-color:var(--brand-primary)">
                            <label class="form-label" for="scmEnabled" style="margin:0">Enabled</label>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-ghost" onclick="closeModal('singleConditionModal')">Cancel</button>
                    <button class="btn btn-primary" onclick="saveSingleCondition()">Save</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(div.firstElementChild);
}

window.saveSingleCondition = async function() {
    const token = getStoredToken();
    if (!token) return;
    const customerId   = _currentCampaignAccount;
    const campaignName = window._scmCampaignName;
    const conditions   = document.getElementById('scmConditionsText')?.value?.trim() || '';
    const workflow     = document.getElementById('scmWorkflow')?.value || 'workflow-0';
    const enabled      = document.getElementById('scmEnabled')?.checked !== false;

    const btn = document.querySelector('#singleConditionModal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        await campaignsAPI.saveCampaignRemovalConditions(customerId, campaignName,
            conditions ? conditions.split('\n').map(s => s.replace(/^•\s*/,'')).filter(Boolean) : [],
            workflow, enabled);
        showToast('Conditions saved ✅', 'success');
        closeModal('singleConditionModal');
        await loadAllCampaigns();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
};

// ----------------------------------------------------------------
// BATCH CONDITIONS MODAL
// ----------------------------------------------------------------
window.openBatchConditionsModal = function(customerId) {
    _currentCampaignAccount = customerId;
    const acGroup = _allCampaigns.find(ac => ac.customerId === customerId);

    if (!document.getElementById('batchConditionsModal')) {
        _createBatchConditionsModal();
    }

    document.getElementById('bcmCustomerId').textContent = customerId;

    const tbody = document.getElementById('bcmTableBody');
    if (!tbody) return;

    if (!acGroup?.campaigns?.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">No campaigns found for this account</td></tr>';
    } else {
        tbody.innerHTML = acGroup.campaigns.map((c, i) => `
            <tr>
                <td style="font-size:.82rem;font-weight:600">${escapeHtml(c.campaignName)}</td>
                <td>
                    <select class="form-control form-control-sm bcm-workflow" data-index="${i}">
                        ${['workflow-0','workflow-1','workflow-2','workflow-3'].map(w =>
                            `<option value="${w}" ${c.workflow === w ? 'selected' : ''}>${w}</option>`
                        ).join('')}
                    </select>
                </td>
                <td>
                    <input type="checkbox" class="bcm-enabled" data-index="${i}"
                        ${c.enabled !== false ? 'checked' : ''}
                        style="width:15px;height:15px;accent-color:var(--brand-primary)">
                </td>
                <td>
                    <textarea class="form-control form-control-sm bcm-conditions" data-index="${i}"
                        rows="2" style="min-width:160px;font-size:.78rem"
                        placeholder="Conditions…">${typeof c.removalConditions === 'string' ? escapeHtml(c.removalConditions) : ''}</textarea>
                </td>
            </tr>
        `).join('');
    }

    openModal('batchConditionsModal');
};

function _createBatchConditionsModal() {
    const div = document.createElement('div');
    div.innerHTML = `
        <div id="batchConditionsModal" class="modal-backdrop" onclick="if(event.target===this)closeModal('batchConditionsModal')">
            <div class="modal-content" style="max-width:860px">
                <div class="modal-header">
                    <h3 class="modal-title">📊 Batch Edit Campaign Conditions</h3>
                    <button class="modal-close" onclick="closeModal('batchConditionsModal')">✕</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="form-label">Account: <strong id="bcmCustomerId"></strong></label>
                    </div>
                    <div style="overflow-x:auto">
                        <table style="width:100%;border-collapse:collapse;font-size:.84rem">
                            <thead>
                                <tr style="border-bottom:2px solid var(--border)">
                                    <th style="padding:8px 12px;text-align:left">Campaign</th>
                                    <th style="padding:8px 12px;text-align:left;width:130px">Workflow</th>
                                    <th style="padding:8px 12px;text-align:left;width:70px">Enabled</th>
                                    <th style="padding:8px 12px;text-align:left">Conditions</th>
                                </tr>
                            </thead>
                            <tbody id="bcmTableBody"></tbody>
                        </table>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-ghost" onclick="closeModal('batchConditionsModal')">Cancel</button>
                    <button class="btn btn-primary" onclick="saveBatchConditions()" id="bcmSaveBtn">Save All</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(div.firstElementChild);
}

window.saveBatchConditions = async function() {
    const token = getStoredToken();
    if (!token) return;
    const customerId = _currentCampaignAccount;
    const acGroup = _allCampaigns.find(ac => ac.customerId === customerId);
    if (!acGroup) return;

    const rows = document.querySelectorAll('#bcmTableBody tr');
    const list = [];

    rows.forEach((tr, i) => {
        const campaign = acGroup.campaigns[i];
        if (!campaign) return;
        const workflow  = tr.querySelector('.bcm-workflow')?.value || 'workflow-0';
        const enabled   = tr.querySelector('.bcm-enabled')?.checked !== false;
        const raw       = tr.querySelector('.bcm-conditions')?.value?.trim() || '';
        const conditions = raw ? raw.split('\n').map(s => s.replace(/^•\s*/,'').trim()).filter(Boolean) : [];
        list.push({ campaignName: campaign.campaignName, removalConditions: conditions, workflow, enabled });
    });

    const btn = document.getElementById('bcmSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        const result = await campaignsAPI.batchSaveCampaignRemovalConditions(customerId, list, token);
        showToast(`Saved ${result.success} campaigns${result.failed ? ` (${result.failed} failed)` : ''} ✅`, 'success');
        closeModal('batchConditionsModal');
        await loadAllCampaigns();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save All'; }
    }
};
