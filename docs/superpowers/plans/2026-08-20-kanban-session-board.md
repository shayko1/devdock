# Kanban Session Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DevDock's flat session sidebar with a configurable Kanban board where active sessions are organized into drag-and-drop columns.

**Architecture:** Add `KanbanColumn` type and `columnId` to `ActiveSession`. Columns persist in `state.json`, session-to-column mappings persist in `active-sessions.json`. New IPC handlers serve column CRUD and session moves. React UI replaces the sidebar with a vertically-stacked column panel using HTML5 DnD.

**Tech Stack:** Electron 33, React 19, TypeScript, Vitest, HTML5 Drag and Drop API

**Spec:** `docs/superpowers/specs/2026-08-20-kanban-session-board-design.md`

## Global Constraints

- No external DnD libraries — use HTML5 Drag and Drop API only
- Follow existing file patterns: mocked-fs unit tests for managers, inline `.test.ts` co-located with source
- CSS must use existing custom properties from the app's theme (e.g. `var(--bg-secondary)`, `var(--border)`, `var(--accent)`)
- IPC channel names use colon-separated namespaces (e.g. `kanban:get-columns`)
- No changes to existing session lifecycle behavior — only additive

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `src/shared/ipc-types.ts` | Modify | Add `KanbanColumn` interface, add `columnId?: string` to `ActiveSession` |
| `src/shared/types.ts` | Modify | Add `kanbanColumns?: KanbanColumn[]` to `AppState` |
| `src/main/kanban-manager.ts` | Create | Column CRUD logic + default columns + orphan cleanup |
| `src/main/kanban-manager.test.ts` | Create | Unit tests for KanbanManager |
| `src/main/session-history.ts` | Modify | `ActiveSession` gains `columnId`, `ActiveSessionStore` gains `moveSession()` |
| `src/main/handlers/kanban.ts` | Create | IPC handlers wiring `kanban:*` channels to KanbanManager + ActiveSessionStore |
| `src/main/handlers/index.ts` | Modify | Export `registerKanbanHandlers` |
| `src/main/index.ts` | Modify | Call `registerKanbanHandlers()` in `setupIPC()` |
| `src/preload/index.ts` | Modify | Expose `kanban*` methods to renderer |
| `src/renderer/hooks/useKanban.ts` | Create | React hook: column state, CRUD, drag handlers |
| `src/renderer/components/KanbanPanel.tsx` | Create | Board container — scrollable panel with columns + "Add column" button |
| `src/renderer/components/KanbanColumn.tsx` | Create | Single column section — header, card list, drop zone |
| `src/renderer/components/KanbanCard.tsx` | Create | Draggable session card |
| `src/renderer/components/KanbanPanel.css` | Create | All Kanban styles |
| `src/renderer/components/ClaudeSessionsView.tsx` | Modify | Replace sidebar div with `<KanbanPanel>` |
| `src/renderer/hooks/useClaudeSessions.ts` | Modify | Add `columnId` to `ClaudeSession`, assign first-column on create |

---

### Task 1: Shared Types — KanbanColumn + ActiveSession.columnId

**Files:**
- Modify: `src/shared/ipc-types.ts` (ActiveSession interface ~line 151-159)
- Modify: `src/shared/types.ts` (AppState interface ~line 21-34)

**Interfaces:**
- Produces: `KanbanColumn { id: string; name: string; order: number; color?: string }` — used by Tasks 2-7
- Produces: `ActiveSession.columnId?: string` — used by Tasks 2, 3, 5, 7

- [ ] **Step 1: Add KanbanColumn interface to ipc-types.ts**

In `src/shared/ipc-types.ts`, add after the `ActiveSession` interface (around line 160):

```ts
export interface KanbanColumn {
  id: string
  name: string
  order: number
  color?: string
}
```

- [ ] **Step 2: Add columnId to ActiveSession**

In `src/shared/ipc-types.ts`, add `columnId` to the existing `ActiveSession` interface:

```ts
export interface ActiveSession {
  id: string
  claudeSessionId: string | null
  folderName: string
  folderPath: string
  worktreePath: string | null
  branchName: string | null
  dangerousMode?: boolean
  columnId?: string
}
```

- [ ] **Step 3: Add kanbanColumns to AppState**

