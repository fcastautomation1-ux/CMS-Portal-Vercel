// ================================================================
// workflows.js
// Workflow settings API + removal conditions management.
// Depends on: supabase-client.js, auth.js
// ================================================================

const workflowsAPI = {

    async getAllWorkflows() {
        return (await directDB.select('workflows')).map(w => ({
            workflowName: w.workflow_name,
            enabled: w.enabled,
            schedule: w.schedule,
            lastRun: w.last_run,
            description: w.description
        }));
    },

    async setWorkflowEnabled(name, enabled, token) {
        const user = await directAPI.validateToken(token);
        if (!user || !user.allowedAccounts.includes('*')) throw new Error('Unauthorized');
        await directDB.update('workflows', { enabled }, { workflow_name: name });
        return true;
    },

    async getAvailableRemovalConditions() {
        try {
            const data = await directDB.select('removal_condition_definitions');
            if (data && data.length > 0) {
                return data.map(r => ({ id: r.id, name: r.name, description: r.description }));
            }
        } catch (e) {
            console.warn('Could not fetch removal conditions from DB, using fallback.');
        }

        // Static fallback list
        return [
            { id: 'LOW_24H_LOW_SPEND', name: 'LOW performance (24h) + spend <$5', description: 'Remove assets with LOW performance in last 24h and spend <$5, must be active at least 24 hours' },
            { id: 'LEARNING_3D_LOW_SPEND', name: 'LEARNING (3 days) + spend <$5', description: 'Remove assets with LEARNING status for 3 days and spend <$5, must be active at least 72 hours' },
            { id: 'LEARNING_72H_LOW_SPEND_4', name: 'LEARNING (72h) + spend <$4', description: 'Remove assets with LEARNING status in last 72h and spend <$4, must be active at least 72 hours' },
            { id: 'LEARNING_60H_LOW_SPEND_3', name: 'LEARNING (60h) + spend <$3', description: 'Remove assets with LEARNING status in last 60h and spend <$3, must be active at least 60 hours' },
            { id: 'LOW_IMPRESSIONS_48H', name: 'Impressions < 100 (48h)', description: 'Remove assets with less than 100 impressions in last 48 hours, must be active at least 48 hours' },
            { id: 'HIGH_SPEND_LOW_CVC_72H', name: 'Spend>$10 (72h) + CVC <0.4', description: 'Remove assets with spend>$10 in last 72h and CVC <0.4, must be active at least 72 hours' },
            { id: 'HIGH_SPEND_CVC_96H', name: 'Spend>$10 (96h) + CVC check', description: 'Keep assets with spend>$10 in last 96h and CVC ≥0.80 (best-performing), else remove. Must be active at least 96 hours' },
            { id: 'LOW_24H_LOW_SPEND_4', name: 'LOW performance (24h) + spend <$4', description: 'Remove assets with LOW performance in last 24h and spend <$4, must be active at least 24 hours' },
            { id: 'ZERO_IMPRESSIONS_24H', name: 'Zero impressions (24h)', description: 'Remove assets with 0 impressions in last 24 hours, must be active at least 24 hours' },
            { id: 'LOW_ASSETS', name: 'LOW performance assets', description: 'Remove assets with LOW performance label, must be active at least 24 hours' },
            { id: 'LEARNING_LIFETIME_LOW_SPEND', name: 'LEARNING + lifetime spend <$1', description: 'Remove assets with LEARNING status and lifetime spend <$1, must be active at least 24 hours' },
            { id: 'LIFETIME_CVC_LOW_65', name: 'Lifetime CVC < 0.65', description: 'Remove assets with lifetime average CVC < 0.65, must be active at least 24 hours' },
            { id: 'LIFETIME_CVC_LOW_45', name: 'Lifetime CVC < 0.45', description: 'Remove assets with lifetime average CVC < 0.45, must be active at least 24 hours' },
            { id: 'LEARNING_72H_LOW_SPEND_1', name: 'LEARNING (72h) + spend $0-$1', description: 'Remove assets with LEARNING status in last 72h and spend between $0 and $1, must be active at least 72 hours' },
            { id: 'LEARNING_5D_MID_SPEND', name: 'LEARNING (5 Days) + spend $1-$10', description: 'Remove assets with LEARNING status in last 5 days and spend between $1 and $10, must be active at least 72 hours' },
            { id: 'LOW_48H_LOW_SPEND', name: 'LOW performance (48h) + spend <= $5', description: 'Remove assets with LOW performance in last 48h and spend <= $5, must be active at least 48 hours' },
            { id: 'LOW_48H', name: 'LOW performance (48h)', description: 'Remove assets with LOW performance in last 48 hours, must be active at least 48 hours' },
            { id: 'LEARNING_7D_ZERO_COST', name: 'LEARNING (7 days) + $0 cost', description: 'Remove assets with LEARNING status for 7 days and $0 cost in last 7 days, must be active at least 7 days (168 hours)' },
            { id: 'LEARNING_14D_LOW_SPEND_10', name: 'LEARNING (14 days) + spend <$10', description: 'Remove assets with LEARNING status for 14 days and spend <$10 in last 14 days, must be active at least 14 days (336 hours)' },
            { id: 'LEARNING_3D_LOW_SPEND_CVC_80', name: 'LEARNING (3 days) + spend <=$1 + CVC <0.80', description: 'Remove assets with LEARNING status for 3 days, spend <=$1, and CVC below 0.80, must be active at least 72 hours' },
            { id: 'LOW_72H_LOW_SPEND_CVC_70', name: 'LOW (72h) + spend <$5 + CVC <0.70', description: 'Remove assets with LOW performance in last 72h, spend <$5, and CVC below 0.70, must be active at least 72 hours' },
            { id: 'HIGH_SPEND_CVC_LOW_60', name: 'Lifetime spend >$10 + CVC <0.60', description: 'Remove assets with lifetime spend >$10 and CVC below 0.60, must be active at least 24 hours' },
            { id: 'HIGH_SPEND_LOW_CVC_2D', name: 'Spend >$30 (2 days) + CVC <0.5', description: 'Remove assets with spend >$30 in last 2 days and avg CVC <0.5, must be active at least 7 days' },
            { id: 'HIGH_SPEND_LOW_CVC_7D', name: 'Spend >$350 (7 days) + CVC <0.7', description: 'Remove assets with spend >$350 in last 7 days and avg CVC <0.7, must be active at least 7 days' }
        ];
    },

    async saveRemovalCondition(data, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        if (!data.id) throw new Error('ID is required');
        await directDB.upsert('removal_condition_definitions', {
            id: data.id, name: data.name, description: data.description
        });
        return true;
    },

    async deleteRemovalCondition(id, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        await directDB.delete('removal_condition_definitions', { id });
        return true;
    },

    async initializeDefaultRules(token) {
        const user = await directAPI.validateToken(token);
        if (!user || user.role !== 'Manager') throw new Error('Unauthorized');
        const defaults = await this.getAvailableRemovalConditions();
        for (const rule of defaults) {
            await directDB.upsert('removal_condition_definitions', rule);
        }
        return true;
    }
};

