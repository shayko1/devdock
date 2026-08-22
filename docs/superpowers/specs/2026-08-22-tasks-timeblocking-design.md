# Tasks — Time-Blocking & Agent Delegation

**Date**: 2026-08-22
**Status**: Approved design, not yet implemented
**Scope**: New top-level `tasks` tab

## Problem

Personal work does not fit in a session list. Deciding *what* to do today, reserving hours
for it against a calendar that is already full of meetings, and noticing when something has
been pushed for a week are all things DevDock currently cannot help with — even though it
already knows every project, can launch a Claude session in an isolated worktree, and has
an AI client configured.

The gap is not agent capability. It is that there is nowhere to say "this is my work, this
is when I am doing it, and this part I am handing off."

## Goal

Plan a day in under a minute: capture tasks in one line, drop them onto a calendar that
knows about real meetings, work them in a focus view, and delegate the tedious ones to a
real Claude session that runs in a worktree.

## Decisions

| Question | Decision |
|---|---|
| Placement | New top-level tab (`TabId` gains `'tasks'`), its own board plus day canvas |
| Relation to the session Kanban | **None.** Purely additive. `KanbanPanel`, `KanbanCard`, `KanbanColumn`, and `ActiveSession.columnId` are untouched |
| Delegation | Launches a real Claude session via the existing worktree + pty machinery; the task stores the link |
| Calendar | macOS Calendar via `osascript`, read-only |
| AI | Reuses `src/main/ai-client.ts` and the user's existing enhancer config; every AI feature is optional and degrades |
| Persistence | Own file, `~/.devdock/tasks.json`, atomic write |

### Rejected, with reasons

- **Merging tasks into the existing session Kanban.** It reads like the obvious move —
  one board, one mental model — but `KanbanPanel` is a 200–400px navigation sidebar inside
  the Claude tab taking eighteen session-lifecycle props, not a general-purpose board. Task
  cards there would couple task lifetime to session lifetime (closing a session must not
  delete a task), fight for width that time-blocking needs, and destabilise code that is
  three commits old and still being fixed. Tasks get their own board; a delegated task
  links to its session by id.
- **Storing tasks in `state.json`.** `store.ts` does a plain `writeFileSync` of the whole
  state object, so a crash mid-write truncates it. `preset-manager.ts` already establishes
  the better pattern — its own file under `~/.devdock/` written via temp-and-`renameSync`.
  Planning data follows the preset precedent, not the store one.
- **A Swift/EventKit helper for calendar access.** Cleaner API and much faster than
  AppleScript, but it means compiling and shipping a native binary in a project that
  currently does no code signing at all. Kept as the documented escape hatch if
  `osascript` proves too slow (see Risks).
- **Auto-detecting when a delegated agent has finished.** Session summaries and titles
  exist, but "is this work actually done" is not reliably inferable from a transcript.
  Completion stays a human judgement: the task card shows live session status and you mark
  it done.
- **ISO-8601 timestamp strings.** `SessionPreset` uses epoch numbers (`createdAt: number`).
  Tasks match that rather than introducing a second convention.

## Data Model

**A task is not a time block.** The board holds *tasks*. The day canvas holds *blocks* — a
concrete span of time pointing at a task. One task may have several blocks (90 minutes
today, 90 tomorrow). Rollover creates a *new* block rather than mutating the old one, so
"this has been pushed four times" stays answerable.

Consequence: **"scheduled" is not a status.** A task is scheduled iff it has a future
block. One source of truth, so drag, undo, and rollover cannot produce a task whose state
contradicts its blocks.

New types in `src/shared/ipc-types.ts`:

```ts
export interface Task {
  id: string
  title: string
  notes?: string
  /** 1 = highest. */
  priority: 1 | 2 | 3 | 4
  estimateMinutes?: number
  status: 'open' | 'done' | 'dropped' | 'delegated'
  dueAt?: number
  /** Board column. Falls back to the first column when unset or dangling. */
  columnId?: string
  /** Absolute path of the DevDock project this task belongs to. Required to delegate. */
  projectPath?: string
  projectName?: string
  delegation?: TaskDelegation
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface TaskBlock {
  id: string
  taskId: string
  startsAt: number
  endsAt: number
  /** Non-null means the focus timer is running for this block. */
  focusStartedAt?: number
  /** Accumulated focus time, excluding any currently running stretch. */
  focusSeconds: number
  /** Block this one was rolled over from, for push-count provenance. */
  rolledFrom?: string
}

export interface TaskDelegation {
  /** DevDock pty session id. */
  sessionId: string
  claudeSessionId: string | null
  worktreePath: string | null
  branchName: string | null
  launchedAt: number
  prompt: string
}

export interface TasksFile {
  version: 1
  tasks: Task[]
  blocks: TaskBlock[]
  /** Task board columns — separate storage from the session Kanban's columns. */
  columns: KanbanColumn[]
}
```

`KanbanColumn` (`{ id, name, order }`) is reused as a *type* because it is already exactly
right. The task board's column *data* is stored in `tasks.json` and is independent of
`state.kanbanColumns`. Default columns: Backlog, Today, Doing, Done.

`projectPath` is the DevDock-native part of this model. A task belongs to a project, which
is what makes delegation possible without asking where to run.

## Module Layout

```
src/main/task-manager.ts             TaskManager class, owns ~/.devdock/tasks.json
src/main/session-launcher.ts         EXTRACTED from handlers/presets.ts (see below)
src/main/calendar-reader.ts          osascript busy-time reader, cached, typed status
src/main/handlers/tasks.ts           registerTaskHandlers()
src/main/handlers/index.ts           + export                                 (modified)
src/main/handlers/presets.ts         preset-launch becomes a thin wrapper     (modified)
src/main/index.ts                    + registerTaskHandlers()                 (modified)
src/shared/task-parse.ts             one-line capture parser        — pure
src/shared/task-scheduling.ts        auto-schedule packer           — pure
src/shared/task-rollover.ts          daily sweep rules              — pure
src/shared/ipc-types.ts              + Task, TaskBlock, TaskDelegation, TasksFile (modified)
src/shared/types.ts                  activeTab union + 'tasks'                (modified)
src/preload/index.ts                 + task bridge methods                    (modified)
src/renderer/hooks/useTasks.ts       task state + IPC
src/renderer/components/tasks/TasksView.tsx      tab root, layout
src/renderer/components/tasks/TaskBoard.tsx      columns of task cards
src/renderer/components/tasks/TaskCard.tsx       card, incl. live session status
src/renderer/components/tasks/DayCanvas.tsx      15-min grid, drag, resize
src/renderer/components/tasks/CaptureBar.tsx     one-line capture
src/renderer/components/tasks/FocusOverlay.tsx   focus mode + timer
src/renderer/components/tasks/SweepModal.tsx     end-of-day rollover
src/renderer/components/tasks/*.css
src/renderer/App.tsx                 TabId, tab button, content, onTab6       (modified)
src/renderer/hooks/useKeyboardShortcuts.ts  + onTab6                          (modified)
scripts/package-mac.sh               + NSAppleEventsUsageDescription          (modified)
scripts/rebuild.sh                   + NSAppleEventsUsageDescription          (modified)
scripts/install-dev.sh               + NSAppleEventsUsageDescription          (modified)
```

Tests are colocated as `*.test.ts` beside their source, per repo convention.

### `TaskManager`

Mirrors `PresetManager`: in-memory array, a `loaded` flag, lazy load on first access, and
`saveFile()` writing to `tasks.json.tmp` then `renameSync` over the real path. Reads
tolerate a missing or corrupt file by returning defaults rather than throwing — the same
posture `loadState()` takes.

### Extracting `session-launcher.ts`

The `preset-launch` handler (`src/main/handlers/presets.ts:45-134`) currently inlines about
ninety lines: git-repo detection, worktree creation under
`~/.devdock/worktrees/<slug>/<timestamp>/worktree` on branch
`devdock/claude-<slug>-<timestamp>`, `ensureDevDockClaudeMd`, `resolveClaudeLaunch`,
`ptyManager.createSession`, `statuslineWatcher.watchSession`, and writing
`initialCommands` into the pty after a 1500ms delay.

