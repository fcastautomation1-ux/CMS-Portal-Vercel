// ================================================================
// dashboard.js
// Dashboard summary + quick stats.
// Depends on: supabase-client.js, auth.js, todos.js
// ================================================================

// ----------------------------------------------------------------
// DASHBOARD DATA
// ----------------------------------------------------------------
async function loadDashboard() {
    const token = getStoredToken();
    if (!token) return;

    renderDashboardSkeleton();

    try {
        const [todos, accounts] = await Promise.all([
            todosAPI.getTodos(token).catch(() => []),
            accountsAPI.getAllAccountsForFrontend(token).catch(() => [])
        ]);

        _allTodos = todos; // Keep global in sync
        renderDashboard(todos, accounts);
    } catch (e) {
        console.error('Dashboard load error:', e);
        showToast('Failed to load dashboard', 'error');
    }
}

function renderDashboardSkeleton() {
    const container = document.getElementById('dashboardStats');
    if (!container) return;
    container.innerHTML = `
        <div class="stat-card skeleton"><div class="skeleton-line w-60"></div><div class="skeleton-line w-40"></div></div>
        <div class="stat-card skeleton"><div class="skeleton-line w-60"></div><div class="skeleton-line w-40"></div></div>
        <div class="stat-card skeleton"><div class="skeleton-line w-60"></div><div class="skeleton-line w-40"></div></div>
        <div class="stat-card skeleton"><div class="skeleton-line w-60"></div><div class="skeleton-line w-40"></div></div>
    `;
}

function renderDashboard(todos, accounts) {
    const now = new Date();
    const myTodos = todos.filter(t =>
        !t.archived &&
        (t.username === currentUser?.username || t.assigned_to === currentUser?.username)
    );

    const active = myTodos.filter(t => !t.completed);
    const done = myTodos.filter(t => t.completed);
    const overdue = active.filter(t => t.due_date && new Date(t.due_date) < now);
    const dueToday = active.filter(t => {
        if (!t.due_date) return false;
        const d = new Date(t.due_date);
        return d.toDateString() === now.toDateString();
    });
    const pendingApproval = myTodos.filter(t => t.approval_status === 'pending_approval');

    // Stats bar
    const statsContainer = document.getElementById('dashboardStats');
    if (statsContainer) {
        statsContainer.innerHTML = [
            { icon: '📋', label: 'Active Tasks', value: active.length, color: 'var(--brand-primary)', section: 'todos' },
            { icon: '✅', label: 'Completed', value: done.length, color: '#22c55e', section: 'todos' },
            { icon: '🔴', label: 'Overdue', value: overdue.length, color: '#ef4444', section: 'todos' },
            { icon: '📊', label: 'Accounts', value: accounts.length, color: '#a78bfa', section: 'accounts' }
        ].map(stat => `
            <div class="stat-card" onclick="navigateTo('${stat.section}')" style="cursor:pointer;">
                <div class="stat-icon">${stat.icon}</div>
                <div class="stat-value" style="color:${stat.color}">${stat.value}</div>
                <div class="stat-label">${stat.label}</div>
            </div>
        `).join('');
    }

    // Recent tasks
    renderRecentTasks(active.slice(0, 8));

    // Quick info
    renderDashboardAlertsSection(overdue, dueToday, pendingApproval);
}

function renderRecentTasks(tasks) {
    const container = document.getElementById('dashboardRecentTasks');
    if (!container) return;

    if (!tasks.length) {
        container.innerHTML = `
            <div class="empty-state" style="padding:32px;">
                <div class="empty-icon">🎉</div>
                <div class="empty-title">All caught up!</div>
                <div class="empty-desc">No active tasks. Great job!</div>
            </div>`;
        return;
    }

    const priorityColors = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };

    container.innerHTML = tasks.map(t => {
        const isOverdue = t.due_date && !t.completed && new Date(t.due_date) < new Date();
        return `
            <div class="recent-task-item" onclick="navigateTo('todos'); setTimeout(() => openTodoDetail('${t.id}'), 300)">
                <div class="task-priority-dot" style="background:${priorityColors[t.priority] || priorityColors.medium}"></div>
                <div class="task-info">
                    <div class="task-name">${escapeHtml(t.title || 'Untitled')}</div>
                    <div class="task-meta-row">
                        ${t.category ? `<span class="tag">${escapeHtml(t.category)}</span>` : ''}
                        ${t.kpi_type ? `<span class="tag">${escapeHtml(t.kpi_type)}</span>` : ''}
                        ${isOverdue ? '<span class="tag tag-danger">Overdue</span>' : ''}
                        ${t.due_date ? `<span class="tag tag-muted">📅 ${new Date(t.due_date).toLocaleDateString()}</span>` : ''}
                    </div>
                </div>
                <span class="task-status-dot status-${t.task_status || 'todo'}"></span>
            </div>
        `;
    }).join('');
}

function renderDashboardAlertsSection(overdue, dueToday, pendingApproval) {
    const container = document.getElementById('dashboardAlerts');
    if (!container) return;

    const alerts = [];

    if (overdue.length) alerts.push(`
        <div class="dashboard-alert alert-danger" onclick="navigateTo('todos')">
            🔴 <strong>${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}</strong>
            — click to review
        </div>`);

    if (dueToday.length) alerts.push(`
        <div class="dashboard-alert alert-warning" onclick="navigateTo('todos')">
            📅 <strong>${dueToday.length} task${dueToday.length > 1 ? 's' : ''} due today</strong>
            — stay on track!
        </div>`);

    if (pendingApproval.length) alerts.push(`
        <div class="dashboard-alert alert-info" onclick="navigateTo('todos')">
            ⏳ <strong>${pendingApproval.length} task${pendingApproval.length > 1 ? 's' : ''} awaiting approval</strong>
        </div>`);

    container.innerHTML = alerts.join('') || '';
}
