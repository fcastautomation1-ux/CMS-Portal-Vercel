// ================================================================
// drive.js
// Google Drive folder browser — uses Google Drive REST API v3
// via a server-side proxy (Next.js API route) on Vercel, OR via
// the Drive URL access list stored in Supabase.
// Depends on: supabase-client.js, auth.js, ui-helpers.js
// ================================================================

// ----------------------------------------------------------------
// DRIVE API (client calls Next.js API route)
// ----------------------------------------------------------------
const driveAPI = {

    /**
     * Fetch the list of Drive folders the current user has access to.
     * On Vercel: this hits /api/drive/list
     * On GAS fallback: uses the Supabase users.allowed_drive_folders column.
     */
    async getAccessibleFolders(token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        // Try calling the Vercel API endpoint first
        if (window.appConfig?.vercelDeployment) {
            try {
                const resp = await fetch('/api/drive/list', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (resp.ok) return (await resp.json()).folders || [];
            } catch { /* fall through */ }
        }

        // Fallback: return folders from Supabase user profile
        const users = await directDB.select('users', { username: user.username });
        const profile = users?.[0];
        const raw = profile?.allowed_drive_folders || '';
        return raw.split(',').map(s => s.trim()).filter(s => s).map(id => ({
            id,
            name: id,
            mimeType: 'application/vnd.google-apps.folder',
            isLink: true
        }));
    },

    /**
     * List files inside a Drive folder.
     * On Vercel: /api/drive/list?folderId=xxx
     */
    async listFolderContents(folderId, token) {
        if (!folderId) throw new Error('Folder ID is required');
        const resp = await fetch(`/api/drive/list?folderId=${encodeURIComponent(folderId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) throw new Error(await resp.text());
        return (await resp.json()).files || [];
    },

    /**
     * Grant user access to a Drive folder (updates Supabase + uses Drive API).
     */
    async grantAccess(username, folderId, token) {
        const resp = await fetch('/api/drive/access', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, folderId, grant: true })
        });
        if (!resp.ok) throw new Error(await resp.text());
        return true;
    },

    async revokeAccess(username, folderId, token) {
        const resp = await fetch('/api/drive/access', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, folderId, grant: false })
        });
        if (!resp.ok) throw new Error(await resp.text());
        return true;
    }
};

// ----------------------------------------------------------------
// DRIVE UI
// ----------------------------------------------------------------
let _driveCurrentFolderId = null;
let _driveBreadcrumb = [{ id: null, name: '🏠 My Drive' }];

async function loadDriveSection() {
    const token = getStoredToken();
    if (!token) return;

    const container = document.getElementById('driveContainer');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner"></div>';

    try {
        const folders = await driveAPI.getAccessibleFolders(token);
        _driveBreadcrumb = [{ id: null, name: '🏠 My Drive' }];
        renderDriveRoot(folders);
    } catch (e) {
        container.innerHTML = `<div class="error-message">Error loading Drive: ${e.message}</div>`;
    }
}

function renderDriveRoot(folders) {
    const container = document.getElementById('driveContainer');
    if (!container) return;

    if (!folders.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📁</div>
                <div class="empty-title">No Drive folders accessible</div>
                <div class="empty-desc">Ask your manager to grant you Drive access.</div>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="drive-breadcrumb" id="driveBreadcrumb"></div>
        <div class="drive-grid" id="driveGrid">
            ${folders.map(f => renderDriveItem(f)).join('')}
        </div>
    `;
    updateDriveBreadcrumb();
}

function renderDriveItem(file) {
    const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
    const icon = isFolder ? '📁' : getFileIcon(file.mimeType);
    const clickHandler = isFolder
        ? `onclick="openDriveFolder('${file.id}', '${escapeHtml(file.name)}')" style="cursor:pointer"`
        : `onclick="openDriveFile('${file.id}', '${file.mimeType}')" style="cursor:pointer"`;

    return `
        <div class="drive-item" ${clickHandler}>
            <div class="drive-item-icon">${icon}</div>
            <div class="drive-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name || file.id)}</div>
            ${file.modifiedTime ? `<div class="drive-item-date">${new Date(file.modifiedTime).toLocaleDateString()}</div>` : ''}
        </div>
    `;
}

async function openDriveFolder(folderId, folderName) {
    const token = getStoredToken();
    if (!token) return;

    const grid = document.getElementById('driveGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="loading-spinner"></div>';

    try {
        const files = await driveAPI.listFolderContents(folderId, token);
        _driveCurrentFolderId = folderId;
        _driveBreadcrumb.push({ id: folderId, name: folderName });
        updateDriveBreadcrumb();

        grid.innerHTML = files.length
            ? files.map(f => renderDriveItem(f)).join('')
            : '<div class="empty-cell">This folder is empty.</div>';
    } catch (e) {
        grid.innerHTML = `<div class="error-message">Error: ${e.message}</div>`;
    }
}

function navigateToDriveCrumb(index) {
    const crumb = _driveBreadcrumb[index];
    _driveBreadcrumb = _driveBreadcrumb.slice(0, index + 1);
    if (!crumb) return;

    if (crumb.id === null) {
        loadDriveSection();
    } else {
        openDriveFolder(crumb.id, crumb.name);
    }
    updateDriveBreadcrumb();
}

function updateDriveBreadcrumb() {
    const nav = document.getElementById('driveBreadcrumb');
    if (!nav) return;
    nav.innerHTML = _driveBreadcrumb.map((crumb, i) => `
        <span class="breadcrumb-item ${i === _driveBreadcrumb.length - 1 ? 'active' : ''}"
              onclick="${i < _driveBreadcrumb.length - 1 ? `navigateToDriveCrumb(${i})` : ''}">
            ${escapeHtml(crumb.name)}
        </span>
        ${i < _driveBreadcrumb.length - 1 ? '<span class="breadcrumb-sep">›</span>' : ''}
    `).join('');
}

function openDriveFile(fileId, mimeType) {
    const viewerUrl = mimeType.includes('google-apps')
        ? `https://drive.google.com/file/d/${fileId}/view`
        : `https://drive.google.com/file/d/${fileId}/view`;
    window.open(viewerUrl, '_blank');
}

function getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📑';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('image')) return '🖼️';
    if (mimeType.includes('video')) return '🎬';
    if (mimeType.includes('audio')) return '🎵';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';
    return '📄';
}
