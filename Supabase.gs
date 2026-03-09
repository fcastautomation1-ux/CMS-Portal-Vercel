/**
 * Supabase Client for Google Apps Script
 */

const SUPABASE_URL = String(PropertiesService.getScriptProperties().getProperty('SUPABASE_URL') || '').trim().replace(/\/$/, "");
const SUPABASE_KEY = String(PropertiesService.getScriptProperties().getProperty('SUPABASE_KEY') || '').trim();


/**
 * Generic function to make requests to Supabase
 */
function supabaseRequest(endpoint, method, payload) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase URL or Key is missing in Script Properties.');
  }

  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const options = {
    method: method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates' 
    },
    muteHttpExceptions: true
  };

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode >= 300) {
    Logger.log(`Error [${responseCode}] ${endpoint}: ${responseBody}`);
    throw new Error(`Supabase Request Failed: ${responseBody}`);
  }

  try {
    return JSON.parse(responseBody);
  } catch (e) {
    return responseBody;
  }
}

/**
 * DB Helper: Upsert data
 * Uses POST with on_conflict query parameter for proper upsert behavior
 * @param {string} table - Table name
 * @param {Object|Array} data - Data to upsert
 * @param {string} onConflict - Optional comma-separated conflict columns (e.g., 'customer_id,campaign_name')
 */
function supabaseUpsert(table, data, onConflict) {
  if (!Array.isArray(data)) data = [data];
  
  // Build endpoint with on_conflict if specified
  let endpoint = table;
  if (onConflict) {
    endpoint = `${table}?on_conflict=${onConflict}`;
  }
  
  return supabaseRequest(endpoint, 'POST', data);
}

/**
 * DB Helper: Update data with filters
 * Uses PATCH for proper update behavior
 * @param {string} table - Table name
 * @param {Object} data - Data to update
 * @param {Object} filters - Key-value pairs for WHERE clause (e.g., {customer_id: '123', campaign_name: 'test'})
 */
function supabaseUpdate(table, data, filters) {
  // Build query string from filters
  const filterParams = Object.entries(filters)
    .map(([key, value]) => `${key}=eq.${encodeURIComponent(value)}`)
    .join('&');
  
  const endpoint = `${table}?${filterParams}`;
  return supabaseRequest(endpoint, 'PATCH', data);
}

/**
 * DB Helper: Check if record exists
 * @param {string} table - Table name  
 * @param {Object} filters - Key-value pairs for WHERE clause
 */
function supabaseExists(table, filters) {
  const filterParams = Object.entries(filters)
    .map(([key, value]) => `${key}=eq.${encodeURIComponent(value)}`)
    .join('&');
  
  // Use select=id (minimal column) instead of select=* to avoid downloading large blobs.
  const endpoint = `${table}?${filterParams}&select=id&limit=1`;
  const result = supabaseRequest(endpoint, 'GET');
  return result && result.length > 0;
}

/**
 * DB Helper: Select data
 */
function supabaseSelect(table, columns = '*') {
  return supabaseRequest(`${table}?select=${columns}`, 'GET');
}

function FORCE_AUTHORIZE() {
  Logger.log('Triggering authorization...');
  UrlFetchApp.fetch('https://www.google.com');
  Logger.log('Done!');
}

/**
 * Get Supabase configuration for client-side use
 * Returns URL and anonymous key (safe to expose to frontend)
 */
function getSupabaseConfig() {
  const url = String(PropertiesService.getScriptProperties().getProperty('SUPABASE_URL') || '').trim().replace(/\/$/, "");
  const key = String(PropertiesService.getScriptProperties().getProperty('SUPABASE_KEY') || '').trim();
  
  if (!url || !key) {
    throw new Error('Supabase configuration missing in Script Properties. Please set SUPABASE_URL and SUPABASE_KEY.');
  }
  
  return {
    url: url,
    anonKey: key
  };
}

/**
 * Login function - validates username and password
 * @param {string} username - Username to login
 * @param {string} password - Password to verify
 * @returns {Object} Login result with success status, token, and user data
 */
function login(username, password) {
  try {
    if (!username || !password) {
      return { success: false, error: 'Username and password are required' };
    }
    
    // Query users table
    const endpoint = `users?username=eq.${encodeURIComponent(username)}&limit=1`;
    const users = supabaseRequest(endpoint, 'GET');
    
    if (!users || users.length === 0) {
      return { success: false, error: 'Invalid username or password' };
    }
    
    const user = users[0];
    
    // Verify password (plain text comparison for now)
    // Note: In production, you should use hashed passwords
    if (user.password !== password) {
      return { success: false, error: 'Invalid username or password' };
    }
    
    // Update last login
    try {
      const now = new Date().toISOString();
      supabaseUpdate('users', { last_login: now }, { username: username });
    } catch (e) {
      Logger.log('Failed to update last_login: ' + e.message);
    }
    
    // Generate simple token (username:role:timestamp)
    const token = Utilities.base64Encode(username + ':' + user.role + ':' + Date.now());
    
    // Parse allowed fields
    const parseAllowed = (str, role, username) => {
      if (!str || str.trim() === '' || str.trim() === 'null') return [];
      if (role === 'Admin' || role === 'Super Manager' || username === 'admin') return ['all'];
      return str.split(',').map(s => s.trim()).filter(s => s);
    };
    
    // Return success with user data
    return {
      success: true,
      token: token,
      user: {
        username: user.username,
        role: user.role,
        department: user.department || null,
        email: user.email || '',
        avatarData: user.avatar_data || null,
        allowedAccounts: parseAllowed(user.allowed_accounts, user.role, user.username),
        allowedCampaigns: parseAllowed(user.allowed_campaigns, user.role, user.username),
        allowedDriveFolders: (user.allowed_drive_folders || '').split(',').map(s => s.trim()).filter(s => s),
        allowedLookerReports: user.allowed_looker_reports || '',
        moduleAccess: user.module_access || null,
        team_members: user.team_members || null,
        manager_id: user.manager_id || null
      }
    };
    
  } catch (error) {
    Logger.log('Login error: ' + error.message);
    return { success: false, error: 'Login failed: ' + error.message };
  }
}

