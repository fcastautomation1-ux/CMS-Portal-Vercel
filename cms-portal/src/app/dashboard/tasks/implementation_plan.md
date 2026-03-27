# Implementation Plan - Premium Dashboard UI Optimization

This plan outlines the steps to implement five premium UI/UX features to enhance the CMS Portal's project management experience.

## 1. Shimmering Skeleton Loaders (Perceived Speed)
- [x] Create `TaskSkeleton` component in `src/components/tasks/task-skeleton.tsx`.
- [x] Implement a shimmering animation using CSS/Tailwind.
- [x] Integrate `TaskSkeleton` into `TasksBoard` to show during `loading` or when `tasksQuery.isLoading` is true.

## 2. Task "Peek" Slide-over Drawer (Premium UX)
- [x] Install/Verify `framer-motion` (already in `package.json`).
- [x] Modify `ModalShell` in `task-detail-modal.tsx` to use `framer-motion` for a right-side slide-over effect.
- [x] Ensure the drawer is responsive (full width on mobile, partial on desktop).
- [x] Keep the main board context visible in the background (dimmed but visible).

## 3. Native Drag & Drop Kanban
- [x] Install/Verify `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.
- [x] Implement `DndContext`, `SortableContext`, and `useSortable` in `TasksBoard` (Kanban view).
- [x] Enable vertical dragging within columns and horizontal dragging between columns (if applicable) or just task movement between status columns.
- [x] Add visual feedback during drag (shadows, tilt).
- [x] Persistence: Call `updateTaskStatusAction` (or similar) on `onDragEnd`.

## 4. DOM Virtualization (Large Lists)
- [x] Install/Verify `@tanstack/react-virtual`.
- [x] Implement `useVirtualizer` in `TasksBoard` (List view).
- [x] Ensure smooth scrolling for 500+ tasks by only rendering visible rows.
- [x] Update `TaskCard` to handle potential fixed heights if required by the virtualizer.

## 5. Global Command Palette (Ctrl + K)
- [x] Create `CommandPalette` component in `src/components/layout/command-palette.tsx`.
- [x] Implement `Ctrl + K` global listener.
- [x] Features:
    - Search tasks by title/app/package.
    - Quick actions: "Create Task", "Go to Dashboard", "Toggle Dark Mode".
    - Recent tasks list.
- [x] Integrate into `DashboardShell` or a global provider.

---

## Technical Details & Refinements
- **Color Palette**: Stick to the Blue/White/Black family.
- **Micro-animations**: Use `framer-motion` for all transitions.
- **Responsiveness**: Ensure all features work flawlessly on mobile and desktop.
