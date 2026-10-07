import type { Notification } from '@/db/notification-dao';
import { getSetting } from '@/db/english-dao';

const DAILY_REMINDER_ID = 771001;

/**
 * 判断本地时间是否处于静默时段。时段可跨午夜，例如 22:00 到 07:00；
 * 相同的起止时间视为未设置有效时段，避免意外静默一整天。
 */
export function isWithinQuietHours(now: Date, start: string, end: string) {
  const asMinutes = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
  };
  const from = asMinutes(start);
  const to = asMinutes(end);
  if (from === null || to === null || from === to) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return from < to ? current >= from && current < to : current >= from || current < to;
}

/**
 * 把刚写入通知中心的事项同步为 Windows 原生提醒。
 * 仅发送本次新建的记录，避免每 15 分钟轮询时重复打扰用户。
 */
export async function sendDesktopNotifications(items: Notification[]) {
  if (!items.length) return;
  try {
    // 未设置时默认开启；用户可在“日程设置 → 通知提醒”中关闭系统弹窗。
    if (await getSetting('app', 'notification.desktop.enabled') === '0') return;
    const [quietEnabled, quietStart, quietEnd] = await Promise.all([
      getSetting('app', 'notification.quiet.enabled'),
      getSetting('app', 'notification.quiet.start'),
      getSetting('app', 'notification.quiet.end'),
    ]);
    // 静默只抑制原生弹窗：所有提醒已经先写入通知中心，不会遗漏。
    if (quietEnabled === '1' && isWithinQuietHours(new Date(), quietStart ?? '22:00', quietEnd ?? '07:00')) return;
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
    const granted = await isPermissionGranted();
    const permission = granted ? 'granted' : await requestPermission();
    if (permission !== 'granted') return;
    for (const item of items.slice(0, 3)) {
      sendNotification({ title: item.title, body: item.body });
    }
    if (items.length > 3) sendNotification({ title: '个人工作站提醒', body: `另有 ${items.length - 3} 条新提醒，请查看通知中心。` });
  } catch {
    // 浏览器预览、系统权限拒绝或插件不可用时仍保留应用内通知中心。
  }
}

/** 保存系统级每日提醒，由通知插件以系统计划通知形式安排。 */
export async function syncDailyDesktopReminder(enabled: boolean, hour: number, minute: number) {
  try {
    const { cancel, isPermissionGranted, requestPermission, Schedule, sendNotification } = await import('@tauri-apps/plugin-notification');
    await cancel([DAILY_REMINDER_ID]);
    if (!enabled) return true;
    const granted = await isPermissionGranted();
    const permission = granted ? 'granted' : await requestPermission();
    if (permission !== 'granted') return false;
    sendNotification({
      id: DAILY_REMINDER_ID,
      title: '个人工作站每日提醒',
      body: '查看今天的待办、项目进度和英语复习。',
      schedule: Schedule.interval({ hour: Math.max(0, Math.min(23, hour)), minute: Math.max(0, Math.min(59, minute)) }),
    });
    return true;
  } catch {
    return false;
  }
}
