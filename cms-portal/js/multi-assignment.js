/* ================================================================
   multi-assignment.js  —  Sequential / parallel task assignment,
   approval chains, approval/decline flows
   ================================================================ */

'use strict';

// ── MULTI-ASSIGNMENT STATE ────────────────────────────────────────
// Approval status constants
const MA_STATUS = {
    PENDING:   'pending',
    ACCEPTED:  'accepted',
    COMPLETED: 'completed',
    REJECTED:  'rejected'
};

const CHAIN_STATUS = {
    PENDING:  'pending',
    APPROVED: 'approved',
    DECLINED: 'declined'
};

// ── API ───────────────────────────────────────────────────────────
const MultiAssignmentAPI = {

    /**
     * Assign a task to multiple users in sequence.
     * Creates multi_assignment + assignment_chain in one go.
     *
     * @param {string}   taskId
     * @param {string[]} assigneeUsernames - in order
     * @param {string}   managerUsername   - the person creating the chain
     */
    async createChain(taskId, assigneeUsernames, managerUsername) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');

        const now = new Date().toISOString();

        const assignees = assigneeUsernames.map(u => ({
            username: u,
            status: MA_STATUS.PENDING,
            assigned_at: now,
            accepted_at: null,
            completed_at: null
        }));

        const chain = assigneeUsernames.map(u => ({
            user: u,
            review_status: CHAIN_STATUS.PENDING,
            reviewed_at: null,
            reviewed_by: null,
            note: null
        }));

        const multiAssignment = {
            enabled: true,
            assignees,
            created_by: managerUsername,
            created_at: now
        };

        const { error } = await client
            .from('todos')
            .update({
                multi_assignment: JSON.stringify(multiAssignment),
                assignment_chain: JSON.stringify(chain),
                assigned_to: assigneeUsernames[0] || null, // first in chain
                updated_at: now
            })
            .eq('id', taskId);

        if (error) throw new Error(error.message);

        // Notify all assignees
        for (const u of assigneeUsernames) {
            try {
                await createNotification({
                    userId: u,
                    type: 'task_assigned',
                    title: 'Task Assigned to You',
                    message: `${managerUsername} added you to a multi-user task chain.`,
                    createdBy: managerUsername,
                    metadata: { todoId: taskId }
                });
            } catch { /* notifications are non-critical */ }
        }

        return true;
    },

    /**
     * Accept a task assignment (current user accepts their slot in the chain).
     */
    async acceptAssignment(task, username) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');

        const ma = parseMultiAssignment(task);
        if (!ma) throw new Error('No multi-assignment on this task');

        const now = new Date().toISOString();

        // Update assignee status in multi_assignment
        const updatedAssignees = (ma.assignees || []).map(a => {
            if ((a.username || '').toLowerCase() !== username.toLowerCase()) return a;
            return { ...a, status: MA_STATUS.ACCEPTED, accepted_at: now };
        });

        const updatedMa = { ...ma, assignees: updatedAssignees };

        // Update assignment_chain entry
        const chain = parseAssignmentChain(task);
        const updatedChain = chain.map(entry => {
            if ((entry.user || '').toLowerCase() !== username.toLowerCase()) return entry;
            if (entry.review_status === CHAIN_STATUS.APPROVED) return entry; // already done
            return { ...entry, review_status: CHAIN_STATUS.APPROVED, reviewed_at: now, reviewed_by: username };
        });

        const { error } = await client
            .from('todos')
            .update({
                multi_assignment: JSON.stringify(updatedMa),
                assignment_chain: JSON.stringify(updatedChain),
                updated_at: now
            })
            .eq('id', task.id);

        if (error) throw new Error(error.message);

        // Notify task creator
        try {
            await createNotification({
                userId: task.username,
                type: 'task_update',
                title: 'Assignment Accepted',
                message: `${username} accepted their task assignment.`,
                createdBy: username,
                metadata: { todoId: task.id }
            });
        } catch { /* non-critical */ }

        return true;
    },

    /**
     * Mark an assignee's portion as completed.
     */
    async completeAssignment(task, username) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');

        const ma = parseMultiAssignment(task);
        if (!ma) throw new Error('No multi-assignment on this task');

        const now = new Date().toISOString();

        const updatedAssignees = (ma.assignees || []).map(a => {
            if ((a.username || '').toLowerCase() !== username.toLowerCase()) return a;
            return { ...a, status: MA_STATUS.COMPLETED, completed_at: now };
        });

        const updatedMa = { ...ma, assignees: updatedAssignees };

        // Check if ALL assignees completed → mark whole task done
        const allDone = updatedAssignees.every(a =>
            a.status === MA_STATUS.COMPLETED || a.status === MA_STATUS.REJECTED
        );

        const updatePayload = {
            multi_assignment: JSON.stringify(updatedMa),
            updated_at: now
        };

        if (allDone) {
            updatePayload.completed    = true;
            updatePayload.completed_by = username;
            updatePayload.completed_at = now;
            updatePayload.task_status  = 'done';
        } else {
            // Move to next assignee
            const myIndex = (ma.assignees || []).findIndex(a =>
                (a.username || '').toLowerCase() === username.toLowerCase()
            );
            const nextAssignee = (ma.assignees || [])[myIndex + 1];
            if (nextAssignee) {
                updatePayload.assigned_to      = nextAssignee.username;
                updatePayload.approval_status  = 'pending_approval';
            }
        }

        const { error } = await client
            .from('todos')
            .update(updatePayload)
            .eq('id', task.id);

        if (error) throw new Error(error.message);

        // Notify creator about progress
        try {
            await createNotification({
                userId: task.username,
                type: 'task_update',
                title: allDone ? 'Task Fully Completed' : 'Assignment Step Done',
                message: allDone
                    ? `All assignees completed the task.`
                    : `${username} completed their assignment step.`,
                createdBy: username,
                metadata: { todoId: task.id }
            });
        } catch { /* non-critical */ }

        return { allDone };
    },

    /**
     * Reject / decline an assignment (creator gets to reassign or close).
     */
    async declineAssignment(task, username, reason) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');

        const ma = parseMultiAssignment(task);
        if (!ma) throw new Error('No multi-assignment');

        const now = new Date().toISOString();

        const updatedAssignees = (ma.assignees || []).map(a => {
            if ((a.username || '').toLowerCase() !== username.toLowerCase()) return a;
            return { ...a, status: MA_STATUS.REJECTED };
        });
        const updatedMa = { ...ma, assignees: updatedAssignees };

        const chain = parseAssignmentChain(task);
        const updatedChain = chain.map(entry => {
            if ((entry.user || '').toLowerCase() !== username.toLowerCase()) return entry;
            return {
                ...entry,
                review_status: CHAIN_STATUS.DECLINED,
                reviewed_at: now,
                reviewed_by: username,
                note: reason || null
            };
        });

        const { error } = await client
            .from('todos')
            .update({
                multi_assignment:  JSON.stringify(updatedMa),
                assignment_chain:  JSON.stringify(updatedChain),
                declined_by:       username,
                declined_at:       now,
                decline_reason:    reason || null,
                approval_status:   'declined',
                assigned_to:       task.username, // return to creator
                updated_at:        now
            })
            .eq('id', task.id);

        if (error) throw new Error(error.message);

        try {
            await createNotification({
                userId: task.username,
                type: 'task_declined',
                title: 'Assignment Declined',
                message: `${username} declined their assignment${reason ? ': ' + reason : ''}.`,
                createdBy: username,
                metadata: { todoId: task.id }
            });
        } catch { /* non-critical */ }

        return true;
    }
};

