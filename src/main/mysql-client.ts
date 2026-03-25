/**
 * mysql-client.ts — Main-process module for managing MySQL connections via mysql2/promise.
 *
 * Exports a singleton `mysqlClient` instance of `MysqlClient`.
 * All public methods are safe to call from IPC handlers; errors are caught
 * and returned in structured result objects rather than thrown.
 */

// Use eval require to prevent Vite from bundling the native module.
// Same pattern as pty-manager.ts.
// eslint-disable-next-line no-eval
const mysql: typeof import('mysql2/promise') = eval("require('mysql2/promise')")

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface QueryResult {
  columns: ColumnDef[]
  rows: any[][]
  rowCount: number
  affectedRows: number
  executionTimeMs: number
  error?: string
}

export interface ColumnDef {
  name: string
  type: string
}

export interface TableInfo {
  name: string
  type: 'TABLE' | 'VIEW'
  engine: string | null
  rows: number | null
  comment: string
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  key: string
  defaultValue: string | null
  extra: string
}

export interface DbConnection {
  id: string
  host: string
  port: number
  user: string
  database: string
  connected: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ROWS = 10_000
const CONNECT_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// MySQL field-type code to human-readable name mapping
// Based on mysql2 field type constants.
// ---------------------------------------------------------------------------

const FIELD_TYPE_NAMES: Record<number, string> = {
  0: 'DECIMAL',
  1: 'TINYINT',
  2: 'SMALLINT',
  3: 'INT',
  4: 'FLOAT',
  5: 'DOUBLE',
  6: 'NULL',
  7: 'TIMESTAMP',
  8: 'BIGINT',
  9: 'MEDIUMINT',
  10: 'DATE',
  11: 'TIME',
  12: 'DATETIME',
  13: 'YEAR',
  14: 'NEWDATE',
  15: 'VARCHAR',
  16: 'BIT',
  245: 'JSON',
  246: 'NEWDECIMAL',
  247: 'ENUM',
  248: 'SET',
  249: 'TINY_BLOB',
  250: 'MEDIUM_BLOB',
  251: 'LONG_BLOB',
  252: 'BLOB',
  253: 'VAR_STRING',
  254: 'STRING',
  255: 'GEOMETRY'
}

function fieldTypeName(typeCode: number): string {
  return FIELD_TYPE_NAMES[typeCode] ?? `UNKNOWN(${typeCode})`
}

// ---------------------------------------------------------------------------
// Internal metadata stored alongside each connection
// ---------------------------------------------------------------------------

interface ConnectionEntry {
  connection: any // mysql2 Connection (typed as any to stay decoupled from runtime types)
  meta: DbConnection
}

// ---------------------------------------------------------------------------
// MysqlClient
// ---------------------------------------------------------------------------

class MysqlClient {
  private connections: Map<string, ConnectionEntry> = new Map()

  /**
   * Connect to a MySQL server. After a successful TCP + auth handshake the
   * connection is verified with a ping.
   */
  async connect(
    id: string,
    host: string,
    port: number,
    user: string,
    password: string,
    database: string
  ): Promise<DbConnection> {
    // If a connection with this id already exists, close it first.
    if (this.connections.has(id)) {
      await this.disconnect(id)
    }

    const connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      connectTimeout: CONNECT_TIMEOUT_MS,
      multipleStatements: false,
      rowsAsArray: true // we always want array rows for efficient transfer
    })

    // Verify the connection is alive.
    await connection.ping()

    const meta: DbConnection = {
      id,
      host,
      port,
      user,
      database,
      connected: true
    }

    this.connections.set(id, { connection, meta })

