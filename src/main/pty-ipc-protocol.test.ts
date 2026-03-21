/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { encodeMessage, decodeMessages } from './pty-ipc-protocol'

describe('pty-ipc-protocol', () => {
  it('encodes a message with 4-byte length prefix', () => {
    const msg = { type: 'data', sessionId: 'abc', data: 'hello' }
    const buf = encodeMessage(msg)

    // First 4 bytes are big-endian uint32 length of the JSON payload
    const payloadLength = buf.readUInt32BE(0)
    const payload = buf.subarray(4)

    expect(buf).toBeInstanceOf(Buffer)
    expect(payload.length).toBe(payloadLength)
    expect(JSON.parse(payload.toString('utf-8'))).toEqual(msg)
  })

  it('decodes a single complete message', () => {
    const msg = { type: 'spawned', sessionId: 's1' }
    const encoded = encodeMessage(msg)

    const { messages, remainder } = decodeMessages(encoded)

    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(msg)
    expect(remainder.length).toBe(0)
  })

  it('handles partial message (incomplete payload)', () => {
    const msg = { type: 'data', sessionId: 's1', data: 'some output' }
    const encoded = encodeMessage(msg)
    // Slice off last 5 bytes so payload is incomplete
    const partial = encoded.subarray(0, encoded.length - 5)

    const { messages, remainder } = decodeMessages(partial)

    expect(messages).toHaveLength(0)
    expect(remainder.length).toBe(partial.length)
  })

  it('handles multiple messages concatenated in one buffer', () => {
    const msg1 = { type: 'data', sessionId: 's1', data: 'first' }
    const msg2 = { type: 'exit', sessionId: 's1', exitCode: 0 }
    const msg3 = { type: 'error', sessionId: 's2', message: 'failed' }

    const combined = Buffer.concat([
      encodeMessage(msg1),
      encodeMessage(msg2),
      encodeMessage(msg3),
    ])

    const { messages, remainder } = decodeMessages(combined)

    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual(msg1)
    expect(messages[1]).toEqual(msg2)
    expect(messages[2]).toEqual(msg3)
    expect(remainder.length).toBe(0)
  })

  it('handles incomplete length header (less than 4 bytes)', () => {
    // Only 2 bytes — not enough for the 4-byte length prefix
    const partial = Buffer.from([0x00, 0x0a])

    const { messages, remainder } = decodeMessages(partial)

    expect(messages).toHaveLength(0)
    expect(remainder).toEqual(partial)
  })
})
