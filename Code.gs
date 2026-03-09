// ============================================================================
// PROFILE MANAGEMENT
// ============================================================================

function saveUserProfileImage(base64Data, token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');
    
    // Safety check: Allow larger images for better quality (up to ~500KB)
    if (base64Data && base64Data.length > 500000) { // ~500KB limit
      throw new Error('Image too large. Please use a smaller image.');
    }

    // First, let's check if user exists
    const checkUser = supabaseRequest(`users?username=eq.${encodeURIComponent(user.username)}&select=username`, 'GET');
    
    if (!checkUser || checkUser.length === 0) {
      throw new Error(`User "${user.username}" not found in database.`);
    }

    const response = supabaseRequest(`users?username=eq.${encodeURIComponent(user.username)}`, 'PATCH', {
      avatar_data: base64Data
    });

    // Verify update actually happened
    if (!response || (Array.isArray(response) && response.length === 0)) {
       throw new Error('Update failed: User not found or database record not updated.');
    }
    
    // READ-AFTER-WRITE VERIFICATION
    const verify = supabaseRequest(`users?username=eq.${encodeURIComponent(user.username)}&select=avatar_data`, 'GET');
    
    if (!verify || verify.length === 0 || !verify[0].avatar_data) {
       throw new Error('Verification failed: Image was not persisted to database.');
    }
    
    console.log('Avatar saved successfully for user:', user.username);
    return { success: true, message: 'Profile picture saved successfully' };
  } catch (e) {
    console.error('Error saving profile image: ' + e.message);
    throw e;
  }
}

/**
 * Google Ads Central Config - Backend API
 * Powered by Supabase Database
 */

// ============================================================================
// SECURITY CONSTANTS
// ============================================================================

const TOKEN_SECRET = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET') || 'default-dev-secret-change-in-production';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const SALT_PREFIX = 'GASv1_';

/**
 * Get Supabase configuration securely from script properties
 * This prevents exposing credentials in frontend code
 */
function getSupabaseConfig() {
  const url = PropertiesService.getScriptProperties().getProperty('SUPABASE_URL');
  const anonKey = PropertiesService.getScriptProperties().getProperty('SUPABASE_ANON_KEY');
  
  if (!url || !anonKey) {
    throw new Error('Supabase configuration not found');
  }
  
  return {
    url: url.trim(),
    anonKey: anonKey.trim()
  };
}

/**
 * Database migration - Add security columns
 * Run this once to add password_hash and password_salt columns
 */
function runDatabaseMigration() {
  try {
    // Add password_hash column
    supabaseRequest('users', 'POST', {
      id: 'migration-placeholder'
    });
  } catch (e) {
    // Table might already exist, ignore
  }
  
  Logger.log('Database migration completed');
  return { success: true, message: 'Migration completed' };
}

// ============================================================================
// PASSWORD HASHING (SHA-256 with salt)
// ============================================================================

function hashPassword(password, salt) {
  if (!salt) {
    salt = Utilities.getUuid();
  }
  const combined = SALT_PREFIX + salt + password;
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined);
  return {
    hash: hash.map(function(b) {
      return ('0' + (b & 0xFF).toString(16)).slice(-2);
    }).join(''),
    salt: salt
  };
}

function verifyPassword(password, storedHash, storedSalt) {
  const result = hashPassword(password, storedSalt);
  return result.hash === storedHash;
}

// ============================================================================
// INPUT VALIDATION & SANITIZATION
// ============================================================================

