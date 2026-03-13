# DevDock

A local project command center for macOS.

DevDock is an Electron desktop application that centralizes your development workflow. It lets you discover projects, run Claude CLI sessions with embedded terminals, manage automated agents, and control a real browser from the command line.

---

## Features

### Launchpad Tab

Scans a configurable workspace directory for projects. Each project appears as a card showing:

- Name and detected tech stack
- Tags for organization
- Run command and port
- Status (running, stopped, port in use)

You can start and stop projects, view logs, detect when ports are already in use, and open projects in Cursor, Zed, Terminal, or Finder.

### All Folders Tab

Browse all folders in your workspace. Each folder shows its git branch and remote information. Open Claude sessions directly from any folder.

### Claude Tab

Embedded terminal sessions that run the Claude CLI (`claude --dangerously-skip-permissions`). Includes:

- **Git worktrees** for isolated development per session
- **Session resume** so you can pick up where you left off
- **File explorer panel** for browsing and opening files
- **Search panel** for finding content
- **Embedded browser panel** for viewing web pages
- **Diff viewer** for reviewing changes
- **Pipeline automation** for autonomous task execution

### Agents Tab

Scans `~/.claude/scripts` and macOS LaunchAgents for Claude-powered automated agents. Shows schedule, status, and logs. Lets you manually trigger agents.

### Browser Bridge

DevDock injects a `browser` CLI command into Claude sessions. Claude can control a real browser window: navigate, take screenshots, click elements, type into inputs, and run JavaScript. This enables interactive web testing and inspection directly from terminal prompts.

### Pipeline

Autonomous task pipeline that creates git worktrees, runs Claude to implement tasks, then runs build and test steps for validation.

---

## Prerequisites

- **Node.js** 18 or later
- **npm** (comes with Node.js)
- **git**
- **Claude CLI** — install via: `npm install -g @anthropic-ai/claude-code`
- **macOS** 10.15 (Catalina) or later
- **Xcode Command Line Tools** (may be required for `node-pty` native compilation)

---

## Installation

### Clone and Install

```bash
git clone <repository-url> project-launchpad
cd project-launchpad
npm install
```

### Development Mode

```bash
npm run dev
```

Runs the app with hot reload. Changes to the renderer process reload automatically.

### Production Build

```bash
npm run build
```

Compiles the application to the `out/` directory.

### Package as macOS Application

```bash
npm run package
```

Creates `dist/DevDock.app`. To install system-wide:

```bash
cp -R dist/DevDock.app /Applications/
```

Then open DevDock from Spotlight or add it to your Dock.

### Preview Built App

```bash
npm run start
# or
npm run preview
```

Runs the already-built application without packaging.

---

## First-Time Setup

1. **Install Claude CLI** (if not already installed):
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. **Set your workspace path** in DevDock (Launchpad tab). The default is `~/Workspace`. DevDock will scan this directory for projects.

3. **Optional: Add agents** by placing scripts in `~/.claude/scripts` or configuring macOS LaunchAgents. DevDock will discover and list them in the Agents tab.

4. **Ensure `claude` is on your PATH** so the embedded terminals can spawn Claude sessions.

---

## Usage Guide

### Launchpad Tab

1. Set or change the scan path (default: `~/Workspace`).
2. Click **Scan** to discover projects. Projects are detected by presence of `package.json`, `Cargo.toml`, and similar files.
3. Edit a project to set its run command, port, and tags.
4. Use **Start** to run the project; **Stop** to kill it.
5. Use the action buttons to open in Cursor, Zed, Terminal, or Finder.
6. Check logs in the log panel for running projects.

### All Folders Tab

1. Browse folders in your workspace.
2. View git branch and remote for each folder.
3. Click to open a Claude session in that folder.

### Claude Tab

