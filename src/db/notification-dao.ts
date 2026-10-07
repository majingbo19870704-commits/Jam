import { v4 as uuid } from 'uuid';
import { exec, query } from './client';
import { useAccountStore } from '@/stores/account';

export type Notification = {
  id: string;
  account_id: string;
  kind: 'overdue' | 'due' | 'reminder' | 'schedule' | 'review' | 'backup';
  title: string;
  body: string;
  link: string | null;
  is_read: number;
  created_at: string;
  read_at: string | null;
};
const accountId = () => {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('请先登录。');
  return id;
};
const today = () => new Date().toLocaleDateString('sv-SE');
const localMinute = () => {
  const date = new Date();
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
};

type ReminderRepeat = 'none' | 'daily' | 'weekly' | 'monthly';

/** 依据本地墙钟时间推进提醒，避免 UTC 转换导致用户设置的时分发生偏移。 */
export function nextReminderAt(value: string, repeat: ReminderRepeat): string | null {
  if (repeat === 'none') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (repeat === 'daily') date.setDate(date.getDate() + 1);
  if (repeat === 'weekly') date.setDate(date.getDate() + 7);
  if (repeat === 'monthly') {
    // 31 日这类日期在短月落到当月最后一天，而不是被 JS 自动滚到下个月。
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
  }
  const part = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

async function insert(
  input: Omit<Notification, 'id' | 'account_id' | 'is_read' | 'created_at' | 'read_at'>,
  key: string,
): Promise<Notification | null> {
  const created: Notification = {
    ...input,
    id: uuid(),
    account_id: accountId(),
    is_read: 0,
    created_at: new Date().toISOString(),
    read_at: null,
  };
  const result = await exec(
    `INSERT OR IGNORE INTO notification(id,account_id,kind,title,body,link,dedupe_key,is_read,created_at,read_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,0,$8,NULL)`,
    [
      created.id,
      created.account_id,
      input.kind,
      input.title,
      input.body,
      input.link,
      key,
      created.created_at,
    ],
  );
  return result.rowsAffected > 0 ? created : null;
}

/** 写入一条不依赖业务扫描的系统通知，并以 key 防止重复。 */
export async function addSystemNotification(
  input: Omit<Notification, 'id' | 'account_id' | 'is_read' | 'created_at' | 'read_at'>,
  key: string,
) {
  return insert(input, key);
}

/** 将业务状态投影为本地通知；同一事项每天最多生成一条。 */
export async function refreshNotifications(): Promise<Notification[]> {
  const account = accountId();
  const date = today();
  const minute = localMinute();
  const [overdue, due, reminders, scheduleReminders, reviews] = await Promise.all([
    query<{ id: string; description: string; planned_at: string }>(
      `SELECT id,description,planned_at FROM work_item WHERE account_id=$1 AND is_deleted=0 AND status<>'closed' AND planned_at < $2`,
      [account, date],
    ),
    query<{ id: string; description: string }>(
      `SELECT id,description FROM work_item WHERE account_id=$1 AND is_deleted=0 AND status<>'closed' AND planned_at = $2`,
      [account, date],
    ),
    query<{
      id: string;
      description: string;
      reminder_at: string;
      reminder_repeat: ReminderRepeat;
    }>(
      `SELECT id,description,reminder_at,COALESCE(reminder_repeat,'none') AS reminder_repeat FROM work_item WHERE account_id=$1 AND is_deleted=0 AND status<>'closed' AND reminder_at IS NOT NULL AND reminder_at <= $2`,
      [account, minute],
    ),
    query<{
      id: string;
      title: string;
      reminder_at: string;
      snooze_until: string | null;
      reminder_repeat: ReminderRepeat;
    }>(
      `SELECT id,title,reminder_at,snooze_until,COALESCE(reminder_repeat,'none') AS reminder_repeat FROM schedule_event WHERE account_id=$1 AND is_deleted=0 AND (snooze_until IS NOT NULL AND snooze_until <= $2 OR snooze_until IS NULL AND reminder_at IS NOT NULL AND reminder_at <= $2)`,
      [account, minute],
    ),
    query<{ n: number }>(
      `SELECT COUNT(*) n FROM word_card WHERE account_id=$1 AND is_deleted=0 AND status IN ('new','learning') AND (status='new' OR next_review_at IS NULL OR next_review_at <= $2)`,
      [account, date],
    ),
  ]);
  const reminderCreated = await Promise.all(
    reminders.map(async (item) => {
      const notification = await insert(
        {
          kind: 'reminder',
          title: '工作事项提醒',
          body: item.description || '未命名工作事项',
          link: `/work?focus=${encodeURIComponent(item.id)}`,
        },
        `reminder:${item.id}:${item.reminder_at}`,
      );
      // 即使上一次通知已写入、但应用在推进前退出，也会在下次扫描时恢复正确的重复计划。
      const next = nextReminderAt(item.reminder_at, item.reminder_repeat);
      await exec(
        'UPDATE work_item SET reminder_at=$1, reminder_repeat=$2, updated_at=$3 WHERE id=$4 AND account_id=$5 AND reminder_at=$6',
        [
          next,
          next ? item.reminder_repeat : 'none',
          new Date().toISOString(),
          item.id,
          account,
          item.reminder_at,
        ],
      );
      return notification;
    }),
  );
  const scheduleCreated = await Promise.all(
    scheduleReminders.map(async (item) => {
      const notification = await insert(
        {
          kind: 'schedule',
          title: '日程提醒',
          body: item.title || '未命名日程',
          link: `/schedule?focus=${encodeURIComponent(item.id)}`,
        },
        item.snooze_until
          ? `schedule-snooze:${item.id}:${item.snooze_until}`
          : `schedule:${item.id}:${item.reminder_at}`,
      );
      if (item.snooze_until) {
        await exec(
          'UPDATE schedule_event SET snooze_until=NULL,updated_at=$1 WHERE id=$2 AND account_id=$3 AND snooze_until=$4',
          [new Date().toISOString(), item.id, account, item.snooze_until],
        );
        return notification;
      }
      const next = nextReminderAt(item.reminder_at, item.reminder_repeat);
      await exec(
        'UPDATE schedule_event SET reminder_at=$1, reminder_repeat=$2, updated_at=$3 WHERE id=$4 AND account_id=$5 AND reminder_at=$6',
        [
          next,
          next ? item.reminder_repeat : 'none',
          new Date().toISOString(),
          item.id,
          account,
          item.reminder_at,
        ],
      );
      return notification;
    }),
  );
  const created = await Promise.all([
    ...overdue.map((item) =>
      insert(
        {
          kind: 'overdue',
          title: '工作事项已逾期',
          body: item.description || '未命名工作事项',
          link: '/work',
        },
        `overdue:${item.id}:${date}`,
      ),
    ),
    ...due.map((item) =>
      insert(
        {
          kind: 'due',
          title: '今日到期工作事项',
          body: item.description || '未命名工作事项',
          link: '/work',
        },
        `due:${item.id}:${date}`,
      ),
    ),
    ...reminderCreated,
    ...scheduleCreated,
    (reviews[0]?.n ?? 0) > 0
      ? insert(
          {
            kind: 'review',
            title: '英语复习提醒',
            body: `今天有 ${reviews[0].n} 个词条待复习。`,
            link: '/english/practice/srs',
          },
          `review:${date}`,
        )
      : Promise.resolve(null),
  ]);
  return created.filter((item): item is Notification => item !== null);
}
export async function listNotifications(limit = 100) {
  return query<Notification>(
    `SELECT id,account_id,kind,title,body,link,is_read,created_at,read_at FROM notification WHERE account_id=$1 ORDER BY is_read ASC,created_at DESC LIMIT $2`,
    [accountId(), limit],
  );
}
export async function unreadNotificationCount() {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*) n FROM notification WHERE account_id=$1 AND is_read=0`,
    [accountId()],
  );
  return rows[0]?.n ?? 0;
}
export async function markNotificationsRead(ids?: string[]) {
  const account = accountId();
  const now = new Date().toISOString();
  if (!ids?.length)
    return exec(`UPDATE notification SET is_read=1,read_at=$1 WHERE account_id=$2 AND is_read=0`, [
      now,
      account,
    ]);
  const placeholders = ids.map((_, index) => `$${index + 3}`).join(',');
  return exec(
    `UPDATE notification SET is_read=1,read_at=$1 WHERE account_id=$2 AND id IN (${placeholders})`,
    [now, account, ...ids],
  );
}

/** 清理当前账号已经阅读的通知；未读提醒始终保留。 */
export async function deleteReadNotifications() {
  return exec('DELETE FROM notification WHERE account_id=$1 AND is_read=1', [accountId()]);
}
