// ================================================================
// todos.js
// Task (Todo) management API + UI core.
// Covers: CRUD, toggle complete, assignment, sharing, queue system,
//         multi-assignment, task history/comments.
// Depends on: supabase-client.js, auth.js, ui-helpers.js, departments.js
// ================================================================

// ----------------------------------------------------------------
// TASK ANALYTICS DIRTY FLAG
// ----------------------------------------------------------------
function markTaskAnalyticsDirty(reason = 'unknown', force = false) {
    try {
        const key = 'task_analytics_dirty';
        const current = JSON.parse(localStorage.getItem(key) || '{}');
        current.dirty = true;
        current.reason = reason;
        current.timestamp = Date.now();
        localStorage.setItem(key, JSON.stringify(current));
    } catch (e) { /* ignore */ }
}

// ----------------------------------------------------------------
// TODOS API
// ----------------------------------------------------------------
const todosAPI = {

    async getTodos(token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        try {
            const client = getSupabase();
            const isAdminOrSuperManager = user.username === 'admin' || user.role === 'Super Manager' || user.role === 'Admin';

            // Build user department map once
            const { data: allUsers } = await client.from('users').select('username, manager_id, team_members, department');
            const userDeptMap = {};
            (allUsers || []).forEach(u => {
                if (u.username && u.department) userDeptMap[u.username.toLowerCase()] = u.department;
            });

            if (isAdminOrSuperManager) {
                const { data: allTodosData, error } = await client.from('todos').select('*');
                if (error) throw error;
                const { data: sharedData } = await client.from('todo_shares').select('todo_id').eq('shared_with', user.username);
                const sharedIds = new Set((sharedData || []).map(s => s.todo_id));
                return (allTodosData || []).map(t => ({
                    ...t,
                    is_shared: sharedIds.has(t.id) || undefined,
                    creator_department: userDeptMap[t.username?.toLowerCase()] || null,
                    assignee_department: userDeptMap[t.assigned_to?.toLowerCase()] || null
                }));
            }

            // Identify my team
            const myTeamUsernames = (allUsers || [])
                .filter(u => {
                    if (!u.manager_id) return false;
                    return u.manager_id.split(',').map(m => m.trim().toLowerCase()).includes(user.username.toLowerCase());
                })
                .map(u => u.username);

            const myRow = (allUsers || []).find(u => (u.username || '').toLowerCase() === user.username.toLowerCase());
            ((myRow?.team_members || '').toString()).split(',').map(s => s.trim()).filter(Boolean).forEach(m => {
                if (m && !myTeamUsernames.includes(m)) myTeamUsernames.push(m);
            });

            // Run queries in parallel
            const [ownedResult, assignedResult, completedByResult, sharedResult, deptQueuedResult] = await Promise.all([
                client.from('todos').select('*').eq('username', user.username),
                client.from('todos').select('*').eq('assigned_to', user.username),
                client.from('todos').select('*').eq('completed_by', user.username),
                client.from('todo_shares').select('todo_id').eq('shared_with', user.username),
                user.department
                    ? client.from('todos').select('*').eq('queue_status', 'queued')
                        .or('assigned_to.is.null,assigned_to.eq.').ilike('queue_department', user.department)
                    : Promise.resolve({ data: [] })
            ]);

            const { data: managedOnTaskData } = await client.from('todos')
                .select('*').ilike('manager_id', `%${user.username}%`);

            let allTasks = [];
            const taskIds = new Set();
            const addTask = (task, flags = {}) => {
                if (!taskIds.has(task.id)) {
                    allTasks.push({
                        ...task, ...flags,
                        creator_department: userDeptMap[task.username?.toLowerCase()] || null,
                        assignee_department: userDeptMap[task.assigned_to?.toLowerCase()] || null
                    });
                    taskIds.add(task.id);
                }
            };

            (ownedResult.data || []).forEach(t => addTask(t));
            (assignedResult.data || []).forEach(t => addTask(t, { is_assigned_to_me: true }));
            (completedByResult.data || []).forEach(t => addTask(t, { is_completed_by_me: true }));
            (deptQueuedResult?.data || []).forEach(t => addTask(t, { is_department_queue: true }));

            // Manager visibility: tasks where manager_id contains user.username
            (managedOnTaskData || []).forEach(t => {
                const taskManagers = (t.manager_id || '').split(',').map(m => m.trim().toLowerCase());
                if (taskManagers.includes(user.username.toLowerCase())) addTask(t, { is_managed: true });
            });

            // Team created/assigned tasks
            if (myTeamUsernames.length > 0) {
                const { data: teamCreated } = await client.from('todos').select('*').in('username', myTeamUsernames);
                (teamCreated || []).forEach(t => addTask(t, { is_team_task: true }));
                const { data: teamAssigned } = await client.from('todos').select('*').in('assigned_to', myTeamUsernames);
                (teamAssigned || []).forEach(t => addTask(t, { is_team_task: true }));
            }

            // Assignment chain visibility
            try {
                const { data: chainTasks } = await client.from('todos').select('*')
                    .filter('assignment_chain::text', 'ilike', `%${user.username}%`);
                (chainTasks || []).forEach(t => {
                    try {
                        const chain = typeof t.assignment_chain === 'string' ? JSON.parse(t.assignment_chain) : (t.assignment_chain || []);
                        if (chain.some(entry => entry.user && entry.user.toLowerCase() === user.username.toLowerCase())) {
                            addTask(t, { is_chain_member: true });
                        }
                    } catch { /* skip */ }
                });
            } catch { /* column may not exist */ }

            // Multi-assignment
            try {
                const { data: maTasks } = await client.from('todos').select('*').not('multi_assignment', 'is', null);
                (maTasks || []).forEach(t => {
                    try {
                        const ma = typeof t.multi_assignment === 'string' ? JSON.parse(t.multi_assignment) : (t.multi_assignment || {});
                        if (ma.enabled && Array.isArray(ma.assignees)) {
                            const isAssignee = ma.assignees.some(a => (a.username || '').toLowerCase() === user.username.toLowerCase());
                            const isDelegatedTo = !isAssignee && ma.assignees.some(a =>
                                Array.isArray(a.delegated_to) &&
                                a.delegated_to.some(sub => (sub.username || '').toLowerCase() === user.username.toLowerCase())
                            );
                            if (isAssignee || isDelegatedTo) addTask(t, { is_multi_assigned: true, is_delegated_to_me: isDelegatedTo });
                        }
                    } catch { /* skip */ }
                });
            } catch { /* multi_assignment column may not exist */ }

            // Shared tasks
            if (sharedResult.data?.length > 0) {
                const sharedIds = sharedResult.data.map(s => s.todo_id).filter(id => !taskIds.has(id));
                if (sharedIds.length > 0) {
                    const { data: sharedTasks } = await client.from('todos').select('*').in('id', sharedIds);
                    (sharedTasks || []).forEach(t => addTask(t, { is_shared: true }));
                }
            }

            // Normalise tags, due_date aliases, archived
            allTasks = allTasks.map(t => {
                if (t.tags && typeof t.tags === 'string') {
                    try { t.tags = JSON.parse(t.tags); } catch { t.tags = []; }
                } else if (!t.tags) { t.tags = []; }

                const isThisAssignee = t.actual_due_date && (t.assigned_to || '').toLowerCase() === user.username.toLowerCase();
                if (isThisAssignee) t.due_date = t.actual_due_date;
                else if (!t.due_date && t.expected_due_date) t.due_date = t.expected_due_date;

                if (t.archived === undefined || t.archived === null) t.archived = false;
                return t;
            });

            return allTasks.sort((a, b) => {
                const posA = a.position || 0, posB = b.position || 0;
                if (posA !== posB) return posA - posB;
                return new Date(b.created_at) - new Date(a.created_at);
            });
        } catch (e) {
            console.error('Could not fetch todos:', e);
            return [];
        }
    },

    async saveTodo(todoData, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        if (!todoData.kpi_type) throw new Error("KPI's is required");

        const now = new Date().toISOString();
        let existingTodo = null;
        if (todoData.id) {
            const existing = await directDB.select('todos', { id: todoData.id });
            if (!existing?.length) throw new Error('Todo not found');
            existingTodo = existing[0];
            if (existingTodo.username !== user.username) throw new Error('Only the task creator can edit task information');
        }

        const payload = {
            id: todoData.id || crypto.randomUUID(),
            ...(todoData.id ? {} : { username: user.username }),
            title: (todoData.title || '').trim(),
            description: todoData.description || '',
            our_goal: todoData.our_goal || '',
            completed: todoData.completed || false,
            task_status: todoData.task_status || (existingTodo?.task_status || 'todo'),
            priority: todoData.priority || 'medium',
            category: todoData.category || null,
            kpi_type: todoData.kpi_type || null,
            due_date: todoData.due_date || null,
            notes: todoData.notes || '',
            package_name: todoData.package_name || null,
            app_name: todoData.app_name || null,
            position: todoData.position || 0,
            archived: todoData.archived !== undefined ? todoData.archived : false,
            queue_department: todoData.queue_department || null,
            queue_status: todoData.queue_status || null,
            multi_assignment: todoData.multi_assignment || { enabled: false, assignees: [] },
            updated_at: now
        };

        if (!todoData.id) {
            payload.created_at = now;
            payload.username = user.username;
            payload.approval_status = 'approved';
            if (todoData.assigned_to) payload.assigned_to = todoData.assigned_to;
            if (todoData.manager_id) payload.manager_id = todoData.manager_id;
            if (todoData.due_date) {
                payload.expected_due_date = todoData.due_date;
                payload.actual_due_date = todoData.due_date;
            }
            if (payload.task_status === 'done') {
                payload.completed = true;
                payload.completed_at = now;
            }
        } else {
            payload.approval_status = 'approved';
            if (payload.task_status === 'done' && !existingTodo.completed) {
                payload.completed = true;
                payload.completed_at = now;
            } else if (payload.task_status !== 'done' && existingTodo.completed) {
                payload.completed = false;
                payload.completed_at = null;
            }
        }

        let savedTodo;
        if (todoData.id) {
            const updatePayload = { ...payload };
            delete updatePayload.id;
            delete updatePayload.username;
            await directDB.update('todos', updatePayload, { id: todoData.id });
            savedTodo = { id: todoData.id, ...updatePayload };
        } else {
            savedTodo = await directDB.upsert('todos', payload);
        }

        markTaskAnalyticsDirty('save_todo', true);
        return savedTodo || payload;
    },

    async toggleTodoComplete(todoId, completed, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        const existing = await directDB.select('todos', { id: todoId });
        if (!existing?.length) throw new Error('Todo not found');
        const todo = existing[0];

        const isOwner = todo.username === user.username;
        const isAssignee = todo.assigned_to === user.username;
        const isTaskManager = isUserInManagerList(todo.manager_id, user.username);

        if (!isOwner && !isAssignee && !isTaskManager) {
            const client = getSupabase();
            const { data: share } = await client.from('todo_shares')
                .select('can_edit').eq('todo_id', todoId).eq('shared_with', user.username).single();
            if (!share?.can_edit) throw new Error('Cannot modify this task — no permission');
        }

        const now = new Date().toISOString();
        const updateData = { updated_at: now };

        if (completed) {
            if (isOwner) {
                updateData.completed = true;
                updateData.completed_at = now;
                updateData.completed_by = user.username;
                updateData.approval_status = 'approved';
            } else {
                updateData.completed = false;
                updateData.approval_status = 'pending_approval';
                updateData.completed_by = user.username;
                await notificationsAPI.createNotification({
                    userId: todo.username,
                    type: 'task_assigned',
                    title: 'Task Completion Needs Your Approval',
                    message: `${user.username} has completed the task "${todo.title}" and is waiting for your approval.`,
                    link: `todo:${todoId}`,
                    createdBy: user.username,
                    metadata: { todoId, todoTitle: todo.title, pendingApproval: true }
                });
            }
        } else {
            if (!isOwner) throw new Error('Only the task creator can reopen a completed task');
            updateData.completed = false;
            updateData.completed_at = null;
            updateData.completed_by = null;
            updateData.approval_status = 'approved';
        }

        await directDB.update('todos', updateData, { id: todoId });
        markTaskAnalyticsDirty('toggle_complete', true);
        return true;
    },

    async deleteTodo(todoId, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        const existing = await directDB.select('todos', { id: todoId });
        if (!existing?.length) throw new Error('Todo not found');
        const todo = existing[0];

        const isOwner = todo.username === user.username;
        const isAdmin = user.username === 'admin';
        if (!isOwner && !isAdmin) throw new Error('Only the task creator can delete this task');

        await directDB.delete('todos', { id: todoId });
        const client = getSupabase();
        await client.from('todo_shares').delete().eq('todo_id', todoId);

        markTaskAnalyticsDirty('delete_todo', true);
        return true;
    },

    async addTaskHistoryEntry(todoId, historyEntry, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        const client = getSupabase();
        const { data: task } = await client.from('todos').select('history').eq('id', todoId).single();
        if (!task) throw new Error('Task not found');

        let history = [];
        if (task.history) {
            try { history = typeof task.history === 'string' ? JSON.parse(task.history) : task.history; }
            catch { history = []; }
        }
        history.push({
            id: crypto.randomUUID(),
            type: historyEntry.type || 'info',
            user: historyEntry.user || user.username,
            details: historyEntry.details || '',
            timestamp: historyEntry.timestamp || new Date().toISOString(),
            icon: historyEntry.icon || '📝',
            title: historyEntry.title || 'Update',
            ...(historyEntry.changes ? { changes: historyEntry.changes } : {})
        });

        await client.from('todos').update({
            history: JSON.stringify(history),
            updated_at: new Date().toISOString()
        }).eq('id', todoId);

        return true;
    },

    async addComment(todoId, message, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        if (!message || message.trim() === '') throw new Error('Message is required');

        const client = getSupabase();
        const { data: task } = await client.from('todos').select('*').eq('id', todoId).single();
        if (!task) throw new Error('Task not found');

        let history = [];
        if (task.history) {
            try { history = typeof task.history === 'string' ? JSON.parse(task.history) : task.history; }
            catch { history = []; }
        }

        // Build unread_by list
        const notifySet = new Set();
        if (task.username && task.username !== user.username) notifySet.add(task.username);
        if (task.assigned_to && task.assigned_to !== user.username) notifySet.add(task.assigned_to);
        const unreadByList = [...notifySet];

        history.push({
            id: crypto.randomUUID(),
            type: 'comment',
            user: user.username,
            message: message.trim(),
            timestamp: new Date().toISOString(),
            icon: '💬',
            title: 'New Message',
            unread_by: unreadByList
        });

        await client.from('todos').update({
            history: JSON.stringify(history),
            updated_at: new Date().toISOString()
        }).eq('id', todoId);

        // Notify
        for (const targetUser of notifySet) {
            await notificationsAPI.createNotification({
                userId: targetUser,
                type: 'message',
                title: 'New Task Message',
                message: `${user.username}: ${message.trim().substring(0, 50)}${message.length > 50 ? '...' : ''}`,
                link: `todo:${todoId}`,
                createdBy: user.username,
                metadata: { todoId, todoTitle: task.title }
            });
        }

        return true;
    },

    async shareTodo(todoId, sharedWithUsername, canEdit, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        if (!todoId || todoId === 'null') throw new Error('Invalid task ID');
        if (sharedWithUsername === user.username) throw new Error('You cannot share a task with yourself');

        const existing = await directDB.select('todos', { id: todoId });
        if (!existing?.length) throw new Error('Task not found');
        if (existing[0].username !== user.username && existing[0].assigned_to !== user.username)
            throw new Error('Only the task creator or assignee can share this task');

        const todo = existing[0];
        const client = getSupabase();
        const { data: assignedUser } = await client.from('users').select('manager_id').eq('username', sharedWithUsername).single();

        await directDB.update('todos', {
            approval_status: 'approved',
            assigned_to: sharedWithUsername,
            manager_id: assignedUser?.manager_id || null,
            task_status: sharedWithUsername !== todo.username ? 'backlog' : (todo.task_status || 'todo')
        }, { id: todoId });

        await directDB.upsert('todo_shares', {
            todo_id: todoId,
            shared_by: user.username,
            shared_with: sharedWithUsername,
            can_edit: !!canEdit
        });

        if (sharedWithUsername !== user.username) {
            await notificationsAPI.createNotification({
                userId: sharedWithUsername,
                type: 'task_shared',
                title: 'Task Assigned to You',
                message: `${user.username} assigned "${todo.title}" to you.`,
                link: `todo:${todoId}`,
                createdBy: user.username,
                metadata: { taskId: todoId, taskTitle: todo.title }
            });
        }

        return true;
    }
};

