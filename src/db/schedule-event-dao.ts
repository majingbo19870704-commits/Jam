import { v4 as uuid } from 'uuid';
import { exec, query, queryOne, withTransaction } from './client';
import { useAccountStore } from '@/stores/account';
import type { ScheduleEvent, ScheduleEventRepeat } from '@/types';

const accountId = () => {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('请先登录。');
  return id;
};

export type ScheduleEventInput = Pick<
  ScheduleEvent,
  | 'title'
  | 'starts_at'
  | 'ends_at'
  | 'all_day'
  | 'reminder_at'
  | 'reminder_repeat'
  | 'type_id'
  | 'color'
  | 'repeat_until'
  | 'repeat_exdates'
  | 'notes'
  | 'completed_at'
>;

export async function listScheduleEvents(options: { from?: string; to?: string } = {}) {
  const account = accountId();
  const where = ['account_id=$1', 'is_deleted=0'];
  const values: unknown[] = [account];
  if (options.from) {
    values.push(options.from);
    where.push(`starts_at >= $${values.length}`);
  }
  if (options.to) {
    values.push(options.to);
    where.push(`starts_at < $${values.length}`);
  }
  return query<ScheduleEvent>(
    `SELECT * FROM schedule_event WHERE ${where.join(' AND ')} ORDER BY starts_at ASC, created_at ASC`,
    values,
  );
}

/** 查询时间段，并把每日/每周/每月的重复规则展开为可显示实例。 */
export async function listScheduleOccurrences(options: { from: string; to: string }) {
  const account = accountId();
  const rows = await query<ScheduleEvent>(
    `SELECT * FROM schedule_event WHERE account_id=$1 AND is_deleted=0
      AND ((starts_at >= $2 AND starts_at < $3) OR (reminder_repeat <> 'none' AND starts_at < $3))
     ORDER BY starts_at ASC, created_at ASC`,
    [account, options.from, options.to],
  );
  return expandScheduleOccurrences(rows, options);
}

export function expandScheduleOccurrences(
  events: ScheduleEvent[],
  range: { from: string; to: string },
) {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const expanded: ScheduleEvent[] = [];
  for (const event of events) {
    const sourceStart = new Date(event.starts_at);
    const sourceEnd = event.ends_at ? new Date(event.ends_at) : null;
    const duration = sourceEnd ? sourceEnd.getTime() - sourceStart.getTime() : null;
    const exclusions = parseExdates(event.repeat_exdates);
    const until = event.repeat_until ? new Date(`${event.repeat_until.slice(0, 10)}T23:59`) : to;
    const occurrence = new Date(sourceStart);
    for (let count = 0; count < 4_000; count++) {
      if (occurrence >= to || occurrence > until) break;
      const key = localDateTime(occurrence);
      if (occurrence >= from && !exclusions.has(key.slice(0, 10))) {
        expanded.push({
          ...event,
          id: event.reminder_repeat === 'none' ? event.id : `${event.id}@${key}`,
          starts_at: key,
          ends_at:
            duration === null ? null : localDateTime(new Date(occurrence.getTime() + duration)),
          recurrence_source_id: event.reminder_repeat === 'none' ? null : event.id,
          is_virtual_occurrence: event.reminder_repeat !== 'none',
        });
      }
      if (event.reminder_repeat === 'none') break;
      if (event.reminder_repeat === 'daily') occurrence.setDate(occurrence.getDate() + 1);
      if (event.reminder_repeat === 'weekly') occurrence.setDate(occurrence.getDate() + 7);
      if (event.reminder_repeat === 'monthly') occurrence.setMonth(occurrence.getMonth() + 1);
    }
  }
  return expanded.sort((left, right) => left.starts_at.localeCompare(right.starts_at));
}

export async function getScheduleEvent(id: string) {
  return queryOne<ScheduleEvent>(
    'SELECT * FROM schedule_event WHERE id=$1 AND account_id=$2 AND is_deleted=0',
    [id, accountId()],
  );
}

