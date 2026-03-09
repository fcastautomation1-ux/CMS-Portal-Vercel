// ================================================================
// todo-detail.js
// Task detail modal: view, edit, comment, share, queue actions.
// Depends on: todos.js, notifications.js, ui-helpers.js
// ================================================================

let _detailTodoId = null;
let _detailTodo = null;

// ----------------------------------------------------------------
// OPEN / CLOSE MODAL
// ----------------------------------------------------------------
async function openTodoDetail(todoId) {
    _detailTodoId = todoId;
    const modal = document.getElementById('todoDetailModal');
    if (!modal) return;

    modal.classList.add('open');
    renderDetailSkeleton();

    try {
        const todo = _allTodos.find(t => t.id === todoId);
        if (!todo) throw new Error('Task not found in cache');
        _detailTodo = todo;
        renderTodoDetail(todo);

        // Mark messages as read
        const token = getStoredToken();
        if (token) {
            todosAPI.markMessagesAsRead?.(todoId, token).catch(() => {});
        }
    } catch (e) {
        renderDetailError(e.message);
    }
}

function closeTodoDetail() {
    document.getElementById('todoDetailModal')?.classList.remove('open');
    _detailTodoId = null;
    _detailTodo = null;
}

function renderDetailSkeleton() {
    const body = document.getElementById('todoDetailBody');
    if (!body) return;
    body.innerHTML = `
        <div class="skeleton-loader">
            <div class="skeleton-line w-60"></div>
            <div class="skeleton-line w-40"></div>
            <div class="skeleton-line w-full"></div>
            <div class="skeleton-line w-full"></div>
        </div>`;
}

function renderDetailError(message) {
    const body = document.getElementById('todoDetailBody');
    if (!body) return;
    body.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
}