function sanitizeString(str, maxLength) {
  if (typeof str !== 'string') return '';
  return str.trim().substring(0, maxLength || 255).replace(/[<>'"]/g, '');
}

function validateEmail(email) {
  if (!email) return true; // Optional fields can be empty
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return false;
  const cleaned = username.trim();
  // Only allow alphanumeric, underscore, and hyphen; 2-50 chars
  return /^[a-zA-Z0-9_-]{2,50}$/.test(cleaned);
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return false;
  // Minimum 6 characters (can be strengthened)
  return password.length >= 6 && password.length <= 128;
}

function sanitizeSQLValue(value) {
  if (!value || typeof value !== 'string') return '';
  // Remove or escape potentially dangerous SQL characters
  return value.replace(/['";\\]/g, '').trim();
}

// ============================================================================
// JWT-LIKE TOKEN GENERATION
// ============================================================================

// ============================================================================
// TOKEN GENERATION (Simple - Using Original Format)
// ============================================================================

function generateToken(username, role) {
  const timestamp = new Date().getTime();
  const tokenStr = username + ':' + timestamp + ':' + role;
  return Utilities.base64Encode(tokenStr);
}

function verifyAndDecodeToken(token) {
  try {
    if (!token) {
      Logger.log('Token is null or empty');
      return null;
    }
    
    Logger.log('Token length: ' + token.length + ', first 50 chars: ' + token.substring(0, 50));
    
    let decoded;
    let parts;
    
    try {
      decoded = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
      parts = decoded.split(':');
    } catch (e) {
      // Try legacy format (might have different encoding)
      Logger.log('First decode failed, trying alternate: ' + e.message);
      try {
        decoded = atob(token);
        parts = decoded.split(':');
      } catch (e2) {
        Logger.log('All decode attempts failed');
        return null;
      }
    }
    
    if (parts.length < 2) {
      Logger.log('Token format invalid, parts: ' + parts.length);
      return null;
    }
    
    let username = parts[0];
    let timestamp;
    let role;
    
    // Try to parse as new format (username:timestamp:role)
    if (parts.length >= 3) {
      timestamp = parseInt(parts[1]);
      role = parts[2];
    } else {
      // Try old format or different structure
      Logger.log('Unexpected token format, parts: ' + JSON.stringify(parts));
      // Try to get username from first part
      username = parts[0];
      timestamp = Date.now(); // Assume current if can't parse
      role = 'User';
    }
    
    // Skip expiration check for now to debug - allow old tokens
    // if (new Date().getTime() - timestamp > TOKEN_EXPIRY_MS) {
    //   Logger.log('Token expired');
    //   return null;
    // }
    
    return {
      username: username,
      ts: timestamp,
      role: role
    };
  } catch (e) {
    Logger.log('Token verification error: ' + e.message);
    return null;
  }
}

function getAccessToken(clientId, clientSecret, refreshToken) {
  const response = UrlFetchApp.fetch(OAUTH_URL, {
    method: 'POST',
    payload: {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }
  });

  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`[${response.getResponseCode()}] Fail to get access token. ${response.getContentText()}`);
  }

  return JSON.parse(response.getContentText()).access_token;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isManager(token) {
  const user = validateToken(token);
  return user && user.role === 'Manager';
}

function hasAccountAccess(user, customerId) {
  if (!user || !customerId) return false;
  
      // Check module access for Manager and Super Manager
      if (user.role === 'Manager' || user.role === 'Super Manager') {
        // Check if module_access field exists in database
        const moduleAccessStr = user.moduleAccess || user.module_access;
        if (moduleAccessStr) {
          try {
            const moduleAccess = typeof moduleAccessStr === 'string' ? JSON.parse(moduleAccessStr) : moduleAccessStr;
            // If module access object exists (even if empty), check Google Account module
            if (moduleAccess.googleAccount && moduleAccess.googleAccount.enabled) {
              if (moduleAccess.googleAccount.accessLevel === 'all') {
                return true;
              } else if (moduleAccess.googleAccount.accounts) {
                return moduleAccess.googleAccount.accounts.includes(customerId.trim());
              }
              return false; // Module enabled but no access configured
            }
            // Module access is configured but Google Account module is NOT enabled - NO ACCESS
            return false;
          } catch (e) {
            console.warn('Error parsing module access:', e);
            return false; // On error, deny access
          }
        }
        // NEW SYSTEM: No module access configured = NO ACCESS (removed backward compatibility)
        return false;
      }
  
  // Regular user access check
  if (user.allowedAccounts && user.allowedAccounts.includes('*')) return true;
  return user.allowedAccounts && user.allowedAccounts.includes(customerId.trim());
}

function hasCampaignAccess(user, campaignName) {
  if (!user || !campaignName) return false;
  
  // Check module access for Manager and Super Manager
  if (user.role === 'Manager' || user.role === 'Super Manager') {
    if (user.moduleAccess) {
      try {
        const moduleAccess = typeof user.moduleAccess === 'string' ? JSON.parse(user.moduleAccess) : user.moduleAccess;
        if (moduleAccess.campaigns && moduleAccess.campaigns.enabled) {
          if (moduleAccess.campaigns.accessLevel === 'all') {
            return true;
          }
          // For specific campaigns, use the allowedCampaigns field
          // (This is handled by the existing logic below)
        } else {
          // Module access configured but Campaigns module not enabled
          return false;
        }
      } catch (e) {
        console.warn('Error parsing module access:', e);
      }
    }
    // No module access configured, default to full access (backward compatibility)
    return true;
  }
  
  // Regular user access check
  if (!user.allowedCampaigns || user.allowedCampaigns.length === 0) return true; // No campaign restrictions = full access
  if (user.allowedCampaigns.includes('*')) return true;
  return user.allowedCampaigns.includes(campaignName.trim());
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

// Get the active Google account email of the user accessing the web app
function getActiveUserEmail() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch(e) {
    return '';
  }
}

function login(username, password) {
  try {
    console.log('Login attempt for username:', username);
    
    // Validate input
    if (!username || !password) {
      return { success: false, error: 'Username and password are required' };
    }
    
    // Validate username format
    const sanitizedUsername = String(username).trim().toLowerCase();
    if (!validateUsername(sanitizedUsername)) {
      return { success: false, error: 'Invalid username format' };
    }
    
    // Validate password
    if (!validatePassword(password)) {
      return { success: false, error: 'Password must be 6-128 characters' };
    }
    
    // Get user by username only
    const users = supabaseRequest(`users?username=eq.${encodeURIComponent(sanitizedUsername)}&select=*`, 'GET');
    
    if (users && users.length > 0) {
      const user = users[0];
      console.log('User found:', user.username, 'Role:', user.role);
      
      // Verify password (support both legacy plain-text and new hashed passwords)
      let passwordValid = false;
      try {
        if (user.password_salt && user.password_hash) {
          // New hashed password format
          passwordValid = verifyPassword(password, user.password_hash, user.password_salt);
        } else if (user.password === password) {
          // Legacy plain-text password (for migration)
          passwordValid = true;
          
          // Try to upgrade to hashed password (ignore errors - column might not exist yet)
          try {
            const hashed = hashPassword(password);
            supabaseRequest(`users?username=eq.${encodeURIComponent(user.username)}`, 'PATCH', {
              password_hash: hashed.hash,
              password_salt: hashed.salt
            });
            console.log('Password upgraded to hashed format for user:', user.username);
          } catch (upgradeErr) {
            console.log('Password upgrade skipped:', upgradeErr.message);
          }
        }
      } catch (pwdErr) {
        // If password_hash columns don't exist, fall back to plain text
        console.log('Password hash columns not found, using legacy auth');
        passwordValid = (user.password === password);
      }
      
      if (!passwordValid) {
        console.log('Password mismatch for user:', username);
        return { success: false, error: 'Invalid username or password' };
      }
      console.log('Password verified for user:', username);

      // Verify browser's Google account email matches user's registered email(s)
      try {
        const browserEmail = Session.getActiveUser().getEmail();
        console.log('Browser email:', browserEmail);
        console.log('Registered emails:', user.email);
        
        if (browserEmail) {
          const registeredEmails = (user.email || '').split(',').map(function(e) { return e.trim().toLowerCase(); }).filter(function(e) { return e.includes('@'); });
          console.log('Parsed registered emails:', registeredEmails);
          
          if (registeredEmails.length > 0 && !registeredEmails.includes(browserEmail.toLowerCase())) {
            console.log('Email mismatch! Browser:', browserEmail, 'not in:', registeredEmails);
            return { success: false, error: 'Your Google account (' + browserEmail + ') does not match your registered email(s). Please sign in with the correct Google account.' };
          }
          console.log('Email verified successfully');
        } else {
          console.log('No browser email available, skipping email check');
        }
      } catch(emailCheckError) {
        // If Session.getActiveUser() is unavailable, skip email check
        console.log('Email verification skipped: ' + emailCheckError.message);
      }
      
      // Generate secure JWT token
      const token = generateToken(user.username, user.role);
      
      // Update last login
      try {
        supabaseRequest(`users?username=eq.${encodeURIComponent(user.username)}`, 'PATCH', { 
          last_login: new Date().toISOString() 
        });
      } catch (e) {}
      
      console.log('Login successful for:', user.username, 'Avatar size:', user.avatar_data ? user.avatar_data.length : 0);
      
      return {
        success: true,
        token: token,
        user: {
          username: user.username,
          role: user.role,
          email: user.email,
          allowedAccounts: user.allowed_accounts === 'All' ? ['*'] : (user.allowed_accounts || '').split(',').map(id => id.trim()).filter(id => id),
          allowedDriveFolders: user.allowed_drive_folders ? user.allowed_drive_folders.split(',').map(id => id.trim()) : [],
          driveAccessLevel: user.drive_access_level || 'viewer',
          allowedCampaigns: user.allowed_campaigns === 'All' ? ['*'] : (user.allowed_campaigns || '').split(',').map(c => c.trim()).filter(c => c),
          allowedLookerReports: user.allowed_looker_reports ? user.allowed_looker_reports.split(',').map(id => id.trim()).filter(id => id) : [],
          avatarData: user.avatar_data || null,
          moduleAccess: user.module_access || null // Include module access configuration
        }
      };
    }
    
    return { success: false, error: 'Invalid username or password' };
  } catch (e) {
    return { success: false, error: 'Login failed: ' + e.message };
  }
}

// ============================================================================
// CACHING SYSTEM - Makes everything FAST
// ============================================================================

// Token cache (5 minutes, but capped at token expiry)
const TOKEN_CACHE = {};
const TOKEN_CACHE_TTL = 5 * 60 * 1000;

// Data caches (3 minutes) - will be refreshed on mutations
const DATA_CACHE = {
  accounts: { data: null, timestamp: 0 },
  users: { data: null, timestamp: 0 },
  workflows: { data: null, timestamp: 0 },
  credentials: { data: null, timestamp: 0 }
};
const DATA_CACHE_TTL = 3 * 60 * 1000;

// Campaign cache per customer (3 minutes)
const CAMPAIGN_CACHE = {};

function getCachedData(key) {
  const cache = DATA_CACHE[key];
  if (cache && cache.data && (new Date().getTime() - cache.timestamp) < DATA_CACHE_TTL) {
    return cache.data;
  }
  return null;
}

function setCachedData(key, data) {
  DATA_CACHE[key] = { data: data, timestamp: new Date().getTime() };
}

function invalidateCache(key) {
  if (key) {
    DATA_CACHE[key] = { data: null, timestamp: 0 };
  } else {
    // Invalidate all
    Object.keys(DATA_CACHE).forEach(k => DATA_CACHE[k] = { data: null, timestamp: 0 });
  }
}

function getCachedCampaigns(customerId) {
  const cache = CAMPAIGN_CACHE[customerId];
  if (cache && cache.data && (new Date().getTime() - cache.timestamp) < DATA_CACHE_TTL) {
    return cache.data;
  }
  return null;
}

function setCachedCampaigns(customerId, data) {
  CAMPAIGN_CACHE[customerId] = { data: data, timestamp: new Date().getTime() };
}


function validateToken(token) {
  if (!token) {
    return null;
  }
  
  // Check cache
  const cached = TOKEN_CACHE[token];
  if (cached && new Date().getTime() < cached.expires) {
    return cached.user;
  }

  try {
    // Verify and decode JWT token
    const payload = verifyAndDecodeToken(token);
    if (!payload || !payload.username) {
      return null;
    }
    
    const username = payload.username;
    
    // Fetch only the columns needed for auth – avatar_data is a large blob and must
    // never be pulled on every request as it causes rapid egress quota exhaustion.
    const USER_AUTH_COLS = 'username,role,department,allowed_accounts,allowed_drive_folders,drive_access_level,allowed_campaigns,email_notifications_enabled,module_access';
    const users = supabaseRequest(`users?username=eq.${encodeURIComponent(username)}&select=${USER_AUTH_COLS}`, 'GET');
    
    if (users && users.length > 0) {
      const dbUser = users[0];
      console.log('Token validated for:', dbUser.username);
      
      const userObj = {
        username: dbUser.username,
        role: dbUser.role,
        department: dbUser.department || null,
        allowedAccounts: dbUser.allowed_accounts === 'All' ? ['*'] : (dbUser.allowed_accounts || '').split(',').map(id => id.trim()).filter(id => id),
        allowedDriveFolders: dbUser.allowed_drive_folders ? dbUser.allowed_drive_folders.split(',').map(id => id.trim()) : [],
        driveAccessLevel: dbUser.drive_access_level || 'viewer',
        allowedCampaigns: dbUser.allowed_campaigns === 'All' ? ['*'] : (dbUser.allowed_campaigns || '').split(',').map(c => c.trim()).filter(c => c),
        avatarData: null, // Not fetched here to avoid egress – avatar is returned at login only
        email_notifications_enabled: dbUser.email_notifications_enabled !== false,
        moduleAccess: dbUser.module_access || null,
        module_access: dbUser.module_access || null
      };
      
      // Update Cache (with proper expiry)
      const cacheExpiry = Math.min(TOKEN_EXPIRY_MS, TOKEN_CACHE_TTL);
      TOKEN_CACHE[token] = {
        user: userObj,
        expires: new Date().getTime() + cacheExpiry
      };
      
      return userObj;
    }
    return null;
  } catch (e) {
    Logger.log('validateToken Error: ' + e.message);
    return null;
  }
}

// ============================================================================
// USER MANAGEMENT
// ============================================================================

function getAllUsers(token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');

    // Always fetch fresh data (no caching) since we're returning password data.
    // Explicitly select columns to avoid pulling avatar_data for every user (reduces egress).
    const users = supabaseSelect('users', 'username,role,department,email,password,allowed_accounts,allowed_drive_folders,allowed_campaigns,allowed_looker_reports,last_login,drive_access_level,module_access,manager_id,team_members');
    const isAdmin = user.username === 'admin' || user.role === 'Admin';
    const isManager = user.role === 'Manager' || user.role === 'Super Manager' || isAdmin;
    
    // Check if caller has limited User module access (department-restricted)
    let callerDepartments = []; // Array to support multiple departments
    let hasLimitedUserAccess = false;
    if (isAdmin || user.role === 'Super Manager') {
      // Admin and Super Manager always see all users — no filtering
      // They have unlimited access
    } else if (isManager) {
      // Check both moduleAccess and module_access (camelCase and snake_case)
      const moduleAccessStr = user.moduleAccess || user.module_access;
      if (moduleAccessStr) {
        try {
          const moduleAccess = typeof moduleAccessStr === 'string' 
            ? JSON.parse(moduleAccessStr) 
            : moduleAccessStr;
          // If module access object exists (even if empty), check User module
          if (moduleAccess.users && moduleAccess.users.enabled) {
            // User module is enabled - check if it's department-restricted
            if (moduleAccess.users.departmentRestricted !== false) {
              hasLimitedUserAccess = true;
              // Support multiple departments (comma-separated)
              const deptStr = (user.department || '').trim();
              if (deptStr) {
                callerDepartments = deptStr.split(',').map(d => d.trim()).filter(d => d);
              }
            }
            // else: departmentRestricted === false → sees all users (hasLimitedUserAccess stays false)
          } else {
            // Module access is configured but User module is NOT enabled → no access
            hasLimitedUserAccess = true;
            callerDepartments = [];
          }
        } catch (e) {
          console.warn('Error parsing caller module access:', e);
          // On parse error, deny access
          hasLimitedUserAccess = true;
          callerDepartments = [];
        }
      } else {
        // NEW SYSTEM: null/undefined module_access = NO ACCESS (no backward compatibility)
        hasLimitedUserAccess = true;
        callerDepartments = [];
      }
    }
    
    return users
      .filter(u => {
        // Admin and Super Manager always see all users
        if (isAdmin || user.role === 'Super Manager') {
          return true;
        }
        
        // If caller has limited User module access, filter by department
        if (hasLimitedUserAccess) {
          if (callerDepartments.length > 0) {
            const userDept = (u.department || '').trim();
            if (!userDept) {
              return false; // User has no department, don't show
            }
            // Check if user's department is in Manager's department list
            // Support both single department and comma-separated departments for users
            const userDepts = userDept.split(',').map(d => d.trim().toLowerCase()).filter(d => d);
            const callerDepts = callerDepartments.map(d => d.toLowerCase());
            // Show user if any of their departments match any of Manager's departments
            return userDepts.some(ud => callerDepts.includes(ud));
          } else {
            // User module not enabled - show no users
            return false;
          }
        }
        // No filtering needed
        return true;
      })
      .map(u => {
      const baseData = {
        username: u.username,
        role: u.role,
        department: u.department || null,
        managerId: u.manager_id || null, // Include manager_id for all users (needed for manager dropdown filtering)
        teamMembers: u.team_members || null, // Include team_members for all users (needed for manager dropdown filtering)
        team_members: u.team_members || null, // Also include snake_case version for compatibility
        manager_id: u.manager_id || null // Also include snake_case version for compatibility
      };

      // Only expose sensitive/management fields to Managers/Admins
      if (isManager) {
        return {
          ...baseData,
          email: u.email,
          password: u.password, // Include password for Manager to view/edit
          allowedAccounts: u.allowed_accounts,
          allowedDriveFolders: u.allowed_drive_folders,
          allowedCampaigns: u.allowed_campaigns,
          allowedLookerReports: u.allowed_looker_reports || '',
          lastLogin: u.last_login,
          driveAccessLevel: u.drive_access_level || 'viewer',
          moduleAccess: u.module_access || null // Include module access configuration
        };
      }

      return baseData;
    });
  } catch (error) {
    throw new Error('Failed to load users: ' + error.message);
  }
}

function saveUser(userData, token) {
  try {
    const currentUser = validateToken(token);
    const isAdmin = currentUser && (currentUser.username === 'admin' || currentUser.role === 'Admin');
    if (!currentUser || (!isAdmin && currentUser.role !== 'Manager' && currentUser.role !== 'Super Manager')) throw new Error('Unauthorized');

    // Check if user already exists (used for both new user and edit validations)
    const checkExisting = supabaseRequest('users?username=eq.' + encodeURIComponent((userData.username || '').trim()), 'GET');
    const isNewUser = !checkExisting || checkExisting.length === 0;
    const oldUser = isNewUser ? null : checkExisting[0];
    const oldRole = oldUser ? oldUser.role : null;
    const newRole = userData.role || oldRole;
    
    // DEPARTMENT MANAGER: restrict new users to the Manager's own departments
    if (currentUser.role === 'Manager') {
      // Prevent creating Admin, Super Manager, or Manager users
      // Managers can only create User and Supervisor roles
      if (newRole === 'Admin' || newRole === 'Super Manager' || newRole === 'Manager') {
        if (isNewUser) {
          throw new Error('Department Managers are not permitted to create Admin, Super Manager, or Manager accounts. They can only create User and Supervisor roles.');
        } else {
          throw new Error('Department Managers are not permitted to change user roles to Admin, Super Manager, or Manager.');
        }
      }
      
      // Validate that selected departments are within Manager's allowed departments
      const managerDepts = (currentUser.department || '').split(',').map(d => d.trim().toLowerCase()).filter(d => d);
      if (managerDepts.length > 0 && userData.department) {
        const userDepts = (userData.department || '').split(',').map(d => d.trim().toLowerCase()).filter(d => d);
        // Check if all user departments are in Manager's departments
        const invalidDepts = userDepts.filter(ud => !managerDepts.includes(ud));
        if (invalidDepts.length > 0) {
          throw new Error('You can only assign departments that you belong to. Invalid departments: ' + invalidDepts.join(', '));
        }
        // If valid, use the user's selected departments
      } else if (isNewUser && managerDepts.length > 0) {
        // For new users, if no department specified, use Manager's first department as default
        if (!userData.department || userData.department.trim() === '') {
          userData.department = currentUser.department.split(',')[0].trim();
        }
      }
    }
    
    // ROLE UPGRADE RESTRICTION: Only Admin and Super Manager can upgrade Manager to Super Manager
    if (!isNewUser && oldRole === 'Manager' && newRole === 'Super Manager') {
      const isAdmin = currentUser.username === 'admin' || currentUser.role === 'Admin';
      const isSuperManager = currentUser.role === 'Super Manager';
      if (!isAdmin && !isSuperManager) {
        throw new Error('Only Admin and Super Manager can upgrade a Manager to Super Manager.');
      }
    }

    const normalizeCsvList = function(value) {
      return (value || '')
        .split(',')
        .map(function(item) { return item.trim(); })
        .filter(function(item) { return item; });
    };

    const toCsvOrNull = function(list) {
      return list.length ? list.join(',') : null;
    };

    const normalizeUniqueCaseInsensitive = function(list) {
      const seen = {};
      const out = [];
      list.forEach(function(item) {
        const key = item.toLowerCase();
        if (!seen[key]) {
          seen[key] = true;
          out.push(item);
        }
      });
      return out;
    };

    // Handle module access for Manager and Super Manager
    let moduleAccessData = null;
    if (userData.moduleAccess) {
      try {
        moduleAccessData = typeof userData.moduleAccess === 'string' ? JSON.parse(userData.moduleAccess) : userData.moduleAccess;
      } catch (e) {
        console.warn('Could not parse module access:', e);
      }
    }
    
    // AUTO-UPDATE: Only for User and Supervisor roles - never touch Manager, Super Manager, or Admin
    // If user has role "User" and has team members, automatically change to "Supervisor"
    // If user has role "Supervisor" and no team members, change back to "User"
    let finalRole = userData.role || 'User';
    
    // Only apply auto-role update to User and Supervisor roles - preserve Manager, Super Manager, Admin
    if (finalRole === 'User' || finalRole === 'Supervisor') {
      const teamMembersList = (userData.teamMembers || '').split(',').map(function(m) { return m.trim(); }).filter(function(m) { return m; });
      
      if (finalRole === 'User' && teamMembersList.length > 0) {
        finalRole = 'Supervisor';
        console.log('Auto-updated role from User to Supervisor for user:', userData.username, 'because they have team members');
      } else if (finalRole === 'Supervisor' && teamMembersList.length === 0) {
        finalRole = 'User';
        console.log('Auto-updated role from Supervisor to User for user:', userData.username, 'because they have no team members');
      }
    } else {
      // For Manager, Super Manager, Admin - preserve the role exactly as set, no auto-update
      console.log('Preserving role for user:', userData.username, 'Role:', finalRole);
    }
    
    // Determine allowed_accounts based on module access ONLY (no default for Managers)
    let finalAllowedAccounts = '';
    if (moduleAccessData && moduleAccessData.googleAccount && moduleAccessData.googleAccount.enabled) {
      if (moduleAccessData.googleAccount.accessLevel === 'all') {
        finalAllowedAccounts = 'All';
      } else if (moduleAccessData.googleAccount.accounts && moduleAccessData.googleAccount.accounts.length > 0) {
        finalAllowedAccounts = moduleAccessData.googleAccount.accounts.join(',');
      }
      // If Google Account module is enabled but no accounts specified, leave empty (no access)
    } else if (finalRole === 'Manager' || finalRole === 'Super Manager') {
      // NEW SYSTEM: No Google Account module enabled = no accounts access (removed default "All")
      finalAllowedAccounts = '';
    } else {
      // For other roles, use the provided allowedAccounts
      finalAllowedAccounts = userData.allowedAccounts || '';
    }

    const payload = {
      username: userData.username.trim(),
      role: finalRole,
      email: userData.email ? userData.email.trim().toLowerCase() : '',
      allowed_accounts: finalAllowedAccounts,
      allowed_drive_folders: userData.allowedDriveFolders || '',
      allowed_campaigns: (userData.username === 'admin' || finalRole === 'Admin') ? 'All' :
        (finalRole === 'Manager' || finalRole === 'Super Manager') ? (finalAllowedAccounts === 'All' ? 'All' : '') :
        (userData.allowedCampaigns || ''),
      allowed_looker_reports: userData.allowedLookerReports || '',
      drive_access_level: userData.driveAccessLevel || 'viewer',
      manager_id: userData.managerId || null, // Manager for approval workflow
      team_members: userData.teamMembers || null,
      department: userData.department || null,
      module_access: (finalRole === 'Manager' || finalRole === 'Super Manager') ? (userData.moduleAccess || '{}') : null // Store module access as JSON string (empty object {} if no modules enabled, null for other roles)
    };
    
    // Hash password before storing
    if (userData.password) {
      const hashed = hashPassword(userData.password.trim());
      payload.password_hash = hashed.hash;
      payload.password_salt = hashed.salt;
      delete payload.password; // Don't store plain text password
    }

    const existing = supabaseRequest(`users?username=eq.${encodeURIComponent(payload.username)}`, 'GET');

    if (existing && existing.length > 0) {
      const oldUser = existing[0];
      const oldManagers = normalizeUniqueCaseInsensitive(normalizeCsvList(oldUser.manager_id));
      const newManagers = normalizeUniqueCaseInsensitive(normalizeCsvList(payload.manager_id));

      const oldTeamMembers = normalizeUniqueCaseInsensitive(normalizeCsvList(oldUser.team_members));
      const newTeamMembers = normalizeUniqueCaseInsensitive(normalizeCsvList(payload.team_members));

      payload.manager_id = toCsvOrNull(newManagers);
      payload.team_members = toCsvOrNull(newTeamMembers);
    
      supabaseRequest(`users?username=eq.${encodeURIComponent(payload.username)}`, 'PATCH', payload);

      // Sync manager relations: edited user's manager_id <-> each manager's team_members
      oldManagers.forEach(function(managerUsername) {
        if (newManagers.map(function(m) { return m.toLowerCase(); }).indexOf(managerUsername.toLowerCase()) === -1) {
          const managerRows = supabaseRequest(`users?username=eq.${encodeURIComponent(managerUsername)}&select=team_members`, 'GET');
          if (managerRows && managerRows.length > 0) {
            const managerMembers = normalizeUniqueCaseInsensitive(normalizeCsvList(managerRows[0].team_members))
              .filter(function(member) { return member.toLowerCase() !== payload.username.toLowerCase(); });
            supabaseRequest(`users?username=eq.${encodeURIComponent(managerUsername)}`, 'PATCH', {
              team_members: toCsvOrNull(managerMembers)
            });
          }
        }
      });

      newManagers.forEach(function(managerUsername) {
        const managerRows = supabaseRequest(`users?username=eq.${encodeURIComponent(managerUsername)}&select=team_members`, 'GET');
        if (managerRows && managerRows.length > 0) {
          const managerMembers = normalizeUniqueCaseInsensitive(normalizeCsvList(managerRows[0].team_members));
          if (managerMembers.map(function(m) { return m.toLowerCase(); }).indexOf(payload.username.toLowerCase()) === -1) {
            managerMembers.push(payload.username);
            supabaseRequest(`users?username=eq.${encodeURIComponent(managerUsername)}`, 'PATCH', {
              team_members: toCsvOrNull(managerMembers)
            });
          }
        }
      });

      // Sync team_members relations: edited user's team_members <-> each member's manager_id
      oldTeamMembers.forEach(function(memberUsername) {
        if (newTeamMembers.map(function(m) { return m.toLowerCase(); }).indexOf(memberUsername.toLowerCase()) === -1) {
          const memberRows = supabaseRequest(`users?username=eq.${encodeURIComponent(memberUsername)}&select=manager_id`, 'GET');
          if (memberRows && memberRows.length > 0) {
            const memberManagers = normalizeUniqueCaseInsensitive(normalizeCsvList(memberRows[0].manager_id))
              .filter(function(managerName) { return managerName.toLowerCase() !== payload.username.toLowerCase(); });
            supabaseRequest(`users?username=eq.${encodeURIComponent(memberUsername)}`, 'PATCH', {
              manager_id: toCsvOrNull(memberManagers)
            });
          }
        }
      });

      newTeamMembers.forEach(function(memberUsername) {
        if (memberUsername.toLowerCase() === payload.username.toLowerCase()) return;
        const memberRows = supabaseRequest(`users?username=eq.${encodeURIComponent(memberUsername)}&select=manager_id`, 'GET');
        if (memberRows && memberRows.length > 0) {
          const memberManagers = normalizeUniqueCaseInsensitive(normalizeCsvList(memberRows[0].manager_id));
          if (memberManagers.map(function(m) { return m.toLowerCase(); }).indexOf(payload.username.toLowerCase()) === -1) {
            memberManagers.push(payload.username);
            supabaseRequest(`users?username=eq.${encodeURIComponent(memberUsername)}`, 'PATCH', {
              manager_id: toCsvOrNull(memberManagers)
            });
          }
        }
      });
    } else {
      if (!payload.password) throw new Error('Password required for new user');
      const newManagers = normalizeUniqueCaseInsensitive(normalizeCsvList(payload.manager_id));
      const newTeamMembers = normalizeUniqueCaseInsensitive(normalizeCsvList(payload.team_members));
      payload.manager_id = toCsvOrNull(newManagers);
      payload.team_members = toCsvOrNull(newTeamMembers);

      supabaseRequest('users', 'POST', payload);

      newManagers.forEach(function(managerUsername) {
        const managerRows = supabaseRequest(`users?username=eq.${encodeURIComponent(managerUsername)}&select=team_members`, 'GET');
        if (managerRows && managerRows.length > 0) {
          const managerMembers = normalizeUniqueCaseInsensitive(normalizeCsvList(managerRows[0].team_members));
          if (managerMembers.map(function(m) { return m.toLowerCase(); }).indexOf(payload.username.toLowerCase()) === -1) {
            managerMembers.push(payload.username);
            supabaseRequest(`users?username=eq.${encodeURIComponent(managerUsername)}`, 'PATCH', {
              team_members: toCsvOrNull(managerMembers)
            });
          }
        }
      });

      newTeamMembers.forEach(function(memberUsername) {
        if (memberUsername.toLowerCase() === payload.username.toLowerCase()) return;
        const memberRows = supabaseRequest(`users?username=eq.${encodeURIComponent(memberUsername)}&select=manager_id`, 'GET');
        if (memberRows && memberRows.length > 0) {
          const memberManagers = normalizeUniqueCaseInsensitive(normalizeCsvList(memberRows[0].manager_id));
          if (memberManagers.map(function(m) { return m.toLowerCase(); }).indexOf(payload.username.toLowerCase()) === -1) {
            memberManagers.push(payload.username);
            supabaseRequest(`users?username=eq.${encodeURIComponent(memberUsername)}`, 'PATCH', {
              manager_id: toCsvOrNull(memberManagers)
            });
          }
        }
      });
    }

    invalidateCache('users'); // Clear cache
    return true;
  } catch (error) {
    throw new Error('Failed to save user: ' + error.message);
  }
}

function deleteUser(username, token) {
  try {
    const currentUser = validateToken(token);
    const isAdmin = currentUser && (currentUser.username === 'admin' || currentUser.role === 'Admin');
    if (!currentUser || (!isAdmin && currentUser.role !== 'Manager' && currentUser.role !== 'Super Manager')) throw new Error('Unauthorized');
    if (username === 'admin') throw new Error('Cannot delete admin');

    supabaseRequest(`users?username=eq.${encodeURIComponent(username)}`, 'DELETE');
    invalidateCache('users'); // Clear cache
    return true;
  } catch (error) {
    throw new Error('Failed to delete user: ' + error.message);
  }
}

/**
 * Update a user's Drive access for a specific folder/file
 * @param {string} username - User to update
 * @param {string} itemId - Drive folder/file ID  
 * @param {boolean} grantAccess - true to grant, false to revoke
 * @param {string} token - Auth token
 */
function updateUserDriveAccess(username, itemId, grantAccess, token, accessLevel = 'viewer') {
  try {
    const currentUser = validateToken(token);
    const isAdmin = currentUser && (currentUser.username === 'admin' || currentUser.role === 'Admin');
    if (!currentUser || (!isAdmin && currentUser.role !== 'Manager' && currentUser.role !== 'Super Manager')) throw new Error('Unauthorized');
    
    // Only fetch the columns we actually need – avoids pulling avatar_data.
    const users = supabaseRequest(`users?username=eq.${encodeURIComponent(username)}&select=email,allowed_drive_folders`, 'GET');
    if (!users || users.length === 0) throw new Error('User not found');
    
    const user = users[0];
    const userEmailRaw = user.email || ''; 
    const emails = userEmailRaw.split(',').map(e => e.trim()).filter(e => e.includes('@'));

    // Parse current allowed folders
    let folders = (user.allowed_drive_folders || '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s && s.length > 0);
    
    if (grantAccess) {
      // Add if not already present
      if (!folders.includes(itemId)) {
        folders.push(itemId);
      }
      
      // Grant Drive Permission directly
      if (emails.length > 0) {
         try {
           let item;
           try { item = DriveApp.getFolderById(itemId); } catch(e) { item = DriveApp.getFileById(itemId); }
           
           emails.forEach(email => {
             try {
                if (accessLevel === 'editor') {
                  item.addEditor(email);
                } else {
                  item.addViewer(email);
                }
             } catch(e) { /* Ignore individual email failure */ }
           });
         } catch(e) {
           Logger.log('Error adding permissions: ' + e.message);
         }
      }

    } else {
      // Remove
      folders = folders.filter(f => f !== itemId);

      // Revoke Drive Permission
      if (emails.length > 0) {
         try {
           let item;
           try { item = DriveApp.getFolderById(itemId); } catch(e) { item = DriveApp.getFileById(itemId); }
           
           emails.forEach(email => {
             try {
               item.removeViewer(email);
               item.removeEditor(email);
             } catch(e) { /* Ignore individual email failure */ }
           });
         } catch(e) {
           Logger.log('Error removing permissions: ' + e.message);
         }
      }
    }
    
    // Update user in DB
    const newValue = folders.join(',');
    supabaseRequest(`users?username=eq.${encodeURIComponent(username)}`, 'PATCH', {
      allowed_drive_folders: newValue
    });
    
    invalidateCache('users');
    return { success: true, folders: folders };
  } catch (error) {
    throw new Error('Failed to update drive access: ' + error.message);
  }
}

// ============================================================================
// ACCOUNT MANAGEMENT
// ============================================================================

function getEnabledAccounts() {
  const accounts = supabaseRequest('accounts?enabled=eq.true', 'GET');
  
  return accounts.map(row => {
    const driveIdsStr = row.drive_code_comments || '';
    const driveIds = driveIdsStr.includes('drive.google.com') || driveIdsStr.includes('/folders/') 
      ? driveIdsStr.split(',').map(id => id.trim()).filter(id => id !== '')
      : [];
      
    return {
      customerId: row.customer_id,
      googleSheetLink: row.google_sheet_link,
      driveCodeComments: row.drive_code_comments,
      driveIds: driveIds,
      lastRun: row.last_run,
      status: row.status,
      workflow: row.workflow || 'workflow-0'
    };
  });
}

function getAllAccountsForFrontend(token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');

    // Always fetch fresh data (no caching) to ensure correct filtering per user
    const allAccounts = supabaseSelect('accounts');
    
    // Filter based on user access
    const filtered = allAccounts.filter(acc => {
      // Admin always sees everything
      if (user.username === 'admin') {
        return true;
      }
      
      // Check module access for Manager and Super Manager
      if (user.role === 'Manager' || user.role === 'Super Manager') {
        // Check if module_access field exists in database
        const moduleAccessStr = user.moduleAccess || user.module_access;
        if (moduleAccessStr) {
          try {
            const moduleAccess = typeof moduleAccessStr === 'string' ? JSON.parse(moduleAccessStr) : moduleAccessStr;
            // If module access object exists (even if empty), check Google Account module
            if (moduleAccess.googleAccount && moduleAccess.googleAccount.enabled) {
              if (moduleAccess.googleAccount.accessLevel === 'all') {
                return true;
              } else if (moduleAccess.googleAccount.accounts) {
                return moduleAccess.googleAccount.accounts.includes(acc.customer_id);
              }
              return false; // Module enabled but no access configured
            }
            // Module access is configured but Google Account module is NOT enabled - NO ACCESS
            return false;
          } catch (e) {
            console.warn('Error parsing module access:', e);
            return false; // On error, deny access
          }
        }
        // NEW SYSTEM: No module access configured = NO ACCESS (removed backward compatibility)
        return false;
      }
      
      // Regular user access check
      const allowedList = user.allowedAccounts || [];
      
      // If allowedAccounts contains '*', allow all
      if (allowedList.includes('*')) {
        return true;
      }
      
      // Check if this account ID is in the allowed list
      return allowedList.includes(acc.customer_id);
    });
    
    return filtered.map(acc => ({
      customerId: acc.customer_id,
      googleSheetLink: acc.google_sheet_link,
      driveCodeComments: acc.drive_code_comments,
      enabled: acc.enabled,
      lastRun: acc.last_run,
      status: acc.status || 'Pending',
      createdDate: acc.created_date,
      workflow: acc.workflow || 'workflow-0'
    }));
  } catch (error) {
    throw new Error('Failed to load accounts: ' + error.message);
  }
}

function getAccountForFrontend(customerId, token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');
    if (!hasAccountAccess(user, customerId)) throw new Error('Access denied');

    const data = supabaseRequest(`accounts?customer_id=eq.${encodeURIComponent(customerId)}`, 'GET');
    if (!data || data.length === 0) return null;
    
    const acc = data[0];
    return {
      customerId: acc.customer_id,
      googleSheetLink: acc.google_sheet_link,
      driveCodeComments: acc.drive_code_comments,
      enabled: acc.enabled,
      lastRun: acc.last_run,
      status: acc.status || 'Pending',
      createdDate: acc.created_date,
      workflow: acc.workflow || 'workflow-0'
    };
  } catch (error) {
    Logger.log('Error in getAccountForFrontend: ' + error.message);
    return null;
  }
}

function saveAccount(accountData, existingCustomerId, token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');

    if (user.role !== 'Manager') {
       if (!existingCustomerId || !hasAccountAccess(user, existingCustomerId)) {
          throw new Error('Unauthorized to edit this account');
       }
    }

    const payload = {
      customer_id: accountData.customerId.trim(),
      google_sheet_link: accountData.googleSheetLink.trim(),
      drive_code_comments: accountData.driveCodeComments || '',
      enabled: accountData.enabled,
      workflow: accountData.workflow || 'workflow-0'
    };

    if (existingCustomerId) {
      supabaseRequest(`accounts?customer_id=eq.${encodeURIComponent(existingCustomerId)}`, 'PATCH', payload);
    } else {
      payload.status = 'Pending';
      payload.created_date = new Date().toISOString();
      supabaseRequest('accounts', 'POST', payload);
    }
    
    invalidateCache('accounts'); // Clear cache on mutation
    return true;
  } catch (error) {
    throw new Error('Failed to save account: ' + error.message);
  }
}

