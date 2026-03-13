'use client'

import { cn } from '@/lib/cn'

function getUserInitials(username: string) {
  const parts = username
    .split(/[._\s-]+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return username.charAt(0).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

export function UserAvatar({
  username,
  avatarUrl,
  size = 'md',
  className,
}: {
  username: string
  avatarUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizeClass =
    size === 'sm'
      ? 'h-7 w-7 text-[10px]'
      : size === 'lg'
        ? 'h-11 w-11 text-sm'
        : 'h-9 w-9 text-xs'

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 font-bold text-slate-700',
        sizeClass,
        className
      )}
      title={username}
      aria-label={username}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={username} className="h-full w-full object-cover" />
      ) : (
        getUserInitials(username)
      )}
    </span>
  )
}