// ----------------------------------------------------------------
// WORKFLOWS UI
// ----------------------------------------------------------------
let _workflows = [];
let _availableConditions = [];

async function loadWorkflowsSection() {
    const token = getStoredToken();
    if (!token) return;

    const container = document.getElementById('workflowsContainer');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner"></div>';

    try {
        [_workflows, _availableConditions] = await Promise.all([
            workflowsAPI.getAllWorkflows(),
            workflowsAPI.getAvailableRemovalConditions()
        ]);
        renderWorkflows();
        renderRemovalConditions();
    } catch (e) {
        container.innerHTML = `<div class="error-message">Error: ${e.message}</div>`;
    }
}

function renderWorkflows() {
    const container = document.getElementById('workflowsList');
    if (!container) return;

    const isAdmin = currentUser?.allowedAccounts?.includes('*');

    container.innerHTML = _workflows.map(w => `
        <div class="workflow-card">
            <div class="workflow-info">
                <div class="workflow-name">${escapeHtml(w.workflowName)}</div>
                ${w.description ? `<div class="workflow-desc">${escapeHtml(w.description)}</div>` : ''}
                ${w.schedule ? `<div class="workflow-schedule">⏰ ${escapeHtml(w.schedule)}</div>` : ''}
                ${w.lastRun ? `<div class="workflow-last-run">Last run: ${new Date(w.lastRun).toLocaleString()}</div>` : ''}
            </div>
            <div class="workflow-toggle">
                <label class="toggle-switch">
                    <input type="checkbox" ${w.enabled ? 'checked' : ''} ${!isAdmin ? 'disabled' : ''}
                        onchange="toggleWorkflow('${w.workflowName}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>
                <span class="toggle-label">${w.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
        </div>
    `).join('') || '<div class="empty-state">No workflows configured</div>';
}