window.MultiAssignmentAPI = MultiAssignmentAPI;

// ── APPROVAL FLOW (single-assignee) ──────────────────────────────

/**
 * When an assignee marks a task as done, it goes into
 * "pending_approval" → creator must approve or decline.
 */
const ApprovalAPI = {

    async requestApproval(task, completedByUsername) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');

        const now = new Date().toISOString();
        const { error } = await client
            .from('todos')
            .update({
                approval_status: 'pending_approval',
                completed:       false,       // not fully done yet — awaits approval
                completed_by:    completedByUsername,
                completed_at:    null,
                task_status:     'in_progress',
                updated_at:      now
            })
            .eq('id', task.id);

        if (error) throw new Error(error.message);

        // Notify creator
        try {
            await createNotification({
                userId: task.username,
                type: 'task_update',
                title: 'Task Pending Your Approval',
                message: `${completedByUsername} marked task "${task.title || task.text}" as done. Please review.`,
                createdBy: completedByUsername,
                metadata: { todoId: task.id }
            });
        } catch { /* non-critical */ }

        return true;
    },

    async approve(task, approvedByUsername) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');

        const now = new Date().toISOString();
        const { error } = await client
            .from('todos')
            .update({
                approval_status: 'approved',
                approved_by:     approvedByUsername,
                approved_at:     now,
                completed:       true,
                completed_at:    now,
                task_status:     'done',
                assigned_to:     task.completed_by || task.assigned_to,
                updated_at:      now
            })
            .eq('id', task.id);

        if (error) throw new Error(error.message);

        // Notify assignee
        const notifyUser = task.completed_by || task.assigned_to;
        if (notifyUser && notifyUser !== approvedByUsername) {
            try {
                await createNotification({
                    userId: notifyUser,
                    type: 'task_approved',
                    title: 'Task Approved ✅',
                    message: `${approvedByUsername} approved your submitted task.`,
                    createdBy: approvedByUsername,
                    metadata: { todoId: task.id }
                });
            } catch { /* non-critical */ }
        }

        return true;
    },

    async decline(task, declinedByUsername, reason) {
        const client = getSupabase();
        if (!client) throw new Error('Supabase not configured');

        const now = new Date().toISOString();
        const { error } = await client
            .from('todos')
            .update({
                approval_status: 'declined',
                declined_by:     declinedByUsername,
                declined_at:     now,
                decline_reason:  reason || null,
                completed:       false,
                task_status:     'todo',
                assigned_to:     task.completed_by || task.assigned_to,
                updated_at:      now
            })
            .eq('id', task.id);

        if (error) throw new Error(error.message);

        // Notify assignee
        const notifyUser = task.completed_by || task.assigned_to;
        if (notifyUser && notifyUser !== declinedByUsername) {
            try {
                await createNotification({
                    userId: notifyUser,
                    type: 'task_declined',
                    title: 'Task Declined ❌',
                    message: `${declinedByUsername} declined your submission${reason ? ': ' + reason : ''}.`,
                    createdBy: declinedByUsername,
                    metadata: { todoId: task.id }
                });
            } catch { /* non-critical */ }
        }

        return true;
    }
};

