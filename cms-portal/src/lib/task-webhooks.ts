import 'server-only'
import { createHmac, randomUUID } from 'node:crypto'

export type TaskWebhookEventName =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.archived'
  | 'task.started'
  | 'task.completed'
  | 'task.approved'
  | 'task.declined'
  | 'task.comment.created'
  | 'task.comment.updated'
  | 'task.comment.deleted'
  | 'task.shared'
  | 'task.unshared'

type TaskWebhookPayload = {
  id: string
  event: TaskWebhookEventName
  taskId: string
  actorUsername: string
  happenedAt: string
  source: 'cms-portal'
  metadata?: Record<string, unknown>
}

function getWebhookConfig() {
  const url = process.env.TASK_WEBHOOK_URL?.trim()
  const secret = process.env.TASK_WEBHOOK_SECRET?.trim()
  return { url, secret }
}

export function isTaskWebhookConfigured() {
  return Boolean(getWebhookConfig().url)
}

export async function dispatchTaskWebhookEvent(input: Omit<TaskWebhookPayload, 'id' | 'happenedAt' | 'source'> & {
  happenedAt?: string
}) {
  const { url, secret } = getWebhookConfig()
  if (!url) return

  const payload: TaskWebhookPayload = {
    id: randomUUID(),
    source: 'cms-portal',
    happenedAt: input.happenedAt ?? new Date().toISOString(),
    ...input,
  }

  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-cms-webhook-event': payload.event,
    'x-cms-webhook-id': payload.id,
  }

  if (secret) {
    headers['x-cms-webhook-signature'] = createHmac('sha256', secret).update(body).digest('hex')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)

  try {
    await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch {
    // Best-effort only: webhook delivery must never block task operations.
  } finally {
    clearTimeout(timeout)
  }
}

export function queueTaskWebhookEvent(
  input: Omit<TaskWebhookPayload, 'id' | 'happenedAt' | 'source'> & {
    happenedAt?: string
  }
) {
  void dispatchTaskWebhookEvent(input)
}
