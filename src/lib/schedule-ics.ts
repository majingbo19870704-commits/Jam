import type { ScheduleEvent, ScheduleEventRepeat } from '@/types';

export type ImportedScheduleEvent = Pick<ScheduleEvent, 'title' | 'starts_at' | 'ends_at' | 'all_day' | 'reminder_at' | 'reminder_repeat' | 'color' | 'notes'>;

const fold = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const unfold = (value: string) => value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
const stamp = (value: string, allDay: boolean) => allDay ? value.slice(0, 10).replaceAll('-', '') : `${value.slice(0, 16).replaceAll(/[-:]/g, '')}00`;

export function exportIcs(events: ScheduleEvent[]) {
  const rows = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Personal Workstation//Schedule//ZH'];
  events.forEach((event) => {
    const repeat = event.reminder_repeat === 'none' ? '' : `\nRRULE:FREQ=${({ daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' } as const)[event.reminder_repeat]}`;
    rows.push('BEGIN:VEVENT', `UID:${event.id}@personal-workstation`, `DTSTART${event.all_day ? ';VALUE=DATE' : ''}:${stamp(event.starts_at, Boolean(event.all_day))}`);
    if (event.ends_at) rows.push(`DTEND${event.all_day ? ';VALUE=DATE' : ''}:${stamp(event.ends_at, Boolean(event.all_day))}`);
    rows.push(`SUMMARY:${fold(event.title)}`, `DESCRIPTION:${fold(event.notes ?? '')}${repeat}`, 'END:VEVENT');
  });
  rows.push('END:VCALENDAR');
  return `${rows.join('\r\n')}\r\n`;
}

export function parseIcs(content: string): ImportedScheduleEvent[] {
  const lines = content.replace(/\r\n[ \t]/g, '').replace(/\r/g, '').split('\n');
  const records: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  lines.forEach((line) => {
    if (line === 'BEGIN:VEVENT') { current = {}; return; }
    if (line === 'END:VEVENT') { if (current) records.push(current); current = null; return; }
    if (!current) return;
    const index = line.indexOf(':'); if (index < 0) return;
    const key = line.slice(0, index).split(';')[0]; current[key] = line.slice(index + 1);
  });
  return records.flatMap((record) => {
    const starts = icsDate(record.DTSTART); if (!starts || !record.SUMMARY?.trim()) return [];
    const allDay = /^\d{8}$/.test(record.DTSTART);
    const frequency = record.RRULE?.match(/FREQ=(DAILY|WEEKLY|MONTHLY)/)?.[1];
    const repeat: ScheduleEventRepeat = frequency === 'DAILY' ? 'daily' : frequency === 'WEEKLY' ? 'weekly' : frequency === 'MONTHLY' ? 'monthly' : 'none';
    return [{ title: unfold(record.SUMMARY).trim(), starts_at: starts, ends_at: icsDate(record.DTEND), all_day: allDay ? 1 : 0, reminder_at: null, reminder_repeat: repeat, color: '#4D7CFE', notes: record.DESCRIPTION ? unfold(record.DESCRIPTION) : null }];
  });
}
function icsDate(value?: string) { if (!value) return null; const clean = value.replace(/Z$/, ''); const match = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/); return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4] ?? '00'}:${match[5] ?? '00'}` : null; }