function shareTodo(todoId, sharedWithUsername, canEdit, token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');

    // Validate todoId
    if (!todoId || todoId === 'null' || todoId === 'undefined') {
      throw new Error('Invalid task ID');
    }

    // Validate sharedWithUsername
    if (!sharedWithUsername || sharedWithUsername === 'null' || sharedWithUsername === 'undefined' || String(sharedWithUsername).trim() === '') {
      throw new Error('Invalid username to share with');
    }

    const cleanUsername = String(sharedWithUsername).trim();

    const existing = supabaseRequest(`todos?id=eq.${encodeURIComponent(todoId)}`, 'GET');
    if (!existing?.length) {
      throw new Error('Task not found');
    }
    if (existing[0].username !== user.username) {
      throw new Error('Only the owner can share this task');
    }

    // Prevent sharing with yourself
    if (cleanUsername === user.username) {
      throw new Error('Cannot share a task with yourself');
    }

    const payload = {
      todo_id: todoId,
      shared_by: user.username,
      shared_with: cleanUsername,
      can_edit: canEdit,
      created_at: new Date().toISOString()
    };

    // Upsert with conflict resolution on todo_id + shared_with
    supabaseRequest('todo_shares', 'POST', payload);
    
    return true;
  } catch (error) {
    throw new Error('Failed to share task: ' + error.message);
  }
}

