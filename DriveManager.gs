/**
 * Google Drive Manager Module
 * Supports Manager (full access) and User (restricted to allowed folders)
 * 
 * This file integrates with Code.gs - functions like isManager() and validateToken() 
 * are available from Code.gs since all .gs files share the same namespace.
 */

// ============================================================================
// GOOGLE DRIVE MANAGER (Manager = Full Access, User = Restricted Access)
// ============================================================================

/**
 * Checks if a folder is within the user's allowed folders (or their descendants)
 * @param {string} folderId - Folder ID to check
 * @param {Array<string>} allowedFolders - List of allowed folder IDs
 * @return {boolean}
 */
function isFolderAllowed(folderId, allowedFolders) {
  if (!allowedFolders || allowedFolders.length === 0) return false;
  if (allowedFolders.includes(folderId)) return true;
  
  // Check if this folder is a descendant of any allowed folder
  try {
    let folder = DriveApp.getFolderById(folderId);
    let maxDepth = 20; // Prevent infinite loops
    
    while (maxDepth > 0) {
      const parents = folder.getParents();
      if (!parents.hasNext()) break;
      
      folder = parents.next();
      if (allowedFolders.includes(folder.getId())) {
        return true;
      }
      maxDepth--;
    }
  } catch (e) {
    return false;
  }
  
  return false;
}

/**
 * Gets the contents of a Google Drive folder
 * - Managers: Full access to all folders
 * - Users: Access only to their assigned folders and subfolders
 * @param {string} folderId - The folder ID (null or 'root' for My Drive root / User's folder list)
 * @param {string} token - Auth token
 * @return {Object} { success: boolean, items: Array, currentFolder: Object, breadcrumbs: Array }
 */