// ----------------------------------------------------------------
// TODOS UI — core (filtering, rendering card/row views, counters)
// ----------------------------------------------------------------
let _allTodos = [];
let _todosFilter = { scope: 'all', status: 'all', priority: 'all', search: '', category: '', archived: false };
let _todosView = 'kanban'; // 'kanban' | 'list'
let _todosGroupBy = 'status'; // 'status' | 'priority' | 'assignee'

async function loadTodos(forceRefresh = false) {
    const token = getStoredToken();
    if (!token) return;

    showTodosLoading(true);
    try {
        _allTodos = await todosAPI.getTodos(token);
        renderTodosView();
        updateTodoCounters();
    } catch (e) {
        console.error('Failed to load todos:', e);
        showToast('Failed to load tasks: ' + e.message, 'error');
    } finally {
        showTodosLoading(false);
    }
}

function showTodosLoading(show) {
    const el = document.getElementById('todosLoadingOverlay');
    if (el) el.classList.toggle('hidden', !show);
}

function getFilteredTodos() {
    return _allTodos.filter(t => {
        if (!_todosFilter.archived && t.archived) return false;
        if (_todosFilter.archived && !t.archived) return false;

        if (_todosFilter.scope === 'mine' && t.username !== currentUser?.username && t.assigned_to !== currentUser?.username) return false;
        if (_todosFilter.scope === 'assigned' && t.assigned_to !== currentUser?.username) return false;
        if (_todosFilter.scope === 'created' && t.username !== currentUser?.username) return false;
        if (_todosFilter.scope === 'team' && !t.is_team_task && t.username !== currentUser?.username) return false;

        if (_todosFilter.status !== 'all' && t.task_status !== _todosFilter.status) return false;
        if (_todosFilter.priority !== 'all' && t.priority !== _todosFilter.priority) return false;
        if (_todosFilter.category && t.category !== _todosFilter.category) return false;

        if (_todosFilter.search) {
            const lower = _todosFilter.search.toLowerCase();
            const inTitle = (t.title || '').toLowerCase().includes(lower);
            const inDesc = (t.description || '').toLowerCase().includes(lower);
            if (!inTitle && !inDesc) return false;
        }

        return true;
    });
}