Delegation needs every one of those steps. Copying them would be the single worst outcome
of this feature, so they move to:

```ts
export interface LaunchSessionInput {
  sessionId: string
  projectPath: string
  projectName: string
  useWorktree: boolean
  dangerousMode: boolean
  model?: string
  initialCommands?: string[]
}

export interface LaunchSessionResult {
  success: boolean
  error?: string
  claudeSessionId?: string | null
  worktreePath?: string | null
  branchName?: string | null
}

export function launchClaudeSession(input: LaunchSessionInput): LaunchSessionResult
```

`preset-launch` becomes: resolve the preset, call `launchClaudeSession`, record usage,
return the preset alongside the result. Behaviour is unchanged — this is a pure refactor
and ships as its own phase so it can be verified in isolation. It also makes the launch
path testable for the first time.

## IPC Surface

Channel names use the `tasks:` prefix, matching `kanban:`.

| Channel | Purpose |
|---|---|
| `tasks:get-all` | `TasksFile` — tasks, blocks, columns in one call |
| `tasks:create` | create a task |
| `tasks:update` | patch a task by id |
| `tasks:delete` | drop a task and cascade its blocks |
| `tasks:save-columns` | board column CRUD, same shape as `kanban:save-columns` |
| `tasks:set-block` | create or update a block (move, resize, schedule) |
| `tasks:delete-block` | unschedule |
| `tasks:batch-blocks` | persist a whole packer run in one write |
| `tasks:focus` | `{ blockId, action: 'start' \| 'stop' }` |
| `tasks:delegate` | `{ taskId, prompt }` → launches a session, stores the link |
| `tasks:calendar-busy` | `{ dayStart, dayEnd }` → `CalendarBusyResult` |
| `tasks:decompose` | AI: split a large task into sub-tasks; may return `null` |

Every write goes through `TaskManager` and persists before returning, so the renderer never
holds state the disk does not have.

## Domain Rules

### Capture parser — `src/shared/task-parse.ts`

Pure: `parseTaskInput(text, now) → ParsedTask`

| Token | Meaning |
|---|---|
| `p1`–`p4` | priority; default 3 |
| `45m`, `90min`, `1h`, `1.5h` | estimate in minutes |
| `today`, `tomorrow`, `mon`…`sun`, `next monday` | date |
| `2pm`, `14:00`, `9:30am` | time |

Date **and** time schedules a block immediately; date alone sets `dueAt` and the task stays
on the board. Whole-word matches only, first match wins per field, remaining tokens
collapse into the title. Returns match offsets so the input can highlight what it
understood.

The parser is deterministic and has no AI in it. `tasks:decompose` is the separate,
optional AI path for the different problem of breaking a big task apart.

### Auto-schedule packer — `src/shared/task-scheduling.ts`

Pure: `packDay({ tasks, blocks, busy, dayStart, dayEnd, workday, now }) → { placements, unplaced }`

Ordering: overdue first, then `dueAt` ascending (undefined last), then priority, then
longest estimate first, so big rocks get the good slots. First-fit into free slots =
workday window minus existing blocks, minus busy intervals, minus everything before `now`.
Snapped to 15 minutes. Estimate defaults to 30 minutes when absent.

Two properties, both tested:

- **It never moves a block placed by hand.** Existing blocks are input, never output.
- **It is deterministic and idempotent.** `now` is a parameter; nothing inside reads the
  clock. Running it twice on unchanged inputs changes nothing.

A task longer than every free slot is returned in `unplaced` with reason `'no_slot'` and
shown. Splitting it silently into fragments would be worse than saying it does not fit.

It runs in the renderer — it is pure and has no I/O, so there is no reason to pay an IPC
round-trip. Results persist through one `tasks:batch-blocks` call.

### Daily sweep — `src/shared/task-rollover.ts`

Pure: `sweepDay({ tasks, blocks, now }) → { stale, suggestions }`