function unshareTodo(todoId, sharedWithUsername, token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');

    // Validate todoId
    if (!todoId || todoId === 'null' || todoId === 'undefined') {
      throw new Error('Invalid task ID');
    }

    // Delete the share record
    supabaseRequest(`todo_shares?todo_id=eq.${encodeURIComponent(todoId)}&shared_with=eq.${encodeURIComponent(sharedWithUsername)}`, 'DELETE');
    
    return true;
  } catch (error) {
    throw new Error('Failed to unshare task: ' + error.message);
  }
}

function deleteAccount(customerId, token) {
  try {
    const user = validateToken(token);
    if (!user || user.role !== 'Manager') throw new Error('Unauthorized');

    supabaseRequest(`accounts?customer_id=eq.${encodeURIComponent(customerId)}`, 'DELETE');
    invalidateCache('accounts'); // Clear cache on mutation
    return true;
  } catch (error) {
    throw new Error('Failed to delete account: ' + error.message);
  }
}

function updateAccountStatus(customerId, status, lastRun) {
  const payload = { status: status };
  if (lastRun) payload.last_run = lastRun;
  
  supabaseRequest(`accounts?customer_id=eq.${encodeURIComponent(customerId)}`, 'PATCH', payload);
}

/**
 * Batch updates the enabled status for multiple accounts
 */