function updateTodoCounters() {
    const all = _allTodos.filter(t => !t.archived && !t.completed);
    const byStatus = { backlog: 0, todo: 0, in_progress: 0, done: 0 };
    all.forEach(t => { if (t.task_status in byStatus) byStatus[t.task_status]++; });

    const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    setCount('todoCountBacklog', byStatus.backlog);
    setCount('todoCountTodo', byStatus.todo);
    setCount('todoCountInProgress', byStatus.in_progress);
    setCount('todoCountDone', byStatus.done);
    setCount('todoCountAll', all.length);
}

function setTodosView(view) {
    _todosView = view;
    renderTodosView();
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
}

function renderTodosView() {
    if (_todosView === 'kanban') renderKanbanBoard();
    else renderTodosList();
}

function renderKanbanBoard() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;

    const filtered = getFilteredTodos();
    const columns = {
        backlog: filtered.filter(t => t.task_status === 'backlog' && !t.completed),
        todo: filtered.filter(t => t.task_status === 'todo' && !t.completed),
        in_progress: filtered.filter(t => t.task_status === 'in_progress' && !t.completed),
        done: filtered.filter(t => t.completed || t.task_status === 'done')
    };

    const statusConfig = {
        backlog: { label: 'Backlog', icon: '📦', color: 'var(--status-backlog)', id: 'todoCountBacklog' },
        todo: { label: 'To Do', icon: '📋', color: 'var(--status-todo)', id: 'todoCountTodo' },
        in_progress: { label: 'In Progress', icon: '⚡', color: 'var(--status-in-progress)', id: 'todoCountInProgress' },
        done: { label: 'Done', icon: '✅', color: 'var(--status-done)', id: 'todoCountDone' }
    };

    board.innerHTML = Object.entries(statusConfig).map(([status, cfg]) => `
        <div class="kanban-column" data-status="${status}">
            <div class="kanban-column-header">
                <span class="kanban-status-icon">${cfg.icon}</span>
                <span class="kanban-status-label" style="color:${cfg.color}">${cfg.label}</span>
                <span class="kanban-count">${columns[status].length}</span>
            </div>
            <div class="kanban-cards" id="kanban-${status}">
                ${columns[status].map(t => renderTodoCard(t)).join('')}
                ${columns[status].length === 0 ? '<div class="kanban-empty">Drop tasks here</div>' : ''}
            </div>
        </div>
    `).join('');
}