async function toggleWorkflow(name, enabled) {
    const token = getStoredToken();
    if (!token) return;
    try {
        await workflowsAPI.setWorkflowEnabled(name, enabled, token);
        const w = _workflows.find(w => w.workflowName === name);
        if (w) w.enabled = enabled;
        showToast(`Workflow ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
        loadWorkflowsSection(); // Revert
    }
}

function renderRemovalConditions() {
    const container = document.getElementById('removalConditionsList');
    if (!container) return;
    const isAdmin = currentUser?.allowedAccounts?.includes('*');

    container.innerHTML = _availableConditions.map(c => `
        <div class="condition-card">
            <div class="condition-info">
                <div class="condition-name">${escapeHtml(c.name)}</div>
                <div class="condition-id"><code>${escapeHtml(c.id)}</code></div>
                ${c.description ? `<div class="condition-desc">${escapeHtml(c.description)}</div>` : ''}
            </div>
            ${isAdmin ? `
            <div class="condition-actions">
                <button class="btn-icon" onclick="editRemovalCondition('${c.id}')">✏️</button>
                <button class="btn-icon btn-danger" onclick="deleteRemovalCondition('${c.id}')">🗑️</button>
            </div>` : ''}
        </div>
    `).join('') || '<div class="empty-state">No removal conditions defined</div>';
}

async function deleteRemovalCondition(id) {
    if (!confirm('Delete this removal condition?')) return;
    const token = getStoredToken();
    try {
        await workflowsAPI.deleteRemovalCondition(id, token);
        showToast('Condition deleted', 'success');
        loadWorkflowsSection();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

// ----------------------------------------------------------------
// EDIT / ADD REMOVAL CONDITION MODAL
// ----------------------------------------------------------------
window.editRemovalCondition = function(id) {
    const cond = _availableConditions.find(c => c.id === id);
    if (!cond) return;
    _showConditionModal(cond);
};

window.showAddConditionModal = function() {
    _showConditionModal(null);
};

function _showConditionModal(existing) {
    if (!document.getElementById('conditionEditModal')) {
        const div = document.createElement('div');
        div.innerHTML = `
            <div id="conditionEditModal" class="modal-backdrop" onclick="if(event.target===this)closeModal('conditionEditModal')">
                <div class="modal-content" style="max-width:540px">
                    <div class="modal-header">
                        <h3 class="modal-title" id="conditionEditTitle">Add Removal Condition</h3>
                        <button class="modal-close" onclick="closeModal('conditionEditModal')">✕</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label class="form-label">ID <span style="color:var(--text-muted);font-size:.8rem">(unique key, no spaces)</span></label>
                            <input type="text" id="condEditId" class="form-control" placeholder="e.g. LOW_24H_LOW_SPEND">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Name</label>
                            <input type="text" id="condEditName" class="form-control" placeholder="Human-readable label">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Description</label>
                            <textarea id="condEditDesc" class="form-control" rows="3" placeholder="Explain when this condition triggers…"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-ghost" onclick="closeModal('conditionEditModal')">Cancel</button>
                        <button class="btn btn-primary" id="condEditSaveBtn" onclick="saveConditionModal()">Save</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(div.firstElementChild);
    }

    document.getElementById('conditionEditTitle').textContent = existing ? 'Edit Removal Condition' : 'Add Removal Condition';
    document.getElementById('condEditId').value   = existing?.id          || '';
    document.getElementById('condEditName').value = existing?.name        || '';
    document.getElementById('condEditDesc').value = existing?.description || '';
    document.getElementById('condEditId').disabled = !!existing; // can't change the PK

    window._condEditOriginalId = existing?.id || null;
    openModal('conditionEditModal');
}

window.saveConditionModal = async function() {
    const token = getStoredToken();
    if (!token) return;

    const id   = document.getElementById('condEditId')?.value?.trim();
    const name = document.getElementById('condEditName')?.value?.trim();
    const desc = document.getElementById('condEditDesc')?.value?.trim();

    if (!id)   { showToast('ID is required', 'error');   return; }
    if (!name) { showToast('Name is required', 'error'); return; }

    const btn = document.getElementById('condEditSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        await workflowsAPI.saveRemovalCondition({ id, name, description: desc }, token);
        showToast('Condition saved ✅', 'success');
        closeModal('conditionEditModal');
        await loadWorkflowsSection();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
};
