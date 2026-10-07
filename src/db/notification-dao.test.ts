import { describe, expect, it } from 'vitest';
import { nextReminderAt } from './notification-dao';

describe('nextReminderAt', () => {
  it('推进每日、每周与每月提醒，并保留设置的时分', () => {
    expect(nextReminderAt('2026-09-29T08:30', 'daily')).toBe('2026-09-30T08:30');
    expect(nextReminderAt('2026-09-29T08:30', 'weekly')).toBe('2026-10-06T08:30');
    expect(nextReminderAt('2026-01-29T08:30', 'monthly')).toBe('2026-02-28T08:30');
  });

  it('一次性提醒或无效时间不生成下一次', () => {
    expect(nextReminderAt('2026-09-29T08:30', 'none')).toBeNull();
    expect(nextReminderAt('not-a-date', 'daily')).toBeNull();
  });
});