function renderTodoCard(todo) {
    const isOverdue = todo.due_date && !todo.completed && new Date(todo.due_date) < new Date();
    const priorityColors = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
    const unreadCount = (typeof todo.history === 'string'
        ? JSON.parse(todo.history || '[]')
        : (todo.history || []))
        .filter(h => h.type === 'comment' && Array.isArray(h.unread_by) && h.unread_by.includes(currentUser?.username)).length;

    return `
        <div class="kanban-card ${isOverdue ? 'overdue' : ''} priority-${todo.priority || 'medium'}"
             data-id="${todo.id}"
             onclick="openTodoDetail('${todo.id}')">
            <div class="kanban-card-header">
                <div class="priority-dot" style="background:${priorityColors[todo.priority] || priorityColors.medium}"></div>
                ${todo.kpi_type ? `<span class="kpi-badge">${escapeHtml(todo.kpi_type)}</span>` : ''}
                ${unreadCount > 0 ? `<span class="unread-badge" title="${unreadCount} unread message${unreadCount > 1 ? 's' : ''}">💬 ${unreadCount}</span>` : ''}
            </div>
            <div class="kanban-card-title">${escapeHtml(todo.title || 'Untitled')}</div>
            ${todo.description ? `<div class="kanban-card-desc">${escapeHtml(todo.description.substring(0, 80))}${todo.description.length > 80 ? '...' : ''}</div>` : ''}
            <div class="kanban-card-footer">
                ${todo.assigned_to ? `<span class="assignee-badge" title="Assigned to ${todo.assigned_to}">👤 ${escapeHtml(todo.assigned_to)}</span>` : ''}
                ${todo.due_date ? `<span class="due-date ${isOverdue ? 'overdue-text' : ''}" title="Due ${new Date(todo.due_date).toLocaleDateString()}">📅 ${new Date(todo.due_date).toLocaleDateString()}</span>` : ''}
                ${todo.category ? `<span class="category-badge">${escapeHtml(todo.category)}</span>` : ''}
            </div>
            ${todo.approval_status === 'pending_approval' ? '<div class="approval-banner">⏳ Awaiting Approval</div>' : ''}
            ${todo.is_department_queue ? '<div class="queue-banner">📥 In Queue</div>' : ''}
        </div>
    `;
}

