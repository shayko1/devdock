/**
 * db-schema.ts — Shapes a connected database's schema into CodeMirror SQL
 * autocompletion data.
 *
 * Pure functions only: no IPC, no CodeMirror imports. The completion shape is
 * declared structurally rather than imported from @codemirror/autocomplete,
 * which is only a transitive dependency of @codemirror/lang-sql.
 */

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  key: string
  defaultValue: string | null
  extra: string
}

/** A table's columns, keyed by table name — as returned by `dbGetSchema`. */
export type SchemaTables = Record<string, ColumnInfo[]>

export interface SchemaStats {
  tableCount: number
  columnCount: number
  truncated: boolean
}

/** Structural subset of CodeMirror's `Completion` that lang-sql consumes. */
export interface ColumnCompletion {
  label: string
  type: 'property'
  detail: string
  boost: number
}

/**
 * MySQL `COLUMN_KEY` values, mapped to the label shown in the completion detail
 * and the sort boost that floats identifying columns to the top of the list.
 */
const KEY_ANNOTATIONS: Record<string, { label: string; boost: number }> = {
  PRI: { label: 'PK', boost: 2 },
  UNI: { label: 'UNIQUE', boost: 1 },
  MUL: { label: 'INDEX', boost: 1 },
}

/**
 * Build the `schema` option for `sql({ dialect, schema })`. Table names come
 * from the keys, so tables with no readable columns are kept rather than
 * dropped — the table name itself is still worth completing.
 */
export function toCompletionSchema(tables: SchemaTables): Record<string, ColumnCompletion[]> {
  const schema: Record<string, ColumnCompletion[]> = {}

  for (const [tableName, columns] of Object.entries(tables)) {
    schema[tableName] = columns.map((col) => {
      const annotation = KEY_ANNOTATIONS[col.key]
      return {
        label: col.name,
        type: 'property',
        detail: annotation ? `${col.type} · ${annotation.label}` : col.type,
        boost: annotation ? annotation.boost : 0,
      }
    })
  }

  return schema
}

/** Toolbar label telling the user how much schema autocompletion is armed with. */
export function formatSchemaSummary(stats: SchemaStats): string {
  const tables = `${stats.tableCount.toLocaleString('en-US')} table${stats.tableCount === 1 ? '' : 's'}`
  const columns = `${stats.columnCount.toLocaleString('en-US')} column${stats.columnCount === 1 ? '' : 's'}`
  return `${tables} · ${columns}${stats.truncated ? ' (partial)' : ''}`
}
