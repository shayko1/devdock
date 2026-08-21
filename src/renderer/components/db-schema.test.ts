import { describe, it, expect } from 'vitest'
import { toCompletionSchema, formatSchemaSummary } from './db-schema'
import type { ColumnInfo } from './db-schema'

function col(name: string, type: string, key = ''): ColumnInfo {
  return { name, type, nullable: true, key, defaultValue: null, extra: '' }
}

describe('toCompletionSchema', () => {
  it('maps every table to its column completions', () => {
    const schema = toCompletionSchema({
      orders: [col('id', 'bigint(20)', 'PRI'), col('created_date', 'datetime')],
      users: [col('email', 'varchar(255)')],
    })

    expect(Object.keys(schema).sort()).toEqual(['orders', 'users'])
    expect(schema.orders.map((c) => c.label)).toEqual(['id', 'created_date'])
    expect(schema.users).toEqual([
      { label: 'email', type: 'property', detail: 'varchar(255)', boost: 0 },
    ])
  })

  it('annotates key columns and boosts them above plain columns', () => {
    const schema = toCompletionSchema({
      orders: [
        col('id', 'bigint(20)', 'PRI'),
        col('guid', 'binary(16)', 'UNI'),
        col('account_id', 'binary(16)', 'MUL'),
        col('note', 'text'),
      ],
    })

    expect(schema.orders).toEqual([
      { label: 'id', type: 'property', detail: 'bigint(20) · PK', boost: 2 },
      { label: 'guid', type: 'property', detail: 'binary(16) · UNIQUE', boost: 1 },
      { label: 'account_id', type: 'property', detail: 'binary(16) · INDEX', boost: 1 },
      { label: 'note', type: 'property', detail: 'text', boost: 0 },
    ])
  })

  it('keeps tables that have no readable columns so the table name still completes', () => {
    expect(toCompletionSchema({ empty_table: [] })).toEqual({ empty_table: [] })
  })

  it('returns an empty schema for an empty input', () => {
    expect(toCompletionSchema({})).toEqual({})
  })
})

describe('formatSchemaSummary', () => {
  it('pluralizes and groups thousands', () => {
    expect(formatSchemaSummary({ tableCount: 128, columnCount: 2431, truncated: false })).toBe(
      '128 tables · 2,431 columns',
    )
  })

  it('uses singular forms for a single table or column', () => {
    expect(formatSchemaSummary({ tableCount: 1, columnCount: 1, truncated: false })).toBe(
      '1 table · 1 column',
    )
  })

  it('marks a truncated schema so partial autocomplete is visible', () => {
    expect(formatSchemaSummary({ tableCount: 900, columnCount: 50000, truncated: true })).toBe(
      '900 tables · 50,000 columns (partial)',
    )
  })
})
