/**
 * PTY Host child process entry point.
 *
 * This file runs as a standalone Node.js child process, fork()ed by the
 * Electron main process.  It reads PtyClientMessages from stdin
 * (length-prefixed binary framing) and writes PtyHostMessages to stdout
 * (same framing).  stderr is reserved for debug logging.
 */

import { encodeMessage, decodeMessages } from './pty-ipc-protocol'
import type { PtyClientMessage, PtyHostMessage } from './pty-ipc-protocol'
import { PtyHostProcess } from './pty-host-process'

// ─── Send callback: encode message and write to stdout ──────────

function send(msg: PtyHostMessage): void {
  const frame = encodeMessage(msg)
  process.stdout.write(frame)
}

// ─── Create the host instance ───────────────────────────────────

const host = new PtyHostProcess(send)

// ─── Read stdin: accumulate buffer, decode, dispatch ────────────

let buffer: Buffer = Buffer.alloc(0)

process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk])
  const { messages, remainder } = decodeMessages(buffer)
  buffer = remainder

  for (const msg of messages) {
    host.handleMessage(msg as PtyClientMessage)
  }
})

process.stdin.on('end', () => {
  // Parent disconnected — tear down all sessions and exit cleanly
  host.handleMessage({ type: 'destroy-all' })
  process.exit(0)
})

// ─── Crash resilience ───────────────────────────────────────────

process.on('uncaughtException', (err: Error) => {
  process.stderr.write(`[pty-host] Uncaught exception: ${err.message}\n${err.stack ?? ''}\n`)
  // Do NOT exit — keep serving other sessions
})

// ─── Startup log ────────────────────────────────────────────────

process.stderr.write('[pty-host] Started\n')