In `src/shared/types.ts`, import `KanbanColumn` from `./ipc-types` and add `kanbanColumns?: KanbanColumn[]` to the `AppState` interface.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors related to KanbanColumn or columnId

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-types.ts src/shared/types.ts
git commit -m "feat(kanban): add KanbanColumn type and ActiveSession.columnId"
```

---

### Task 2: KanbanManager — Column CRUD + Defaults

**Files:**
- Create: `src/main/kanban-manager.ts`
- Create: `src/main/kanban-manager.test.ts`

**Interfaces:**
- Consumes: `KanbanColumn` from `src/shared/ipc-types.ts` (Task 1)
- Consumes: `loadState()`, `saveState()` from `src/main/store.ts`
- Consumes: `activeSessions` from `src/main/session-history.ts`
- Produces: `KanbanManager` class with methods `getColumns(): KanbanColumn[]`, `saveColumns(columns: KanbanColumn[]): void`, `moveSession(sessionId: string, columnId: string): void`, `getFirstColumnId(): string`

- [ ] **Step 1: Write the failing tests**

Create `src/main/kanban-manager.test.ts` with tests for:
- `getColumns()` returns default 4 columns when state has none, and saves them
- `getColumns()` returns existing columns from state without re-saving
- `saveColumns()` persists columns to state
- `saveColumns()` clears `columnId` on sessions referencing deleted columns
- `moveSession()` updates `columnId` on target session
- `getFirstColumnId()` returns the id of the lowest-order column

Mock pattern: `vi.mock('./store')` for `loadState`/`saveState`, `vi.mock('./session-history')` for `activeSessions`, `vi.mock('crypto')` for `randomUUID`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/kanban-manager.test.ts 2>&1 | tail -20`
Expected: FAIL — module `./kanban-manager` not found

- [ ] **Step 3: Implement KanbanManager**

Create `src/main/kanban-manager.ts`:
- Import `randomUUID` from `crypto`, `loadState`/`saveState` from `./store`, `activeSessions` from `./session-history`, `KanbanColumn` from `../shared/ipc-types`
- `DEFAULT_COLUMNS`: `[{name:'Backlog',order:0},{name:'In Progress',order:1},{name:'Done',order:2},{name:'Monitor',order:3}]`
- `getColumns()`: read state, return existing if present, else generate defaults with `randomUUID()`, save, return
- `saveColumns(columns)`: read state, compute deleted column IDs (old minus new), save new state, clear `columnId` on orphaned sessions
- `moveSession(sessionId, columnId)`: find session in `activeSessions.getAll()`, call `activeSessions.set()` with updated `columnId`
- `getFirstColumnId()`: call `getColumns()`, sort by order, return first id
- Export singleton `kanbanManager`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/kanban-manager.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/kanban-manager.ts src/main/kanban-manager.test.ts
git commit -m "feat(kanban): add KanbanManager with column CRUD and orphan cleanup"
```

---

### Task 3: IPC Handlers + Preload Bridge

**Files:**
- Create: `src/main/handlers/kanban.ts`
- Modify: `src/main/handlers/index.ts` (barrel exports)
- Modify: `src/main/index.ts` (setupIPC function ~line 168-187)
- Modify: `src/preload/index.ts` (api object)
- Modify: `src/main/session-history.ts` (local ActiveSession interface ~line 7-15)

**Interfaces:**
- Consumes: `kanbanManager` singleton from `src/main/kanban-manager.ts` (Task 2)
- Consumes: `KanbanColumn` type from `src/shared/ipc-types.ts` (Task 1)
- Produces: IPC channels `kanban:get-columns`, `kanban:save-columns`, `kanban:move-session`
- Produces: Preload API methods `kanbanGetColumns(): Promise<KanbanColumn[]>`, `kanbanSaveColumns(columns: KanbanColumn[]): Promise<void>`, `kanbanMoveSession(sessionId: string, columnId: string): Promise<void>`

- [ ] **Step 1: Create IPC handler file**

Create `src/main/handlers/kanban.ts`:
- Import `ipcMain` from `electron`, `kanbanManager` from `../kanban-manager`, `KanbanColumn` type from `../../shared/ipc-types`
- `registerKanbanHandlers()` registers 3 handlers:
  - `kanban:get-columns` → `kanbanManager.getColumns()`
  - `kanban:save-columns` → `kanbanManager.saveColumns(columns)`
  - `kanban:move-session` → `kanbanManager.moveSession(sessionId, columnId)`

Pattern reference: `src/main/handlers/presets.ts`

- [ ] **Step 2: Register handler in barrel**

In `src/main/handlers/index.ts`, add: `export { registerKanbanHandlers } from './kanban'`

- [ ] **Step 3: Call registerKanbanHandlers in setupIPC**

In `src/main/index.ts`, add `registerKanbanHandlers` to the destructured import from `'./handlers'`, and call `registerKanbanHandlers()` inside the `setupIPC()` function body.

- [ ] **Step 4: Expose in preload**

In `src/preload/index.ts`, add `KanbanColumn` to the import from `'../shared/ipc-types'`, then add 3 methods to the `api` object:
```ts
kanbanGetColumns: (): Promise<KanbanColumn[]> => ipcRenderer.invoke('kanban:get-columns'),
kanbanSaveColumns: (columns: KanbanColumn[]): Promise<void> => ipcRenderer.invoke('kanban:save-columns', columns),
kanbanMoveSession: (sessionId: string, columnId: string): Promise<void> => ipcRenderer.invoke('kanban:move-session', sessionId, columnId),
```

- [ ] **Step 5: Add columnId to local ActiveSession in session-history.ts**

In `src/main/session-history.ts`, add `columnId?: string` to the local `ActiveSession` interface (the duplicate at lines 7-15). The `set()` method already uses direct assignment so `columnId` is automatically persisted.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/main/handlers/kanban.ts src/main/handlers/index.ts src/main/index.ts src/preload/index.ts src/main/session-history.ts
git commit -m "feat(kanban): add IPC handlers and preload bridge for kanban board"
```

