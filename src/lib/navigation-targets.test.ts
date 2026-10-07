import { describe, expect, it } from 'vitest';
import { isoWeekNumber, knowledgeSearchTarget, projectFileSearchTarget, projectPanelSearchTarget, workSearchTarget } from './navigation-targets';

describe('search navigation targets', () => {
  it('keeps a work item id in the route', () => {
    expect(workSearchTarget('work/1')).toBe('/work?focus=work%2F1');
  });

  it('encodes a knowledge file path safely', () => {
    expect(knowledgeSearchTarget('计划/本周 #1.md')).toBe('/knowledge?path=%E8%AE%A1%E5%88%92%2F%E6%9C%AC%E5%91%A8%20%231.md');
  });

  it('opens a project at the matched file', () => {
    expect(projectFileSearchTarget('project/1', 'file #2')).toBe('/project/project%2F1?tab=file&file=file%20%232');
  });

  it('opens the matched project panel item', () => {
    expect(projectPanelSearchTarget('project-1', 'risk', 'risk/1')).toBe('/project/project-1?tab=risk&focus=risk%2F1');
  });
});

describe('ISO week calculation', () => {
  it('handles a year boundary correctly', () => {
    expect(isoWeekNumber(new Date(2021, 0, 1))).toBe(53);
    expect(isoWeekNumber(new Date(2021, 0, 4))).toBe(1);
  });
});
