import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

export type ReportColumn<T> = {
  title: string;
  value: (row: T) => string | number | null | undefined;
  width?: number;
};

export type ImportRow = { rowNo: number; values: Record<string, string> };

const EXCEL_FILTERS = [{ name: 'Excel 文件', extensions: ['xlsx', 'xls', 'csv'] }];

/** 导出当前报表数据；标题行与导入模板严格一致。 */
export async function exportReport<T>(opts: {
  title: string;
  fileStem: string;
  columns: ReportColumn<T>[];
  rows: T[];
}) {
  const path = await saveDialog({
    title: `导出${opts.title}`,
    defaultPath: `${opts.fileStem}_${dateStamp()}.xlsx`,
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
  });
  if (!path) return false;

  const XLSX = await import('xlsx');
  const cells = [
    opts.columns.map((column) => column.title),
    ...opts.rows.map((row) => opts.columns.map((column) => sanitizeExportCell(column.value(row)))),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(cells);
  sheet['!cols'] = opts.columns.map((column) => ({ wch: column.width ?? 16 }));
  sheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { c: 0, r: 0 },
      e: { c: opts.columns.length - 1, r: Math.max(0, cells.length - 1) },
    }),
  };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(opts.title));
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  await invoke('write_generated_xlsx_file', { path, data: Array.from(new Uint8Array(data)) });
  return true;
}

/** 选择并读取首个工作表。空行会忽略，单元格统一转为可校验的文本。 */
export async function readImportRows() {
  const selected = await openDialog({
    title: '选择导入文件',
    multiple: false,
    filters: EXCEL_FILTERS,
  });
  if (!selected) return null;
  const path = selected;
  const bytes = await readFile(path);
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
  const firstName = workbook.SheetNames[0];
  if (!firstName) throw new Error('文件中没有工作表。');
  const raw = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstName], {
    header: 1,
    defval: '',
    raw: false,
  });
  return normalizeImportRows(raw);
}

/**
 * 把 Excel 的二维表转为报表行，且在写入任何业务数据前拒绝歧义结构。
 * 所有模块共享这层校验：重复标题会导致 Object.fromEntries 覆盖值，必须显式失败。
 */
export function normalizeImportRows(raw: unknown[][]): ImportRow[] {
  const [headerRow, ...dataRows] = raw;
  const headers = (headerRow ?? []).map((item) => String(item ?? '').trim());
  const namedHeaders = headers.filter(Boolean);
  if (!namedHeaders.length) throw new Error('首行必须是报表字段标题。');
  const duplicates = namedHeaders.filter((name, index) => namedHeaders.indexOf(name) !== index);
  if (duplicates.length) throw new Error(`首行含重复字段标题：${Array.from(new Set(duplicates)).join('、')}`);
  if (dataRows.length > 10_000) throw new Error('单次最多导入 10,000 行，请拆分文件后重试。');
  return dataRows
    .map((cells, offset) => ({
      rowNo: offset + 2,
      values: Object.fromEntries(
        headers
          .map((header, index) => [header, String(cells[index] ?? '').trim()] as const)
          .filter(([header]) => Boolean(header)),
      ),
    }))
    .filter((row) => Object.values(row.values).some(Boolean));
}

export function cell(row: Record<string, string>, title: string) {
  return row[title]?.trim() ?? '';
}

export function optionalDate(value: string) {
  if (!value.trim()) return null;
  const normalized = value.trim().replaceAll('/', '-').replaceAll('.', '-');
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function optionId(value: string, options: { id: string; name: string }[]) {
  if (!value.trim()) return null;
  return options.find((option) => option.id === value || option.name === value)?.id ?? undefined;
}

export function formatImportSummary(imported: number, errors: string[]) {
  const parts = [`已导入 ${imported} 条记录。`];
  if (errors.length)
    parts.push(
      `跳过 ${errors.length} 条：\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? '\n…其余错误未展开' : ''}`,
    );
  return parts.join('\n\n');
}

function dateStamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function safeSheetName(name: string) {
  return (
    name
      .replace(/[\\/:*?]/g, '_')
      .replaceAll('[', '_')
      .replaceAll(']', '_')
      .slice(0, 31) || '报表'
  );
}

/** 防止导出的用户文本被 Excel 当作公式执行。 */
export function sanitizeExportCell(value: string | number | null | undefined): string | number {
  if (typeof value !== 'string') return value ?? '';
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
