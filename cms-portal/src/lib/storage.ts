export const CMS_STORAGE_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'cms-files'

interface SignedUrlCapableStorageClient {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number
      ) => Promise<{ data: { signedUrl?: string } | null }>
    }
  }
}

const signedUrlCache = new Map<string, Promise<string | null>>()

function sanitizeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown'
}

function sanitizeFileName(fileName: string) {
  const parts = fileName.split('.')
  const ext = parts.length > 1 ? parts.pop() : ''
  const base = sanitizeSegment(parts.join('.'))
  return ext ? `${base}.${sanitizeSegment(ext)}` : base
}

function yearMonthParts(date = new Date()) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return { year: String(year), month }
}

export function isStoragePath(value: string | null | undefined) {
  if (!value) return false
  if (value.startsWith('data:')) return false
  if (/^https?:\/\//i.test(value)) return false
  return value.startsWith('users/')
}

export async function resolveStorageUrl(
  supabase: SignedUrlCapableStorageClient,
  pathOrUrl: string | null | undefined,
  expiresIn = 60 * 60
) {
  if (!pathOrUrl) return null
  if (!isStoragePath(pathOrUrl)) return pathOrUrl

  const cacheKey = `${expiresIn}:${pathOrUrl}`
  const cached = signedUrlCache.get(cacheKey)
  if (cached) return cached

  const pending = supabase.storage
    .from(CMS_STORAGE_BUCKET)
    .createSignedUrl(pathOrUrl, expiresIn)
    .then(({ data }) => data?.signedUrl ?? null)
    .catch(() => null)

  signedUrlCache.set(cacheKey, pending)

  return pending
}

export function buildTaskAttachmentPath(input: {
  ownerUsername: string
  taskId: string
  fileName: string
  now?: Date
}) {
  const { year, month } = yearMonthParts(input.now)
  const owner = sanitizeSegment(input.ownerUsername)
  const safeName = sanitizeFileName(input.fileName)
  return `users/${owner}/tasks/${input.taskId}/attachments/${year}/${month}/${crypto.randomUUID()}-${safeName}`
}

export function buildUserAvatarPath(input: {
  username: string
  fileName: string
  now?: Date
}) {
  const { year, month } = yearMonthParts(input.now)
  const owner = sanitizeSegment(input.username)
  const safeName = sanitizeFileName(input.fileName)
  return `users/${owner}/profile/avatar/${year}/${month}/${crypto.randomUUID()}-${safeName}`
}

export function buildAccountFilePath(input: {
  ownerUsername: string
  accountId: string
  fileName: string
  now?: Date
}) {
  const { year, month } = yearMonthParts(input.now)
  const owner = sanitizeSegment(input.ownerUsername)
  const account = sanitizeSegment(input.accountId)
  const safeName = sanitizeFileName(input.fileName)
  return `users/${owner}/accounts/${account}/files/${year}/${month}/${crypto.randomUUID()}-${safeName}`
}

export function buildPortalLogoPath(input: {
  fileName: string
  now?: Date
}) {
  const { year, month } = yearMonthParts(input.now)
  const safeName = sanitizeFileName(input.fileName)
  return `users/system/branding/logo/${year}/${month}/${crypto.randomUUID()}-${safeName}`
}
