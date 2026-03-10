'use server'

import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'

export interface DriveItem {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  size?: string
  iconLink?: string
  webViewLink?: string
  parents?: string[]
}

// Drive Manager works with Google Drive API which requires OAuth.
// For now we provide a placeholder that reads allowed_drive_folders from user config.
export async function getDriveConfig() {
  const user = await getSession()
  if (!user) return { folders: [], accessLevel: 'none' as const }

  return {
    folders: user.allowedDriveFolders,
    accessLevel: user.driveAccessLevel,
  }
}

export async function getUserDriveAccess(): Promise<Array<{ username: string; drive_access_level: string; allowed_drive_folders: string }>> {
  const user = await getSession()
  if (!user) return []
  if (!['Admin', 'Super Manager', 'Manager'].includes(user.role)) return []

  const supabase = createServerClient()
  const { data } = await supabase.from('users').select('username, drive_access_level, allowed_drive_folders').order('username')
  return (data ?? []) as Array<{ username: string; drive_access_level: string; allowed_drive_folders: string }>
}