---

### Task 4: useKanban Hook

**Files:**
- Create: `src/renderer/hooks/useKanban.ts`

**Interfaces:**
- Consumes: `window.api.kanbanGetColumns()`, `window.api.kanbanSaveColumns()`, `window.api.kanbanMoveSession()` from preload (Task 3)
- Consumes: `KanbanColumn` from `src/shared/ipc-types.ts` (Task 1)
- Produces: `useKanban()` hook returning `{ columns, addColumn, renameColumn, deleteColumn, moveColumnUp, moveColumnDown, moveSession, getSessionColumn }`

- [ ] **Step 1: Create the hook**

Create `src/renderer/hooks/useKanban.ts`:
- State: `columns: KanbanColumn[]`, loaded from `window.api.kanbanGetColumns()` in a `useEffect`
- `persistColumns(next)`: `setColumns(next)` + `window.api.kanbanSaveColumns(next)`
- `addColumn(name)`: append with `crypto.randomUUID()`, `order = maxOrder + 1`
- `renameColumn(columnId, name)`: map and update matching column
- `deleteColumn(columnId)`: filter out, re-index orders
- `moveColumnUp(columnId)` / `moveColumnDown(columnId)`: swap order with adjacent column
- `moveSession(sessionId, columnId)`: call `window.api.kanbanMoveSession()`
- `getSessionColumn(columnId?)`: return `columnId` if it exists in columns, else first column's id

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/hooks/useKanban.ts
git commit -m "feat(kanban): add useKanban React hook for column state and CRUD"
```

---

### Task 5: KanbanCard Component

**Files:**
- Create: `src/renderer/components/KanbanCard.tsx`

**Interfaces:**
- Consumes: `ResourceBadge` from `./ResourceBadge` (existing component)
- Consumes: `SessionMetrics` from `../../shared/ipc-types` (existing type)
- Produces: `<KanbanCard>` component with props: `session`, `title`, `isActive`, `isWaiting`, `metrics`, `isResourceLoading`, `onSelect`, `onClose`, `onResume`, `onDragStart`

- [ ] **Step 1: Create KanbanCard component**

Create `src/renderer/components/KanbanCard.tsx`:
- Props interface with `session` (id, folderName, branchName, exited, claudeSessionId, dangerousMode, initializing), `title: string`, `isActive: boolean`, `isWaiting: boolean`, `metrics: SessionMetrics | undefined`, `isResourceLoading: boolean`, callbacks for select/close/resume/dragStart
- Renders: status dot, title, project name (if different from title), branch name (truncated), resource badges, thinking/waiting/unsafe/resume/ended badges
- `draggable` attribute, `onDragStart` handler
- CSS classes: `kanban-card`, `active`, `exited`, `waiting`
- Reuses existing badge CSS classes: `sidebar-status-dot`, `sidebar-badge-thinking`, `sidebar-badge-unsafe`, `sidebar-badge-waiting`, `sidebar-badge-resume`, `sidebar-badge-exited`, `sidebar-card-close`

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/KanbanCard.tsx
git commit -m "feat(kanban): add KanbanCard draggable session card component"
```

---

### Task 6: KanbanColumn + KanbanPanel Components + CSS

