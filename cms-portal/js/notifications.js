// ================================================================
// notifications.js
// Notification API — create, fetch, mark read, delete.
// Depends on: supabase-client.js, auth.js
// ================================================================

// Attached to directAPI object in api.js — exposed here as standalone
const notificationsAPI = {

    /**
     * Create a notification for a given user.
     * Non-critical — never throws; returns false on failure.
     * Super Managers only receive notifications for tasks directly involving them.
     */
    async createNotification(notificationData) {
        try {
            const targetUserId = notificationData.userId;
            if (targetUserId) {
                const client = getSupabase();
                const { data: targetUserData } = await client.from('users')
                    .select('role')
                    .eq('username', targetUserId)
                    .single();

                if (targetUserData && targetUserData.role === 'Super Manager') {
                    const meta = notificationData.metadata || {};
                    const todoId = meta.todoId || null;
                    if (todoId) {
                        const taskData = await directDB.select('todos', { id: todoId });
                        if (taskData && taskData.length > 0) {
                            const task = taskData[0];
                            const isDirectlyConnected =
                                task.assigned_to === targetUserId ||
                                task.username === targetUserId ||
                                task.completed_by === targetUserId;
                            if (!isDirectlyConnected) return false;
                        }
                    }
                }
            }

            const payload = {
                user_id: notificationData.userId,
                type: notificationData.type || 'info',
                title: notificationData.title || 'Notification',
                message: notificationData.message || '',
                link: notificationData.link || null,
                created_by: notificationData.createdBy || null,
                metadata: notificationData.metadata ? JSON.stringify(notificationData.metadata) : null,
                read: false
            };

            await directDB.upsert('notifications', payload);
            return true;
        } catch (error) {
            console.error('Error creating notification:', error);
            return false;
        }
    },

    /**
     * Fetch last 50 notifications for the authenticated user.
     */
    async getNotifications(token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        const client = getSupabase();
        const { data, error } = await client
            .from('notifications')
            .select('*')
            .eq('user_id', user.username)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw new Error(error.message);

        return (data || []).map(n => ({
            id: n.id,
            type: n.type,
            title: n.title,
            message: n.message,
            link: n.link,
            read: n.read,
            createdAt: n.created_at,
            createdBy: n.created_by,
            metadata: n.metadata
                ? (typeof n.metadata === 'string' ? JSON.parse(n.metadata) : n.metadata)
                : null
        }));
    },

    async markNotificationAsRead(notificationId, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        await directDB.update('notifications', { read: true }, {
            id: notificationId,
            user_id: user.username
        });
        return true;
    },

    async markAllNotificationsAsRead(token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        const client = getSupabase();
        const { error } = await client
            .from('notifications')
            .update({ read: true })
            .eq('user_id', user.username)
            .eq('read', false);

        if (error) throw new Error(error.message);
        return true;
    },

    async deleteNotification(notificationId, token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');
        await directDB.delete('notifications', { id: notificationId, user_id: user.username });
        return true;
    },

    async getUnreadNotificationCount(token) {
        const user = await directAPI.validateToken(token);
        if (!user) throw new Error('Unauthorized');

        const client = getSupabase();
        const { count, error } = await client
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.username)
            .eq('read', false);

        if (error) throw new Error(error.message);
        return count || 0;
    }
};

// ----------------------------------------------------------------
// NOTIFICATION BELL UI
// ----------------------------------------------------------------
let _notificationPollInterval = null;

async function loadNotificationCount() {
    const token = getStoredToken();
    if (!token) return;
    try {
        const count = await notificationsAPI.getUnreadNotificationCount(token);
        updateNotificationBadge(count);
    } catch (e) { /* silent */ }
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notificationBadge');
    const badgeMobile = document.getElementById('notificationBadgeMobile');
    [badge, badgeMobile].forEach(el => {
        if (!el) return;
        if (count > 0) {
            el.textContent = count > 99 ? '99+' : count;
            el.style.display = 'flex';
        } else {
            el.style.display = 'none';
        }
    });
}

function startNotificationPolling(intervalMs = 60000) {
    loadNotificationCount();
    if (_notificationPollInterval) clearInterval(_notificationPollInterval);
    _notificationPollInterval = setInterval(loadNotificationCount, intervalMs);
}

function stopNotificationPolling() {
    if (_notificationPollInterval) {
        clearInterval(_notificationPollInterval);
        _notificationPollInterval = null;
    }
}

async function openNotificationsPanel() {
    const panel = document.getElementById('notificationsPanel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
        await renderNotifications();
    }
}

async function renderNotifications() {
    const token = getStoredToken();
    if (!token) return;

    const list = document.getElementById('notificationsList');
    if (!list) return;

    list.innerHTML = '<div class="loading-spinner">Loading...</div>';

    try {
        const notifications = await notificationsAPI.getNotifications(token);
        if (!notifications.length) {
            list.innerHTML = '<div class="empty-state" style="padding:32px;text-align:center;color:var(--text-muted);">No notifications</div>';
            return;
        }

        list.innerHTML = notifications.map(n => `
            <div class="notification-item ${n.read ? '' : 'unread'}" data-id="${n.id}" onclick="handleNotificationClick('${n.id}', '${n.link || ''}')">
                <div class="notification-icon">${getNotificationIcon(n.type)}</div>
                <div class="notification-body">
                    <div class="notification-title">${escapeHtml(n.title)}</div>
                    <div class="notification-message">${escapeHtml(n.message)}</div>
                    <div class="notification-time">${formatRelativeTime(n.createdAt)}</div>
                </div>
                <button class="notification-dismiss" onclick="event.stopPropagation(); dismissNotification('${n.id}')" title="Dismiss">✕</button>
            </div>
        `).join('');

        updateNotificationBadge(notifications.filter(n => !n.read).length);
    } catch (e) {
        list.innerHTML = `<div class="error-state" style="padding:24px;">${e.message}</div>`;
    }
}

function getNotificationIcon(type) {
    const icons = {
        task_assigned: '📋', task_shared: '🔗', access_granted: '🔓',
        team_update: '👥', message: '💬', queue_task: '📥', info: 'ℹ️'
    };
    return icons[type] || 'ℹ️';
}

async function handleNotificationClick(notificationId, link) {
    const token = getStoredToken();
    if (token) {
        notificationsAPI.markNotificationAsRead(notificationId, token).catch(() => {});
    }
    document.querySelector(`[data-id="${notificationId}"]`)?.classList.remove('unread');

    // Navigate if there's a link
    if (link && link.startsWith('todo:')) {
        const todoId = link.replace('todo:', '');
        openTodoDetail(todoId);
        document.getElementById('notificationsPanel')?.classList.remove('open');
    }
}

async function dismissNotification(notificationId) {
    const token = getStoredToken();
    if (!token) return;
    try {
        await notificationsAPI.deleteNotification(notificationId, token);
        document.querySelector(`[data-id="${notificationId}"]`)?.remove();
        await loadNotificationCount();
    } catch (e) {
        showToast('Could not dismiss notification', 'error');
    }
}

async function markAllRead() {
    const token = getStoredToken();
    if (!token) return;
    try {
        await notificationsAPI.markAllNotificationsAsRead(token);
        document.querySelectorAll('.notification-item.unread').forEach(el => el.classList.remove('unread'));
        updateNotificationBadge(0);
    } catch (e) {
        showToast('Could not mark all as read', 'error');
    }
}

// Helpers
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
}

function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
