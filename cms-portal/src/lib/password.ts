import { createHash, randomUUID } from 'crypto'

export function hashLegacyPassword(password: string, salt: string): string {
  return createHash('sha256')
    .update(`GASv1_${salt}${password}`, 'utf8')
    .digest('hex')
}

export function buildLegacyPasswordFields(password: string) {
  const salt = randomUUID()

  return {
    password,
    password_salt: salt,
    password_hash: hashLegacyPassword(password, salt),
  }
}

export function verifyPasswordRecord(inputPassword: string, record: {
  password?: string | null
  password_hash?: string | null
  password_salt?: string | null
}) {
  const hasHash = Boolean(record.password_hash && record.password_salt)
  const hashMatches = hasHash
    ? hashLegacyPassword(inputPassword, record.password_salt as string) === record.password_hash
    : false
  const plainMatches = record.password === inputPassword

  return {
    valid: hashMatches || plainMatches,
    needsUpgrade: plainMatches && !hashMatches,
  }
}