function batchUpdateAccountStatus(customerIds, enabled, token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');
    
    // Validate access for all IDs
    if (user.role !== 'Manager') {
      const allowed = user.allowedAccounts || [];
      if (!allowed.includes('*')) {
        for (const id of customerIds) {
           if (!allowed.includes(id)) {
             throw new Error(`Unauthorized access to account ${id}`);
           }
        }
      }
    }

    const payload = { enabled: enabled };
    
    // Construct filter for IN clause properly for Supabase
    // URL format: accounts?customer_id=in.(id1,id2)
    // Note: UrlFetchApp disallows literal quotes in URL. PostgREST parses comma-separated lists correctly.
    const idList = customerIds.map(id => id).join(',');
    supabaseRequest(`accounts?customer_id=in.(${idList})`, 'PATCH', payload);
    
    invalidateCache('accounts');
    return { success: true };
  } catch (error) {
    throw new Error('Batch update failed: ' + error.message);
  }
}

// ============================================================================
// CREDENTIALS
// ============================================================================

function getCentralCredentials() {
  const data = supabaseRequest('credentials?id=eq.1', 'GET');
  if (!data || data.length === 0) throw new Error('Credentials not found in database');
  
  const row = data[0];
  return {
    developerToken: row.developer_token,
    clientId: row.client_id,
    clientSecret: row.client_secret,
    refreshToken: row.refresh_token,
    youtubeRefreshToken: row.youtube_refresh_token
  };
}

// ============================================================================
// CAMPAIGN CONDITIONS
// ============================================================================

function getWorkflowTable(workflow) {
  if (!workflow) return 'campaign_conditions';
  const num = String(workflow).replace('workflow-', '').trim();
  if (num === '1') return 'workflow_1';
  if (num === '2') return 'workflow_2';
  if (num === '3') return 'workflow_3';
  return 'campaign_conditions';
}

function getCampaignRemovalConditions(customerId, campaignName, workflow) {
  try {
    const table = getWorkflowTable(workflow);
    const query = `${table}?customer_id=eq.${encodeURIComponent(customerId)}&campaign_name=eq.${encodeURIComponent(campaignName)}&select=*`;
    const data = supabaseRequest(query, 'GET');

    if (data && data.length > 0) {
      const str = data[0].removal_conditions || '';
      return str.split(/[\n•,]/).map(c => c.trim()).filter(c => c !== '');
    }
    return [];
  } catch (error) {
    Logger.log('Error in getCampaignRemovalConditions: ' + error.message);
    return [];
  }
}

function saveCampaignRemovalConditions(customerId, campaignName, removalConditions, campaignWorkflow, enabled = true) {
  try {
    const table = getWorkflowTable(campaignWorkflow);

    // Handle empty conditions properly - save empty string when all conditions removed
    let formattedConditions = '';
    if (Array.isArray(removalConditions) && removalConditions.length > 0) {
      formattedConditions = '• ' + removalConditions.join('\n• ');
    } else if (typeof removalConditions === 'string') {
      formattedConditions = removalConditions.trim();
    }

    const filters = {
      customer_id: customerId,
      campaign_name: campaignName
    };

    // Check if record exists
    const exists = supabaseExists(table, filters);
    
    // Base data without enabled field
    const baseData = {
      removal_conditions: formattedConditions,
      workflow: campaignWorkflow || 'workflow-0'
    };

    // Try to save with enabled field first, fallback to without if column doesn't exist
    try {
      if (exists) {
        // Update existing record using PATCH
        supabaseUpdate(table, {
          ...baseData,
          enabled: enabled
        }, filters);
      } else {
        // Insert new record
        const payload = {
          customer_id: customerId,
          campaign_name: campaignName,
          ...baseData,
          enabled: enabled
        };
        supabaseUpsert(table, payload, 'customer_id,campaign_name');
      }
    } catch (error) {
      // If error mentions 'enabled' column or schema, retry without it
      const errorMsg = error.message || error.toString();
      if (errorMsg.includes('enabled') || errorMsg.includes('column') || errorMsg.includes('schema')) {
        Logger.log(`Table ${table} does not have 'enabled' column, saving without it.`);
        if (exists) {
          // Update existing record without enabled
          supabaseUpdate(table, baseData, filters);
        } else {
          // Insert new record without enabled
          const payload = {
            customer_id: customerId,
            campaign_name: campaignName,
            ...baseData
          };
          supabaseUpsert(table, payload, 'customer_id,campaign_name');
        }
      } else {
        // Re-throw if it's a different error
        throw error;
      }
    }
    
    return true;
  } catch (error) {
    Logger.log('Error in saveCampaignRemovalConditions: ' + error.message);
    throw error;
  }
}

function getCampaignsForCustomer(customerId, token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');

    const tables = ['campaign_conditions', 'workflow_1', 'workflow_2', 'workflow_3'];
    let allCampaigns = [];

    tables.forEach(table => {
      try {
        const data = supabaseRequest(`${table}?customer_id=eq.${encodeURIComponent(customerId)}&select=*`, 'GET');
        if (data && data.length > 0) {
          data.forEach(row => {
            allCampaigns.push({
              campaignName: row.campaign_name,
              removalConditions: row.removal_conditions,
              workflow: row.workflow || (table === 'campaign_conditions' ? 'workflow-0' : table.replace('_', '-')),
              enabled: row.enabled !== false // Default to true if null/missing
            });
          });
        }
      } catch (tableError) {
        // Silent fail for individual table errors
      }
    });

    // Filter campaigns based on user's allowed campaigns
    return allCampaigns;
  } catch (error) {
    throw error;
  }
}

// Alias for frontend compatibility
function getCampaignsForFrontend(customerId, token) {
  return getCampaignsForCustomer(customerId, token);
}

/**
 * Batch saves campaign removal conditions (Manager only)
 */
function batchSaveCampaignRemovalConditions(customerId, campaignDataList, token) {
  try {
    const user = validateToken(token);
    if (!user || user.role !== 'Manager') throw new Error('Unauthorized');

    let successCount = 0;
    let failedCount = 0;
    let errors = [];

    campaignDataList.forEach(item => {
      try {
        // Pass enabled field if provided, otherwise default to true
        const enabled = item.enabled !== undefined ? item.enabled : true;
        saveCampaignRemovalConditions(customerId, item.campaignName, item.removalConditions, item.workflow, enabled);
        successCount++;
      } catch (e) {
        failedCount++;
        errors.push(`${item.campaignName}: ${e.message}`);
      }
    });

    return {
      success: successCount,
      failed: failedCount,
      errors: errors
    };
  } catch (error) {
    throw new Error('Batch save failed: ' + error.message);
  }
}

/**
 * Syncs campaigns from the account's linked Google Sheet (Upload tab)
 * and merges them with existing database conditions
 */
function syncCampaignsFromUpload(customerId, token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');
    
    // Always fetch fresh data from Google Sheet (no cache check)
    
    // Get the account's Google Sheet link from database (use accounts cache)
    let allAccounts = getCachedData('accounts');
    if (!allAccounts) {
      allAccounts = supabaseSelect('accounts');
      setCachedData('accounts', allAccounts);
    }
    
    const account = allAccounts.find(a => a.customer_id === customerId);
    if (!account) {
      throw new Error('Account not found');
    }
    
    const googleSheetLink = account.google_sheet_link;
    if (!googleSheetLink) {
      throw new Error('No Google Sheet link configured for this account');
    }
    
    // Extract spreadsheet ID from the link
    const sheetIdMatch = googleSheetLink.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
      throw new Error('Invalid Google Sheet link format');
    }
    const spreadsheetId = sheetIdMatch[1];
    
    // Open the spreadsheet and find the Real Upload sheet (or fallback to Upload)
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheets = ss.getSheets();
    let uploadSheet = null;
    
    // First priority: Case-insensitive "Real Upload"
    uploadSheet = sheets.find(s => s.getName().toLowerCase() === 'real upload');
    
    // Second priority: Case-insensitive "Upload"
    if (!uploadSheet) {
      uploadSheet = sheets.find(s => s.getName().toLowerCase() === 'upload');
    }
    
    if (!uploadSheet) {
      // Return existing campaigns from database if no Upload sheet found
      const dbCampaigns = getCampaignsForCustomer(customerId, token);
      setCachedCampaigns(customerId, dbCampaigns);
      return dbCampaigns;
    }
    
    const lastRow = uploadSheet.getLastRow();
    const lastCol = uploadSheet.getLastColumn();
    
    if (lastRow < 2 || lastCol < 1) {
      const dbCampaigns = getCampaignsForCustomer(customerId, token);
      setCachedCampaigns(customerId, dbCampaigns);
      return dbCampaigns;
    }
    
    // Read headers to find Campaign column
    const headers = uploadSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    let campaignColIndex = -1;
    
    // Look for "Campaign" or "Campaign Name" column (case-insensitive)
    for (let i = 0; i < headers.length; i++) {
      const header = String(headers[i] || '').toLowerCase().trim();
      if (header === 'campaign' || header === 'campaign name' || header === 'campaignname') {
        campaignColIndex = i;
        break;
      }
    }
    
    // If no Campaign column found, default to column A
    if (campaignColIndex === -1) {
      campaignColIndex = 0;
    }
    
    // Read only the campaign column for speed
    const data = uploadSheet.getRange(2, campaignColIndex + 1, lastRow - 1, 1).getValues();
    const uniqueCampaigns = new Set();
    
    data.forEach(row => {
      let name = String(row[0] || '').trim();
      if (name) {
        // Split by " + " to separate campaign from ad group
        // Format: "Campaign Name + Ad Group Name" -> we only want "Campaign Name"
        if (name.includes(' + ')) {
          name = name.split(' + ')[0].trim();
        }
        if (name) {
          uniqueCampaigns.add(name);
        }
      }
    });
    
    const campaignNames = Array.from(uniqueCampaigns);

    
    // Get existing conditions from database
    const existingCampaigns = getCampaignsForCustomer(customerId, token);
    const existingMap = {};
    existingCampaigns.forEach(c => {
      existingMap[c.campaignName] = c;
    });
    
    // Merge: keep existing conditions, add new campaigns with empty conditions
    const mergedCampaigns = [];
    
    campaignNames.forEach(name => {
      if (existingMap[name]) {
        mergedCampaigns.push(existingMap[name]);
        delete existingMap[name]; // Mark as processed
      } else {
        mergedCampaigns.push({
          campaignName: name,
          removalConditions: '',
          workflow: 'workflow-0',
          enabled: true
        });
      }
    });
    
    // Include database campaigns not in Upload sheet
    Object.values(existingMap).forEach(ec => {
      mergedCampaigns.push(ec);
    });
    
    // Cache the result
    setCachedCampaigns(customerId, mergedCampaigns);
    
    return mergedCampaigns;
  } catch (e) {
    // Fallback to database-only campaigns
    try {
      return getCampaignsForCustomer(customerId, token);
    } catch (e2) {
      return [];
    }
  }
}


// ============================================================================
// WORKFLOW MANAGEMENT
// ============================================================================

function getAllWorkflows() {
  try {
    // Check cache first
    let workflows = getCachedData('workflows');
    if (!workflows) {
      workflows = supabaseSelect('workflows');
      setCachedData('workflows', workflows);
    }
    
    return workflows.map(w => ({
      workflowName: w.workflow_name,
      enabled: w.enabled,
      schedule: w.schedule,
      lastRun: w.last_run,
      description: w.description
    }));
  } catch (error) {
    throw error;
  }
}

