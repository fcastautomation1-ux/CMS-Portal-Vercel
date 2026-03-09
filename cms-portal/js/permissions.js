/* ================================================================
   permissions.js  —  Permission helpers used across all modules
   parseAllowed, role checks, department helpers, team lookups
   ================================================================ */

'use strict';

// ── ROLE CHECK HELPERS ────────────────────────────────────────────

/**
 * True if the user has any administrative/manager role.
 */
function isAdmin(user) {
    if (!user) return false;
    return user.username === 'admin' || user.role === 'Admin';
}

function isSuperManager(user) {
    if (!user) return false;
    return user.role === 'Super Manager';
}

function isManager(user) {
    if (!user) return false;
    return user.role === 'Manager' || isSuperManager(user) || isAdmin(user);
}

function isPrivilegedUser(user) {
    return isManager(user);
}

/** Expose to global scope */
window.isAdmin           = isAdmin;
window.isSuperManager    = isSuperManager;
window.isManager         = isManager;
window.isPrivilegedUser  = isPrivilegedUser;

// ── ACCOUNT ACCESS ────────────────────────────────────────────────

/**
 * Parse allowed_accounts string into an array of IDs.
 * Returns ['*'] for full access, [] for no access.
 * @param {string} str   - DB field value
 * @param {string} role  - user role
 * @param {string} username - user username
 */
function parseAllowed(str, role, username) {
    if (username === 'admin' || role === 'Admin' || role === 'Super Manager') return ['*'];
    if (str === 'All') return ['*'];
    if (!str || str.trim() === '') return [];
    return str.split(',').map(s => s.trim()).filter(s => s);
}

/**
 * Returns true if user can access a given account or campaign ID.
 */
function canAccessAccount(user, accountId) {
    if (!user) return false;
    const allowed = user.allowedAccounts || [];
    return allowed.includes('*') || allowed.includes(accountId);
}

window.parseAllowed    = parseAllowed;
window.canAccessAccount = canAccessAccount;

// ── MANAGER / TEAM HELPERS ────────────────────────────────────────

/**
 * True if usernameToCheck appears in managerIdField
 * (comma-separated list of manager usernames).
 */
function isUserInManagerList(managerIdField, usernameToCheck) {
    if (!managerIdField || !usernameToCheck) return false;
    const managers = managerIdField.split(',').map(m => m.trim().toLowerCase());
    return managers.includes(usernameToCheck.toLowerCase());
}

/**
 * Returns all team members for `username` by combining:
 *   1. Users who have `username` in their manager_id
 *   2. Users listed in `username`'s team_members field
 */
function resolveTeamMembers(username, allUsers) {
    const usernameLower = (username || '').toLowerCase();
    const team = new Set();

    const myRow = (allUsers || []).find(u => (u.username || '').toLowerCase() === usernameLower);
    const explicitMembers = (myRow?.team_members || '').split(',').map(s => s.trim()).filter(Boolean);
    explicitMembers.forEach(m => team.add(m.toLowerCase()));

    (allUsers || []).forEach(u => {
        if (!u.manager_id) return;
        const managers = u.manager_id.split(',').map(m => m.trim().toLowerCase());
        if (managers.includes(usernameLower)) team.add((u.username || '').toLowerCase());
    });

    team.delete(usernameLower); // exclude self
    return [...team];
}

window.isUserInManagerList = isUserInManagerList;
window.resolveTeamMembers  = resolveTeamMembers;

// ── DEPARTMENT HELPERS ────────────────────────────────────────────