// ----------------------------------------------------------------
// MAIN DETAIL RENDER
// ----------------------------------------------------------------
function renderTodoDetail(todo) {
    const body = document.getElementById('todoDetailBody');
    const title = document.getElementById('todoDetailTitle');
    if (!body) return;
    if (title) title.textContent = todo.title || 'Untitled Task';

    const isCreator = (todo.username || '').toLowerCase() === (currentUser?.username || '').toLowerCase();
    const isAssignee = (todo.assigned_to || '').toLowerCase() === (currentUser?.username || '').toLowerCase();
    const isAdmin = currentUser?.username === 'admin';
    const canEdit = isCreator || isAdmin;

    const history = parseHistory(todo.history);
    const comments = history.filter(h => h.type === 'comment');
    const activityLog = history.filter(h => h.type !== 'comment');

    const statusLabels = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
    const priorityIcons = { high: '🔴', medium: '🟡', low: '🟢' };
    const isOverdue = todo.due_date && !todo.completed && new Date(todo.due_date) < new Date();

    body.innerHTML = `
        <!-- STATUS BAR -->
        <div class="detail-status-bar">
            <span class="detail-status-badge status-${todo.task_status || 'todo'}">${statusLabels[todo.task_status] || 'To Do'}</span>
            <span class="detail-priority">${priorityIcons[todo.priority] || '🟡'} ${(todo.priority || 'medium').charAt(0).toUpperCase() + (todo.priority || 'medium').slice(1)}</span>
            ${todo.approval_status === 'pending_approval' ? '<span class="approval-tag">⏳ Pending Approval</span>' : ''}
            ${todo.is_department_queue ? '<span class="queue-tag">📥 Queued</span>' : ''}
        </div>

        <!-- META GRID -->
        <div class="detail-meta-grid">
            ${todo.category ? `<div class="detail-meta-item"><div class="meta-label">Department</div><div class="meta-value">${escapeHtml(todo.category)}</div></div>` : ''}
            ${todo.kpi_type ? `<div class="detail-meta-item"><div class="meta-label">KPI Type</div><div class="meta-value">${escapeHtml(todo.kpi_type)}</div></div>` : ''}
            ${todo.username ? `<div class="detail-meta-item"><div class="meta-label">Created By</div><div class="meta-value">👤 ${escapeHtml(todo.username)}</div></div>` : ''}
            ${todo.assigned_to ? `<div class="detail-meta-item"><div class="meta-label">Assigned To</div><div class="meta-value">👤 ${escapeHtml(todo.assigned_to)}</div></div>` : ''}
            ${todo.due_date ? `<div class="detail-meta-item"><div class="meta-label">Due Date</div><div class="meta-value ${isOverdue ? 'overdue-text' : ''}">📅 ${new Date(todo.due_date).toLocaleDateString()} ${isOverdue ? '(Overdue!)' : ''}</div></div>` : ''}
            ${todo.package_name ? `<div class="detail-meta-item"><div class="meta-label">Package</div><div class="meta-value">${escapeHtml(todo.package_name)}</div></div>` : ''}
            ${todo.app_name ? `<div class="detail-meta-item"><div class="meta-label">App</div><div class="meta-value">${escapeHtml(todo.app_name)}</div></div>` : ''}
            <div class="detail-meta-item"><div class="meta-label">Created</div><div class="meta-value">${todo.created_at ? new Date(todo.created_at).toLocaleString() : '—'}</div></div>
        </div>

        <!-- DESCRIPTION -->
        ${todo.description ? `
        <div class="detail-section">
            <div class="detail-section-title">📝 Description</div>
            <div class="detail-description">${escapeHtml(todo.description)}</div>
        </div>` : ''}

        <!-- OUR GOAL -->
        ${todo.our_goal ? `
        <div class="detail-section">
            <div class="detail-section-title">🎯 Our Goal</div>
            <div class="detail-description">${escapeHtml(todo.our_goal)}</div>
        </div>` : ''}

        <!-- NOTES -->
        ${todo.notes ? `
        <div class="detail-section">
            <div class="detail-section-title">📌 Notes</div>
            <div class="detail-description">${escapeHtml(todo.notes)}</div>
        </div>` : ''}

        <!-- ACTIONS -->
        <div class="detail-actions">
            ${canEdit ? `<button class="btn btn-primary" onclick="openEditTodoModal('${todo.id}')">✏️ Edit Task</button>` : ''}
            ${!todo.completed ? `
                <button class="btn btn-success" onclick="completeTodoFromDetail('${todo.id}', true)">
                    ✅ ${isCreator ? 'Mark Complete' : 'Submit for Approval'}
                </button>` : `
                <button class="btn btn-warning" onclick="completeTodoFromDetail('${todo.id}', false)">↩️ Reopen Task</button>`}
            ${canEdit ? `<button class="btn btn-secondary" onclick="openShareTodoModal('${todo.id}')">👥 Assign/Share</button>` : ''}
            ${canEdit ? `<button class="btn btn-ghost" onclick="openQueueTodoModal('${todo.id}')">📥 Send to Queue</button>` : ''}
            ${isAdmin || isCreator ? `<button class="btn btn-danger" onclick="deleteTaskFromDetail('${todo.id}')">🗑️ Delete</button>` : ''}
        </div>

        <!-- COMMENTS -->
        <div class="detail-section">
            <div class="detail-section-title">💬 Messages (${comments.length})</div>
            <div class="comments-list" id="detailCommentsList">
                ${comments.length ? comments.map(c => `
                    <div class="comment-item ${c.user === currentUser?.username ? 'mine' : ''}">
                        <div class="comment-avatar">${(c.user || '?')[0].toUpperCase()}</div>
                        <div class="comment-body">
                            <div class="comment-header">
                                <span class="comment-author">${escapeHtml(c.user || 'Unknown')}</span>
                                <span class="comment-time">${formatRelativeTime(c.timestamp)}</span>
                            </div>
                            <div class="comment-text">${escapeHtml(c.message || '')}</div>
                        </div>
                    </div>
                `).join('') : '<div class="no-comments">No messages yet. Start the conversation!</div>'}
            </div>
            <div class="comment-composer">
                <textarea id="detailCommentInput" class="comment-input" rows="2"
                    placeholder="Write a message... (Enter to send)" maxlength="2000"
                    onkeydown="handleCommentEnter(event, '${todo.id}')"></textarea>
                <button class="btn btn-primary" onclick="sendComment('${todo.id}')">Send 📤</button>
            </div>
        </div>

        <!-- ACTIVITY LOG -->
        ${activityLog.length ? `
        <div class="detail-section">
            <div class="detail-section-title">📜 Activity Log</div>
            <div class="activity-log">
                ${activityLog.slice(-20).reverse().map(h => `
                    <div class="activity-item">
                        <span class="activity-icon">${h.icon || '📝'}</span>
                        <div class="activity-body">
                            <div class="activity-title">${escapeHtml(h.title || h.type || 'Update')}</div>
                            <div class="activity-details">${escapeHtml(h.details || '')}</div>
                            <div class="activity-time">${formatRelativeTime(h.timestamp)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>` : ''}
    `;
}

function parseHistory(history) {
    if (!history) return [];
    try {
        return typeof history === 'string' ? JSON.parse(history) : (Array.isArray(history) ? history : []);
    } catch { return []; }
}

// ----------------------------------------------------------------
// QUICK ACTIONS FROM DETAIL PANEL
// ----------------------------------------------------------------
async function completeTodoFromDetail(todoId, completed) {
    const token = getStoredToken();
    if (!token) return;
    try {
        await todosAPI.toggleTodoComplete(todoId, completed, token);
        const todo = _allTodos.find(t => t.id === todoId);
        if (todo) {
            todo.completed = completed;
            todo.task_status = completed ? 'done' : 'todo';
            _detailTodo = todo;
            renderTodoDetail(todo);
        }
        renderTodosView();
        updateTodoCounters();
        showToast(completed ? 'Task complete! 🎉' : 'Task reopened', 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

async function deleteTaskFromDetail(todoId) {
    if (!confirm('Delete this task? This cannot be undone.')) return;
    const token = getStoredToken();
    if (!token) return;
    try {
        await todosAPI.deleteTodo(todoId, token);
        closeTodoDetail();
        _allTodos = _allTodos.filter(t => t.id !== todoId);
        renderTodosView();
        updateTodoCounters();
        showToast('Task deleted', 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

// ----------------------------------------------------------------
// COMMENTS
// ----------------------------------------------------------------
async function sendComment(todoId) {
    const input = document.getElementById('detailCommentInput');
    const message = (input?.value || '').trim();
    if (!message) return;

    const token = getStoredToken();
    if (!token) return;

    input.disabled = true;

    try {
        await todosAPI.addComment(todoId, message, token);
        input.value = '';

        // Update local cache
        const todo = _allTodos.find(t => t.id === todoId);
        if (todo) {
            const history = parseHistory(todo.history);
            history.push({
                id: crypto.randomUUID(), type: 'comment', user: currentUser?.username,
                message: message, timestamp: new Date().toISOString(), icon: '💬', title: 'New Message', unread_by: []
            });
            todo.history = JSON.stringify(history);
            renderTodoDetail(todo);
        }
    } catch (e) {
        showToast('Error sending message: ' + e.message, 'error');
    } finally {
        if (input) input.disabled = false;
        input?.focus();
    }
}

function handleCommentEnter(event, todoId) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendComment(todoId);
    }
}