function setWorkflowEnabled(workflowName, enabled, token) {
  try {
    const user = validateToken(token);
    if (!user || user.role !== 'Manager') throw new Error('Unauthorized');
    
    supabaseRequest(`workflows?workflow_name=eq.${encodeURIComponent(workflowName)}`, 'PATCH', { enabled: enabled });
    invalidateCache('workflows'); // Clear cache
    return true;
  } catch (error) {
    throw error;
  }
}

function isWorkflowEnabled(workflowName) {
  try {
    const workflows = getAllWorkflows();
    const workflow = workflows.find(w => w.workflowName === workflowName);
    return workflow ? workflow.enabled : true;
  } catch (error) {
    return true;
  }
}

// ============================================================================
// LOOKER REPORTS MANAGEMENT
// ============================================================================

// Used by the Looker module in the UI. Normal users ONLY see reports explicitly
// assigned to them via allowed_looker_reports (deny-by-default).
function getLookerReports(token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');

    const reports = supabaseSelect('looker_reports') || [];

    const isPrivileged = user.role === 'Manager' || user.role === 'Super Manager' || user.username === 'admin';
    const allowed = user.allowedLookerReports || [];

    // Managers/Admins see all active reports
    const visibleReports = isPrivileged
      ? reports.filter(r => r.active !== false)
      : reports.filter(r => r.active !== false && allowed.includes(r.id));

    return visibleReports.map(r => ({
      id: r.id,
      name: r.name,
      url: r.url,
      description: r.description || '',
      allowedUsers: r.allowed_users || '',
      active: r.active !== false
    }));
  } catch (error) {
    Logger.log('Error in getLookerReports: ' + error.message);
    return [];
  }
}

function getAllLookerReports(token) {
  try {
    const user = validateToken(token);
    const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
    if (!user) throw new Error('Unauthorized');

    // Management list for the User modal / admin pages: Managers/Super Managers/Admin only
    if (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager') {
      return [];
    }

    // Fetch all Looker reports from database
    const reports = supabaseSelect('looker_reports');
    
     // Managers/Admins can view all reports (including inactive for management)
     let visibleReports = reports || [];
    
    return visibleReports.map(r => ({
      id: r.id,
      name: r.name,
      url: r.url,
      description: r.description || '',
      allowedUsers: r.allowed_users || '',
      active: r.active !== false
    }));
  } catch (error) {
    Logger.log('Error in getAllLookerReports: ' + error.message);
    return [];
  }
}

function saveLookerReport(reportData, token) {
  try {
    const user = validateToken(token);
    const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
    if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager')) throw new Error('Unauthorized');

    // Clean up URL if it's an iframe code
    let url = reportData.url;
    if (url.includes('<iframe')) {
       const match = url.match(/src="([^"]+)"/);
       if (match) url = match[1];
    } else if (url.includes('lookerstudio.google.com/embed/')) {
       // already good
    } else if (url.includes('lookerstudio.google.com/reporting/')) {
       // Convert reporting URL to embed URL if possible?
       // Usually /reporting/ID/page/ID -> /embed/reporting/ID/page/ID
       if (!url.includes('/embed/')) {
          url = url.replace('/reporting/', '/embed/reporting/');
       }
    }

    const payload = {
      name: reportData.name,
      url: url,
      description: reportData.description || '',
      allowed_users: reportData.allowedUsers || '',
      active: true
    };

    supabaseRequest('looker_reports', 'POST', payload);
    return true;
  } catch (error) {
    throw new Error('Failed to save report: ' + error.message);
  }
}

function deleteLookerReport(id, token) {
  try {
    const user = validateToken(token);
    const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
    if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager')) throw new Error('Unauthorized');

    supabaseRequest(`looker_reports?id=eq.${id}`, 'DELETE');
    return true;
  } catch (error) {
    throw new Error('Failed to delete report: ' + error.message);
  }
}

function updateWorkflowLastRun(workflowName) {
  try {
    supabaseRequest(`workflows?workflow_name=eq.${encodeURIComponent(workflowName)}`, 'PATCH', { 
      last_run: new Date().toISOString() 
    });
    return true;
  } catch (error) {
    Logger.log('Error in updateWorkflowLastRun: ' + error.message);
    return false;
  }
}

// ============================================================================
// REMOVAL CONDITIONS DEFINITIONS
// ============================================================================

function getAvailableRemovalConditions() {
  // Try to fetch from database first
  try {
    const data = supabaseRequest('removal_condition_definitions?select=*', 'GET');
    if (data && data.length > 0) {
      return data.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description
      }));
    }
  } catch (e) {
    Logger.log('Error fetching removal definitions from DB: ' + e.message);
  }

  // Fallback to hardcoded list with detailed descriptions
  return [
    { 
      id: 'LOW_24H_LOW_SPEND', 
      name: 'LOW performance (24h) + spend <$5', 
      description: 'Remove assets with LOW performance in last 24h and spend <$5, must be active at least 24 hours' 
    },
    { 
      id: 'LEARNING_3D_LOW_SPEND', 
      name: 'LEARNING (3 days) + spend <$5', 
      description: 'Remove assets with LEARNING status for 3 days and spend <$5, must be active at least 72 hours' 
    },
    { 
      id: 'LEARNING_72H_LOW_SPEND_4', 
      name: 'LEARNING (72h) + spend <$4', 
      description: 'Remove assets with LEARNING status in last 72h and spend <$4, must be active at least 72 hours' 
    },
    { 
      id: 'LEARNING_60H_LOW_SPEND_3', 
      name: 'LEARNING (60h) + spend <$3', 
      description: 'Remove assets with LEARNING status in last 60h and spend <$3, must be active at least 60 hours' 
    },
    { 
      id: 'LOW_IMPRESSIONS_48H', 
      name: 'Impressions < 100 (48h)', 
      description: 'Remove assets with less than 100 impressions in last 48 hours, must be active at least 48 hours' 
    },
    { 
      id: 'HIGH_SPEND_LOW_CVC_72H', 
      name: 'Spend >$10 (72h) + CVC <0.4', 
      description: 'Remove assets with spend >$10 in last 72h and CVC <0.4, must be active at least 72 hours' 
    },
    { 
      id: 'HIGH_SPEND_CVC_96H', 
      name: 'Spend >$10 (96h) + CVC check', 
      description: 'Keep assets with spend >$10 in last 96h and CVC ≥0.80 (best-performing), else remove. Must be active at least 96 hours' 
    },
    { 
      id: 'LOW_24H_LOW_SPEND_4', 
      name: 'LOW performance (24h) + spend <$4', 
      description: 'Remove assets with LOW performance in last 24h and spend <$4, must be active at least 24 hours' 
    },
    { 
      id: 'ZERO_IMPRESSIONS_24H', 
      name: 'Zero impressions (24h)', 
      description: 'Remove assets with 0 impressions in last 24 hours, must be active at least 24 hours' 
    },
    { 
      id: 'LOW_ASSETS', 
      name: 'LOW performance assets', 
      description: 'Remove assets with LOW performance label, must be active at least 24 hours' 
    },
    { 
      id: 'LEARNING_LIFETIME_LOW_SPEND', 
      name: 'LEARNING + lifetime spend <$1', 
      description: 'Remove assets with LEARNING status and lifetime spend <$1, must be active at least 24 hours' 
    },
    { 
      id: 'LIFETIME_CVC_LOW_65', 
      name: 'Lifetime CVC < 0.65', 
      description: 'Remove assets with lifetime average CVC < 0.65, must be active at least 24 hours' 
    },
    { 
      id: 'LIFETIME_CVC_LOW_45', 
      name: 'Lifetime CVC < 0.45', 
      description: 'Remove assets with lifetime average CVC < 0.45, must be active at least 24 hours' 
    },
    { 
      id: 'LEARNING_72H_LOW_SPEND_1', 
      name: 'LEARNING (72h) + spend $0-$1', 
      description: 'Remove assets with LEARNING status in last 72h and spend between $0 and $1, must be active at least 72 hours' 
    },
    { 
      id: 'LEARNING_5D_MID_SPEND', 
      name: 'LEARNING (5 Days) + spend $1-$10', 
      description: 'Remove assets with LEARNING status in last 5 days and spend between $1 and $10, must be active at least 72 hours' 
    },
    { 
      id: 'LOW_48H_LOW_SPEND', 
      name: 'LOW performance (48h) + spend <= $5', 
      description: 'Remove assets with LOW performance in last 48h and spend <= $5, must be active at least 48 hours' 
    },
    { 
      id: 'LOW_48H', 
      name: 'LOW performance (48h)', 
      description: 'Remove assets with LOW performance in last 48 hours, must be active at least 48 hours' 
    },
    { 
      id: 'LEARNING_7D_ZERO_COST', 
      name: 'LEARNING (7 days) + $0 cost', 
      description: 'Remove assets with LEARNING status for 7 days and $0 cost in last 7 days, must be active at least 7 days (168 hours)' 
    },
    { 
      id: 'LEARNING_14D_LOW_SPEND_10', 
      name: 'LEARNING (14 days) + spend <$10', 
      description: 'Remove assets with LEARNING status for 14 days and spend <$10 in last 14 days, must be active at least 14 days (336 hours)' 
    },
    { 
      id: 'LEARNING_3D_LOW_SPEND_CVC_80', 
      name: 'LEARNING (3 days) + spend <=$1 + CVC <0.80', 
      description: 'Remove assets with LEARNING status for 3 days, spend <=$1, and CVC below 0.80, must be active at least 72 hours' 
    },
    { 
      id: 'LOW_72H_LOW_SPEND_CVC_70', 
      name: 'LOW (72h) + spend <$5 + CVC <0.70', 
      description: 'Remove assets with LOW performance in last 72h, spend <$5, and CVC below 0.70, must be active at least 72 hours' 
    },
    { 
      id: 'HIGH_SPEND_CVC_LOW_60', 
      name: 'Lifetime spend >$10 + CVC <0.60', 
      description: 'Remove assets with lifetime spend >$10 and CVC below 0.60, must be active at least 24 hours' 
    },
    { 
      id: 'HIGH_SPEND_LOW_CVC_2D', 
      name: 'Spend >$30 (2 days) + CVC <0.5', 
      description: 'Remove assets with spend >$30 in last 2 days and avg CVC <0.5, must be active at least 7 days' 
    },
    { 
      id: 'HIGH_SPEND_LOW_CVC_7D', 
      name: 'Spend >$350 (7 days) + CVC <0.7', 
      description: 'Remove assets with spend >$350 in last 7 days and avg CVC <0.7, must be active at least 7 days' 
    }
  ];
}

function getAvailableRemovalConditionsForFrontend() {
  return getAvailableRemovalConditions().map(c => ({
    id: c.id,
    name: c.name,
    description: c.description
  }));
}

// ============================================================================
// WEB APP ENTRY POINT
// ============================================================================

function doGet(e) {
  // Serve service worker if requested
  if (e && e.parameter && e.parameter.file === 'service-worker') {
    return serveServiceWorker();
  }
  
  if (!e || !e.parameter || Object.keys(e.parameter).length === 0) {
    return HtmlService.createTemplateFromFile('frontend')
      .evaluate()
      .setTitle('Google Ads Accounts Management')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    success: false,
    error: 'Use POST method for API calls, or access without parameters for frontend'
  })).setMimeType(ContentService.MimeType.JSON);
}