    return { ...meta }
  }

  /**
   * Disconnect a single connection by id.
   */
  async disconnect(id: string): Promise<void> {
    const entry = this.connections.get(id)
    if (!entry) return

    entry.meta.connected = false
    this.connections.delete(id)

    try {
      await entry.connection.end()
    } catch {
      // Best-effort — the connection may already be dead.
    }
  }

  /**
   * Execute an arbitrary SQL statement and return a structured result.
   *
   * - SELECT-like statements return columns + rows (capped at MAX_ROWS).
   * - DML statements (INSERT/UPDATE/DELETE) return affectedRows.
   * - Errors are caught and surfaced via `QueryResult.error`.
   */
  async executeQuery(id: string, sql: string): Promise<QueryResult> {
    const empty: QueryResult = {
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: 0,
      executionTimeMs: 0
    }

    const entry = this.connections.get(id)
    if (!entry) {
      return { ...empty, error: `No connection found for id "${id}"` }
    }

    const start = performance.now()

    try {
      const [result, fields] = await entry.connection.query(sql)
      const executionTimeMs = Math.round((performance.now() - start) * 100) / 100

      // SELECT-like queries return an array of rows and a fields descriptor.
      if (Array.isArray(result)) {
        const columns: ColumnDef[] = (fields ?? []).map((f: any) => ({
          name: f.name as string,
          type: fieldTypeName(f.columnType ?? f.type ?? 0)
        }))

        const rows = result.length > MAX_ROWS ? result.slice(0, MAX_ROWS) : result

        return {
          columns,
          rows: rows as any[][],
          rowCount: rows.length,
          affectedRows: 0,
          executionTimeMs
        }
      }

      // DML / DDL — result is an OkPacket-like object.
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: (result as any).affectedRows ?? 0,
        executionTimeMs
      }
    } catch (err: any) {
      const executionTimeMs = Math.round((performance.now() - start) * 100) / 100

      // If the error indicates the connection is gone, mark it.
      if (isConnectionLostError(err)) {
        entry.meta.connected = false
      }

      return {
        ...empty,
        executionTimeMs,
        error: err.message ?? String(err)
      }
    }
  }

  /**
   * List all databases the connected user can see.
   */
  async listDatabases(id: string): Promise<string[]> {
    const entry = this.connections.get(id)
    if (!entry) {
      throw new Error(`No connection found for id "${id}"`)
    }

    try {
      const [rows] = await entry.connection.query('SHOW DATABASES')
      return (rows as any[]).map((r: any) => (Array.isArray(r) ? r[0] : r.Database) as string)
    } catch (err: any) {
      if (isConnectionLostError(err)) entry.meta.connected = false
      throw err
    }
  }

  /**
   * List tables (and views) in the given database, falling back to the
   * connection's current database.
   */
  async listTables(id: string, database?: string): Promise<TableInfo[]> {
    const entry = this.connections.get(id)
    if (!entry) {
      throw new Error(`No connection found for id "${id}"`)
    }

    const db = database ?? entry.meta.database

    try {
      const [rows] = await entry.connection.query(
        `SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, TABLE_COMMENT
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [db]
      )

      return (rows as any[]).map((r: any) => {
        // With rowsAsArray the row is a positional array.
        const row = Array.isArray(r) ? r : [r.TABLE_NAME, r.TABLE_TYPE, r.ENGINE, r.TABLE_ROWS, r.TABLE_COMMENT]
        return {
          name: row[0] as string,
          type: (row[1] === 'VIEW' ? 'VIEW' : 'TABLE') as 'TABLE' | 'VIEW',
          engine: (row[2] as string) ?? null,
          rows: row[3] != null ? Number(row[3]) : null,
          comment: (row[4] as string) ?? ''
        }
      })
    } catch (err: any) {
      if (isConnectionLostError(err)) entry.meta.connected = false
      throw err
    }
  }

  /**
   * Describe the columns of a table.
   */
  async describeTable(id: string, tableName: string, database?: string): Promise<ColumnInfo[]> {
    const entry = this.connections.get(id)
    if (!entry) {
      throw new Error(`No connection found for id "${id}"`)
    }

    const db = database ?? entry.meta.database

    try {
      // Escape database and table identifiers to prevent injection.
      // mysql2 connection.escapeId handles backtick-quoting.
      const qualifiedTable = database
        ? `${entry.connection.escapeId(db)}.${entry.connection.escapeId(tableName)}`
        : entry.connection.escapeId(tableName)

      const [rows] = await entry.connection.query(`SHOW FULL COLUMNS FROM ${qualifiedTable}`)

      return (rows as any[]).map((r: any) => {
        // rowsAsArray: [Field, Type, Collation, Null, Key, Default, Extra, Privileges, Comment]
        const row = Array.isArray(r)
          ? r
          : [r.Field, r.Type, r.Collation, r.Null, r.Key, r.Default, r.Extra, r.Privileges, r.Comment]
        return {
          name: row[0] as string,
          type: row[1] as string,
          nullable: row[3] === 'YES',
          key: (row[4] as string) ?? '',
          defaultValue: row[5] != null ? String(row[5]) : null,
          extra: (row[6] as string) ?? ''
        }
      })
    } catch (err: any) {
      if (isConnectionLostError(err)) entry.meta.connected = false
      throw err
    }
  }

  /**
   * Return a serializable snapshot of all active connections.
   */
  getConnections(): DbConnection[] {
    return Array.from(this.connections.values()).map((e) => ({ ...e.meta }))
  }

  /**
   * Disconnect every active connection. Called on app quit.
   */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys())
    await Promise.allSettled(ids.map((id) => this.disconnect(id)))
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the error indicates the underlying TCP connection is dead
 * (server gone, connection reset, protocol desync, etc.).
 */
function isConnectionLostError(err: any): boolean {
  if (!err) return false
  const code: string = err.code ?? ''
  const fatal: boolean = err.fatal ?? false
  const lostCodes = new Set([
    'PROTOCOL_CONNECTION_LOST',
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ER_SERVER_SHUTDOWN',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'
  ])
  return fatal || lostCodes.has(code)
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const mysqlClient = new MysqlClient()
