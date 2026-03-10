# Module 05 — Drive Manager

---

## 1. What This Module Does

Provides a Google Drive file browser embedded inside the CMS portal. Users can:
- Browse folders and files in Google Drive
- Create folders, Google Sheets, Google Docs, Google Slides
- Upload files from local device
- Rename, delete, move items
- Generate shareable links
- Share items with specific email addresses
- Search across Drive
- View storage quota

Each user may have restricted access — they can only browse specific folders configured by an Admin.

---

## 2. Access Control Model

### Drive Access Levels (per user)

| Access Level | Meaning |
|-------------|---------|
| `none` | No Drive access at all |
| `view` | Can browse and download only |
| `upload` | Can browse + upload files |
| `full` | Can browse, upload, create, rename, delete, move, share |

### Folder Restrictions

Each user has `allowed_drive_folders` — a comma-separated list of Google Drive folder IDs.

```
IF allowed_drive_folders is empty / 'All' / '*':
  → User can browse any folder

IF allowed_drive_folders has specific IDs:
  → isFolderAllowed() is called on every folder navigation
  → Must traverse up the folder parent chain
  → The current folder OR any of its ancestors must be in allowed list
```

### Admin Access

Admin always has full access (`drive_access_level = 'full'`) to all folders.

---

## 3. isFolderAllowed() Traversal Logic

```
function isFolderAllowed(folderId, allowedFolderIds):
  if folderId is in allowedFolderIds → return true
  
  folder = Drive.getFolderById(folderId)
  parents = folder.getParents()
  
  while parents has next:
    parentId = parent.getId()
    if parentId is in allowedFolderIds → return true
    recurse: isFolderAllowed(parentId, allowedFolderIds)
  
  return false
```

This means if a user is allowed to access `FolderA`, they automatically get access to all subfolders inside `FolderA`.

---

## 4. Task Attachments Folder

When tasks (todos) have file attachments:
- Files are stored in a specific Drive folder: `"Task Attachments"`
- This folder is created if it doesn't exist
- Subfolders are created per task ID: `Task Attachments / {task_id}`
- All files uploaded as task attachments go here

---

## 5. File Sharing Policy

- Default share: `ANYONE_WITH_LINK` with `VIEWER` role
- Shared link: returns the standard Google Drive `webViewLink`
- When sharing with specific emails: `shareDriveItemWithEmails(itemId, emails[], role)`
  - Adds each email as a viewer or editor
  - Role can be `'reader'` or `'writer'`

---

## 6. All Drive Operations

| Function (GAS) | Action | Returns |
|----------------|--------|---------|
| `getDriveFolderContents(folderId)` | List folder contents | Array of items with id, name, type, size, mimeType, modifiedDate, webViewLink |
| `createDriveFolder(name, parentId)` | Create subfolder | new folder id |
| `createDriveSheet(name, parentId)` | Create Google Sheet | new sheet id |
| `createDriveDoc(name, parentId)` | Create Google Doc | new doc id |
| `createDriveSlides(name, parentId)` | Create Slides presentation | new slides id |
| `uploadFileToDrive(base64Data, mimeType, name, parentId)` | Upload file | new file id |
| `renameDriveItem(itemId, newName)` | Rename file/folder | success bool |
| `deleteDriveItem(itemId)` | Trash item | success bool |
| `moveDriveItem(itemId, newParentId)` | Move to folder | success bool |
| `getDriveShareLink(itemId)` | Get/create public link | share URL string |
| `shareDriveItemWithEmails(itemId, emails, role)` | Share with users | success bool |
| `searchDrive(query, folderId)` | Search files | Array of items |
| `getDriveStorageQuota()` | Get used/limit | {used, limit, percentage} |
| `getAllDriveImages(folderId)` | Get all images recursively | Array of image items |
| `grantUserDriveAccess(userId, folderId, role)` | Grant user access | success bool |
| `fixAllTaskAttachmentPermissions()` | Fix permissions on existing task attachments | void |

---

## 7. Folder Content Item Schema

```typescript
interface DriveItem {
  id: string
  name: string
  type: 'folder' | 'file'
  mimeType: string
  size: number | null       // null for folders
  modifiedDate: string      // ISO date string
  webViewLink: string
  iconLink: string
  thumbnailLink?: string
  parents: string[]
}
```

---

## 8. Breadcrumb Navigation

- Drive starts at the user's root or first allowed folder
- Every folder click pushes to a breadcrumb stack
- Back button pops from stack
- Clicking breadcrumb item navigates directly
- The path: `My Drive > FolderA > FolderB > SubFolder`

---

## 9. Storage Quota Display

```typescript
interface StorageQuota {
  used: number        // bytes
  limit: number       // bytes (Google Drive limit)
  percentage: number  // 0-100
}
```

