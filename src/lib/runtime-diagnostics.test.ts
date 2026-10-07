import { describe, expect, it } from 'vitest';
import { buildDiagnosticReport } from './runtime-diagnostics';

describe('buildDiagnosticReport', () => {
  it('includes health facts and only the supplied runtime diagnostics', () => {
    const report = buildDiagnosticReport({ platform: 'windows', data_directory: 'C:\\data', database_status: '数据库完整性正常', database_size_bytes: 1_024, backup_count: 2, backup_size_bytes: 2_048 }, [{ at: '2026-09-30T10:00:00.000Z', source: 'route-error', message: 'route failed' }]);
    expect(report).toContain('数据库大小：1.0 KB');
    expect(report).toContain('运行异常记录：1 条');
    expect(report).toContain('route failed');
  });
});