1. Click **New Session** to create a session. Choose a name and working directory (or worktree).
2. In the terminal, type normally — commands run in a real shell (`/bin/zsh -i`).
3. To invoke Claude: run `claude` or use the prompt. DevDock auto-writes `CLAUDE.md` to the session directory with browser tool instructions.
4. Use the side panels: File Explorer, Search, Changes (diff), and Browser.
5. Sessions persist; resume from the tab list.

### Agents Tab

1. View discovered agents from `~/.claude/scripts` and LaunchAgents.
2. See schedule and last run status.
3. Trigger an agent manually with the run button.
4. View logs for debugging.

### Browser Bridge (inside Claude sessions)

When running Claude inside a DevDock session, the `browser` command is injected into your PATH. Example usage:

```bash
browser open
browser navigate https://localhost:3000
browser screenshot
browser click '#submit-btn'
browser type '#email' hello@example.com
browser text
browser close
```

---

## Keyboard Shortcuts

### General

| Shortcut | Action |
|----------|--------|
| Cmd+K | Focus search (or clear terminal when in terminal) |
| Cmd+1 | Switch to Launchpad tab |
| Cmd+2 | Switch to All Folders tab |
| Cmd+3 | Switch to Claude tab |
| Cmd+4 | Switch to Agents tab |
| Esc | Close modal / exit mode |
| ? | Show shortcuts help |

### Terminal (Claude sessions)

| Shortcut | Action |
|----------|--------|
| Shift+Enter | New line in Claude prompt |
| Cmd+K | Clear terminal |
| Cmd+C (with selection) | Copy |
| Cmd+V | Paste |
| Cmd+A | Select all |
| Cmd++ / Cmd+- / Cmd+0 | Zoom font size |

You can also drag and drop images into the terminal to paste image paths for Claude.

---

## Configuration

### Data Locations

| Path | Purpose |
|------|---------|
| `~/Library/Application Support/devdock/state.json` | Persisted app state (projects, tags, scan path) |
| `~/.devdock/worktrees/` | Git worktrees for Claude sessions and pipeline |
| `~/.devdock/tmp-images/` | Temporary screenshots from the browser bridge |
| `~/.devdock/browser` | Browser bridge CLI helper script (injected into Claude session PATH) |

### Default Scan Path

The default workspace scan path is `~/Workspace`. Change it in the Launchpad tab.

---

## Development

### Project Structure

```
src/
  main/           # Electron main process
    index.ts       # Main entry, window creation, IPC
    store.ts       # State persistence
    scanner.ts     # Project discovery
    process-manager.ts
    pty-manager.ts # Terminal sessions (node-pty)
    pipeline-manager.ts
    browser-bridge.ts
    agent-scanner.ts
  preload/
    index.ts       # IPC bridge (contextBridge)
  renderer/        # React UI
    App.tsx
    components/
    hooks/
  shared/
    types.ts       # Shared TypeScript types
```

### Tech Stack

- **Electron** 33
- **React** 19
- **TypeScript** 5.7
- **Vite** 6
- **xterm.js** — terminal emulation
- **node-pty** — pseudo-terminal spawning

### Development Workflow

1. Run `npm run dev` for hot-reload development.
2. Main process changes require an app restart.
3. Renderer changes reload automatically.

---

## Troubleshooting

### node-pty Fails to Build

`node-pty` requires native compilation. Install Xcode Command Line Tools:

```bash
xcode-select --install
```

Then reinstall:

```bash
npm install
```

### Claude CLI Not Found

Ensure Claude is installed and on your PATH:

```bash
npm install -g @anthropic-ai/claude-code
which claude
```

### Port Already in Use

DevDock detects when a project's port is in use. Check the project card status. Stop the conflicting process or change the project's port in the edit modal.

### Browser Bridge Not Working

The `browser` command is only available inside DevDock Claude sessions. Ensure:

1. You are in a session started from the Claude tab.
2. The session is using a working directory where DevDock has set up the PATH.

### Sessions Not Resuming

State is stored in `~/Library/Application Support/devdock/`. If sessions disappear, check that this directory is writable and not being cleared.

---

## License

MIT
