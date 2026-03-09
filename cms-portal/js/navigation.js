// ================================================================
// navigation.js
// Sidebar / section routing and page init helpers.
// Depends on: auth.js, ui-helpers.js
// ================================================================

// All navigable sections
const NAV_SECTIONS = [
    { id: 'dashboard',      label: 'Dashboard',       icon: '🏠', roles: ['*'] },
    { id: 'todos',          label: 'Tasks',           icon: '✅', roles: ['*'] },
    { id: 'accounts',       label: 'Accounts',        icon: '📊', roles: ['Manager', 'Super Manager', 'Admin', 'Employee'] },
    { id: 'campaigns',      label: 'Campaigns',       icon: '📈', roles: ['*'] },
    { id: 'looker',         label: 'Reports',         icon: '📉', roles: ['*'] },
    { id: 'workflows',      label: 'Workflows',       icon: '⚙️',  roles: ['Manager', 'Super Manager', 'Admin'] },
    { id: 'packages',       label: 'Packages',        icon: '📦', roles: ['*'] },
    { id: 'users',          label: 'Users',           icon: '👤', roles: ['Manager', 'Super Manager', 'Admin'] },
    { id: 'departments',    label: 'Departments',     icon: '🏢', roles: ['Manager', 'Super Manager', 'Admin'] },
    { id: 'drive',          label: 'Drive',           icon: '📁', roles: ['*'] },
    { id: 'settings',       label: 'Settings',        icon: '⚙️',  roles: ['*'] }
];

let _currentSection = 'dashboard';

// ----------------------------------------------------------------
// SIDEBAR BUILDER
// ----------------------------------------------------------------
function buildSidebar() {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;

    const role = currentUser?.role || 'Employee';
    const isAdmin = currentUser?.username === 'admin';

    nav.innerHTML = NAV_SECTIONS.filter(s =>
        s.roles.includes('*') ||
        isAdmin ||
        s.roles.includes(role)
    ).map(s => `
        <li>
            <button class="nav-item ${_currentSection === s.id ? 'active' : ''}"
                    data-section="${s.id}"
                    onclick="navigateTo('${s.id}')"
                    id="nav-${s.id}">
                <span class="nav-icon">${s.icon}</span>
                <span class="nav-label">${s.label}</span>
                ${s.id === 'todos' ? '<span class="nav-badge" id="todoBadge" style="display:none"></span>' : ''}
            </button>
        </li>
    `).join('');
}

// ----------------------------------------------------------------
// ROUTING
// ----------------------------------------------------------------
function navigateTo(sectionId) {
    if (_currentSection === sectionId) return;

    // Hide all sections
    document.querySelectorAll('.app-section').forEach(el => el.classList.add('hidden'));

    // Show target section
    const target = document.getElementById(`section-${sectionId}`);
    if (!target) {
        console.warn(`Section #section-${sectionId} not found`);
        return;
    }
    target.classList.remove('hidden');
    _currentSection = sectionId;

    // Update sidebar active states
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === sectionId);
    });

    // Lazy-load section data
    _onSectionEnter(sectionId);

    // Update topbar breadcrumb text and page title
    const section = NAV_SECTIONS.find(s => s.id === sectionId);
    const breadcrumb = document.getElementById('topbarBreadcrumb');
    if (breadcrumb && section) breadcrumb.textContent = section.label;
    if (section) document.title = `${section.label} — CMS Portal`;

    // Mobile: close sidebar
    closeMobileSidebar();
}

function _onSectionEnter(sectionId) {
    switch (sectionId) {
        case 'dashboard': loadDashboard?.(); break;
        case 'todos': loadTodos?.(); break;
        case 'accounts': loadAccounts?.(); break;
        case 'campaigns': loadAllCampaigns?.(); break;
        case 'looker': loadLookerReports?.(); break;
        case 'workflows': loadWorkflowsSection?.(); break;
        case 'packages':
            initPackages?.();
            setTimeout(() => renderPackagesSectionHeader?.(), 200);
            break;
        case 'users': loadUsersSection?.(); break;
        case 'departments': loadDepartmentsSection?.(); break;
        case 'drive': loadDriveSection?.(); break;
        case 'settings': renderSettingsSection?.(); break;
    }
}

// ----------------------------------------------------------------
// MOBILE SIDEBAR
// ----------------------------------------------------------------
function toggleMobileSidebar() {
    document.getElementById('sidebar')?.classList.toggle('mobile-open');
    document.getElementById('sidebarOverlay')?.classList.toggle('visible');
}

function closeMobileSidebar() {
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('sidebarOverlay')?.classList.remove('visible');
}

// ----------------------------------------------------------------
// APP INITIALIZATION (called after successful login / auto-login)
// ----------------------------------------------------------------
async function init() {
    // Show the main app, hide login
    document.getElementById('loginSection')?.classList.add('hidden');
    document.getElementById('mainApp')?.classList.remove('hidden');

    // Build UI for the logged-in user
    buildSidebar();
    updateUserProfileUI(currentUser);

    // Start notification polling
    startNotificationPolling(60000);

    // Navigate to default section
    const defaultSection = currentUser?.role === 'Admin' || currentUser?.username === 'admin'
        ? 'dashboard'
        : 'todos';
    navigateTo(defaultSection);
}

function updateUserProfileUI(user) {
    if (!user) return;
    const nameEls = document.querySelectorAll('[data-user-name]');
    nameEls.forEach(el => { el.textContent = user.username; });
    const roleEls = document.querySelectorAll('[data-user-role]');
    roleEls.forEach(el => { el.textContent = user.role || 'Employee'; });
    const avatarEls = document.querySelectorAll('[data-user-avatar]');
    avatarEls.forEach(el => { el.textContent = (user.username || '?')[0].toUpperCase(); });
}

// ----------------------------------------------------------------
// PAGE LOAD ENTRY POINT
// ----------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    // Try to restore a previous session without re-login
    const loggedIn = await tryAutoLogin();
    if (loggedIn) {
        await init();
    } else {
        // Show login form
        document.getElementById('loginSection')?.classList.remove('hidden');
        document.getElementById('mainApp')?.classList.add('hidden');
        document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    }

    // Close panels on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#notificationsPanel') && !e.target.closest('[onclick*="openNotificationsPanel"]')) {
            document.getElementById('notificationsPanel')?.classList.remove('open');
        }
        if (!e.target.closest('#sidebar') && !e.target.closest('#menuToggle')) {
            closeMobileSidebar();
        }
    });

    // Global escape key
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeTodoDetail?.();
            closeTodoFormModal?.();
            closeShareTodoModal?.();
            closeQueueTodoModal?.();
            closeUserModal?.();
            closeAccountModal?.();
            closeLookerViewer?.();
        }
    });
});
