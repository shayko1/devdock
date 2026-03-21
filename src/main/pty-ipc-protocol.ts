/**
 * Binary IPC protocol for communication between Electron main process
 * and the PTY host child process via stdio.
 *
 * Wire format: [4-byte big-endian uint32 payload length][JSON payload]
 *
 * Each message is length-prefixed so the receiver can handle partial
 * reads and multiple messages arriving in a single chunk.
 */

// ─── Messages from main process TO PTY host ─────────────────────

export interface SpawnMessage {
  type: 'spawn'
  sessionId: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
  shell: string
  shellArgs: string[]
  command?: string
}

export interface WriteMessage {
  type: 'write'
  sessionId: string
  data: string
}

export interface ResizeMessage {
  type: 'resize'
  sessionId: string
  cols: number
  rows: number
}

export interface KillMessage {
  type: 'kill'
  sessionId: string
}

export interface SnapshotRequestMessage {
  type: 'snapshot'
  sessionId: string
}

export interface DestroyAllMessage {
  type: 'destroy-all'
}

export type PtyClientMessage =
  | SpawnMessage
  | WriteMessage
  | ResizeMessage
  | KillMessage
  | SnapshotRequestMessage
  | DestroyAllMessage

// ─── Messages from PTY host TO main process ─────────────────────

export interface DataMessage {
  type: 'data'
  sessionId: string
  data: string
}

export interface ExitMessage {
  type: 'exit'
  sessionId: string
  exitCode: number
}

export interface ErrorMessage {
  type: 'error'
  sessionId: string
  message: string
}

export interface SpawnedMessage {
  type: 'spawned'
  sessionId: string
}

export interface ReadyMessage {
  type: 'ready'
  sessionId: string
}

export interface SnapshotResponseMessage {
  type: 'snapshot'
  sessionId: string
  lines: string[]
  cursorX: number
  cursorY: number
}

export interface HostErrorMessage {
  type: 'host-error'
  message: string
}

export type PtyHostMessage =
  | DataMessage
  | ExitMessage
  | ErrorMessage
  | SpawnedMessage
  | ReadyMessage
  | SnapshotResponseMessage
  | HostErrorMessage

// ─── Encode / Decode ─────────────────────────────────────────────

const LENGTH_PREFIX_SIZE = 4

/**
 * Encode a message into a length-prefixed buffer.
 * Format: [4-byte BE uint32 payload length][UTF-8 JSON payload]
 */
export function encodeMessage(msg: PtyClientMessage | PtyHostMessage | Record<string, unknown>): Buffer {
  const json = JSON.stringify(msg)
  const payload = Buffer.from(json, 'utf-8')
  const frame = Buffer.allocUnsafe(LENGTH_PREFIX_SIZE + payload.length)
  frame.writeUInt32BE(payload.length, 0)
  payload.copy(frame, LENGTH_PREFIX_SIZE)
  return frame
}

/**
 * Decode zero or more complete messages from a buffer.
 *
 * Returns the decoded messages and any leftover bytes that form
 * an incomplete frame (caller should prepend remainder to the next chunk).
 */
export function decodeMessages(buf: Buffer): { messages: Array<PtyClientMessage | PtyHostMessage>; remainder: Buffer } {
  const messages: Array<PtyClientMessage | PtyHostMessage> = []
  let offset = 0

  while (offset + LENGTH_PREFIX_SIZE <= buf.length) {
    const payloadLength = buf.readUInt32BE(offset)

    if (offset + LENGTH_PREFIX_SIZE + payloadLength > buf.length) {
      // Incomplete payload — return what we have as remainder
      break
    }

    const json = buf.subarray(offset + LENGTH_PREFIX_SIZE, offset + LENGTH_PREFIX_SIZE + payloadLength).toString('utf-8')
    messages.push(JSON.parse(json))
    offset += LENGTH_PREFIX_SIZE + payloadLength
  }

  const remainder = buf.subarray(offset)
  return { messages, remainder }
}
