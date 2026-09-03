import { describe, it, expect } from 'vitest'
import { cn, formatDate, truncate } from '../utils'

describe('cn utility', () => {
  it('joins class names correctly', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('foo', true && 'bar', false && 'baz')).toBe('foo bar')
  })

  it('handles empty and undefined', () => {
    expect(cn('foo', '', undefined, null, 'bar')).toBe('foo bar')
  })
})

describe('formatDate', () => {
  it('formats a date string', () => {
    expect(formatDate('2026-09-03')).toContain('2026')
  })
})

describe('truncate', () => {
  it('leaves short strings alone', () => {
    expect(truncate('abc', 10)).toBe('abc')
  })

  it('truncates long strings with ellipsis', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcde...')
  })
})