Stale = block has ended, its task is still `open`, and no later block exists for that task.
Each suggestion offers tomorrow at the same time if free, else the earliest free slot
tomorrow. Presented with a per-row choice: Roll over / Reschedule / Done / Drop.

**Nothing mutates without a click.** A sweep that rewrites the calendar unattended is how
you stop trusting the calendar. New blocks carry `rolledFrom`, and the card shows a
"pushed ×N" badge derived from walking that chain.

### Focus timer

`tasks:focus` with `'start'` stamps `focusStartedAt`; the renderer displays
`focusSeconds + (now - focusStartedAt)` and never owns the number. `'stop'` folds the delta
into `focusSeconds` and clears the stamp. Because the stamp is on disk, quitting DevDock
mid-focus and reopening it resumes the same elapsed time instead of losing it.

Only one block runs at a time: starting one stops any other in the same write.

### Calendar — `src/main/calendar-reader.ts`

Reads busy intervals from Calendar.app via `osascript`, returning:

```ts
export interface CalendarBusyResult {
  status: 'ok' | 'denied' | 'timeout' | 'error' | 'unconfigured'
  busy: Array<{ startsAt: number; endsAt: number; title: string; allDay: boolean }>
}
```

- Spawned **asynchronously** with a 10-second timeout — never `execSync`, which would
  freeze the main process and with it every terminal in the app.
- **All-day events are returned but flagged, and the packer ignores them.** They are
  usually OOO markers or birthdays; treating them as busy blanks the whole day.
- Results cached 60 seconds per day key.
- Failure never blocks the canvas. The day renders immediately, busy times arrive when they
  arrive, and a non-`ok` status shows a strip: *"Calendar unavailable — auto-schedule may
  double-book."* The packer degrades toward double-booking, which is the unsafe direction,
  so that warning is loud rather than subtle.

The three packaging scripts each write `Info.plist` from a heredoc; all three gain
`NSAppleEventsUsageDescription` explaining the Calendar read.

### Delegation

1. A task needs `projectPath`. Without one, the delegate action prompts for a project
   first — it cannot guess where work should run.
2. `tasks:delegate` builds the prompt from title and notes, calls `launchClaudeSession`
   with `useWorktree: true`, and stores the returned `TaskDelegation` on the task, moving
   it to `status: 'delegated'`.
3. Any future blocks for that task are removed — it is off your calendar.
4. The renderer switches to the Claude tab, reusing the existing
   `onSessionActivated: () => setActiveTab('claude')` path.
5. The task card shows live session status by matching `delegation.sessionId` against
   active sessions. Marking it done is manual.

### AI assist

`tasks:decompose` sends title and notes through `chatCompletion` from `ai-client.ts` using
the config already loaded by `loadEnhancerConfig()`, and parses the reply with
`parseJsonContent`. It returns `null` on any failure — matching the documented contract of
that module — and the UI simply reports that AI is unavailable. The feature is hidden when
no enhancer config exists, exactly as the prompt enhancer behaves.

No other AI is in v1. Scheduling is an algorithm, not a language problem.

## UI

`TasksView` is a two-pane layout: the board on the left, the day canvas on the right, with
a capture bar spanning the top.

- **Board**: columns of task cards. Priority as a left border rather than a coloured pill.
  A card shows estimate, due date, "pushed ×N" when relevant, and live session status when
  delegated.
- **Day canvas**: 15-minute rows, a current-time line, busy events in a muted fill behind
  task blocks. Drag a card onto the canvas to schedule; top and bottom handles resize.
- **Capture bar**: one line, parsed live with the understood tokens highlighted.
- **Focus overlay**: dims everything but the active block, with elapsed time and a done
  action.
- **Keyboard**: `Cmd+6` switches to the tab, added as an optional `onTab6` following the
  existing `onTab1`–`onTab4` pattern in `useKeyboardShortcuts`.

  Tasks is the sixth tab, and `onTab5` does not exist — db-access, the fifth tab, has
  never had a shortcut. Rather than renumber or quietly bind `Cmd+5` to Tasks, the number
  stays positional and `Cmd+5` remains unbound. Adding a db-access shortcut is unrelated
  to this feature and is left alone deliberately.

  Drag has a keyboard equivalent — select a card, press `S`, type a time — so scheduling is
  not mouse-only.

