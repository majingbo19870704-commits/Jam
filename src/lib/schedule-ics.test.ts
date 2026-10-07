import { describe, expect, it } from 'vitest';
import { exportIcs, parseIcs } from './schedule-ics';
describe('schedule ICS', () => {
  it('exports and imports title, timing and recurrence', () => {
    const ics = exportIcs([{ id: 'a', account_id: 'u', title: '项目例会', starts_at: '2026-09-29T09:30', ends_at: '2026-09-29T10:00', all_day: 0, reminder_at: null, reminder_repeat: 'weekly', color: '#4D7CFE', notes: '讨论\n风险', created_at: '', updated_at: '', is_deleted: 0 }]);
    expect(parseIcs(ics)).toMatchObject([{ title: '项目例会', starts_at: '2026-09-29T09:30', reminder_repeat: 'weekly', notes: '讨论\n风险' }]);
  });
});
