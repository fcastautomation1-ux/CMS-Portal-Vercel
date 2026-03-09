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