function normalizeDepartmentName(value) {
    const raw = (value || '').toString().toLowerCase().trim();
    if (!raw) return '';
    return raw
        .replace(/[`']/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^apps?\s+/, '')
        .replace(/\s+apps?$/, '')
        .trim();
}

function splitDepartmentValues(value) {
    if (!value) return [];
    return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function userBelongsToDepartment(userOrDeptStr, departmentName) {
    const target = normalizeDepartmentName(departmentName);
    if (!target) return false;
    const raw = (typeof userOrDeptStr === 'object' && userOrDeptStr !== null)
        ? (userOrDeptStr.department || '')
        : userOrDeptStr;
    return splitDepartmentValues(raw).some(d => normalizeDepartmentName(d) === target);
}

function getPrimaryDepartmentForUsername(username) {
    const uLower = (username || '').toLowerCase().trim();
    if (!uLower) return '';
    const row = (window.allUsers || []).find(u => (u.username || '').toLowerCase() === uLower);
    if (!row) return '';
    const parts = splitDepartmentValues(row.department || '');
    return parts[0] || '';
}

function isQueuedTaskForDepartmentUser(task, username) {
    if (!task || task.queue_status !== 'queued' || task.completed || task.archived) return false;
    const qDept = normalizeDepartmentName(task.queue_department);
    if (!qDept) return false;
    const userDept = getPrimaryDepartmentForUsername(username) ||
        ((username || '').toLowerCase() === (window.currentUser?.username || '').toLowerCase()
            ? (window.currentUser?.department || '') : '');
    return qDept === normalizeDepartmentName(userDept);
}

/**
 * Returns a deduplicated, sorted array of department names
 * using official departments table first, then users as fallback.
 */
function getLatestDepartmentNames() {
    const canonicalByNorm = new Map();

    const addNames = (values, isOfficial = false) => {
        (values || []).forEach(rawValue => {
            splitDepartmentValues(rawValue).forEach(name => {
                const clean = (name || '').toString().trim();
                if (!clean) return;
                const norm = normalizeDepartmentName(clean);
                if (!norm) return;
                const existing = canonicalByNorm.get(norm);
                if (!existing) {
                    canonicalByNorm.set(norm, { name: clean, official: !!isOfficial });
                    return;
                }
                if (isOfficial && !existing.official) {
                    canonicalByNorm.set(norm, { name: clean, official: true });
                }
            });
        });
    };

    const deptCacheRows = (window.departmentsCache?.data || []);
    addNames(deptCacheRows.map(d => (d && typeof d === 'object') ? (d.name || '') : d), true);

    if (canonicalByNorm.size === 0) {
        addNames((window.allUsers || []).map(u => u?.department || ''), false);
    }

    return Array.from(canonicalByNorm.values())
        .map(v => v.name)
        .sort((a, b) => a.localeCompare(b));
}

window.normalizeDepartmentName        = normalizeDepartmentName;
window.splitDepartmentValues          = splitDepartmentValues;
window.userBelongsToDepartment        = userBelongsToDepartment;
window.getPrimaryDepartmentForUsername = getPrimaryDepartmentForUsername;
window.isQueuedTaskForDepartmentUser  = isQueuedTaskForDepartmentUser;
window.getLatestDepartmentNames       = getLatestDepartmentNames;

// ── MODULE ACCESS (Managers) ──────────────────────────────────────

/**
 * Parse a user's module_access JSON field.
 * Returns {} on error.
 */
function parseModuleAccess(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * Check if a user has a specific module enabled.
 * e.g. checkModuleAccess(user, 'accounts')
 */
function checkModuleAccess(user, moduleName) {
    if (!user) return false;
    // Admins / Super Managers always have access
    if (isAdmin(user) || isSuperManager(user)) return true;

    const ma = parseModuleAccess(user.moduleAccess || user.module_access);
    if (!ma || !ma[moduleName]) return false;
    return ma[moduleName].enabled === true;
}

window.parseModuleAccess  = parseModuleAccess;
window.checkModuleAccess  = checkModuleAccess;

// ── MULTI-ASSIGNMENT HELPERS ──────────────────────────────────────

/**
 * Parse multi_assignment JSON from a task row.
 * Returns null if not present or invalid.
 */
function parseMultiAssignment(task) {
    if (!task || !task.multi_assignment) return null;
    try {
        const ma = typeof task.multi_assignment === 'string'
            ? JSON.parse(task.multi_assignment)
            : task.multi_assignment;
        if (!ma || !ma.enabled) return null;
        return ma;
    } catch { return null; }
}

/**
 * Parse assignment_chain JSON from a task row.
 */
function parseAssignmentChain(task) {
    if (!task || !task.assignment_chain) return [];
    try {
        const chain = typeof task.assignment_chain === 'string'
            ? JSON.parse(task.assignment_chain)
            : task.assignment_chain;
        return Array.isArray(chain) ? chain : [];
    } catch { return []; }
}

/**
 * Returns the approval status for a specific user in the assignment chain.
 */
function getChainStatusForUser(chain, username) {
    const entry = chain.find(e => (e.user || '').toLowerCase() === (username || '').toLowerCase());
    return entry ? (entry.review_status || 'pending') : null;
}

/**
 * True if current user is one of the multi-assignees.
 */
function isMultiAssignee(task, username) {
    const ma = parseMultiAssignment(task);
    if (!ma) return false;
    return (ma.assignees || []).some(a =>
        (a.username || '').toLowerCase() === (username || '').toLowerCase()
    );
}

window.parseMultiAssignment   = parseMultiAssignment;
window.parseAssignmentChain   = parseAssignmentChain;
window.getChainStatusForUser  = getChainStatusForUser;
window.isMultiAssignee        = isMultiAssignee;

// ── TASK VISIBILITY ───────────────────────────────────────────────

/**
 * Returns true if a task should be visible to the given user.
 * Used for client-side filtering (server already filters on fetch).
 */
function isTaskVisibleToUser(task, user) {
    if (!task || !user) return false;

    const uLower = user.username.toLowerCase();
    const isPriv = isAdmin(user) || isSuperManager(user);
    if (isPriv) return true;

    // Own tasks
    if ((task.username || '').toLowerCase() === uLower) return true;
    // Assigned
    if ((task.assigned_to || '').toLowerCase() === uLower) return true;
    // Completed by
    if ((task.completed_by || '').toLowerCase() === uLower) return true;
    // Multi-assignee
    if (isMultiAssignee(task, user.username)) return true;
    // Department queue
    if (isQueuedTaskForDepartmentUser(task, user.username)) return true;

    return false;
}

window.isTaskVisibleToUser = isTaskVisibleToUser;
