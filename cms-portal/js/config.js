// ================================================================
// config.js - App Configuration
// Supabase credentials loaded from environment / window global
// For Vercel: set SUPABASE_URL and SUPABASE_ANON_KEY in .env.local
// ================================================================

// ----------------------------------------------------------------
// Supabase Configuration
// In Vercel: add these in Project Settings > Environment Variables
// NEXT_PUBLIC_SUPABASE_URL = https://xxxx.supabase.co
// NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJhbGc...
// For plain HTML/JS hosting, set them here or via a config endpoint
// ----------------------------------------------------------------
let SUPABASE_CONFIG = null;

// Legacy flag kept for GAS compatibility shims
const USE_DIRECT_SUPABASE = true;

/**
 * Apply Supabase config from any source (env, server, manual).
 * @param {Object} cfg - { url, anonKey }
 * @param {string} source - label for debugging
 */
function applySupabaseConfig(cfg, source = 'env') {
    if (!cfg || typeof cfg !== 'object') return false;
    const url = String(cfg.url || '').trim().replace(/\/$/, '');
    const anonKey = String(cfg.anonKey || cfg.key || '').trim();
    if (!url || !anonKey) return false;
    SUPABASE_CONFIG = { url, anonKey };
    _supabaseClient = null; // force re-create with new config
    _supabaseConfigSource = source;
    _supabaseConfigSynced = true;
    return true;
}

/**
 * Load config from Vercel environment variables injected at build time.
 * For static HTML deployments, these will be window globals set in index.html.
 */
function loadConfigFromEnv() {
    // Vercel injects env vars at build time via next.config.js publicRuntimeConfig
    // or as window.__ENV vars for static sites
    const envUrl = (typeof window !== 'undefined' && window.__ENV && window.__ENV.SUPABASE_URL)
        || (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_SUPABASE_URL)
        || null;
    const envKey = (typeof window !== 'undefined' && window.__ENV && window.__ENV.SUPABASE_ANON_KEY)
        || (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
        || null;

    if (envUrl && envKey) {
        return applySupabaseConfig({ url: envUrl, anonKey: envKey }, 'env');
    }
    return false;
}

// ----------------------------------------------------------------
// Initialization Guard - prevent iframe embedding
// ----------------------------------------------------------------
(function () {
    'use strict';
    if (window.top !== window.self) {
        try {
            window.top.location = window.self.location;
        } catch (e) {
            // Cross-origin iframe - silently allow
        }
    }

    // Ensure handleLogin is accessible early (placeholder until auth.js loads)
    window.handleLogin = window.handleLogin || function () {
        const errorDiv = document.getElementById('loginError');
        if (errorDiv) {
            errorDiv.textContent = 'Please wait, system is initializing...';
            errorDiv.classList.remove('hidden');
        }
    };
})();

// ----------------------------------------------------------------
// Security - DevTools restriction (production only)
// ----------------------------------------------------------------
(function () {
    'use strict';
    const isProduction = window.location.hostname !== 'localhost'
        && !window.location.hostname.includes('127.0.0.1')
        && !window.location.hostname.includes('.local');

    // Disable console methods in all environments as requested
    const consoleMethods = ['log', 'debug', 'info', 'warn', 'error', 'assert', 'count',
        'time', 'timeEnd', 'profile', 'profileEnd', 'group', 'groupEnd',
        'clear', 'trace', 'table', 'dir', 'dirxml'];
    consoleMethods.forEach(m => { console[m] = () => false; });

    if (isProduction) {
        document.addEventListener('contextmenu', e => { e.preventDefault(); return false; }, false);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'F12' || e.keyCode === 123) { e.preventDefault(); return false; }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I', 'i', 'C', 'c', 'J', 'j', 'K', 'k'].includes(e.key)) {
                e.preventDefault(); return false;
            }
            if ((e.ctrlKey || e.metaKey) && e.altKey && ['U', 'u'].includes(e.key)) {
                e.preventDefault(); return false;
            }
        }, false);
    }

    document.addEventListener('drag', e => e.preventDefault(), false);
    document.addEventListener('drop', e => e.preventDefault(), false);
})();
