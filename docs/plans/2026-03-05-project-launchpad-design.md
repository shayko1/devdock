# Project Launchpad - Design

## Overview
Mac Electron app that scans ~/Workspace, lets you curate/tag projects, and run/manage them from a single dashboard.

## Tech Stack
- Electron + React + TypeScript
- electron-vite for build tooling
- Local JSON file for persistence

## Key Features
1. **Workspace Scanner** - scans directories, detects package.json/docker-compose/Makefile, infers tech stack and run commands
2. **Manual Tagging** - user-defined tags and categories
3. **Process Manager** - start/stop projects, stream logs, auto-open browser
4. **Port Collision Manager** - detects port conflicts and auto-assigns free ports
5. **Rich Cards** - name, description, tech stack, tags, port, status dot, last opened
6. **Log Viewer** - collapsible bottom panel with live log streaming
7. **Search + Filter** - by name, tag, tech, description + sidebar tag filters

## Data Model
- Projects stored in `~/.config/project-launchpad/state.json`
- Each project: id, name, path, tags[], description, techStack[], runCommand, port, lastOpened, hidden

## Architecture
- Main process: IPC handlers, process spawning, file I/O, port management
- Preload: contextBridge API exposure
- Renderer: React app with hooks-based state management
