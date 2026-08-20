# Kanban Session Board — Design Spec

## Overview

Replace DevDock's flat session sidebar in the Claude tab with a Kanban board that organizes active sessions into user-configurable columns (e.g. Backlog, In Progress, Done, Monitor). Sessions move between columns via drag-and-drop.

**Scope**: Active (running + exited-but-not-closed) sessions only. Historical sessions are out of scope — they remain in the Session Finder.

## Data Model

### KanbanColumn

```ts
interface KanbanColumn {
  id: string       // crypto.randomUUID()
  name: string     // user-visible label, e.g. "In Progress"
  order: number    // sort key (0-based, ascending)
  color?: string   // optional accent color for the column header
}
```

Stored in `state.json` under a new top-level key `kanbanColumns: KanbanColumn[]`.

Default columns on first launch (when `kanbanColumns` is absent or empty):

| order | name        |
|-------|-------------|
| 0     | Backlog     |
| 1     | In Progress |
| 2     | Done        |
| 3     | Monitor     |

### Session-to-Column Mapping

Extend `ActiveSession` with an optional field:

```ts
interface ActiveSession {
  // ... existing fields
  columnId?: string   // references KanbanColumn.id
}
```

Persisted in `~/.devdock/active-sessions.json` alongside existing session data.

**Assignment rules:**
- New session → first column (lowest `order`).
- Session's `columnId` references a deleted column → fall back to first column.
- `columnId` is `undefined` or missing → fall back to first column (backwards compatibility).

## IPC Layer

New file: `src/main/handlers/kanban.ts`

| Channel | Direction | Payload | Returns |
|---------|-----------|---------|---------|
| `kanban:get-columns` | renderer → main | none | `KanbanColumn[]` |
| `kanban:save-columns` | renderer → main | `KanbanColumn[]` | `void` |
| `kanban:move-session` | renderer → main | `{ sessionId: string, columnId: string }` | `void` |

### kanban:get-columns

Reads `kanbanColumns` from the store. If absent, returns the 4 default columns and writes them to the store (lazy initialization).

### kanban:save-columns

Replaces `kanbanColumns` in the store. Handles create, rename, reorder, and delete in a single write. The renderer is responsible for maintaining valid `order` values before sending.

When a column is deleted, any `ActiveSession` referencing that column has its `columnId` cleared (falls back to first column on next read).

### kanban:move-session

Updates the `columnId` field of the specified session in `ActiveSessionStore` and persists to disk.

## UI Components

### Layout Change

The current Claude tab layout:

```
+---sidebar (180px)---+---terminal + toolbar---+
| session list        | terminal               |
+---------------------+------------------------+
```

Becomes:

```
+---kanban (~250px, resizable)---+---terminal + toolbar---+
| [column headers + cards]       | terminal               |
+--------------------------------+------------------------+
```

The panel width is resizable (min 200px, max 400px, default 250px) and persisted to `localStorage` under `devdock-kanban-width`.

### KanbanPanel (`src/renderer/components/KanbanPanel.tsx`)

Top-level container rendered in place of the old session sidebar.

Structure:
- Scrollable vertical area containing all columns
- Each column is a collapsible section
- "Add column" button fixed at the bottom of the panel
- Panel header with "Board" title and optional collapse-all/expand-all toggle

### KanbanColumn (`src/renderer/components/KanbanColumn.tsx`)

A single column section within the panel.

**Header**:
- Column name (click to select all sessions in column, double-click to rename inline)
- Session count badge
- Collapse/expand chevron
- Drag handle for column reorder (optional, can defer to context menu)

**Body** (when expanded):
- Vertical list of `KanbanCard` components
- Drop zone for drag-and-drop (visual highlight on dragover)
- Empty state text when column has no sessions: "No sessions"

**Context menu** (right-click header):
- Rename
- Delete (with confirmation if column has sessions; moves sessions to first column)
- Move Up / Move Down
- Set Color (optional, can defer to v2)

### KanbanCard (`src/renderer/components/KanbanCard.tsx`)

A draggable session card. Compact layout within the ~250px panel width.

**Content**:
- Status dot: green (active/running), yellow (waiting/idle), gray (exited)
- Title: session title or folder name (truncated with ellipsis)
- Branch name (small, dimmed, shown if present)
- Resource badges (CPU/memory, shown if significant)
- Thinking/waiting/unsafe indicator badges (same as current sidebar)

