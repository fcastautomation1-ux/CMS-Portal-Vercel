// ================================================================
// api/config.js  —  Vercel Serverless Function
// Returns Supabase credentials from environment variables.
// These are set in Vercel Dashboard, never stored in code.
// ================================================================

export default function handler(req, res) {
    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
        return res.status(500).json({
            error: 'Supabase environment variables are not configured. ' +
                   'Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel Dashboard.'
        });
    }

    // Never cache credentials
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    return res.status(200).json({ url, key });
}
