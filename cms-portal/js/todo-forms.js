// ================================================================
// todo-forms.js
// Task create/edit form handling + share/queue modals.
// Depends on: todos.js, todo-detail.js, ui-helpers.js, departments.js
// ================================================================

// ----------------------------------------------------------------
// CREATE / EDIT TODO MODAL
// ----------------------------------------------------------------
function openNewTodoModal() {
    _openTodoFormModal(null);
}

function openEditTodoModal(todoId) {
    const todo = _allTodos.find(t => t.id === todoId);
    _openTodoFormModal(todo);
}

async function _openTodoFormModal(todo = null) {
    const modal = document.getElementById('todoFormModal');
    if (!modal) return;

    document.getElementById('todoFormTitle').textContent = todo ? 'Edit Task' : 'New Task';
    document.getElementById('editingTodoId').value = todo?.id || '';

    document.getElementById('todoTitle').value = todo?.title || '';
    document.getElementById('todoDescription').value = todo?.description || '';
    document.getElementById('todoOurGoal').value = todo?.our_goal || '';
    document.getElementById('todoNotes').value = todo?.notes || '';
    document.getElementById('todoPriority').value = todo?.priority || 'medium';
    document.getElementById('todoCategory').value = todo?.category || '';
    document.getElementById('todoKpiType').value = todo?.kpi_type || '';
    document.getElementById('todoDueDate').value = todo?.due_date ? todo.due_date.substring(0, 10) : '';
    document.getElementById('todoPackage').value = todo?.package_name || '';
    document.getElementById('todoAppName').value = todo?.app_name || '';
    document.getElementById('todoTaskStatus').value = todo?.task_status || 'todo';

    // Populate category from departments
    await populateDepartmentDropdowns();

    // Load users for assignment select
    await populateUserSelectsInForm();

    if (todo?.assigned_to) {
        const assignedEl = document.getElementById('todoDirectAssignee');
        if (assignedEl) assignedEl.value = todo.assigned_to;
    }

    modal.classList.add('open');

    // Init searchable dropdowns inside form
    ['todoCategory', 'todoKpiType', 'todoPackage', 'todoAppName', 'todoDirectAssignee'].forEach(id => {
        try { makeSearchable(id); } catch { /* element may not exist */ }
    });
}

function closeTodoFormModal() {
    document.getElementById('todoFormModal')?.classList.remove('open');
}

async function saveTodoFromForm() {
    const token = getStoredToken();
    if (!token) return;

    const editingId = document.getElementById('editingTodoId').value;
    const todoData = {
        id: editingId || null,
        title: document.getElementById('todoTitle').value.trim(),
        description: document.getElementById('todoDescription').value.trim(),
        our_goal: document.getElementById('todoOurGoal').value.trim(),
        notes: document.getElementById('todoNotes').value.trim(),
        priority: document.getElementById('todoPriority').value,
        category: document.getElementById('todoCategory').value || null,
        kpi_type: document.getElementById('todoKpiType').value || null,
        due_date: document.getElementById('todoDueDate').value || null,
        package_name: document.getElementById('todoPackage').value || null,
        app_name: document.getElementById('todoAppName').value || null,
        task_status: document.getElementById('todoTaskStatus').value || 'todo',
        assigned_to: document.getElementById('todoDirectAssignee')?.value || null
    };

    if (!todoData.title) { showToast('Title is required', 'error'); return; }
    if (!todoData.kpi_type) { showToast("KPI Type is required", 'error'); return; }

    const btn = document.getElementById('saveTodoBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
        const saved = await todosAPI.saveTodo(todoData, token);
        closeTodoFormModal();
        showToast(editingId ? 'Task updated ✅' : 'Task created 🎉', 'success');

        // Update local cache
        if (editingId) {
            const idx = _allTodos.findIndex(t => t.id === editingId);
            if (idx >= 0) _allTodos[idx] = { ..._allTodos[idx], ...todoData };
        } else if (saved) {
            _allTodos.unshift({ ...todoData, ...saved, username: currentUser?.username });
        }

        renderTodosView();
        updateTodoCounters();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Task'; }
    }
}

