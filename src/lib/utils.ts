import { type ClassValue, clsx } from 'clsx';

/** classnames 拼接 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** 格式化 ISO 日期为 YYYY-MM-DD */
export function fmtDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 使用 Chromium/Intl 内置的中国农历日历，避免以公历月日近似农历。 */
export function approxLunar(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      month: 'long', day: 'numeric',
    }).formatToParts(date);
    const month = parts.find((part) => part.type === 'month')?.value ?? '';
    const day = parts.find((part) => part.type === 'day')?.value ?? '';
    return month && day ? `农历${month}${day}` : '农历—';
  } catch {
    return '农历—';
  }
}

/** 中文星期 */
export function weekdayCn(date: Date): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
}