## Error Handling

- Every mutation is persisted by `TaskManager` before the handler returns; a failed write
  rejects and the renderer reverts that one change and shows a toast, using the existing
  `Toast` component.
- Drag and resize are debounced, and the queue collapses per block id so the last position
  wins.
- A dangling `columnId` (column deleted) falls back to the first column, mirroring
  `useKanban`'s `getSessionColumn`.
- Deleting a task cascades its blocks in the same write, so no orphan blocks can be
  rendered.
- A corrupt or missing `tasks.json` yields defaults instead of throwing, matching
  `loadState`.
- Worktree creation failing during delegation leaves the task `open` with an error toast —
  it never lands in `delegated` with no session behind it.

## Testing

Vitest, colocated. The pure modules carry the logic and the coverage.

| File | Covers |
|---|---|
| `src/shared/task-parse.test.ts` | token table, ambiguity (`review 1h1 doc`, `p5`, bare `tomorrow`, `next mon 9am`), title cleanup |
| `src/shared/task-scheduling.test.ts` | no free slot; oversized task → `unplaced`; never before `now`; idempotence; never moves manual blocks; busy respected; all-day ignored |
| `src/shared/task-rollover.test.ts` | stale detection, successor detection, `rolledFrom` chain depth |
| `src/main/task-manager.test.ts` | atomic write, corrupt-file recovery, cascade delete, dangling column fallback, single running focus block |
| `src/main/session-launcher.test.ts` | the extracted launcher, including the non-git-repo path that currently has no test |
| `src/main/calendar-reader.test.ts` | timeout, denied, malformed output, cache hit, all-day flagging |

`node-pty` is already mocked at `src/main/__mocks__/node-pty.ts`, so launcher tests have a
seam to use.

## Risks

- **`osascript` latency.** Querying Calendar.app through Apple Events can take several
  seconds on a busy calendar. Mitigated by async spawn, a 10s timeout, caching, and a
  canvas that renders without waiting. If it proves unusable in practice, the escape hatch
  is a small Swift EventKit helper — better in every way except that it must be compiled
  and shipped.
- **TCC permission and unsigned builds.** There is no code signing anywhere in the
  packaging scripts; `package-mac.sh` copies `Electron.app`, renames the binary, and strips
  quarantine with `xattr -dr`. macOS ties Automation grants to code identity, so `npm run
  dev` is stable (the identity is Electron's own binary) while the packaged app will likely
  re-prompt after rebuilds. Acceptable for a self-built tool, but it is the reason calendar
  access must degrade gracefully rather than being assumed.
- **The `session-launcher` extraction touches a working feature.** It ships first and
  alone, with tests, so a regression in preset launching is caught before any task code
  exists.

## Build Order

1. **Extract `session-launcher.ts`.** Pure refactor; `preset-launch` becomes a wrapper.
   Existing preset behaviour unchanged, now under test.
2. **Data layer and tab shell.** Types, `TaskManager`, `handlers/tasks.ts`, preload bridge,
   `useTasks`, and a `tasks` tab rendering an empty board.
3. **Core loop.** Capture bar with the parser, board with columns and drag, day canvas with
   drag and resize, sweep modal.
4. **Packer and focus mode.** The two remaining pure modules plus their UI. Fully usable
   with no calendar.
5. **Calendar and delegation.** `calendar-reader.ts`, the `Info.plist` keys, the busy
   overlay, then `tasks:delegate` and the optional `tasks:decompose`.

Phases 1 and 2 gate everything. Phases 4 and 5 are independent of each other.

## Out of Scope

Two-way calendar sync, recurring tasks, energy-level modelling, automatic detection of
agent completion, splitting oversized tasks across slots, time reports over historical
focus data, and any merge with the session Kanban.
