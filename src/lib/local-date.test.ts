import { describe, expect, it } from 'vitest';
import { localDateKey } from './local-date';

describe('localDateKey', () => {
  it('uses local calendar parts instead of UTC serialization', () => {
    expect(localDateKey(new Date(2026, 0, 2, 0, 5))).toBe('2026-01-02');
    expect(localDateKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});