window.ApprovalAPI = ApprovalAPI;

// ── UI HELPERS ────────────────────────────────────────────────────

/**
 * Render the multi-assignment chain indicator inside a task card.
 */
function renderChainBadge(task) {
    const ma = parseMultiAssignment(task);
    if (!ma) return '';

    const assignees = ma.assignees || [];
    const chain     = parseAssignmentChain(task);
    const total     = assignees.length;
    const done      = assignees.filter(a => a.status === MA_STATUS.COMPLETED).length;

    const dots = assignees.map(a => {
        let color = '#94a3b8'; // pending
        if (a.status === MA_STATUS.COMPLETED) color = '#22c55e';
        if (a.status === MA_STATUS.REJECTED)  color = '#ef4444';
        if (a.status === MA_STATUS.ACCEPTED)  color = '#f59e0b';
        return `<span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;margin:0 2px"></span>`;
    }).join('');

    return `
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
            <span style="font-size:.7rem;color:var(--text-muted)">Chain:</span>
            ${dots}
            <span style="font-size:.7rem;color:var(--text-muted)">${done}/${total}</span>
        </div>`;
}

/**
 * Render full chain view for task detail modal.
 */
function renderChainDetails(task) {
    const ma = parseMultiAssignment(task);
    if (!ma) {
        // Check simple approval pending
        if (task.approval_status === 'pending_approval') {
            return `
                <div class="approval-banner" style="padding:12px 14px;border-radius:10px;margin-bottom:12px">
                    ⏳ Awaiting approval from <strong>${task.username || 'creator'}</strong>
                    ${task.completed_by ? ` — submitted by <strong>${task.completed_by}</strong>` : ''}
                </div>`;
        }
        if (task.approval_status === 'declined') {
            return `
                <div style="padding:12px 14px;border-radius:10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);color:#ef4444;margin-bottom:12px">
                    ❌ Declined by <strong>${task.declined_by || '?'}</strong>
                    ${task.decline_reason ? ` — "${task.decline_reason}"` : ''}
                </div>`;
        }
        return '';
    }

    const assignees = ma.assignees || [];
    const chain     = parseAssignmentChain(task);

    const rows = assignees.map((a, idx) => {
        const chainEntry = chain[idx] || {};
        const statusIcon = {
            [MA_STATUS.PENDING]:   '⏳',
            [MA_STATUS.ACCEPTED]:  '✅',
            [MA_STATUS.COMPLETED]: '🎯',
            [MA_STATUS.REJECTED]:  '❌'
        }[a.status] || '⏳';

        const statusColor = {
            [MA_STATUS.PENDING]:   'var(--text-muted)',
            [MA_STATUS.ACCEPTED]:  '#f59e0b',
            [MA_STATUS.COMPLETED]: '#22c55e',
            [MA_STATUS.REJECTED]:  '#ef4444'
        }[a.status] || 'var(--text-muted)';

        const note = chainEntry.note ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:3px">"${chainEntry.note}"</div>` : '';

        return `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:var(--bg-elevated);border-radius:10px;border:1px solid var(--border);margin-bottom:6px">
                <div style="font-size:1.1rem;flex-shrink:0">${statusIcon}</div>
                <div style="flex:1;min-width:0">
                    <div style="font-size:.85rem;font-weight:700;color:var(--text-primary)">${a.username}</div>
                    <div style="font-size:.76rem;color:${statusColor};font-weight:600">${a.status.toUpperCase()}</div>
                    ${a.completed_at ? `<div style="font-size:.7rem;color:var(--text-muted)">Done: ${new Date(a.completed_at).toLocaleDateString()}</div>` : ''}
                    ${note}
                </div>
                <div style="font-size:.7rem;color:var(--text-muted);text-align:right">Step ${idx + 1}</div>
            </div>`;
    }).join('');

    return `
        <div style="margin-bottom:16px">
            <div class="detail-section-title" style="margin-bottom:8px">📋 Assignment Chain</div>
            ${rows}
        </div>`;
}

