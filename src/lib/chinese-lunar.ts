/**
 * 利用 Chromium/ICU 内置的 Chinese calendar 获取农历。
 * 不维护易过期的农历对照表，也不请求网络；Tauri 的 WebView2 在 Windows
 * 已包含此日历实现。若运行环境意外缺失，则返回 null，让界面只显示公历。
 */
export type LunarDate = {
  shortLabel: string;
  fullLabel: string;
};

const DAY_NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function lunarDayName(day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 30) return '';
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  const prefix = day < 10 ? '初' : day < 20 ? '十' : '廿';
  return `${prefix}${DAY_NUMBERS[(day - 1) % 10]}`;
}

export function chineseLunarDate(date: Date): LunarDate | null {
  try {
    const formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const parts = formatter.formatToParts(date);
    // TypeScript 的 Intl 定义尚未包含 Chinese calendar 专用的 yearName，
    // 因此这里接受字符串，同时仍从 formatToParts 的实际结果中读取。
    const part = (type: string) =>
      parts.find((item) => item.type === type)?.value ?? '';
    const month = part('month');
    const day = Number(part('day'));
    const dayLabel = lunarDayName(day);
    if (!month || !dayLabel) return null;
    const stemBranchYear = part('yearName');
    return {
      shortLabel: `${month}${dayLabel}`,
      fullLabel: `${stemBranchYear ? `${stemBranchYear}年` : '农历'}${month}${dayLabel}`,
    };
  } catch {
    return null;
  }
}
