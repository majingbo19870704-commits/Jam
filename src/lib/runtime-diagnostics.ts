export type RuntimeDiagnostic = {
  at: string;
  source: 'window-error' | 'unhandled-rejection' | 'route-error';
  message: string;
};

export type HealthSnapshot = {
  platform: string;
  data_directory: string;
  database_status: string;
  database_size_bytes: number;
  backup_count: number;
  backup_size_bytes: number;
};

const STORAGE_KEY = 'workstation.runtime-diagnostics.v1';
const MAX_RECORDS = 50;

function messageOf(value: unknown) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function listRuntimeDiagnostics(): RuntimeDiagnostic[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(isDiagnostic).slice(-MAX_RECORDS).reverse() : [];
  } catch { return []; }
}

function isDiagnostic(value: unknown): value is RuntimeDiagnostic {
  return !!value && typeof value === 'object' && 'at' in value && 'source' in value && 'message' in value;
}

export function recordRuntimeDiagnostic(source: RuntimeDiagnostic['source'], reason: unknown) {
  const message = messageOf(reason).trim().slice(0, 2_000);
  if (!message) return;
  const previous = listRuntimeDiagnostics().reverse();
  const last = previous.at(-1);
  // React 开发模式可能让同一错误重复上报；保留一次即可。
  if (last?.source === source && last.message === message) return;
  const next = [...previous, { at: new Date().toISOString(), source, message }].slice(-MAX_RECORDS);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* 存储不可用不影响应用 */ }
}

export function clearRuntimeDiagnostics() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* no-op */ }
}

/** 在应用启动时记录未处理异常；记录始终只保存在当前设备。 */
export function installRuntimeDiagnostics() {
  window.addEventListener('error', (event) => recordRuntimeDiagnostic('window-error', event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => recordRuntimeDiagnostic('unhandled-rejection', event.reason));
}

export function buildDiagnosticReport(data: HealthSnapshot, events: RuntimeDiagnostic[]) {
  const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
  const header = [
    '个人工作站诊断报告',
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    `平台：${data.platform}`,
    `数据库：${data.database_status}`,
    `数据库大小：${bytes(data.database_size_bytes)}`,
    `备份：${data.backup_count} 份，共 ${bytes(data.backup_size_bytes)}`,
    `数据目录：${data.data_directory}`,
    '',
    `运行异常记录：${events.length} 条（仅本机保留，不包含业务数据或密钥）`,
  ];
  const body = events.length
    ? events.map((item, index) => `${index + 1}. [${item.at}] ${item.source}\n${item.message}`).join('\n\n')
    : '无记录。';
  return [...header, body, ''].join('\n');
}