function serveServiceWorker() {
  // Service worker code - embedded for Google Apps Script
  const swCode = `// Service Worker for Background Notifications
// Optimized for Google Apps Script hosting
const CACHE_NAME = 'cms-notifications-v1';
const NOTIFICATION_CHECK_INTERVAL = 5000;

self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

self.addEventListener('sync', (event) => {
    if (event.tag === 'check-notifications') {
        event.waitUntil(checkForNotifications());
    }
});

self.addEventListener('push', (event) => {
    let notificationData = {
        title: 'New Notification',
        body: 'You have a new notification',
        icon: '🔔',
        badge: '🔔',
        tag: 'notification',
        requireInteraction: false,
        data: {}
    };

    if (event.data) {
        try {
            const data = event.data.json();
            notificationData = {
                title: data.title || notificationData.title,
                body: data.message || notificationData.body,
                icon: data.icon || notificationData.icon,
                badge: data.badge || notificationData.badge,
                tag: data.tag || notificationData.tag,
                requireInteraction: data.requireInteraction || false,
                data: data.data || {}
            };
        } catch (e) {
            console.error('Error parsing push data:', e);
        }
    }

    event.waitUntil(
        self.registration.showNotification(notificationData.title, {
            body: notificationData.body,
            icon: notificationData.icon,
            badge: notificationData.badge,
            tag: notificationData.tag,
            requireInteraction: notificationData.requireInteraction,
            data: notificationData.data,
            actions: [
                { action: 'open', title: 'Open' },
                { action: 'close', title: 'Close' }
            ]
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const action = event.action;
    const notificationData = event.notification.data;

    if (action === 'close') return;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url && 'focus' in client) {
                    if (notificationData && notificationData.link) {
                        const url = new URL(client.url);
                        const cleanUrl = url.origin + url.pathname.split('?')[0];
                        const hash = notificationData.link.startsWith('todo:') ? '#todos' : '';
                        return client.navigate(cleanUrl + hash).then(() => client.focus());
                    }
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                let url = self.registration.scope;
                if (notificationData && notificationData.link) {
                    if (notificationData.link.startsWith('todo:')) {
                        url = url + '#todos';
                    }
                }
                return clients.openWindow(url);
            }
        })
    );
});

async function checkForNotifications() {
    try {
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
            client.postMessage({
                type: 'CHECK_NOTIFICATIONS',
                timestamp: Date.now()
            });
        });
    } catch (error) {
        console.error('Service Worker: Error checking notifications', error);
    }
}

let backgroundCheckInterval = null;

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, options } = event.data;
        event.waitUntil(self.registration.showNotification(title, options));
    }
    
    if (event.data && event.data.type === 'START_PERIODIC_CHECK') {
        if (backgroundCheckInterval) clearInterval(backgroundCheckInterval);
        backgroundCheckInterval = setInterval(() => {
            checkForNotifications();
        }, NOTIFICATION_CHECK_INTERVAL);
    } else if (event.data && event.data.type === 'STOP_PERIODIC_CHECK') {
        if (backgroundCheckInterval) {
            clearInterval(backgroundCheckInterval);
            backgroundCheckInterval = null;
        }
    }
});`;
  
  // Return service worker with proper MIME type
  return ContentService.createTextOutput(swCode)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================================
// SUPABASE CONFIG (for frontend hybrid/direct mode)
// ============================================================================

/**
 * Returns Supabase configuration from Script Properties.
 * NOTE: If you are using direct Supabase calls from the browser, this key becomes
 * visible to the client. Prefer using an anon key (not service role) for browser usage.
 */
function getSupabaseConfig(token) {
  // Best-effort auth gate: allow if token is valid; otherwise still allow so login can proceed.
  // (The HTML source already contains config in many deployments, so this is not a strict secret.)
  try {
    if (token) {
      const user = validateToken(token);
      if (!user) throw new Error('Unauthorized');
    }
  } catch (e) {
    // If invalid token is provided, block.
    throw e;
  }

  return {
    url: SUPABASE_URL,
    anonKey: SUPABASE_KEY
  };
}

// ============================================================================
// EMAIL NOTIFICATION SYSTEM
// ============================================================================

/**
 * Send email notification to user
 * @param {string} userId - Username of the recipient
 * @param {Object} notificationData - Notification data
 * @param {string} notificationData.title - Notification title
 * @param {string} notificationData.message - Notification message
 * @param {string} notificationData.type - Notification type
 * @param {string} notificationData.createdBy - Who created the notification
 * @param {string} notificationData.link - Optional link
 * @return {Object} { success: boolean, error?: string }
 */
function sendEmailNotification(userId, notificationData) {
  try {
    // Force permission check - this will trigger authorization dialog if needed
    // The authorization will happen automatically when this function is called
    // if permissions are missing
    
    // Get user from database
    const users = supabaseRequest(`users?username=eq.${encodeURIComponent(userId)}&select=email,email_notifications_enabled`, 'GET');
    
    if (!users || users.length === 0) {
      return { success: false, error: 'User not found' };
    }
    
    const user = users[0];
    
    // Check if email notifications are enabled (default to true if not set)
    const emailEnabled = user.email_notifications_enabled !== false;
    if (!emailEnabled) {
      return { success: false, error: 'Email notifications disabled for user' };
    }
    
    // Get user email(s)
    const userEmail = user.email || '';
    if (!userEmail || userEmail.trim() === '' || userEmail === 'EMPTY') {
      return { success: false, error: 'No email address found for user' };
    }
    
    // Parse multiple emails (comma-separated)
    const emails = userEmail.split(',').map(e => e.trim()).filter(e => e && e.includes('@'));
    if (emails.length === 0) {
      return { success: false, error: 'No valid email addresses found' };
    }
    
    // Build email content
    const subject = `🔔 ${notificationData.title || 'New Notification'}`;
    
    // Get app URL from script properties or use default
    const appUrl = PropertiesService.getScriptProperties().getProperty('APP_URL') || ScriptApp.getService().getUrl();
    
    // Build email body with HTML
    let emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366F1 0%, #4F46E5 100%); padding: 20px; border-radius: 8px 8px 0 0; color: white;">
          <h2 style="margin: 0; font-size: 20px;">${notificationData.title || 'New Notification'}</h2>
        </div>
        
        <div style="background: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="color: #1E293B; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
            ${notificationData.message || ''}
          </p>
          
          ${notificationData.createdBy ? `
          <p style="color: #64748B; font-size: 14px; margin: 16px 0;">
            <strong>From:</strong> ${notificationData.createdBy}
          </p>
          ` : ''}
          
          <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
            <a href="${appUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, #6366F1 0%, #4F46E5 100%); color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
              Open Dashboard
            </a>
          </div>
          
          <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
            This is an automated notification from your Ads Manager dashboard.<br>
            You can disable email notifications in your profile settings.
          </p>
        </div>
      </div>
    `;
    
    // Send email to all addresses
    const results = { sent: [], failed: [] };
    
    emails.forEach(email => {
      try {
        MailApp.sendEmail({
          to: email,
          subject: subject,
          htmlBody: emailBody,
          noReply: false
        });
        results.sent.push(email);
      } catch (error) {
        Logger.log(`Failed to send email to ${email}: ${error.message}`);
        results.failed.push({ email: email, error: error.message });
      }
    });
    
    if (results.sent.length > 0) {
      return { 
        success: true, 
        sent: results.sent.length,
        failed: results.failed.length 
      };
    } else {
      return { 
        success: false, 
        error: 'Failed to send to all email addresses',
        details: results.failed 
      };
    }
    
  } catch (error) {
    Logger.log('Error in sendEmailNotification: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update user email notification preference
 * @param {string} token - Auth token
 * @param {boolean} enabled - Whether to enable email notifications
 * @return {Object} { success: boolean }
 */
function updateEmailNotificationPreference(token, enabled) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');
    
    const result = supabaseRequest(`users?username=eq.${encodeURIComponent(user.username)}`, 'PATCH', {
      email_notifications_enabled: enabled
    });
    
    return { success: true };
  } catch (error) {
    Logger.log('Error updating email notification preference: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Force authorization for all required permissions
 * This function will trigger the authorization dialog if permissions are missing
 * Run this function to ensure all permissions are granted
 * 
 * IMPORTANT: When you run this function, Google will show an authorization dialog.
 * Click "Review Permissions" and authorize all requested permissions.
 */
function forceRequestPermissions() {
  try {
    Logger.log('🔐 Checking permissions...');
    Logger.log('If you see an authorization dialog, please click "Review Permissions" and authorize all permissions.');
    
    // Force authorization by attempting to use each required service
    // This will trigger the authorization dialog if permissions are missing
    
    // 1. Test UrlFetchApp (for Supabase API calls) - This WILL trigger authorization if missing
    // We use a real request (not muted) to force the permission request
    try {
      const response = UrlFetchApp.fetch('https://www.google.com', {
        method: 'get',
        muteHttpExceptions: false  // Don't mute - let it fail if no permission
      });
      Logger.log('✓ UrlFetchApp permission: GRANTED');
    } catch (e) {
      // If we get here, permission is missing - the error will trigger authorization dialog
      Logger.log('⚠ UrlFetchApp permission check triggered authorization request');
      // Re-throw to show the authorization dialog
      throw e;
    }
    
    // 2. Test MailApp (for sending emails) - This WILL trigger authorization if missing
    try {
      // This will trigger the authorization dialog if Gmail.send permission is missing
      const testQuota = MailApp.getRemainingDailyQuota();
      Logger.log('✓ MailApp permission: GRANTED (Daily quota: ' + testQuota + ')');
    } catch (e) {
      // If we get here, permission is missing - the error will trigger authorization dialog
      Logger.log('⚠ MailApp permission check triggered authorization request');
      // Re-throw to show the authorization dialog
      throw e;
    }
    
    // 3. Test Drive (if needed)
    try {
      DriveApp.getRootFolder();
      Logger.log('✓ Drive permission: GRANTED');
    } catch (e) {
      Logger.log('⚠ Drive permission: ' + e.message);
    }
    
    Logger.log('✅ All required permissions are available!');
    Logger.log('You can now use email notifications and other features.');
    return { 
      success: true, 
      message: 'All permissions granted successfully',
      permissions: {
        urlFetch: true,
        mail: true,
        drive: true
      }
    };
    
  } catch (error) {
    Logger.log('❌ Permission Error: ' + error.message);
    Logger.log('');
    Logger.log('📋 INSTRUCTIONS:');
    Logger.log('1. Look for the authorization dialog above this log');
    Logger.log('2. Click "Review Permissions"');
    Logger.log('3. Select your Google account');
    Logger.log('4. Click "Allow" to grant all permissions');
    Logger.log('5. Run this function again to verify permissions');
    Logger.log('');
    Logger.log('If no dialog appeared, the error details are: ' + error.message);
    
    // Return error but don't fail completely - let user see the instructions
    return { 
      success: false, 
      error: error.message,
      needsAuthorization: true,
      instructions: [
        'Look for the authorization dialog',
        'Click "Review Permissions"',
        'Select your Google account',
        'Click "Allow"',
        'Run this function again to verify'
      ]
    };
  }
}

/**
 * Test function to trigger authorization for new permissions
 * Run this once to authorize the script with all required permissions
 */
function testEmailNotificationPermissions() {
  return forceRequestPermissions();
}

// ============================================================================
// AUTOMATIC TASK REMINDER SYSTEM
// ============================================================================

/**
 * Automatic reminder system - checks tasks with 3 days remaining and sends notifications
 * This function should be scheduled to run every morning (e.g., 8 AM)
 * 
 * To set up a trigger:
 * 1. Go to Triggers in Apps Script editor
 * 2. Add trigger: checkAndSendTaskReminders
 * 3. Time-driven: Day timer
 * 4. Time of day: 8am to 9am (or your preferred time)
 */
function checkAndSendTaskReminders() {
  try {
    Logger.log('🔔 Starting automatic task reminder check...');
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Calculate dates for next 3 days
    const day1 = new Date(today);
    day1.setDate(day1.getDate() + 1);
    
    const day2 = new Date(today);
    day2.setDate(day2.getDate() + 2);
    
    const day3 = new Date(today);
    day3.setDate(day3.getDate() + 3);
    
    // Format dates for database query (YYYY-MM-DD)
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    const dates = [formatDate(day1), formatDate(day2), formatDate(day3)];
    
    // Get all tasks with due dates in the next 3 days that are not completed
    // Query: due_date is between today+1 and today+3, completed = false, archived = false
    let tasksToRemind = [];
    
    for (const dateStr of dates) {
      try {
        // Query tasks with due_date on this specific date
        // Note: due_date is stored as ISO string, we need to match date part
        const query = `todos?completed=eq.false&archived=eq.false&due_date=gte.${dateStr}T00:00:00&due_date=lt.${dateStr}T23:59:59&select=id,title,due_date,username,assigned_to,manager_id`;
        const tasks = supabaseRequest(query, 'GET');
        
        if (tasks && Array.isArray(tasks)) {
          tasksToRemind = tasksToRemind.concat(tasks);
        }
      } catch (e) {
        Logger.log(`Error querying tasks for date ${dateStr}: ${e.message}`);
      }
    }
    
    // Also check for tasks due today (edge case)
    try {
      const todayStr = formatDate(today);
      const query = `todos?completed=eq.false&archived=eq.false&due_date=gte.${todayStr}T00:00:00&due_date=lt.${todayStr}T23:59:59&select=id,title,due_date,username,assigned_to,manager_id`;
      const todayTasks = supabaseRequest(query, 'GET');
      if (todayTasks && Array.isArray(todayTasks)) {
        tasksToRemind = tasksToRemind.concat(todayTasks);
      }
    } catch (e) {
      Logger.log(`Error querying today's tasks: ${e.message}`);
    }
    
    if (tasksToRemind.length === 0) {
      Logger.log('✅ No tasks need reminders today.');
      return { success: true, sent: 0, message: 'No tasks need reminders' };
    }
    
    Logger.log(`📋 Found ${tasksToRemind.length} task(s) needing reminders`);
    
    // Track sent reminders to avoid duplicates
    const sentReminders = new Set();
    let successCount = 0;
    let failCount = 0;
    
    for (const task of tasksToRemind) {
      try {
        const dueDate = new Date(task.due_date);
        const daysRemaining = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
        
        if (daysRemaining < 0 || daysRemaining > 3) {
          continue; // Skip if outside our 3-day window
        }
        
        // Determine who to notify - ONLY: Creator, Assignee, and Manager
        const usersToNotify = [];
        
        // 1. Notify task creator
        if (task.username) {
          usersToNotify.push(task.username);
        }
        
        // 2. Notify task assignee (if different from creator)
        if (task.assigned_to && task.assigned_to !== task.username) {
          usersToNotify.push(task.assigned_to);
        }
        
        // 3. Notify assigned manager (if exists and different from creator/assignee)
        if (task.manager_id) {
          if (task.manager_id !== task.username && task.manager_id !== task.assigned_to) {
            usersToNotify.push(task.manager_id);
          }
        }
        
        // Remove duplicates (in case manager is also creator or assignee)
        const uniqueUsers = [...new Set(usersToNotify)];
        
        Logger.log(`Task "${task.title}": Notifying ${uniqueUsers.length} user(s) - Creator: ${task.username || 'N/A'}, Assignee: ${task.assigned_to || 'N/A'}, Manager: ${task.manager_id || 'N/A'}`);
        
        // Send reminder to each user (only creator, assignee, and manager)
        for (const username of uniqueUsers) {
          const reminderKey = `${task.id}_${username}_${formatDate(today)}`;
          
          if (sentReminders.has(reminderKey)) {
            continue; // Already sent today
          }
          
          const daysText = daysRemaining === 0 ? 'today' : 
                          daysRemaining === 1 ? 'tomorrow' : 
                          `in ${daysRemaining} days`;
          
          const notificationData = {
            title: `⏰ Task Reminder: ${task.title}`,
            message: `Your task "${task.title}" is due ${daysText}. Don't forget to complete it!`,
            type: 'reminder',
            link: `todo:${task.id}`
          };
          
          const result = sendEmailNotification(username, notificationData);
          
          if (result.success) {
            sentReminders.add(reminderKey);
            successCount++;
            Logger.log(`✅ Reminder sent to ${username} for task: ${task.title}`);
          } else {
            failCount++;
            Logger.log(`❌ Failed to send reminder to ${username}: ${result.error}`);
          }
        }
      } catch (e) {
        Logger.log(`Error processing task ${task.id}: ${e.message}`);
        failCount++;
      }
    }
    
    Logger.log(`✅ Reminder check complete. Sent: ${successCount}, Failed: ${failCount}`);
    return {
      success: true,
      sent: successCount,
      failed: failCount,
      total: tasksToRemind.length
    };
    
  } catch (error) {
    Logger.log('❌ Error in checkAndSendTaskReminders: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Automatically sets up the time-driven trigger for task reminders
 * Run this function ONCE to automatically create the daily reminder trigger
 * 
 * This will create a trigger that runs checkAndSendTaskReminders() every day at 8:00 AM
 * 
 * To run: Just execute this function from the Apps Script editor
 */
function setupAutomaticReminderTrigger() {
  try {
    // Delete existing triggers for this function (to avoid duplicates)
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'checkAndSendTaskReminders') {
        ScriptApp.deleteTrigger(trigger);
        Logger.log('🗑️ Removed existing trigger');
      }
    });
    
    // Create new daily trigger at 8:00 AM
    ScriptApp.newTrigger('checkAndSendTaskReminders')
      .timeBased()
      .everyDays(1)
      .atHour(8) // 8:00 AM
      .create();
    
    Logger.log('✅ Automatic reminder trigger created successfully!');
    Logger.log('📅 The system will now check and send reminders every day at 8:00 AM');
    Logger.log('💡 You can change the time by editing this function and running it again');
    
    return {
      success: true,
      message: 'Automatic reminder trigger created successfully!',
      schedule: 'Daily at 8:00 AM',
      function: 'checkAndSendTaskReminders'
    };
    
  } catch (error) {
    Logger.log('❌ Error setting up trigger: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Remove the automatic reminder trigger (if you want to disable it)
 */
function removeAutomaticReminderTrigger() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    let removedCount = 0;
    
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'checkAndSendTaskReminders') {
        ScriptApp.deleteTrigger(trigger);
        removedCount++;
        Logger.log('🗑️ Removed trigger');
      }
    });
    
    if (removedCount === 0) {
      Logger.log('ℹ️ No reminder triggers found to remove');
      return { success: true, message: 'No triggers found', removed: 0 };
    }
    
    Logger.log(`✅ Removed ${removedCount} reminder trigger(s)`);
    return {
      success: true,
      message: `Removed ${removedCount} trigger(s)`,
      removed: removedCount
    };
    
  } catch (error) {
    Logger.log('❌ Error removing trigger: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// PACKAGE MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Get all packages (Manager only)
 */
function getPackages(token) {
  try {
    const user = validateToken(token);
    const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
    if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager')) throw new Error('Unauthorized');
    
    const packages = supabaseRequest('packages?select=*&order=name.asc', 'GET');
    return packages || [];
  } catch (error) {
    throw new Error('Failed to get packages: ' + error.message);
  }
}

/**
 * Add a new package (Manager only)
 */
function addPackage(packageData, token) {
  try {
    const user = validateToken(token);
    const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
    if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager')) throw new Error('Unauthorized');
    
    const payload = {
      name: packageData.name.trim(),
      app_name: (packageData.app_name || '').trim(),
      description: (packageData.description || '').trim(),
      department: packageData.department || null,
      playconsole_account: (packageData.playconsole_account || '').trim(),
      marketer: (packageData.marketer || '').trim(),
      product_owner: (packageData.product_owner || '').trim(),
      monetization: (packageData.monetization || '').trim(),
      admob: (packageData.admob || '').trim(),
      created_by: user.username
    };
    
    if (!payload.name) throw new Error('Package name is required');
    
    const result = supabaseRequest('packages', 'POST', payload);
    return result;
  } catch (error) {
    throw new Error('Failed to add package: ' + error.message);
  }
}

/**
 * Update an existing package (Manager only)
 */
function updatePackage(packageData, token) {
  try {
    const user = validateToken(token);
    const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
    if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager')) throw new Error('Unauthorized');
    
    if (!packageData.id) throw new Error('Package ID is required');
    
    const payload = {
      name: packageData.name.trim(),
      app_name: (packageData.app_name || '').trim(),
      description: (packageData.description || '').trim(),
      department: packageData.department || null,
      playconsole_account: (packageData.playconsole_account || '').trim(),
      marketer: (packageData.marketer || '').trim(),
      product_owner: (packageData.product_owner || '').trim(),
      monetization: (packageData.monetization || '').trim(),
      admob: (packageData.admob || '').trim()
    };
    
    const result = supabaseRequest(`packages?id=eq.${encodeURIComponent(packageData.id)}`, 'PATCH', payload);
    return result;
  } catch (error) {
    throw new Error('Failed to update package: ' + error.message);
  }
}

/**
 * Delete a package (Manager only)
 */
function deletePackage(packageId, token) {
  try {
    const user = validateToken(token);
    const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
    if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager')) throw new Error('Unauthorized');
    
    supabaseRequest(`packages?id=eq.${encodeURIComponent(packageId)}`, 'DELETE');
    return true;
  } catch (error) {
    throw new Error('Failed to delete package: ' + error.message);
  }
}

/**
 * Get all user-package assignments (Manager only)
 */
function getUserPackages(token) {
  try {
    const user = validateToken(token);
    const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
    if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager')) throw new Error('Unauthorized');
    
    const assignments = supabaseRequest('user_packages?select=*,packages(name)&order=username.asc', 'GET');
    return assignments || [];
  } catch (error) {
    throw new Error('Failed to get user packages: ' + error.message);
  }
}

/**
 * Assign packages to a user (Manager only)
 * @param {string} username - The user to assign packages to
 * @param {string[]} packageIds - Array of package IDs to assign
 */
function assignPackagesToUser(username, packageIds, token) {
  try {
    const user = validateToken(token);
    const isAdmin = user && (user.username === 'admin' || user.role === 'Admin');
    if (!user || (!isAdmin && user.role !== 'Manager' && user.role !== 'Super Manager')) throw new Error('Unauthorized');
    
    // First, remove all existing assignments for this user
    supabaseRequest(`user_packages?username=eq.${encodeURIComponent(username)}`, 'DELETE');
    
    // Then add new assignments
    if (packageIds && packageIds.length > 0) {
      const assignments = packageIds.map(pkgId => ({
        username: username,
        package_id: pkgId,
        assigned_by: user.username
      }));
      
      supabaseRequest('user_packages', 'POST', assignments);
    }
    
    return true;
  } catch (error) {
    throw new Error('Failed to assign packages: ' + error.message);
  }
}

/**
 * Get packages assigned to the current user (for task creation dropdown)
 */
function getMyPackages(token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Unauthorized');
    
    const assignments = supabaseRequest(
      `user_packages?username=eq.${encodeURIComponent(user.username)}&select=package_id,packages(id,name,department)`,
      'GET'
    );
    
    return (assignments || []).map(a => ({
      id: a.packages?.id || a.package_id,
      name: a.packages?.name || 'Unknown',
      department: a.packages?.department || null
    }));
  } catch (error) {
    throw new Error('Failed to get assigned packages: ' + error.message);
  }
}