Displayed as a progress bar in the Drive UI.

---

## 10. Frontend UI Elements

- **Breadcrumb bar**: clickable path navigation
- **File/Folder grid** (or list view): icons, name, modified date, size
- **Context menu** (right-click or 3-dot): rename, delete, move, share, get link
- **Upload button**: file picker, shows progress
- **New dropdown**: Folder, Sheet, Doc, Slides
- **Search box**: full-text Drive search within scope
- **Storage quota bar**: at bottom of sidebar
- **Share modal**: input email list, role selector
- **List/Grid view toggle**
- **Sort options**: by name, date, size

---

## 11. AI Build Prompt

> **Use this prompt when building this module in Next.js + TypeScript:**

```
Build the Drive Manager module for a CMS portal in Next.js 14 App Router + TypeScript.

PAGE: /dashboard/drive

IMPORTANT ARCHITECTURE NOTE:
In the Next.js version, Google Drive operations run on the server via Google Drive API 
(using googleapis npm package + service account or OAuth 2.0 credentials).
Do NOT call Google Drive from the browser directly.
All Drive API calls must be server actions or API routes.

FEATURES TO BUILD:

1. FOLDER BROWSER
   - Show contents of current folder as a grid of cards OR list rows
   - Each item shows: icon, name, modified date, size (for files)
   - Folders are double-clickable to navigate inside
   - Files show a link icon — clicking opens in new tab (webViewLink)
   - Breadcrumb navigation at top: clickable path segments
   - "Up" / back button support
   - Empty state: "This folder is empty" with New/Upload CTAs

2. TOOLBAR
   - New button (dropdown): New Folder, New Sheet, New Doc, New Slides
   - Upload Files button: opens file picker, uploads to current folder
   - Upload shows progress percentage
   - Search input: searches within current folder scope
   - List/Grid view toggle (saved to localStorage)

3. CONTEXT MENU (per item)
   Right-click or 3-dot menu per item showing:
   - Open (for files: open in new tab)
   - Rename (inline rename input or modal)
   - Move (folder picker tree modal)
   - Get Share Link (copies to clipboard)
   - Share with Emails (opens share modal)
   - Delete (confirmation dialog)

4. SHARE MODAL
   - Email address input (multiple, comma-separated)
   - Role selector: Viewer / Editor
   - Share button
   - Shows current sharing status if available

5. STORAGE QUOTA BAR
   - In sidebar or at top of drive page
   - Shows: "12.4 GB of 15 GB used" with color progress bar
   - Fetch quota on page load

6. ACCESS CONTROL (client + server)
   - User's drive_access_level controls which buttons appear:
     - 'none': show "No access" message, render nothing
     - 'view': show browser only, hide all action buttons
     - 'upload': show browser + upload button only
     - 'full': show all buttons
   - Folder navigation: server-side check isFolderAllowed() using user.allowed_drive_folders
   - If user navigates to forbidden folder: show error, redirect to last valid path

SERVER ACTIONS (src/app/dashboard/drive/actions.ts):
- getFolderContents(folderId, userId): check access, list items
- createFolder(name, parentId, userId): check access, create folder
- createGoogleFile(type, name, parentId, userId): create Sheet/Doc/Slides
- uploadFile(base64, mimeType, name, parentId, userId): upload
- renameItem(itemId, newName, userId): rename
- deleteItem(itemId, userId): trash
- moveItem(itemId, newParentId, userId): move
- getShareLink(itemId): generate public link
- shareWithEmails(itemId, emails, role): add permissions
- searchDrive(query, folderId, userId): search
- getStorageQuota(): get quota
- isFolderAllowed(folderId, allowedFolderIds): recursive parent check

TYPES (src/types/drive.ts):
interface DriveItem {
  id: string
  name: string
  type: 'folder' | 'file'
  mimeType: string
  size: number | null
  modifiedDate: string
  webViewLink: string
  iconLink: string
  thumbnailLink?: string
}

interface BreadcrumbItem {
  id: string
  name: string
}

DRIVE API SETUP:
Use googleapis package. Authenticate with Google service account or OAuth.
Store credentials in environment variables:
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=...
Or use OAuth2 with stored refresh token.

TASK ATTACHMENTS:
For tasks that need file uploads, use this same Drive system.
Folder structure: Task Attachments / {task_id} / {filename}
Create parent folder if missing on first upload.

STYLING:
- Grid view: 4-6 columns on desktop, 2 on mobile
- Folders have yellow folder icon, files have mime-type specific icon
- Selected item: blue border/background
- Drag-and-drop reordering is optional (nice to have)
- Loading skeleton while fetching folder contents
```

---
