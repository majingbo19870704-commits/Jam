import { describe, expect, it } from 'vitest';
import { assigneeMemberIds, computeCriticalPath, createsDependencyCycle } from './project-wbs-dao';
import type { ProjectWbs } from '@/types';

function task(id: string, start: string, end: string, dependsOn = '[]'): ProjectWbs {
  return { id, account_id: 'a', project_id: 'p', parent_id: null, seq_no: 1, level: 1, type: null, item: id, progress_note: null, depends_on: dependsOn, status: 'following', planned_start: start, planned_end: end, actual_start: null, actual_end: null, created_at: '', updated_at: '', is_deleted: 0 };
}

describe('WBS dependencies', () => {
  it('finds the longest dependent path', () => {
    const items = [task('a', '2026-01-01', '2026-01-02'), task('b', '2026-01-03', '2026-01-05', '["a"]'), task('c', '2026-01-01', '2026-01-01')];
    const result = computeCriticalPath(items);
    expect(result.hasCycle).toBe(false);
    expect(result.totalDays).toBe(5);
    expect(result.criticalIds).toEqual(new Set(['a', 'b']));
  });

  it('rejects an edit that makes a dependency cycle', () => {
    const items = [task('a', '2026-01-01', '2026-01-01'), task('b', '2026-01-02', '2026-01-02', '["a"]')];
    expect(createsDependencyCycle(items, 'a', ['b'])).toBe(true);
    expect(createsDependencyCycle(items, 'b', [])).toBe(false);
  });

  it('parses valid unique member assignments and tolerates legacy values', () => {
    const assigned = { ...task('a', '2026-01-01', '2026-01-01'), assignee_member_ids: '["m1","m1","m2"]' };
    expect(assigneeMemberIds(assigned)).toEqual(['m1', 'm2']);
    expect(assigneeMemberIds({ ...assigned, assignee_member_ids: 'invalid-json' })).toEqual([]);
  });
});
