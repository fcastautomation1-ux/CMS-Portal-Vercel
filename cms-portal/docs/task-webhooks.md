# Task Webhooks

Task webhooks are optional outbound HTTP events sent by the app after key task mutations.

## Environment Variables

Add these in your deployment environment:

```env
TASK_WEBHOOK_URL=https://your-server.example.com/task-webhook
TASK_WEBHOOK_SECRET=replace-with-a-long-random-secret
```

If `TASK_WEBHOOK_URL` is not set, webhook delivery is disabled.

## Payload Shape

```json
{
  "id": "event-uuid",
  "event": "task.created",
  "taskId": "task-uuid",
  "actorUsername": "ahsan",
  "happenedAt": "2026-03-25T10:15:00.000Z",
  "source": "cms-portal",
  "metadata": {
    "title": "Launch task"
  }
}
```

## Headers

```text
content-type: application/json
x-cms-webhook-event: task.created
x-cms-webhook-id: event-uuid
x-cms-webhook-signature: <sha256 hex hmac of raw body>
```

## Notes

- Delivery is best-effort and non-blocking.
- Webhooks are useful for syncing other systems, audit pipelines, automation, and cache invalidation.
- Webhooks do not directly make page rendering faster; pagination, query trimming, indexes, and lazy loading do that.
