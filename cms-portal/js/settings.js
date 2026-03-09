// ================================================================
// settings.js
// User settings UI: change password, theme, profile preferences.
// Depends on: supabase-client.js, auth.js, ui-helpers.js
// ================================================================

function renderSettingsSection() {
    const container = document.getElementById('settingsContent');
    if (!container) return;

    const user = currentUser;

    container.innerHTML = `
        <!-- PROFILE INFO -->
        <div class="settings-card">
            <div class="settings-card-header">👤 Profile</div>
            <div class="settings-card-body">
                <div class="profile-row">
                    <div class="profile-avatar-lg">${(user?.username || '?')[0].toUpperCase()}</div>
                    <div class="profile-details">
                        <div class="profile-username">${escapeHtml(user?.username || '—')}</div>
                        <div class="profile-role">${escapeHtml(user?.role || 'Employee')}</div>
                        ${user?.department ? `<div class="profile-dept">🏢 ${escapeHtml(user.department)}</div>` : ''}
                    </div>
                </div>
            </div>
        </div>

        <!-- CHANGE PASSWORD -->
        <div class="settings-card">
            <div class="settings-card-header">🔒 Change Password</div>
            <div class="settings-card-body">
                <div class="form-group">
                    <label class="form-label">Current Password</label>
                    <input type="password" id="currentPassword" class="form-control" placeholder="Enter current password">
                </div>
                <div class="form-group">
                    <label class="form-label">New Password</label>
                    <input type="password" id="newPassword" class="form-control" placeholder="Enter new password (min 6 chars)">
                </div>
                <div class="form-group">
                    <label class="form-label">Confirm New Password</label>
                    <input type="password" id="confirmPassword" class="form-control" placeholder="Re-enter new password">
                </div>
                <button class="btn btn-primary" onclick="changePassword()">Update Password</button>
            </div>
        </div>

        <!-- APPEARANCE -->
        <div class="settings-card">
            <div class="settings-card-header">🎨 Appearance</div>
            <div class="settings-card-body">
                <div class="appearance-options">
                    <button class="appearance-btn ${_getTheme() === 'dark' ? 'active' : ''}"
                            onclick="setTheme('dark')" id="themeDark">
                        🌙 Dark
                    </button>
                    <button class="appearance-btn ${_getTheme() === 'light' ? 'active' : ''}"
                            onclick="setTheme('light')" id="themeLight">
                        ☀️ Light
                    </button>
                </div>
            </div>
        </div>

        <!-- SESSION -->
        <div class="settings-card">
            <div class="settings-card-header">🔐 Session</div>
            <div class="settings-card-body">
                <p class="settings-hint">Signing out will clear your session and return you to the login screen.</p>
                <button class="btn btn-danger" onclick="handleLogout()">🚪 Sign Out</button>
            </div>
        </div>

        <!-- ABOUT -->
        <div class="settings-card">
            <div class="settings-card-header">ℹ️ About</div>
            <div class="settings-card-body">
                <p class="settings-hint">CMS Portal — v2.0.0 (Next.js / Vercel)</p>
                <p class="settings-hint">Supabase Backend · Google Drive REST API</p>
            </div>
        </div>
    `;
}

// ----------------------------------------------------------------
// CHANGE PASSWORD
// ----------------------------------------------------------------
async function changePassword() {
    const currentPwd = document.getElementById('currentPassword')?.value || '';
    const newPwd = document.getElementById('newPassword')?.value || '';
    const confirmPwd = document.getElementById('confirmPassword')?.value || '';

    if (!currentPwd || !newPwd || !confirmPwd) {
        showToast('All password fields are required', 'error');
        return;
    }

    if (newPwd !== confirmPwd) {
        showToast('New passwords do not match', 'error');
        return;
    }

    if (newPwd.length < 6) {
        showToast('Password must be at least 6 characters', 'error');
        return;
    }

    const token = getStoredToken();
    if (!token) return;

    const btn = document.querySelector('[onclick="changePassword()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }

    try {
        // Verify current password by doing a login attempt
        const verifyResult = await directAPI.login(currentUser.username, currentPwd);
        if (!verifyResult.success) throw new Error('Current password is incorrect');

        // Hash new password
        const hashedNew = await hashPassword(newPwd);
        await directDB.update('users', { password: hashedNew }, { username: currentUser.username });

        showToast('Password updated successfully 🔒', 'success');

        // Clear fields
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Update Password'; }
    }
}

// ----------------------------------------------------------------
// THEME
// ----------------------------------------------------------------
const THEME_KEY = 'cms_portal_theme';

function _getTheme() {
    return localStorage.getItem(THEME_KEY) || 'dark';
}

function setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);

    // Update buttons
    document.getElementById('themeDark')?.classList.toggle('active', theme === 'dark');
    document.getElementById('themeLight')?.classList.toggle('active', theme === 'light');
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

// Apply saved theme on script load
applyTheme(_getTheme());
