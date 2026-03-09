/* ================================================================
   security.js  —  Client-side security hardenings
   Disable DevTools in production, block devtools keyboard shortcuts,
   secure console, prevent iframe embedding.
   ================================================================ */

'use strict';

(function () {
    // ── ENVIRONMENT DETECTION ─────────────────────────────────────
    const hostname = window.location.hostname;
    const href     = window.location.href;

    // Production = deployed on Vercel custom domain or vercel.app
    const isProduction =
        hostname.endsWith('.vercel.app') ||
        (!hostname.includes('localhost') && !hostname.includes('127.0.0.1') && !hostname.includes('file://'));

    const isDev = !isProduction;

    // ── IFRAME PROTECTION ─────────────────────────────────────────
    // Prevent the app from being embedded in an untrusted iframe.
    try {
        if (window.top !== window.self) {
            const topHost = window.top.location.hostname;
            if (topHost !== hostname) {
                // Cross-origin iframe — redirect top frame to our URL
                window.top.location = window.self.location;
            }
        }
    } catch (e) {
        // Cross-origin access blocked — we're probably in a foreign iframe.
        // Render a friendly warning instead of crashing.
        document.addEventListener('DOMContentLoaded', () => {
            document.body.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;
                            height:100vh;font-family:sans-serif;text-align:center;padding:40px">
                    <div>
                        <h2 style="color:#ef4444">⚠️ Access Denied</h2>
                        <p>This application cannot be embedded in an iframe.</p>
                    </div>
                </div>`;
        });
    }

    // ── CONSOLE SILENCING (production only) ───────────────────────
    if (isProduction) {
        const noop = () => false;
        const methods = [
            'log','debug','info','warn','error','assert','count',
            'time','timeEnd','profile','profileEnd','group','groupEnd',
            'clear','trace','table','dir','dirxml'
        ];
        methods.forEach(m => { try { console[m] = noop; } catch { /* readonly in some envs */ } });
    }

    // ── DEVTOOLS KEYBOARD BLOCKER (production only) ───────────────
    if (isProduction) {
        document.addEventListener('keydown', function (e) {
            // F12
            if (e.key === 'F12' || e.keyCode === 123) {
                e.preventDefault(); return false;
            }
            // Ctrl/Cmd + Shift + I (Inspector)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey &&
                (e.key === 'I' || e.key === 'i')) {
                e.preventDefault(); return false;
            }
            // Ctrl/Cmd + Shift + C (Inspect Element)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey &&
                (e.key === 'C' || e.key === 'c')) {
                e.preventDefault(); return false;
            }
            // Ctrl/Cmd + Shift + J (Console)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey &&
                (e.key === 'J' || e.key === 'j')) {
                e.preventDefault(); return false;
            }
            // Ctrl/Cmd + Shift + K (Firefox Console)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey &&
                (e.key === 'K' || e.key === 'k')) {
                e.preventDefault(); return false;
            }
            // Ctrl/Cmd + U (View Source)
            if ((e.ctrlKey || e.metaKey) && (e.key === 'U' || e.key === 'u')) {
                e.preventDefault(); return false;
            }
            // Ctrl/Cmd + S (Save Page)
            if ((e.ctrlKey || e.metaKey) && (e.key === 'S' || e.key === 's') && !e.shiftKey) {
                e.preventDefault(); return false;
            }
        }, false);

        // Disable right-click context menu
        document.addEventListener('contextmenu', function (e) {
            e.preventDefault(); return false;
        }, false);
    }

    // ── DEVTOOLS DETECTION (production only) ──────────────────────
    // Uses timing exploit: debugger pauses devtools, causing delay.
    if (isProduction) {
        let _devtoolsOpen = false;

        const devtoolsCheck = () => {
            const start = performance.now();
            // eslint-disable-next-line no-debugger
            debugger;
            const elapsed = performance.now() - start;
            if (elapsed > 100 && !_devtoolsOpen) {
                _devtoolsOpen = true;
                // Graceful degradation: show warning rather than breaking the app
                console.clear && console.clear();
                if (window.showToast) {
                    showToast('⚠️ Developer tools detected. Some features may be restricted.', 'warning');
                }
            } else if (elapsed < 20) {
                _devtoolsOpen = false;
            }
        };

        // Run check every 3 seconds (non-intrusive)
        setInterval(devtoolsCheck, 3000);
    }

    // ── SESSION INTEGRITY ─────────────────────────────────────────
    /**
     * Remove any stale tokens from localStorage if they look tampered.
     * Called at startup before any auth check.
     */
    window.sanitizeStoredSession = function () {
        const token = localStorage.getItem('cms-portal-token');
        if (!token) return;

        try {
            const decoded = atob(token);
            const parts   = decoded.split(':');
            // Expected format: username:timestamp:role
            if (parts.length < 3) {
                localStorage.removeItem('cms-portal-token');
                localStorage.removeItem('cms-portal-user');
                return;
            }
            const ts = parseInt(parts[1], 10);
            // Tokens older than 30 days are considered stale
            const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
            if (Date.now() - ts > MAX_AGE) {
                localStorage.removeItem('cms-portal-token');
                localStorage.removeItem('cms-portal-user');
            }
        } catch {
            localStorage.removeItem('cms-portal-token');
            localStorage.removeItem('cms-portal-user');
        }
    };

    // ── CONTENT SECURITY HELPERS ───────────────────────────────────
    /**
     * Escape HTML to prevent XSS when inserting user-controlled
     * strings into innerHTML. Already defined in some modules;
     * expose globally as a safety net.
     */
    if (!window.escHtml) {
        window.escHtml = function (str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };
    }

    // ── EXPOSE ENV FLAG ───────────────────────────────────────────
    window.__CMS_IS_PRODUCTION = isProduction;
    window.__CMS_IS_DEV        = isDev;

})();
