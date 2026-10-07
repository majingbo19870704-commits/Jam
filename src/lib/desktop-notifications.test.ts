import { describe, expect, it } from 'vitest';
import { isWithinQuietHours } from './desktop-notifications';

describe('isWithinQuietHours', () => {
  it('supports a quiet period that crosses midnight', () => {
    expect(isWithinQuietHours(new Date(2026, 8, 30, 23, 0), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(new Date(2026, 8, 30, 6, 59), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(new Date(2026, 8, 30, 12, 0), '22:00', '07:00')).toBe(false);
  });

  it('uses a half-open normal daytime interval and rejects invalid ranges', () => {
    expect(isWithinQuietHours(new Date(2026, 8, 30, 9, 0), '09:00', '18:00')).toBe(true);
    expect(isWithinQuietHours(new Date(2026, 8, 30, 18, 0), '09:00', '18:00')).toBe(false);
    expect(isWithinQuietHours(new Date(2026, 8, 30, 9, 0), '09:00', '09:00')).toBe(false);
  });
});