**Interactions**:
- Click → select session (opens in terminal area)
- Drag → HTML5 DnD to move between columns
- Active (selected) session gets an accent-colored left border

**Drag visual**:
- `draggable="true"` on the card element
- `dragstart` sets `dataTransfer` with session ID
- `dragover` on column body shows drop indicator (top border highlight)
- `drop` calls `kanban:move-session` IPC and updates React state

### KanbanPanel.css (`src/renderer/components/KanbanPanel.css`)

Follows DevDock's existing plain CSS pattern (no CSS-in-JS). Uses CSS custom properties consistent with the app's existing design tokens.

Key styles:
- `.kanban-panel` — flex column, full height, border-right, background
- `.kanban-column` — collapsible section with header + body
- `.kanban-column-header` — flex row, sticky within scroll
- `.kanban-card` — compact card with left border accent
- `.kanban-card.active` — highlighted selected state
- `.kanban-card.dragging` — reduced opacity during drag
- `.kanban-drop-zone` — visual drop target indicator
- `.kanban-add-column` — bottom-fixed "+" button

## Persistence & Lifecycle

### App startup
1. `kanban:get-columns` returns column definitions (lazy-inits defaults if needed)
2. `useClaudeSessions` auto-resume reads `active-sessions.json` including `columnId` per session
3. Kanban panel renders sessions grouped by `columnId`

### New session created
1. `startSession` in `useClaudeSessions` assigns `columnId` = first column's ID
2. Persisted to `active-sessions.json` via `ActiveSessionStore`
3. UI re-renders, card appears in first column

### Session moved (drag-and-drop)
1. `drop` handler calls `kanban:move-session` IPC
2. Main process updates `ActiveSessionStore`, writes to disk
3. Renderer updates local React state optimistically

### Session closed
1. Session removed from `active-sessions.json` (existing behavior)
2. Card disappears from board

### Column deleted
1. Renderer sends `kanban:save-columns` with the column removed
2. Main process orphan-checks: any session with deleted `columnId` gets it cleared
3. Renderer re-groups — orphaned sessions appear in first column

### App quit & restart
- Column definitions persist in `state.json`
- Session column assignments persist in `active-sessions.json`
- Full board state restored on next launch

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `src/shared/ipc-types.ts` | Modify | Add `KanbanColumn` interface, add `columnId` to `ActiveSession` |
| `src/shared/types.ts` | Modify | Add `kanbanColumns` to `AppState` |
| `src/main/handlers/kanban.ts` | New | IPC handlers for column CRUD + session moves |
| `src/main/session-history.ts` | Modify | `ActiveSessionStore` reads/writes `columnId`, orphan cleanup |
| `src/main/store.ts` | Modify | Default `kanbanColumns` in initial state (if store handles defaults) |
| `src/main/index.ts` | Modify | Register kanban handlers in `setupIPC()` |
| `src/preload/index.ts` | Modify | Expose `kanban:*` IPC methods to renderer |
| `src/renderer/hooks/useClaudeSessions.ts` | Modify | Add `columnId` to `ClaudeSession`, assign on create |
| `src/renderer/hooks/useKanban.ts` | New | Hook for column state, drag handlers, column CRUD |
| `src/renderer/components/KanbanPanel.tsx` | New | Board container component |
| `src/renderer/components/KanbanColumn.tsx` | New | Single column component |
| `src/renderer/components/KanbanCard.tsx` | New | Draggable session card |
| `src/renderer/components/KanbanPanel.css` | New | All Kanban styles |
| `src/renderer/components/ClaudeSessionsView.tsx` | Modify | Replace sidebar with `<KanbanPanel>` |

## Out of Scope

- Historical session grouping (use Session Finder)
- Auto-status detection (manual drag only)
- Column color customization (can add in v2)
- Column drag reorder (use context menu Move Up/Down for v1)
- Multi-select / bulk move sessions
- Kanban for Agents tab (Claude tab only)

## Bug Fixes (Separate Work)

Three existing bugs to investigate independently:

1. **Session stuck on DB Access tab switch** — switching to DB Access tab freezes/stalls the active Claude session. Likely a PTY focus or process suspension issue.
2. **Scroll shows only last sentences** — terminal scrollback not fully loaded; may be an xterm.js buffer or scrollback recovery issue.
3. **Wrong session restored on reopen** — `activeId` in `active-sessions.json` not correctly saved or restored; the auto-resume logic may pick the wrong session.

These will be investigated after the Kanban feature is implemented.
