/**
 * Verifies that the schema shape produced by `toCompletionSchema` is actually
 * consumed by @codemirror/lang-sql — i.e. that typing a table alias followed by
 * "." offers that table's columns in the SQL editor.
 *
 * Exercises lang-sql's real completion source rather than a stand-in, so a
 * breaking change in its expected schema format fails here instead of silently
 * degrading autocomplete back to keywords-only.
 */
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { schemaCompletionSource, MySQL, StandardSQL } from '@codemirror/lang-sql'
import { toCompletionSchema } from './db-schema'
import type { ColumnInfo } from './db-schema'

function col(name: string, type: string, key = ''): ColumnInfo {
  return { name, type, nullable: true, key, defaultValue: null, extra: '' }
}

const SCHEMA = toCompletionSchema({
  orders: [col('id', 'bigint(20)', 'PRI'), col('account_id', 'binary(16)', 'MUL'), col('created_date', 'datetime')],
  subscriptions: [col('id', 'bigint(20)', 'PRI'), col('cycle', 'int(11)')],
})

/** Run lang-sql's completion source at the end of `doc` and return the labels offered. */
function completionsAt(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [StandardSQL.language] })
  const source = schemaCompletionSource({ dialect: MySQL, schema: SCHEMA })
  // explicit=true so completion fires even where it wouldn't auto-trigger.
  const result = source(new CompletionContext(state, doc.length, true))
  if (!result || 'then' in result) return []
  return result.options.map((o) => o.label)
}

describe('lang-sql integration', () => {
  it('completes a table alias into that table\'s columns', () => {
    const labels = completionsAt('SELECT * FROM orders o WHERE o.')
    expect(labels).toEqual(expect.arrayContaining(['id', 'account_id', 'created_date']))
    expect(labels).not.toContain('cycle')
  })

  it('completes a bare table name into its columns', () => {
    const labels = completionsAt('SELECT subscriptions.')
    expect(labels).toEqual(expect.arrayContaining(['id', 'cycle']))
    expect(labels).not.toContain('created_date')
  })

  it('offers table names at the top level', () => {
    const labels = completionsAt('SELECT * FROM ')
    expect(labels).toEqual(expect.arrayContaining(['orders', 'subscriptions']))
  })
})