function getDriveFolderContents(folderId, token) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    const isManagerUser = user.role === 'Manager';
    const allowedFolders = user.allowedDriveFolders || [];
    
    // For regular users with no assigned folders
    if (!isManagerUser && allowedFolders.length === 0) {
      return {
        success: true,
        items: [],
        currentFolder: { id: 'root', name: 'My Folders' },
        breadcrumbs: [{ id: 'root', name: 'My Folders' }],
        totalItems: 0,
        message: 'No folders have been shared with you yet. Please contact your administrator.'
      };
    }
    
    // For regular users accessing "root" - show their allowed folders
    if (!isManagerUser && (!folderId || folderId === 'root')) {
      const items = [];
      
      for (const fId of allowedFolders) {
        try {
          const f = DriveApp.getFolderById(fId.trim());
          items.push({
            id: f.getId(),
            name: f.getName(),
            type: 'folder',
            mimeType: 'application/vnd.google-apps.folder',
            size: null,
            modifiedDate: f.getLastUpdated().toISOString(),
            createdDate: f.getDateCreated().toISOString(),
            url: f.getUrl(),
            icon: '📁'
          });
        } catch (e) {
          // Try to fetch as file (e.g. specific Sheet)
          try {
             const f = DriveApp.getFileById(fId.trim());
             const mime = f.getMimeType();
             let icon = '📄';
             if (mime.includes('spreadsheet')) icon = '📊';
             else if (mime.includes('document')) icon = '📝';
             else if (mime.includes('presentation')) icon = '📑';
             else if (mime.includes('image')) icon = '🖼️';
             else if (mime.includes('pdf')) icon = '📕';

             items.push({
                 id: f.getId(),
                 name: f.getName(),
                 type: 'file',
                 mimeType: mime,
                 size: f.getSize(),
                 modifiedDate: f.getLastUpdated().toISOString(),
                 createdDate: f.getDateCreated().toISOString(),
                 url: f.getUrl(),
                 icon: icon
             });
          } catch (e2) {
             Logger.log('User cannot access item: ' + fId);
          }
        }
      }
      
      items.sort((a, b) => a.name.localeCompare(b.name));
      
      return {
        success: true,
        items: items,
        currentFolder: { id: 'root', name: 'My Folders' },
        breadcrumbs: [{ id: 'root', name: 'My Folders' }],
        totalItems: items.length
      };
    }
    
    // For regular users - check access to the folder
    if (!isManagerUser && folderId && folderId !== 'root') {
      if (!isFolderAllowed(folderId, allowedFolders)) {
        throw new Error('You do not have permission to access this folder');
      }
    }
    
    // Get folder contents (same logic for both managers and authorized users)
    let folder;
    if (!folderId || folderId === 'root' || folderId === '') {
      folder = DriveApp.getRootFolder();
      folderId = 'root';
    } else {
      folder = DriveApp.getFolderById(folderId);
    }
    
    const items = [];
    
    // Get all subfolders
    const folders = folder.getFolders();
    while (folders.hasNext()) {
      const f = folders.next();
      items.push({
        id: f.getId(),
        name: f.getName(),
        type: 'folder',
        mimeType: 'application/vnd.google-apps.folder',
        size: null,
        modifiedDate: f.getLastUpdated().toISOString(),
        createdDate: f.getDateCreated().toISOString(),
        url: f.getUrl(),
        icon: '📁'
      });
    }
    
    // Get all files
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const mimeType = file.getMimeType();
      let icon = '📄';
      
      // Set icon based on mime type
      if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
        icon = '📊';
      } else if (mimeType.includes('document') || mimeType.includes('word')) {
        icon = '📝';
      } else if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
        icon = '📑';
      } else if (mimeType.includes('image')) {
        icon = '🖼️';
      } else if (mimeType.includes('video')) {
        icon = '🎬';
      } else if (mimeType.includes('audio')) {
        icon = '🎵';
      } else if (mimeType.includes('pdf')) {
        icon = '📕';
      } else if (mimeType.includes('zip') || mimeType.includes('archive')) {
        icon = '🗜️';
      }
      
      items.push({
        id: file.getId(),
        name: file.getName(),
        type: 'file',
        mimeType: mimeType,
        size: file.getSize(),
        modifiedDate: file.getLastUpdated().toISOString(),
        createdDate: file.getDateCreated().toISOString(),
        url: file.getUrl(),
        icon: icon,
        thumbnailUrl: mimeType.includes('image') ? `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w400` : null,
        viewUrl: mimeType.includes('image') ? `https://drive.google.com/uc?id=${file.getId()}` : file.getUrl()
      });
    }
    
    // Sort: folders first, then files, both alphabetically
    items.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });
    
    // Build breadcrumbs
    const breadcrumbs = [];
    if (folderId !== 'root') {
      let current = folder;
      const path = [];
      
      // Build path from current folder to root
      while (current) {
        try {
          path.unshift({ id: current.getId(), name: current.getName() });
          const parents = current.getParents();
          current = parents.hasNext() ? parents.next() : null;
        } catch (e) {
          break;
        }
      }
      
      // For regular users, start breadcrumb from "My Folders"
      if (!isManagerUser) {
        breadcrumbs.push({ id: 'root', name: 'My Folders' });
      } else {
        breadcrumbs.push({ id: 'root', name: 'My Drive' });
      }
      
      // Add path (skip the root which has no proper parent representation)
      path.forEach(p => {
        if (p.id !== DriveApp.getRootFolder().getId()) {
          breadcrumbs.push(p);
        }
      });
    } else {
      breadcrumbs.push({ id: 'root', name: isManagerUser ? 'My Drive' : 'My Folders' });
    }
    
    return {
      success: true,
      items: items,
      currentFolder: {
        id: folderId,
        name: folderId === 'root' 
          ? (isManagerUser ? 'My Drive' : 'My Folders') 
          : folder.getName()
      },
      breadcrumbs: breadcrumbs,
      totalItems: items.length
    };
    
  } catch (error) {
    Logger.log('Error in getDriveFolderContents: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Checks if user has write permission to a folder
 * - Managers: Can write anywhere
 * - Users: Can only write in their allowed folders or subfolders
 */
function canWriteToFolder(user, folderId) {
  if (user.role === 'Manager') return true;

  // 1. Must be an Editor
  if (user.driveAccessLevel !== 'editor') return false;
  
  const allowedFolders = user.allowedDriveFolders || [];
  if (allowedFolders.length === 0) return false;
  
  // Root for User is virtual (My Folders), so they can't write to "root" itself
  if (!folderId || folderId === 'root') return false;
  
  // Check if they have access to this folder or its parents
  return isFolderAllowed(folderId, allowedFolders);
}

/**
 * Creates a new folder in Google Drive
 * @param {string} folderName - Name of the new folder
 * @param {string} parentFolderId - Parent folder ID (null or 'root' for My Drive root)
 * @param {string} token - Auth token
 * @return {Object} { success: boolean, folder: Object }
 */
function createDriveFolder(folderName, parentFolderId, token) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    if (!canWriteToFolder(user, parentFolderId)) {
      throw new Error('Permission denied: You cannot create folders in this location');
    }
    
    if (!folderName || folderName.trim() === '') {
      throw new Error('Folder name cannot be empty');
    }
    
    let parentFolder;
    if (!parentFolderId || parentFolderId === 'root') {
      parentFolder = DriveApp.getRootFolder();
    } else {
      parentFolder = DriveApp.getFolderById(parentFolderId);
    }
    
    const newFolder = parentFolder.createFolder(folderName.trim());
    
    return {
      success: true,
      folder: {
        id: newFolder.getId(),
        name: newFolder.getName(),
        url: newFolder.getUrl()
      }
    };
    
  } catch (error) {
    Logger.log('Error in createDriveFolder: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Creates a new Google Sheets document
 * @param {string} fileName - Name of the new spreadsheet
 * @param {string} parentFolderId - Parent folder ID
 * @param {string} token - Auth token
 * @return {Object} { success: boolean, file: Object }
 */
function createDriveSheet(fileName, parentFolderId, token) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    if (!canWriteToFolder(user, parentFolderId)) {
      throw new Error('Permission denied: You cannot create files in this location');
    }
    
    if (!fileName || fileName.trim() === '') {
      throw new Error('File name cannot be empty');
    }
    
    // Create the spreadsheet
    const ss = SpreadsheetApp.create(fileName.trim());
    const file = DriveApp.getFileById(ss.getId());
    
    // Move to target folder if not root
    if (parentFolderId && parentFolderId !== 'root') {
      const targetFolder = DriveApp.getFolderById(parentFolderId);
      file.moveTo(targetFolder);
    }
    
    return {
      success: true,
      file: {
        id: file.getId(),
        name: file.getName(),
        url: ss.getUrl(),
        mimeType: file.getMimeType()
      }
    };
    
  } catch (error) {
    Logger.log('Error in createDriveSheet: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Creates a new Google Docs document
 * @param {string} fileName - Name of the new document
 * @param {string} parentFolderId - Parent folder ID
 * @param {string} token - Auth token
 * @return {Object} { success: boolean, file: Object }
 */
function createDriveDoc(fileName, parentFolderId, token) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    if (!canWriteToFolder(user, parentFolderId)) {
      throw new Error('Permission denied: You cannot create files in this location');
    }
    
    if (!fileName || fileName.trim() === '') {
      throw new Error('File name cannot be empty');
    }
    
    // Create the document
    const doc = DocumentApp.create(fileName.trim());
    const file = DriveApp.getFileById(doc.getId());
    
    // Move to target folder if not root
    if (parentFolderId && parentFolderId !== 'root') {
      const targetFolder = DriveApp.getFolderById(parentFolderId);
      file.moveTo(targetFolder);
    }
    
    return {
      success: true,
      file: {
        id: file.getId(),
        name: file.getName(),
        url: doc.getUrl(),
        mimeType: file.getMimeType()
      }
    };
    
  } catch (error) {
    Logger.log('Error in createDriveDoc: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Creates a new Google Slides presentation
 * @param {string} fileName - Name of the new presentation
 * @param {string} parentFolderId - Parent folder ID
 * @param {string} token - Auth token
 * @return {Object} { success: boolean, file: Object }
 */
function createDriveSlides(fileName, parentFolderId, token) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    if (!canWriteToFolder(user, parentFolderId)) {
      throw new Error('Permission denied: You cannot create files in this location');
    }
    
    if (!fileName || fileName.trim() === '') {
      throw new Error('File name cannot be empty');
    }
    
    // Create the presentation
    const presentation = SlidesApp.create(fileName.trim());
    const file = DriveApp.getFileById(presentation.getId());
    
    // Move to target folder if not root
    if (parentFolderId && parentFolderId !== 'root') {
      const targetFolder = DriveApp.getFolderById(parentFolderId);
      file.moveTo(targetFolder);
    }
    
    return {
      success: true,
      file: {
        id: file.getId(),
        name: file.getName(),
        url: presentation.getUrl(),
        mimeType: file.getMimeType()
      }
    };
    
  } catch (error) {
    Logger.log('Error in createDriveSlides: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Gets or creates the Task Attachments folder in Drive
 * This folder is used to organize all task attachments
 * @return {Folder} The Task Attachments folder
 */
function getOrCreateTaskAttachmentsFolder() {
  const folderName = 'Task Attachments';
  const rootFolder = DriveApp.getRootFolder();
  
  // Search for existing folder
  const folders = rootFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    const folder = folders.next();
    Logger.log('Found existing Task Attachments folder: ' + folder.getId());
    return folder;
  }
  
  // Create folder if it doesn't exist
  const newFolder = rootFolder.createFolder(folderName);
  Logger.log('Created new Task Attachments folder: ' + newFolder.getId());
  return newFolder;
}

/**
 * Gets or creates a task-specific folder within Task Attachments
 * This organizes files by task ID for better management
 * @param {string} todoId - The task ID
 * @return {Folder} The task-specific folder
 */
function getOrCreateTaskFolder(todoId) {
  if (!todoId) {
    // If no task ID, use main Task Attachments folder
    return getOrCreateTaskAttachmentsFolder();
  }
  
  const mainFolder = getOrCreateTaskAttachmentsFolder();
  const taskFolderName = 'Task-' + todoId.substring(0, 8); // Use first 8 chars of UUID for folder name
  
  // Search for existing task folder
  const folders = mainFolder.getFoldersByName(taskFolderName);
  if (folders.hasNext()) {
    const folder = folders.next();
    Logger.log('Found existing task folder: ' + taskFolderName + ' (' + folder.getId() + ')');
    return folder;
  }
  
  // Create task folder if it doesn't exist
  const newTaskFolder = mainFolder.createFolder(taskFolderName);
  Logger.log('Created new task folder: ' + taskFolderName + ' (' + newTaskFolder.getId() + ')');
  return newTaskFolder;
}

/**
 * Uploads a file to Google Drive
 * Task attachments are saved to a dedicated "Task Attachments" folder, organized by task ID
 * @param {string} base64Data - The file data as base64 string
 * @param {string} fileName - Name of the file
 * @param {string} mimeType - MIME type of the file
 * @param {string} parentFolderId - Parent folder ID (if 'root' or null, uses Task Attachments folder)
 * @param {string} token - Auth token
 * @param {string} todoId - Optional task ID for organizing files by task
 * @return {Object} { success: boolean, file: Object }
 */
function uploadFileToDrive(base64Data, fileName, mimeType, parentFolderId, token, todoId) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    // Allow all authenticated users to upload to root folder (for task attachments)
    // For other folders, require Manager role or editor access level
    const isRootFolder = !parentFolderId || parentFolderId === 'root';
    
    Logger.log('Upload request - User: ' + user.username + ', Role: ' + user.role + ', Root folder: ' + isRootFolder + ', Task ID: ' + (todoId || 'N/A'));
    
    if (!isRootFolder) {
      const canEdit = user.role === 'Manager' || user.driveAccessLevel === 'editor';
      if (!canEdit) {
        Logger.log('Permission denied for non-root folder upload');
        throw new Error('Permission denied: You need Editor access to upload files to this folder');
      }
    }
    
    // For root folder, allow all authenticated users (no permission check)
    Logger.log('Permission granted - proceeding with upload');
    
    if (!fileName || fileName.trim() === '') {
      throw new Error('File name cannot be empty');
    }
    
    // Decode base64 data
    const decodedData = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(decodedData, mimeType, fileName.trim());
    
    // For task attachments (root folder), use dedicated "Task Attachments" folder organized by task
    let parentFolder;
    if (isRootFolder && todoId) {
      // Use task-specific folder for better organization
      parentFolder = getOrCreateTaskFolder(todoId);
      Logger.log('Using task-specific folder for upload: ' + fileName + ' (Task: ' + todoId.substring(0, 8) + ')');
    } else if (isRootFolder) {
      // Fallback to main Task Attachments folder if no task ID
      parentFolder = getOrCreateTaskAttachmentsFolder();
      Logger.log('Using Task Attachments folder for upload: ' + fileName);
    } else {
      // Use specified folder for other uploads
      parentFolder = DriveApp.getFolderById(parentFolderId);
      Logger.log('Using specified folder for upload: ' + fileName);
    }
    
    const file = parentFolder.createFile(blob);
    Logger.log('File created successfully: ' + file.getId() + ' in folder: ' + parentFolder.getName());
    
    // For task attachments, set sharing to "Anyone with the link can view"
    // This allows all users with task access to view the attachment without permission errors
    if (isRootFolder || todoId) {
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        Logger.log('Sharing set to "Anyone with link can view" for file: ' + file.getId());
      } catch (shareError) {
        Logger.log('Warning: Could not set sharing permissions: ' + shareError.message);
        // Continue anyway - file was created successfully
      }
    }
    
    return {
      success: true,
      file: {
        id: file.getId(),
        name: file.getName(),
        url: file.getUrl(),
        mimeType: file.getMimeType()
      }
    };
    
  } catch (error) {
    Logger.log('Error in uploadFileToDrive: ' + error.message);
    Logger.log('Error stack: ' + error.stack);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Makes a file publicly accessible (anyone with link can view)
 * Used to fix sharing permissions for task attachments
 * @param {string} fileId - The file ID to make public
 * @param {string} token - Auth token
 * @return {Object} { success: boolean, url: string }
 */
function makeFilePublic(fileId, token) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    const file = DriveApp.getFileById(fileId);
    
    // Set sharing to anyone with link can view
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    Logger.log('File ' + fileId + ' set to public by ' + user.username);
    
    return {
      success: true,
      url: file.getUrl()
    };
  } catch (error) {
    Logger.log('Error making file public: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Fix sharing permissions for all attachments in the Task Attachments folder
 * This is a one-time migration function for existing attachments
 * @param {string} token - Auth token (must be Manager)
 * @return {Object} { success: boolean, fixed: number, errors: Array }
 */
function fixAllTaskAttachmentPermissions(token) {
  try {
    const user = validateToken(token);
    if (!user || (user.role !== 'Manager' && user.role !== 'Super Manager')) {
      throw new Error('Manager access required');
    }
    
    const folder = getOrCreateTaskAttachmentsFolder();
    let fixed = 0;
    const errors = [];
    
    // Process all files in the main folder
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        fixed++;
      } catch (e) {
        errors.push({ file: file.getName(), error: e.message });
      }
    }
    
    // Process all subfolders (task-specific folders)
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      const subfolder = subfolders.next();
      const subfiles = subfolder.getFiles();
      while (subfiles.hasNext()) {
        const file = subfiles.next();
        try {
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          fixed++;
        } catch (e) {
          errors.push({ file: file.getName(), error: e.message });
        }
      }
    }
    
    Logger.log('Fixed permissions for ' + fixed + ' files, ' + errors.length + ' errors');
    
    return {
      success: true,
      fixed: fixed,
      errors: errors
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Checks if user has write permission to an existing item (file or folder)
 */
function canWriteToItem(user, itemId) {
  return user.role === 'Manager' || user.driveAccessLevel === 'editor';
}



/**
 * Renames a file or folder
 * @param {string} itemId - File or folder ID
 * @param {string} newName - New name
 * @param {string} token - Auth token
 * @return {Object} { success: boolean }
 */
function renameDriveItem(itemId, newName, token) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    const canEdit = user.role === 'Manager' || user.driveAccessLevel === 'editor';
    if (!canEdit) {
      throw new Error('Permission denied: You need Editor access to rename items');
    }
    
    if (!newName || newName.trim() === '') {
      throw new Error('New name cannot be empty');
    }
    
    // Try as file first, then as folder
    try {
      const file = DriveApp.getFileById(itemId);
      file.setName(newName.trim());
    } catch (e) {
      const folder = DriveApp.getFolderById(itemId);
      folder.setName(newName.trim());
    }
    
    return { success: true };
    
  } catch (error) {
    Logger.log('Error in renameDriveItem: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Deletes (moves to trash) a file or folder
 * @param {string} itemId - File or folder ID
 * @param {string} token - Auth token
 * @param {boolean} allowTaskAttachmentDelete - Optional bypass for task attachments only
 * @return {Object} { success: boolean }
 */
function deleteDriveItem(itemId, token, allowTaskAttachmentDelete) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    const canEdit = user.role === 'Manager' || user.driveAccessLevel === 'editor';

    const canDeleteTaskAttachmentFile = (file) => {
      try {
        if (!allowTaskAttachmentDelete) return false;
        const rootFolder = getOrCreateTaskAttachmentsFolder();
        const rootId = rootFolder.getId();

        const parentIterator = file.getParents();
        while (parentIterator.hasNext()) {
          const parent = parentIterator.next();
          if (parent.getId() === rootId) return true;

          const grandParentIterator = parent.getParents();
          while (grandParentIterator.hasNext()) {
            const grandParent = grandParentIterator.next();
            if (grandParent.getId() === rootId) return true;
          }
        }
        return false;
      } catch (err) {
        Logger.log('Task attachment check failed: ' + err.message);
        return false;
      }
    };
    
    // Try as file first, then as folder
    let file = null;
    try {
      file = DriveApp.getFileById(itemId);
    } catch (e) {
      file = null;
    }

    if (file) {
      if (!canEdit && !canDeleteTaskAttachmentFile(file)) {
        throw new Error('Permission denied: You need Editor access to delete items');
      }
      file.setTrashed(true);
    } else {
      if (!canEdit) {
        throw new Error('Permission denied: You need Editor access to delete folders');
      }
      const folder = DriveApp.getFolderById(itemId);
      folder.setTrashed(true);
    }
    
    return { success: true };
    
  } catch (error) {
    Logger.log('Error in deleteDriveItem: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Moves a file or folder to another folder
 * @param {string} itemId - File or folder ID to move
 * @param {string} targetFolderId - Target folder ID
 * @param {string} token - Auth token
 * @return {Object} { success: boolean }
 */
function moveDriveItem(itemId, targetFolderId, token) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    // Check if can move the item
    if (!canWriteToItem(user, itemId)) {
      throw new Error('Permission denied: You cannot move this item');
    }
    
    // Check if can write to target
    if (!canWriteToFolder(user, targetFolderId)) {
      throw new Error('Permission denied: You cannot move items to this folder');
    }
    
    let targetFolder;
    if (!targetFolderId || targetFolderId === 'root') {
      targetFolder = DriveApp.getRootFolder();
    } else {
      targetFolder = DriveApp.getFolderById(targetFolderId);
    }
    
    // Try as file first, then as folder
    try {
      const file = DriveApp.getFileById(itemId);
      file.moveTo(targetFolder);
    } catch (e) {
      const folder = DriveApp.getFolderById(itemId);
      folder.moveTo(targetFolder);
    }
    
    return { success: true };
    
  } catch (error) {
    Logger.log('Error in moveDriveItem: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Gets shareable link for a file or folder
 * @param {string} itemId - File or folder ID
 * @param {string} accessType - 'view' or 'edit'
 * @param {string} token - Auth token
 * @return {Object} { success: boolean, url: string }
 */
function getDriveShareLink(itemId, accessType, token) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    if (!canWriteToItem(user, itemId)) {
      throw new Error('Permission denied: You cannot share this item');
    }
    
    let item;
    let isFolder = false;
    
    // Try as file first, then as folder
    try {
      item = DriveApp.getFileById(itemId);
    } catch (e) {
      item = DriveApp.getFolderById(itemId);
      isFolder = true;
    }
    
    // Set sharing access
    if (accessType === 'edit') {
      item.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    } else {
      item.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
    
    return {
      success: true,
      url: item.getUrl(),
      shareType: accessType
    };
    
  } catch (error) {
    Logger.log('Error in getDriveShareLink: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Shares a Drive item with multiple email addresses (viewers)
 * @param {string} itemId - File or folder ID
 * @param {Array<string>} emails - List of email addresses
 * @param {string} token - Auth token
 * @return {Object} { success: boolean }
 */
function shareDriveItemWithEmails(itemId, emails, token) {
  try {
    const user = validateToken(token);
    if (!user || user.role !== 'Manager') {
      throw new Error('Unauthorized');
    }

    if (!itemId || !emails || !Array.isArray(emails)) {
      throw new Error('Invalid parameters');
    }

    let item;
    try {
      item = DriveApp.getFileById(itemId);
    } catch (e) {
      item = DriveApp.getFolderById(itemId);
    }

    // Add each email as a viewer
    const results = { shared: [], failed: [] };
    
    emails.forEach(email => {
      try {
        const cleanEmail = email.trim().toLowerCase();
        if (cleanEmail && cleanEmail.includes('@')) {
          item.addViewer(cleanEmail);
          results.shared.push(cleanEmail);
        }
      } catch (e) {
        results.failed.push(email);
        Logger.log(`Failed to share ${itemId} with ${email}: ${e.message}`);
      }
    });

    return { 
      success: true, 
      sharedCount: results.shared.length,
      failedCount: results.failed.length,
      results: results
    };

  } catch (error) {
    Logger.log('Error in shareDriveItemWithEmails: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Copies a file to another location
 * @param {string} fileId - File ID to copy
 * @param {string} targetFolderId - Target folder ID
 * @param {string} newName - Optional new name for the copy
 * @param {string} token - Auth token
 * @return {Object} { success: boolean, file: Object }
 */
function copyDriveFile(fileId, targetFolderId, newName, token) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    // Check if can write to target
    if (!canWriteToFolder(user, targetFolderId)) {
      throw new Error('Permission denied: You cannot copy files to this folder');
    }
    
    const originalFile = DriveApp.getFileById(fileId);
    
    let targetFolder;
    if (!targetFolderId || targetFolderId === 'root') {
      targetFolder = DriveApp.getRootFolder();
    } else {
      targetFolder = DriveApp.getFolderById(targetFolderId);
    }
    
    const copyName = newName && newName.trim() !== '' 
      ? newName.trim() 
      : originalFile.getName() + ' (Copy)';
    
    const copiedFile = originalFile.makeCopy(copyName, targetFolder);
    
    return {
      success: true,
      file: {
        id: copiedFile.getId(),
        name: copiedFile.getName(),
        url: copiedFile.getUrl()
      }
    };
    
  } catch (error) {
    Logger.log('Error in copyDriveFile: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Gets Drive storage quota information
 * @param {string} token - Auth token
 * @return {Object} { success: boolean, quota: Object }
 */
function getDriveStorageQuota(token) {
  try {
    if (!isManager(token)) {
      throw new Error('Permission denied: Only Managers can view storage quota');
    }
    
    const quota = DriveApp.getStorageLimit();
    const used = DriveApp.getStorageUsed();
    
    return {
      success: true,
      quota: {
        limit: quota,
        used: used,
        available: quota - used,
        percentUsed: Math.round((used / quota) * 100 * 100) / 100
      }
    };
    
  } catch (error) {
    Logger.log('Error in getDriveStorageQuota: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Searches for files and folders in Drive
 * @param {string} query - Search query
 * @param {string} token - Auth token
 * @return {Object} { success: boolean, items: Array }
 */
function searchDrive(query, token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Authentication required');
    
    const isManagerUser = user.role === 'Manager';
    const allowedFolders = user.allowedDriveFolders || [];
    
    if (!isManagerUser && allowedFolders.length === 0) {
      return { success: true, items: [], query: query.trim() };
    }
    
    if (!query || query.trim() === '') {
      return { success: true, items: [] };
    }
    
    const items = [];
    
    // Search for files
    const files = DriveApp.searchFiles(`title contains '${query.trim()}'`);
    while (files.hasNext() && items.length < 50) {
      const file = files.next();
      
      // Filter for users
      if (!isManagerUser) {
        let isAllowed = false;
        try {
          const parents = file.getParents();
          while (parents.hasNext()) {
            if (isFolderAllowed(parents.next().getId(), allowedFolders)) {
              isAllowed = true;
              break;
            }
          }
        } catch(e) {}
        if (!isAllowed) continue;
      }

      const mimeType = file.getMimeType();
      let icon = '📄';
      
      if (mimeType.includes('folder')) {
        icon = '📁';
      } else if (mimeType.includes('spreadsheet')) {
        icon = '📊';
      } else if (mimeType.includes('document')) {
        icon = '📝';
      } else if (mimeType.includes('presentation')) {
        icon = '📑';
      } else if (mimeType.includes('image')) {
        icon = '🖼️';
      } else if (mimeType.includes('pdf')) {
        icon = '📕';
      }
      
      items.push({
        id: file.getId(),
        name: file.getName(),
        type: mimeType.includes('folder') ? 'folder' : 'file',
        mimeType: mimeType,
        size: file.getSize(),
        modifiedDate: file.getLastUpdated().toISOString(),
        url: file.getUrl(),
        icon: icon
      });
    }
    
    // Search for folders
    const folders = DriveApp.searchFolders(`title contains '${query.trim()}'`);
    while (folders.hasNext() && items.length < 50) {
      const folder = folders.next();
      
      // Filter for users
      if (!isManagerUser) {
        if (!isFolderAllowed(folder.getId(), allowedFolders)) continue;
      }

      items.push({
        id: folder.getId(),
        name: folder.getName(),
        type: 'folder',
        mimeType: 'application/vnd.google-apps.folder',
        size: null,
        modifiedDate: folder.getLastUpdated().toISOString(),
        url: folder.getUrl(),
        icon: '📁'
      });
    }
    
    // Remove duplicates and sort
    const uniqueItems = items.filter((item, index, self) => 
      index === self.findIndex(t => t.id === item.id)
    );
    
    uniqueItems.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });
    
    return {
      success: true,
      items: uniqueItems,
      query: query.trim()
    };
    
  } catch (error) {
    Logger.log('Error in searchDrive: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Helper: Format file size for display
 * @param {number} bytes - Size in bytes
 * @return {string} Formatted size string
 */
function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Resolves names for a list of Drive IDs (Files or Folders)
 * @param {Array<string>} ids - List of IDs
 * @param {string} token - Auth token
 * @return {Object} { success: boolean, names: Object<id, {name, type}> }
 */
function getDriveItemNames(ids, token) {
  try {
    const user = validateToken(token);
    if (!user) throw new Error('Auth required');
    
    // Check permissions if needed, but for name resolution mostly read access is implied 
    // or we just try/catch individually.
    
    const names = {};
    const uniqueIds = [...new Set(ids)]; // Deduplicate
    
    for (const id of uniqueIds) {
      if (!id) continue;
      const cleanId = id.trim();
      if (!cleanId) continue;
      
      try {
        // Try folder first
        const folder = DriveApp.getFolderById(cleanId);
        names[cleanId] = { name: folder.getName(), type: 'folder' };
      } catch (e) {
        try {
          // Try file
          const file = DriveApp.getFileById(cleanId);
          const mime = file.getMimeType();
          let type = 'file';
          if (mime.includes('spreadsheet')) type = 'spreadsheet';
          else if (mime.includes('document')) type = 'document';
          
          names[cleanId] = { name: file.getName(), type: type };
        } catch (e2) {
          names[cleanId] = { name: 'Inaccessible (' + cleanId + ')', type: 'unknown' };
        }
      }
    }
    
    return { success: true, names: names };
    
  } catch (error) {
     return { success: false, error: error.message };
  }
}

/**
 * Gets all images from accessible Drive folders for the dashboard gallery
 * @param {string} token - Auth token
 * @param {number} limit - Maximum number of images to return (default 50)
 * @return {Object} { success: boolean, images: Array }
 */
function getAllDriveImages(token, limit) {
  try {
    const user = validateToken(token);
    if (!user) {
      throw new Error('Authentication required');
    }
    
    const maxImages = limit || 50;
    const images = [];
    const isManagerUser = user.role === 'Manager';
    const allowedFolders = user.allowedDriveFolders || [];
    
    // Helper function to collect images from a folder recursively
    function collectImagesFromFolder(folder, depth, folderName) {
      if (depth > 5 || images.length >= maxImages) return; // Limit depth and count
      
      try {
        // Get all image files in this folder
        const files = folder.getFiles();
        while (files.hasNext() && images.length < maxImages) {
          const file = files.next();
          const mimeType = file.getMimeType();
          
          // Check if it's an image
          if (mimeType.includes('image')) {
            const fileId = file.getId();
            images.push({
              id: fileId,
              name: file.getName(),
              mimeType: mimeType,
              size: file.getSize(),
              modifiedDate: file.getLastUpdated().toISOString(),
              url: file.getUrl(),
              // Thumbnail URL for Google Drive images
              thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`,
              // Direct view URL
              viewUrl: `https://drive.google.com/uc?id=${fileId}`,
              folderName: folderName || folder.getName()
            });
          }
        }
        
        // Recurse into subfolders
        const subFolders = folder.getFolders();
        while (subFolders.hasNext() && images.length < maxImages) {
          const subFolder = subFolders.next();
          collectImagesFromFolder(subFolder, depth + 1, subFolder.getName());
        }
      } catch (e) {
        Logger.log('Error accessing folder: ' + e.message);
      }
    }
    
    // For managers - can access all of My Drive
    if (isManagerUser) {
      const rootFolder = DriveApp.getRootFolder();
      collectImagesFromFolder(rootFolder, 0, 'My Drive');
    } else {
      // For regular users - only their allowed folders
      if (allowedFolders.length === 0) {
        return {
          success: true,
          images: [],
          message: 'No folders have been shared with you.'
        };
      }
      
      for (const folderId of allowedFolders) {
        if (images.length >= maxImages) break;
        try {
          const folder = DriveApp.getFolderById(folderId.trim());
          collectImagesFromFolder(folder, 0, folder.getName());
        } catch (e) {
          // Skip inaccessible folders
          Logger.log('Cannot access folder: ' + folderId);
        }
      }
    }
    
    // Sort by modified date (newest first)
    images.sort((a, b) => new Date(b.modifiedDate) - new Date(a.modifiedDate));
    
    return {
      success: true,
      images: images,
      totalCount: images.length
    };
    
  } catch (error) {
    Logger.log('Error in getAllDriveImages: ' + error.message);
    return {
      success: false,
      error: error.message
    };
  }
}


/**
 * Grants a user Viewer OR Editor access to multiple Drive folders/files
 * This automates the sharing process so Managers don't have to go to Drive
 * @param {string} userEmail - The user's Google email address
 * @param {Array<string>} itemIds - List of folder/file IDs to share
 * @param {string} token - Auth token
 * @param {string} accessLevel - 'viewer' or 'editor' (default: 'viewer')
 * @return {Object} { success: boolean }
 */
function grantUserDriveAccess(userEmail, itemIds, token, accessLevel = 'viewer') {
  try {
    const user = validateToken(token);
    if (!user || user.role !== 'Manager') {
      throw new Error('Unauthorized');
    }

    if (!userEmail || !userEmail.includes('@') || !itemIds || !Array.isArray(itemIds)) {
      return { success: false, error: 'Invalid parameters' };
    }

    const emails = userEmail.split(',').map(e => e.trim()).filter(e => e && e.includes('@'));
    
    if (emails.length === 0) {
       return { success: false, error: 'No valid email addresses provided' };
    }

    const results = { success: [], failed: [] };

    itemIds.forEach(id => {
      try {
        const cleanId = id.trim();
        if (!cleanId) return;

        let item;
        try {
          try {
            item = DriveApp.getFolderById(cleanId);
          } catch(e) {
            item = DriveApp.getFileById(cleanId);
          }
          
          if (!item) throw new Error('Item not found');

          // Share with all emails
          emails.forEach(email => {
            if (accessLevel === 'editor') {
              item.addEditor(email);
            } else {
              item.addViewer(email);
            }
          });
          
        } catch (e2) {
           throw new Error('Item not found or access denied: ' + e2.message);
        }
        
        results.success.push(cleanId);
      } catch (err) {
        results.failed.push({ id: id, error: err.message });
      }
    });

    return { 
      success: true, 
      sharedCount: results.success.length,
      failedCount: results.failed.length,
      details: results
    };

  } catch (error) {
    Logger.log('Error in grantUserDriveAccess: ' + error.message);
    return { success: false, error: error.message };
  }
}