window.renderChainBadge   = renderChainBadge;
window.renderChainDetails = renderChainDetails;

// ── APPROVE / DECLINE MODAL ───────────────────────────────────────

window.showApproveDeclineModal = function(task) {
    const me = window.currentUser;
    if (!me) return;

    const modal = document.getElementById('approveDeclineModal');
    const body  = document.getElementById('approveDeclineBody');
    if (!modal || !body) return;

    body.innerHTML = `
        <div style="text-align:center;margin-bottom:20px">
            <div style="font-size:2rem;margin-bottom:8px">🔍</div>
            <div style="font-size:.9rem;color:var(--text-secondary)">
                <strong>${task.completed_by || task.assigned_to || '?'}</strong> submitted this task for your review.
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">Note (optional)</label>
            <textarea id="approvalNote" class="form-control" placeholder="Feedback or reason…" rows="3"></textarea>
        </div>
        <div class="modal-footer" style="padding:0;border:none;margin-top:20px">
            <button class="btn btn-danger" onclick="handleDeclineTask(${JSON.stringify(task.id)})">❌ Decline</button>
            <button class="btn btn-success" onclick="handleApproveTask(${JSON.stringify(task.id)})">✅ Approve</button>
        </div>`;

    window._approvalTask = task;
    openModal('approveDeclineModal');
};

window.handleApproveTask = async function(taskId) {
    const task = window._approvalTask;
    if (!task || task.id !== taskId) return;
    const me = window.currentUser;
    if (!me) return;

    try {
        await ApprovalAPI.approve(task, me.username);
        showToast('Task approved ✅', 'success');
        closeModal('approveDeclineModal');
        if (window.loadTodos) await window.loadTodos();
    } catch(e) {
        showToast('Error: ' + e.message, 'error');
    }
};

