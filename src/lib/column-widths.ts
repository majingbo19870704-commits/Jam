/**
 * 表格列宽持久化 —— 保存在 localStorage，按表 id 命名
 * key: pw:colw:<tableId> → { [colKey]: pixel }
 */
const KEY = 'pw:colw:';

export function loadWidths(tableId: string, fallback: Record<string, number>): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY + tableId);
    if (!raw) return { ...fallback };
    return { ...fallback, ...(JSON.parse(raw) as Record<string, number>) };
  } catch {
    return { ...fallback };
  }
}

export function saveWidths(tableId: string, widths: Record<string, number>): void {
  try {
    localStorage.setItem(KEY + tableId, JSON.stringify(widths));
  } catch { /* ignore */ }
}