**Files:**
- Create: `src/renderer/components/KanbanColumn.tsx`
- Create: `src/renderer/components/KanbanPanel.tsx`
- Create: `src/renderer/components/KanbanPanel.css`

**Interfaces:**
- Consumes: `<KanbanCard>` from `./KanbanCard` (Task 5)
- Consumes: `KanbanColumn` type from `../../shared/ipc-types` (Task 1)
- Consumes: `SessionMetrics` type from `../../shared/ipc-types`
- Produces: `<KanbanColumnSection>` with props: `column`, `sessions[]`, `sessionTitles`, `activeSessionId`, `waitingSessions`, `getSessionMetrics`, `isResourceLoading`, callbacks for select/close/resume/drop/rename/delete/moveUp/moveDown, `isFirst`, `isLast`
- Produces: `<KanbanPanel>` with props: `sessions[]`, `columns[]`, `sessionTitles`, `activeSessionId`, `waitingSessions`, `getSessionMetrics`, `isResourceLoading`, `getSessionColumn`, callbacks for all session and column operations, `onNewSession`

KanbanColumnSection features:
- Collapsible (chevron toggle)
- Drag-and-drop zone (`onDragOver`/`onDragLeave`/`onDrop` with `dataTransfer`)
- Inline rename (double-click header)
- Right-click context menu (Rename, Delete, Move Up/Down)
- Session count badge
- Empty state: "No sessions"

KanbanPanel features:
- Scrollable vertical body with sorted columns
- "Board" title + "+" new session button header
- "Add Column" footer with inline form
- Groups sessions by `columnId` using `getSessionColumn()` fallback

CSS: `.kanban-panel`, `.kanban-column`, `.kanban-column-header`, `.kanban-card`, `.kanban-context-menu`, `.kanban-add-column-btn`, `.kanban-add-form`, `.kanban-resize-handle` — all using `var(--bg-secondary)`, `var(--border)`, `var(--accent)`, `var(--text-muted)`, `var(--text-primary)`, etc.

- [ ] **Step 1: Create KanbanColumn.tsx**
- [ ] **Step 2: Create KanbanPanel.tsx**
- [ ] **Step 3: Create KanbanPanel.css**
- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/KanbanColumn.tsx src/renderer/components/KanbanPanel.tsx src/renderer/components/KanbanPanel.css
git commit -m "feat(kanban): add KanbanPanel, KanbanColumn components and styles"
```

---

### Task 7: Wire Kanban into ClaudeSessionsView + useClaudeSessions

**Files:**
- Modify: `src/renderer/components/ClaudeSessionsView.tsx` (~682 lines, sidebar at lines 374-471)
- Modify: `src/renderer/hooks/useClaudeSessions.ts` (ClaudeSession interface at lines 5-16, startSession at line 124)

**Interfaces:**
- Consumes: `<KanbanPanel>` from `./KanbanPanel` (Task 6)
- Consumes: `useKanban()` from `../hooks/useKanban` (Task 4)
- Consumes: `window.api.kanbanGetColumns()` from preload (Task 3)

Changes to `useClaudeSessions.ts`:
- Add `columnId?: string` to `ClaudeSession` interface
- In `startSession()`: fetch first column via `window.api.kanbanGetColumns()`, assign to new session
- In `restoreSessions()`: preserve `columnId` from saved session record
- In all `activeSessionsSet()` calls: include `columnId` field

Changes to `ClaudeSessionsView.tsx`:
- Import `KanbanPanel` and `useKanban`
- Call `useKanban()` hook
- Replace the `<div className="claude-sessions-sidebar">` block (lines ~375-471) with `<KanbanPanel>`
- Add resizable panel width state (saved to localStorage as `devdock-kanban-width`, min 200px, max 400px, default 250px)
- Add resize handle between kanban panel and terminal area

- [ ] **Step 1: Add columnId to ClaudeSession in useClaudeSessions.ts**
- [ ] **Step 2: Assign default columnId in startSession**
- [ ] **Step 3: Restore columnId during auto-resume**
- [ ] **Step 4: Replace sidebar with KanbanPanel in ClaudeSessionsView.tsx**
- [ ] **Step 5: Add resizable panel width**
- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 7: Run existing tests for regressions**

Run: `npx vitest run 2>&1 | tail -30`

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/ClaudeSessionsView.tsx src/renderer/hooks/useClaudeSessions.ts
git commit -m "feat(kanban): wire Kanban board into Claude tab, replacing flat session sidebar"
```
