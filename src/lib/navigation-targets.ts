/**
 * 集中构造跨模块搜索结果的落点，避免搜索结果只打开模块首页而丢失上下文。
 */
export function workSearchTarget(id: string) {
  return `/work?focus=${encodeURIComponent(id)}`;
}

export function knowledgeSearchTarget(path: string) {
  return `/knowledge?path=${encodeURIComponent(path)}`;
}

export function projectFileSearchTarget(projectId: string, fileId: string) {
  return `/project/${encodeURIComponent(projectId)}?tab=file&file=${encodeURIComponent(fileId)}`;
}

export function projectPanelSearchTarget(projectId: string, tab: 'progress' | 'risk' | 'member', itemId: string) {
  return `/project/${encodeURIComponent(projectId)}?tab=${tab}&focus=${encodeURIComponent(itemId)}`;
}

/** ISO-8601 周数：星期一为每周第一天，第一周包含当年的第一个星期四。 */
export function isoWeekNumber(value: Date) {
  const date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}