function renderTodosList() {
    const container = document.getElementById('todosList');
    if (!container) return;

    const filtered = getFilteredTodos();
    if (!filtered.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">✅</div>
                <div class="empty-title">No tasks found</div>
                <div class="empty-desc">Create a new task or adjust your filters.</div>
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(t => {
        const isOverdue = t.due_date && !t.completed && new Date(t.due_date) < new Date();
        return `
            <div class="todo-list-item ${t.completed ? 'completed' : ''} ${isOverdue ? 'overdue' : ''}"
                 data-id="${t.id}" onclick="openTodoDetail('${t.id}')">
                <div class="todo-check">
                    <input type="checkbox" ${t.completed ? 'checked' : ''}
                        onclick="event.stopPropagation(); quickToggleTodo('${t.id}', ${!t.completed})"
                        title="${t.completed ? 'Mark incomplete' : 'Mark complete'}">
                </div>
                <div class="todo-main">
                    <div class="todo-title">${escapeHtml(t.title || 'Untitled')}</div>
                    ${t.description ? `<div class="todo-desc">${escapeHtml(t.description.substring(0, 100))}</div>` : ''}
                </div>
                <div class="todo-meta">
                    ${t.category ? `<span class="category-badge-sm">${escapeHtml(t.category)}</span>` : ''}
                    ${t.kpi_type ? `<span class="kpi-badge-sm">${escapeHtml(t.kpi_type)}</span>` : ''}
                    <span class="priority-badge priority-${t.priority || 'medium'}">${(t.priority || 'medium')}</span>
                    ${t.due_date ? `<span class="due-badge ${isOverdue ? 'overdue' : ''}">📅 ${new Date(t.due_date).toLocaleDateString()}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function quickToggleTodo(todoId, completed) {
    const token = getStoredToken();
    if (!token) return;
    try {
        await todosAPI.toggleTodoComplete(todoId, completed, token);
        const todo = _allTodos.find(t => t.id === todoId);
        if (todo) {
            todo.completed = completed;
            todo.task_status = completed ? 'done' : 'todo';
        }
        renderTodosView();
        updateTodoCounters();
        showToast(completed ? 'Task completed! 🎉' : 'Task reopened', 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

function setTodosFilter(key, value) {
    _todosFilter[key] = value;
    renderTodosView();
    updateTodoCounters();
}

function searchTodos(term) {
    _todosFilter.search = term;
    renderTodosView();
}
