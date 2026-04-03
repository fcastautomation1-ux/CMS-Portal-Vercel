# Task Visibility and Performer Credit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure members (User 3) retain visibility of tasks in their portal and receive performance credit after their manager (User 2) approves their work.

**Architecture:** 
1. Update `getTodos` to query the `assignment_chain` for both active and completed tasks.
2. Modify `toggleTodoCompleteAction` to ensure the correct user is credited in `completed_by` when a manager completes a member's task.
3. Update `approveTodoAction` to avoid task "theft" where a manager becomes the sole assignee and performer.

**Tech Stack:** Next.js (App Router), Supabase, TypeScript

---

### Task 1: Update `getTodos` visibility query

**Files:**
- Modify: `src/app/dashboard/tasks/actions.ts:666-675`
- Modify: `src/app/dashboard/tasks/actions.ts:679-688`

**Step 1: Modify `assignmentChainRes` to include completed tasks**
Update the query to remove the `completed = false` constraint, allowing users to see tasks they were part of even after they are finished.

**Step 2: Modify `completedByRes` to be more inclusive**
Ensure it captures tasks where the user was either the final `completed_by` OR was the original worker.

---

### Task 2: Preserve original worker in `toggleTodoCompleteAction`

**Files:**
- Modify: `src/app/dashboard/tasks/actions.ts:1880-1920`

**Step 1: Update `completed_by` logic**
In the `workflowAction === 'complete'` block, check if the person performing the action (Manager) is completing a task that was assigned to someone else (Member). If so, preserve the member's username in a way that the system recognizes them as the performer.

---

### Task 3: Prevent state overwrite in `approveTodoAction`

**Files:**
- Modify: `src/app/dashboard/tasks/actions.ts:2047-2062`

**Step 1: Fix `assigned_to` overwrite**
Remove or modify the line `updatePayload.assigned_to = user.username` for intermediate approvers. The task should remain "owned" by the performer or the context should be maintained to prevent User 3 from losing visibility.

---

### Task 4: Verification & Performance Audit

**Step 1: Verify SQL Indexing**
Ensure GIN indexes on `assignment_chain` are efficient for these expanded queries.

**Step 2: Manual Verification**
1. User 3 completes task.
2. User 2 approves task.
3. User 1 (Creator) receives and completes task.
4. Verify User 3 still sees task in "Completed" menu and "Performance" tab.
