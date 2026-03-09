// ================================================================
// looker.js
// Looker Studio reports API + embed UI.
// Depends on: supabase-client.js, auth.js
// ================================================================

const lookerAPI = {

    async getLookerReports(token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        try {
            const allReports = await directDB.select('looker_reports');

            // Managers and Admin see all reports
            if (user.role === 'Manager' || user.role === 'Super Manager' || user.username === 'admin') {
                return allReports || [];
            }

            // Regular users: filter to allowed report IDs only
            const users = await directDB.select('users', { username: user.username });
            const userProfile = users?.[0];
            const allowedIds = userProfile?.allowed_looker_reports
                ? userProfile.allowed_looker_reports.split(',').map(s => s.trim()).filter(s => s)
                : [];

            if (allowedIds.length === 0) return [];

            return (allReports || []).filter(r => r.active && allowedIds.includes(r.id));
        } catch (e) {
            console.warn('Could not fetch Looker reports:', e);
            return [];
        }
    },

    async saveLookerReport(reportData, token) {
        const user = await directAPI.validateToken(token);
        const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
        if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager'))
            throw new Error('Unauthorized — Managers only');

        const payload = {
            id: reportData.id || crypto.randomUUID(),
            name: reportData.name.trim(),
            url: reportData.url.trim(),
            description: reportData.description || '',
            allowed_users: reportData.allowedUsers || '',
            active: reportData.active !== false,
            updated_at: new Date().toISOString()
        };
        if (!reportData.id) payload.created_at = new Date().toISOString();

        await directDB.upsert('looker_reports', payload);
        return payload;
    },

    async deleteLookerReport(reportId, token) {
        const user = await directAPI.validateToken(token);
        const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
        if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager'))
            throw new Error('Unauthorized — Managers only');
        await directDB.delete('looker_reports', { id: reportId });
        return true;
    }
};

// ----------------------------------------------------------------
// LOOKER UI
// ----------------------------------------------------------------
let _lookerReports = [];
let _activeLookerReport = null;

async function loadLookerReports() {
    const token = getStoredToken();
    if (!token) return;

    const grid = document.getElementById('lookerReportsGrid');
    const viewer = document.getElementById('lookerReportViewer');
    if (!grid) return;
    grid.innerHTML = '<div class="loading-spinner"></div>';

    try {
        _lookerReports = await lookerAPI.getLookerReports(token);
        renderLookerReports(_lookerReports);
    } catch (e) {
        grid.innerHTML = `<div class="error-message">Error: ${e.message}</div>`;
        showToast('Failed to load reports: ' + e.message, 'error');
    }
}

function renderLookerReports(reports) {
    const grid = document.getElementById('lookerReportsGrid');
    if (!grid) return;

    if (!reports.length) {
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📊</div>
                <div class="empty-title">No reports available</div>
                <div class="empty-desc">Ask your manager to assign Looker Studio reports to you.</div>
            </div>`;
        return;
    }

    const canManage = currentUser?.role === 'Manager'
        || currentUser?.role === 'Super Manager'
        || currentUser?.username === 'admin';

    grid.innerHTML = reports.map(r => `
        <div class="report-card ${_activeLookerReport?.id === r.id ? 'active' : ''}"
             onclick="openLookerReport('${r.id}')">
            <div class="report-card-icon">📊</div>
            <div class="report-card-body">
                <div class="report-card-name">${escapeHtml(r.name)}</div>
                ${r.description ? `<div class="report-card-desc">${escapeHtml(r.description)}</div>` : ''}
            </div>
            ${canManage ? `
            <div class="report-card-actions">
                <button class="btn-icon" title="Edit" onclick="event.stopPropagation(); showLookerReportModal('${r.id}')">✏️</button>
                <button class="btn-icon btn-danger" title="Delete" onclick="event.stopPropagation(); deleteLookerReport('${r.id}')">🗑️</button>
            </div>` : ''}
        </div>
    `).join('');
}

function openLookerReport(reportId) {
    const report = _lookerReports.find(r => r.id === reportId);
    if (!report) return;
    _activeLookerReport = report;

    const viewer = document.getElementById('lookerReportViewer');
    const iframe = document.getElementById('lookerIframe');
    const title = document.getElementById('lookerReportTitle');

    if (!viewer || !iframe) return;

    if (title) title.textContent = report.name;
    iframe.src = report.url;
    viewer.classList.remove('hidden');

    // Highlight active card
    document.querySelectorAll('.report-card').forEach(el => el.classList.remove('active'));
    document.querySelector(`[onclick="openLookerReport('${reportId}')"]`)?.classList.add('active');
}

function closeLookerViewer() {
    const viewer = document.getElementById('lookerReportViewer');
    const iframe = document.getElementById('lookerIframe');
    if (iframe) iframe.src = '';
    viewer?.classList.add('hidden');
    _activeLookerReport = null;
    document.querySelectorAll('.report-card').forEach(el => el.classList.remove('active'));
}

function showLookerReportModal(reportId = null) {
    const modal = document.getElementById('lookerReportModal');
    if (!modal) return;

    const report = reportId ? _lookerReports.find(r => r.id === reportId) : null;
    document.getElementById('lookerModalTitle').textContent = report ? 'Edit Report' : 'Add Report';
    document.getElementById('lookerReportId').value = report?.id || '';
    document.getElementById('lookerReportName').value = report?.name || '';
    document.getElementById('lookerReportUrl').value = report?.url || '';
    document.getElementById('lookerReportDescription').value = report?.description || '';
    document.getElementById('lookerReportAllowedUsers').value = report?.allowed_users || '';
    document.getElementById('lookerReportActive').checked = report ? report.active : true;

    modal.classList.add('open');
}

function closeLookerReportModal() {
    document.getElementById('lookerReportModal')?.classList.remove('open');
}

async function saveLookerReportFromModal() {
    const token = getStoredToken();
    if (!token) return;

    const reportData = {
        id: document.getElementById('lookerReportId').value || null,
        name: document.getElementById('lookerReportName').value.trim(),
        url: document.getElementById('lookerReportUrl').value.trim(),
        description: document.getElementById('lookerReportDescription').value.trim(),
        allowedUsers: document.getElementById('lookerReportAllowedUsers').value.trim(),
        active: document.getElementById('lookerReportActive').checked
    };

    if (!reportData.name || !reportData.url) {
        showToast('Name and URL are required', 'error');
        return;
    }

    const btn = document.getElementById('saveLookerReportBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
        await lookerAPI.saveLookerReport(reportData, token);
        closeLookerReportModal();
        showToast('Report saved', 'success');
        loadLookerReports();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Report'; }
    }
}

async function deleteLookerReport(reportId) {
    if (!confirm('Delete this Looker report? This cannot be undone.')) return;
    const token = getStoredToken();
    if (!token) return;
    try {
        await lookerAPI.deleteLookerReport(reportId, token);
        showToast('Report deleted', 'success');
        if (_activeLookerReport?.id === reportId) closeLookerViewer();
        loadLookerReports();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}