window.handleDeclineTask = async function(taskId) {
    const task = window._approvalTask;
    if (!task || task.id !== taskId) return;
    const me = window.currentUser;
    if (!me) return;

    const reason = document.getElementById('approvalNote')?.value?.trim() || '';
    try {
        await ApprovalAPI.decline(task, me.username, reason);
        showToast('Task declined', 'warning');
        closeModal('approveDeclineModal');
        if (window.loadTodos) await window.loadTodos();
    } catch(e) {
        showToast('Error: ' + e.message, 'error');
    }
};

// ── HISTORICAL BACKFILL (run as admin once) ───────────────────────
const MA_CHAIN_BACKFILL_VERSION = '2026-03-04-v1';
let _maChainBackfillRunning = false;

window.queueHistoricalMaChainBackfill = async function() {
    const me = window.currentUser;
    if (!me) return;
    const isAllowed = me.username === 'admin' || me.role === 'Admin' || me.role === 'Super Manager';
    if (!isAllowed) return;

    const doneKey = `ma_chain_backfill_done_${MA_CHAIN_BACKFILL_VERSION}`;
    if (localStorage.getItem(doneKey) === '1') return;

    setTimeout(() => _runMaChainBackfill(), 5000);
};

async function _runMaChainBackfill() {
    if (_maChainBackfillRunning) return;
    _maChainBackfillRunning = true;

    const client = getSupabase();
    if (!client) { _maChainBackfillRunning = false; return; }

    const nowIso = new Date().toISOString();
    let scanned = 0, updated = 0;

    try {
        let from = 0;
        const pageSize = 200;

        while (true) {
            const { data: rows, error } = await client
                .from('todos')
                .select('id, multi_assignment, assignment_chain')
                .not('multi_assignment', 'is', null)
                .range(from, from + pageSize - 1);

            if (error || !rows || rows.length === 0) break;
            scanned += rows.length;

            const updates = [];
            for (const row of rows) {
                const ma    = parseMultiAssignment(row);
                const chain = parseAssignmentChain(row);
                if (!ma?.enabled || !chain.length) continue;

                const assigneeMap = {};
                (ma.assignees || []).forEach(a => {
                    assigneeMap[(a.username || '').toLowerCase()] = a;
                });

                let changed = false;
                const nextChain = chain.map(entry => {
                    const current = (entry.review_status || '').toLowerCase();
                    if (current === CHAIN_STATUS.APPROVED || current === CHAIN_STATUS.DECLINED) return entry;

                    const uname = (entry.user || '').toLowerCase();
                    const m = assigneeMap[uname];
                    if (!m) return entry;

                    if (m.status === MA_STATUS.ACCEPTED || m.status === MA_STATUS.COMPLETED) {
                        changed = true;
                        return { ...entry, review_status: CHAIN_STATUS.APPROVED, reviewed_at: m.accepted_at || nowIso };
                    }
                    if (m.status === MA_STATUS.REJECTED) {
                        changed = true;
                        return { ...entry, review_status: CHAIN_STATUS.DECLINED, reviewed_at: nowIso };
                    }
                    return entry;
                });

                if (changed) updates.push({ id: row.id, chain: nextChain });
            }

            for (let i = 0; i < updates.length; i += 15) {
                await Promise.all(updates.slice(i, i + 15).map(u =>
                    client.from('todos').update({ assignment_chain: JSON.stringify(u.chain), updated_at: nowIso }).eq('id', u.id)
                ));
                updated += Math.min(15, updates.length - i);
            }

            from += rows.length;
            if (rows.length < pageSize) break;
        }

        localStorage.setItem(`ma_chain_backfill_done_${MA_CHAIN_BACKFILL_VERSION}`, '1');
        if (updated > 0) showToast(`Chain backfill complete: ${updated} tasks synced`, 'success');
    } catch(e) {
        console.warn('MA chain backfill failed:', e.message);
    } finally {
        _maChainBackfillRunning = false;
    }
}