// ----------------------------------------------------------------
// SHARE / ASSIGN MODAL
// ----------------------------------------------------------------
function openShareTodoModal(todoId) {
    const modal = document.getElementById('shareTodoModal');
    if (!modal) return;
    document.getElementById('shareTodoId').value = todoId;
    document.getElementById('shareUserSelect').value = '';
    document.getElementById('shareCanEdit').checked = false;
    modal.classList.add('open');
    populateUserSelectsInForm('shareUserSelect');
}

function closeShareTodoModal() {
    document.getElementById('shareTodoModal')?.classList.remove('open');
}

async function executeTodoShare() {
    const token = getStoredToken();
    if (!token) return;

    const todoId = document.getElementById('shareTodoId').value;
    const sharedWith = document.getElementById('shareUserSelect').value;
    const canEdit = document.getElementById('shareCanEdit')?.checked || false;

    if (!sharedWith) { showToast('Please select a user', 'error'); return; }

    const btn = document.getElementById('confirmShareBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sharing...'; }

    try {
        await todosAPI.shareTodo(todoId, sharedWith, canEdit, token);
        closeShareTodoModal();
        showToast(`Task assigned/shared with ${sharedWith}`, 'success');
        await loadTodos(true);
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Share / Assign'; }
    }
}

// ----------------------------------------------------------------
// QUEUE TO DEPARTMENT MODAL
// ----------------------------------------------------------------
function openQueueTodoModal(todoId) {
    const modal = document.getElementById('queueTodoModal');
    if (!modal) return;
    document.getElementById('queueTodoId').value = todoId;
    const deptSelect = document.getElementById('deptQueuePickerSelect');
    if (deptSelect) {
        const depts = getLatestDepartmentNames();
        deptSelect.innerHTML = '<option value="">Select Department...</option>'
            + depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
        makeSearchable(deptSelect);
    }
    modal.classList.add('open');
}

function closeQueueTodoModal() {
    document.getElementById('queueTodoModal')?.classList.remove('open');
}

async function executeQueueTask() {
    const token = getStoredToken();
    if (!token) return;

    const todoId = document.getElementById('queueTodoId').value;
    const department = document.getElementById('deptQueuePickerSelect').value;

    if (!department) { showToast('Please select a department', 'error'); return; }

    const btn = document.getElementById('confirmQueueBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Queuing...'; }

    try {
        const result = await directAPI.queueTaskToDepartment(todoId, department, token);
        closeQueueTodoModal();
        const msg = result.status === 'assigned'
            ? `Task auto-assigned to ${result.assignedTo} 🎉`
            : `Task added to ${department} queue 📥`;
        showToast(msg, 'success');
        await loadTodos(true);
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Send to Queue'; }
    }
}

// ----------------------------------------------------------------
// FORM HELPERS
// ----------------------------------------------------------------
async function populateDepartmentDropdowns() {
    const depts = getLatestDepartmentNames();
    const catEl = document.getElementById('todoCategory');
    if (!catEl) return;
    const curVal = catEl.value;
    catEl.innerHTML = '<option value="">Select Department...</option>'
        + depts.map(d => `<option value="${escapeHtml(d)}" ${d === curVal ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
}

async function populateUserSelectsInForm(specificSelectId = null) {
    const token = getStoredToken();
    if (!token) return;

    const users = window.allUsers || await usersAPI.getAllUsers(token).catch(() => []);
    window.allUsers = users;

    const updateSelect = (id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const curVal = el.value;
        el.innerHTML = '<option value="">Select User...</option>'
            + users.map(u =>
                `<option value="${escapeHtml(u.username)}" ${u.username === curVal ? 'selected' : ''}>${escapeHtml(u.username)}</option>`
            ).join('');
        if (curVal) el.value = curVal;
        makeSearchable(el);
    };

    if (specificSelectId) {
        updateSelect(specificSelectId);
    } else {
        ['todoDirectAssignee', 'shareUserSelect'].forEach(id => updateSelect(id));
    }
}
