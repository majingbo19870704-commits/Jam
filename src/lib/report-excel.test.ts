import { describe, expect, it } from 'vitest';
import { normalizeImportRows, sanitizeExportCell } from './report-excel';

describe('normalizeImportRows', () => {
  it('保留字段与原始工作表行号，并忽略空行', () => {
    expect(normalizeImportRows([
      ['日期', '事项', ''],
      ['2026-09-29', '整理报告', 'ignored'],
      ['', '', ''],
    ])).toEqual([{ rowNo: 2, values: { 日期: '2026-09-29', 事项: '整理报告' } }]);
  });

  it('拒绝会覆盖数据的重复列标题', () => {
    expect(() => normalizeImportRows([['事项', '事项'], ['A', 'B']]))
      .toThrow('重复字段标题：事项');
  });

  it('限制单次导入规模', () => {
    const rows = Array.from({ length: 10_001 }, () => ['事项']);
    expect(() => normalizeImportRows([['事项'], ...rows])).toThrow('最多导入 10,000 行');
  });

  it('将危险的公式前缀作为普通文本导出', () => {
    expect(sanitizeExportCell('=HYPERLINK("https://unsafe.example")')).toBe("'=HYPERLINK(\"https://unsafe.example\")");
    expect(sanitizeExportCell('普通事项')).toBe('普通事项');
    expect(sanitizeExportCell(42)).toBe(42);
  });
});