export async function createScheduleEvent(input: ScheduleEventInput) {
  const account = accountId();
  const now = new Date().toISOString();
  const row: ScheduleEvent = {
    id: uuid(),
    account_id: account,
    title: input.title.trim(),
    starts_at: input.starts_at,
    ends_at: input.ends_at || null,
    all_day: input.all_day ? 1 : 0,
    reminder_at: input.reminder_at || null,
    reminder_repeat: input.reminder_repeat ?? 'none',
    type_id: input.type_id || null,
    color: input.color || '#4D7CFE',
    repeat_until: input.repeat_until || null,
    repeat_exdates: input.repeat_exdates || '[]',
    notes: input.notes?.trim() || null,
    completed_at: input.completed_at || null,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  if (!row.title) throw new Error('请填写日程标题。');
  if (!isLocalDateTime(row.starts_at)) throw new Error('请设置有效的开始时间。');
  if (row.ends_at && (!isLocalDateTime(row.ends_at) || row.ends_at < row.starts_at))
    throw new Error('结束时间应晚于开始时间。');
  if (row.reminder_at && !isLocalDateTime(row.reminder_at)) throw new Error('提醒时间无效。');
  await exec(
    `INSERT INTO schedule_event(id,account_id,title,starts_at,ends_at,all_day,reminder_at,reminder_repeat,type_id,color,repeat_until,repeat_exdates,notes,completed_at,created_at,updated_at,is_deleted)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0)`,
    [
      row.id,
      row.account_id,
      row.title,
      row.starts_at,
      row.ends_at,
      row.all_day,
      row.reminder_at,
      row.reminder_repeat,
      row.type_id,
      row.color,
      row.repeat_until,
      row.repeat_exdates,
      row.notes,
      row.completed_at,
      row.created_at,
      row.updated_at,
    ],
  );
  return row;
}

export async function updateScheduleEvent(id: string, patch: Partial<ScheduleEventInput>) {
  const existing = await getScheduleEvent(id);
  if (!existing) throw new Error('日程不存在或已删除。');
  const next: ScheduleEventInput = { ...existing, ...patch };
  if (!next.title.trim()) throw new Error('请填写日程标题。');
  if (!isLocalDateTime(next.starts_at)) throw new Error('请设置有效的开始时间。');
  if (next.ends_at && (!isLocalDateTime(next.ends_at) || next.ends_at < next.starts_at))
    throw new Error('结束时间应晚于开始时间。');
  if (next.reminder_at && !isLocalDateTime(next.reminder_at)) throw new Error('提醒时间无效。');
  await exec(
    `UPDATE schedule_event SET title=$1,starts_at=$2,ends_at=$3,all_day=$4,reminder_at=$5,
      reminder_repeat=$6,type_id=$7,color=$8,repeat_until=$9,repeat_exdates=$10,notes=$11,completed_at=$12,updated_at=$13 WHERE id=$14 AND account_id=$15 AND is_deleted=0`,
    [
      next.title.trim(),
      next.starts_at,
      next.ends_at || null,
      next.all_day ? 1 : 0,
      next.reminder_at || null,
      next.reminder_repeat ?? 'none',
      next.type_id || null,
      next.color || '#4D7CFE',
      next.repeat_until || null,
      next.repeat_exdates || '[]',
      next.notes?.trim() || null,
      next.completed_at || null,
      new Date().toISOString(),
      id,
      accountId(),
    ],
  );
}

/** 返回与候选时间段重叠的日程，用于保存前的显式确认。 */
export async function findScheduleConflicts(
  input: Pick<ScheduleEventInput, 'starts_at' | 'ends_at' | 'all_day'>,
  excludeId?: string,
) {
  const end =
    input.ends_at || localDateTimePlusMinutes(input.starts_at, input.all_day ? 24 * 60 : 30);
  const values: unknown[] = [accountId(), end];
  let exclude = '';
  if (excludeId) {
    values.push(excludeId);
    exclude = ` AND id <> $${values.length}`;
  }
  const candidates = await query<ScheduleEvent>(
    `SELECT * FROM schedule_event
     WHERE account_id=$1 AND is_deleted=0${exclude}
       AND starts_at < $2
     ORDER BY starts_at ASC`,
    values,
  );
  return candidates.filter(
    (event) =>
      (event.ends_at || localDateTimePlusMinutes(event.starts_at, event.all_day ? 24 * 60 : 30)) >
      input.starts_at,
  );
}

/**
 * 软删除一个真实日程记录。
 *
 * 重复日程在界面中会展开为“虚拟实例”，调用方需传入其
 * recurrence_source_id；这里额外返回结果，避免界面把未命中的删除误报为成功。
 */
export async function deleteScheduleEvent(id: string): Promise<boolean> {
  await exec('UPDATE schedule_event SET is_deleted=1,updated_at=$1 WHERE id=$2 AND account_id=$3', [
    new Date().toISOString(),
    id,
    accountId(),
  ]);
  return !(await getScheduleEvent(id));
}

/** 删除重复日程的单个实例：记录日期例外，不影响系列中其他日程。 */
export async function deleteScheduleOccurrence(sourceId: string, occurrenceStart: string) {
  const event = await getScheduleEvent(sourceId);
  if (!event) throw new Error('日程不存在或已删除。');
  const excluded = parseExdates(event.repeat_exdates);
  excluded.add(occurrenceStart.slice(0, 10));
  await updateScheduleEvent(sourceId, { repeat_exdates: JSON.stringify([...excluded].sort()) });
}

/** 临时稍后提醒不会改变日程原本的重复提醒时间。 */
export async function snoozeScheduleReminder(id: string, minutes: number) {
  const safeMinutes = [5, 10, 30].includes(minutes) ? minutes : 5;
  const next = new Date();
  next.setMinutes(next.getMinutes() + safeMinutes, 0, 0);
  await exec(
    'UPDATE schedule_event SET snooze_until=$1,updated_at=$2 WHERE id=$3 AND account_id=$4 AND is_deleted=0',
    [localDateTime(next), new Date().toISOString(), id, accountId()],
  );
}

/** ICS 导入以事务提交，任意无效项不会留下半批日程。 */
export async function importScheduleEvents(items: ScheduleEventInput[]) {
  if (items.length > 2_000) throw new Error('一次最多导入 2,000 个日程。');
  return withTransaction(async () => {
    const created: ScheduleEvent[] = [];
    for (const item of items) created.push(await createScheduleEvent(item));
    return created;
  });
}

export async function advanceScheduleReminder(
  id: string,
  current: string,
  repeat: ScheduleEventRepeat,
) {
  const { nextReminderAt } = await import('./notification-dao');
  const next = nextReminderAt(current, repeat);
  await exec(
    'UPDATE schedule_event SET reminder_at=$1,reminder_repeat=$2,updated_at=$3 WHERE id=$4 AND account_id=$5 AND reminder_at=$6',
    [next, next ? repeat : 'none', new Date().toISOString(), id, accountId(), current],
  );
  return next;
}

export function isLocalDateTime(value: string | null | undefined) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function localDateTimePlusMinutes(value: string, minutes: number) {
  const next = new Date(value);
  next.setMinutes(next.getMinutes() + minutes);
  const local = new Date(next.getTime() - next.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localDateTime(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseExdates(value?: string | null) {
  try {
    return new Set(JSON.parse(value || '[]') as string[]);
  } catch {
    return new Set<string>();
  }
}
