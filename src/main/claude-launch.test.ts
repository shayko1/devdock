/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { planClaudeLaunch, claudeProjectDirName, transcriptPathFor, isClaudeSessionId } from './claude-launch'

const UUID = 'd3ae2a00-9c17-4c25-812a-324d233978a0'
const OTHER_UUID = 'f718d22a-8661-4c5d-bd3c-506fb7806450'

describe('planClaudeLaunch', () => {
  const base = { supportsSessionId: true, newId: OTHER_UUID, flags: '' }

  it('resumes a session that has a transcript on disk', () => {
    expect(planClaudeLaunch({ ...base, reservedId: UUID, hasTranscript: true })).toEqual({
      command: `claude --resume ${UUID}`,
      claudeSessionId: UUID,
    })
  })

  it('reuses a reserved id that was never written, rather than resuming a session that does not exist', () => {
    // `claude --resume <unknown-id>` exits with "No conversation found"; the
    // reserved id is still free, so claiming it again is the correct move.
    expect(planClaudeLaunch({ ...base, reservedId: UUID, hasTranscript: false })).toEqual({
      command: `claude --session-id ${UUID}`,
      claudeSessionId: UUID,
    })
  })

  it('claims a fresh id for a brand-new session', () => {
    expect(planClaudeLaunch({ ...base, reservedId: null, hasTranscript: false })).toEqual({
      command: `claude --session-id ${OTHER_UUID}`,
      claudeSessionId: OTHER_UUID,
    })
  })

  it('never passes --session-id together with --resume', () => {
    const { command } = planClaudeLaunch({ ...base, reservedId: UUID, hasTranscript: true })
    expect(command).not.toContain('--session-id')
  })

  it('appends model and permission flags after the session flag', () => {
    expect(
      planClaudeLaunch({
        ...base,
        reservedId: null,
        hasTranscript: false,
        flags: ' --model opus --dangerously-skip-permissions',
      }).command,
    ).toBe(`claude --session-id ${OTHER_UUID} --model opus --dangerously-skip-permissions`)
  })

  describe('when the installed CLI has no --session-id flag', () => {
    const legacy = { ...base, supportsSessionId: false }

    it('still resumes by id', () => {
      expect(planClaudeLaunch({ ...legacy, reservedId: UUID, hasTranscript: true })).toEqual({
        command: `claude --resume ${UUID}`,
        claudeSessionId: UUID,
      })
    })

    it('starts plain and reports no known id, leaving discovery to the statusline', () => {
      expect(planClaudeLaunch({ ...legacy, reservedId: null, hasTranscript: false })).toEqual({
        command: 'claude',
        claudeSessionId: null,
      })
    })
  })
})

describe('isClaudeSessionId', () => {
  it('accepts a UUID', () => {
    expect(isClaudeSessionId(UUID)).toBe(true)
  })

  it('rejects anything that could smuggle shell syntax into the launch command', () => {
    // The plan string is executed by the session's shell, so ids from disk are
    // untrusted input until they match the UUID shape.
    expect(isClaudeSessionId('abc; rm -rf /')).toBe(false)
    expect(isClaudeSessionId('$(whoami)')).toBe(false)
    expect(isClaudeSessionId('claude-mq6zfgwm')).toBe(false)
    expect(isClaudeSessionId('')).toBe(false)
    expect(isClaudeSessionId(null)).toBe(false)
    expect(isClaudeSessionId(undefined)).toBe(false)
  })
})

describe('claudeProjectDirName', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(claudeProjectDirName('/Users/shayk/Workspace/Research')).toBe('-Users-shayk-Workspace-Research')
  })

  it('matches a directory name Claude Code actually produced', () => {
    // Ground truth: this path was run through `claude --session-id` and the
    // transcript landed in the directory asserted below.
    expect(
      claudeProjectDirName(
        '/private/tmp/claude-501/-Users-shayk-Workspace-deckdrop-pro/d6c48808-2b30-46e9-a7a5-941f0f19a01f/scratchpad/sid-test',
      ),
    ).toBe(
      '-private-tmp-claude-501--Users-shayk-Workspace-deckdrop-pro-d6c48808-2b30-46e9-a7a5-941f0f19a01f-scratchpad-sid-test',
    )
  })

  it('encodes underscores and dots, which DevDock worktree paths contain', () => {
    // Claude Code's rule is "non-alphanumeric -> dash", not just slashes.
    expect(claudeProjectDirName('/Users/s/my_app')).toBe('-Users-s-my-app')
    expect(claudeProjectDirName('/Users/s/site.com')).toBe('-Users-s-site-com')
    expect(claudeProjectDirName('/Users/s/.devdock/worktrees/a_b/x1/worktree')).toBe(
      '-Users-s--devdock-worktrees-a-b-x1-worktree',
    )
  })
})

describe('transcriptPathFor', () => {
  it('points at the per-project JSONL Claude Code writes', () => {
    expect(transcriptPathFor('/Users/shayk/Workspace/Research', UUID)).toMatch(
      new RegExp(`/\\.claude/projects/-Users-shayk-Workspace-Research/${UUID}\\.jsonl$`),
    )
  })
})
