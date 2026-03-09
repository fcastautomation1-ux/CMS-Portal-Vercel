// ================================================================
// auth.js
// Authentication: login, logout, token generation/parsing,
// password hashing (SHA-256 + salt), and auto-upgrade from plaintext.
// Depends on: supabase-client.js, config.js
// ================================================================

// ── PASSWORD HASHING ─────────────────────────────────────────────
// Salt prefix matches original Google Apps Script portal convention.
const _HASH_PREFIX = 'GASv1_';

/**
 * Hash a password using SHA-256 with our fixed salt prefix.
 * Returns hex string.
 */
async function hashPassword(plaintext) {
    const salted = _HASH_PREFIX + plaintext;
    const encoder = new TextEncoder();
    const data = encoder.encode(salted);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Verify a plaintext password against a stored hash.
 * Handles both hashed (hex 64-char) and legacy plaintext passwords.
 * @returns {{ match: boolean, needsUpgrade: boolean }}
 */
async function verifyPassword(plaintext, storedValue) {
    if (!storedValue || !plaintext) return { match: false, needsUpgrade: false };

    // If stored value looks like a SHA-256 hex hash (64 hex chars)
    if (/^[0-9a-f]{64}$/.test(storedValue)) {
        const hashed = await hashPassword(plaintext);
        return { match: hashed === storedValue, needsUpgrade: false };
    }

    // Legacy: stored as plaintext — compare directly, flag for upgrade
    const match = plaintext === storedValue;
    return { match, needsUpgrade: match };
}

/**
 * Upgrade a user's plaintext password to SHA-256 hash in-place.
 * Called after a successful plaintext login.
 */
async function upgradePlaintextPassword(username, plaintext) {
    try {
        const hashed = await hashPassword(plaintext);
        const client = getSupabase();
        if (!client) return;
        await client.from('users').update({ password: hashed }).eq('username', username);
    } catch (e) {
        console.warn('Password upgrade failed (non-critical):', e.message);
    }
}

/**
 * Generate a base64 auth token (lightweight, client-side).
 * For Vercel production, upgrade this to a real JWT using jose library.
 */
async function generateToken(username, role) {
    const timestamp = Date.now();
    const tokenStr = username + ':' + timestamp + ':' + role;
    return btoa(tokenStr);
}

/**
 * Parse a base64 token back to { username, role }.
 */
async function parseToken(token) {
    try {
        if (!token) return null;
        const decoded = atob(token);
        const parts = decoded.split(':');
        if (parts.length < 3) return null;
        return { username: parts[0], role: parts[2] };
    } catch (e) {
        return null;
    }
}

/**
 * Parse allowed_accounts string into an array.
 * '*' = full access. Empty = no access.
 */
function parseAllowed(str, role, username) {
    if (username === 'admin' || role === 'Admin' || role === 'Super Manager') return ['*'];
    if (str === 'All') return ['*'];
    if (!str || str.trim() === '') return [];
    return str.split(',').map(s => s.trim()).filter(s => s);
}

/**
 * Check if a username exists in a comma-separated manager list.
 */
function isUserInManagerList(managerIdField, usernameToCheck) {
    if (!managerIdField || !usernameToCheck) return false;
    const managers = managerIdField.split(',').map(m => m.trim().toLowerCase());
    return managers.includes(usernameToCheck.toLowerCase());
}

// ----------------------------------------------------------------
// AUTH TOKEN STORAGE (localStorage)
// ----------------------------------------------------------------
const TOKEN_KEY = 'cms_portal_token';
const USER_KEY = 'cms_portal_user';

function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function getStoredToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function getStoredUser() {
    try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

// ----------------------------------------------------------------
// CURRENT USER STATE (in-memory after login)
// ----------------------------------------------------------------
let currentUser = null;

/**
 * Hydrate currentUser from DB after login to pick up any permission changes
 * without requiring a new login. Does NOT overwrite avatarData from the login
 * response (it's a heavy blob, omitted from auth columns).
 */
async function hydrateCurrentUserFromDB(token) {
    try {
        const freshUser = await directAPI.validateToken(token);
        if (freshUser && currentUser) {
            // Merge — preserve avatar from original login
            currentUser = {
                ...currentUser,
                role: freshUser.role,
                department: freshUser.department,
                allowedAccounts: freshUser.allowedAccounts,
                allowedDriveFolders: freshUser.allowedDriveFolders,
                allowedCampaigns: freshUser.allowedCampaigns,
                allowedLookerReports: freshUser.allowedLookerReports,
                driveAccessLevel: freshUser.driveAccessLevel,
                moduleAccess: freshUser.moduleAccess,
                team_members: freshUser.team_members,
                manager_id: freshUser.manager_id
            };
        }
    } catch (e) {
        console.warn('hydrateCurrentUserFromDB failed:', e.message);
    }
}

// ----------------------------------------------------------------
// LOGIN HANDLER — called by the login form submit
// ----------------------------------------------------------------
async function handleLogin(event) {
    if (event) event.preventDefault();

    const usernameInput = document.getElementById('usernameInput');
    const passwordInput = document.getElementById('passwordInput');
    const errorDiv = document.getElementById('loginError');
    const loginBtn = document.getElementById('loginBtn');

    const username = (usernameInput?.value || '').trim();
    const password = (passwordInput?.value || '').trim();

    if (!username || !password) {
        if (errorDiv) {
            errorDiv.textContent = 'Please enter both username and password.';
            errorDiv.classList.remove('hidden');
        }
        return;
    }

    // Disable button while loading
    if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = 'Signing in...';
    }
    if (errorDiv) errorDiv.classList.add('hidden');

    try {
        // Ensure Supabase is ready
        const ready = await ensureSupabaseReady(4000);
        if (!ready) {
            throw new Error('Database connection failed. Please check your connection and try again.');
        }

        const result = await directAPI.login(username, password);

        if (result.success) {
            currentUser = result.user;
            saveSession(result.token, result.user);

            // Schedule DB migrations and backfills
            window.scheduleDatabaseMigrations?.();
            await init();
        } else {
            throw new Error(result.error || 'Login failed');
        }
    } catch (e) {
        if (errorDiv) {
            errorDiv.textContent = e.message || 'An unexpected error occurred.';
            errorDiv.classList.remove('hidden');
        }
    } finally {
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Sign In';
        }
    }
}

// ----------------------------------------------------------------
// LOGOUT
// ----------------------------------------------------------------
function handleLogout() {
    clearSession();
    currentUser = null;
    // Reset and show login screen
    document.getElementById('loginSection')?.classList.remove('hidden');
    document.getElementById('mainApp')?.classList.add('hidden');
    // Clear all cached data
    window.dataCache && clearCache();
}

// ----------------------------------------------------------------
// AUTO-LOGIN on page load (if session exists)
// ----------------------------------------------------------------
async function tryAutoLogin() {
    const token = getStoredToken();
    const storedUser = getStoredUser();

    if (!token || !storedUser) return false;

    try {
        const ready = await ensureSupabaseReady(3000);
        if (!ready) return false;

        const validUser = await directAPI.validateToken(token);
        if (validUser) {
            currentUser = { ...storedUser, ...validUser };
            return true;
        }
    } catch (e) {
        console.warn('Auto-login failed:', e.message);
    }

    clearSession();
    return false;
}
