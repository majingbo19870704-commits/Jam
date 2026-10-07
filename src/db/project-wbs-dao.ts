// =============================================================================
// db/project-wbs-dao.ts · 项目进度 WBS 任务（支持任意层级）
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';
import type { ProjectWbs } from '@/types';

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export async function listWbs(projectId: string): Promise<ProjectWbs[]> {
  return query<ProjectWbs>(
    `SELECT * FROM project_wbs
     WHERE account_id = $1 AND project_id = $2 AND is_deleted = 0
     ORDER BY seq_no ASC, created_at ASC`,
    [accountId(), projectId],
  );
}

/** 按 ID 读取当前账号的一条未删除 WBS 任务。 */
export async function getWbs(id: string): Promise<ProjectWbs | null> {
  return queryOne<ProjectWbs>(
    `SELECT * FROM project_wbs WHERE id = $1 AND account_id = $2 AND is_deleted = 0`,
    [id, accountId()],
  );
}

/** 追加一个顶级任务（seq 最大值 + 1，parent_id = null） */
export async function createWbs(
  projectId: string,
  _insertAt: unknown = 'end',
): Promise<ProjectWbs> {
  const now = new Date().toISOString();
  const acc = accountId();
  const r = await queryOne<{ n: number }>(
    `SELECT MAX(seq_no) as n FROM project_wbs
     WHERE account_id = $1 AND project_id = $2 AND is_deleted = 0`,
    [acc, projectId],
  );
  const seq = (r?.n ?? 0) + 1;
  return doInsert(acc, projectId, null, 1, seq, now);
}

/**
 * 通用插入：
 *  - refId：参考行 id（可为 null 表示顶级）
 *  - mode='sibling-above' | 'sibling-below' | 'child-below'（子级只支持"下方"，落在父的最后一个子之后）
 *  - refId=null 时只允许 'sibling-below'，等价于末尾追加顶级任务
 */
export async function insertWbs(opts: {
  projectId: string;
  refId: string | null;
  mode: 'sibling-above' | 'sibling-below' | 'child-below';
}): Promise<ProjectWbs> {
  const acc = accountId();
  const now = new Date().toISOString();
  const { projectId, refId, mode } = opts;

  if (!refId) {
    return createWbs(projectId);
  }

  const ref = await queryOne<ProjectWbs>(`SELECT * FROM project_wbs WHERE id = $1`, [refId]);
  if (!ref) throw new Error('参考行不存在');

  let parentId: string | null;
  let level: number;
  let insertSeq: number;

  if (mode === 'child-below') {
    parentId = ref.id;
    level = (ref.level ?? 1) + 1;
    // 找到参考行的子树最后一行的 seq_no
    const lastDesc = await lastDescendantSeq(ref.id);
    insertSeq = (lastDesc ?? ref.seq_no) + 1;
  } else {
    parentId = ref.parent_id ?? null;
    level = ref.level ?? 1;
    if (mode === 'sibling-above') {
      insertSeq = ref.seq_no;
    } else {
      // sibling-below：新任务插在参考行子树之后
      const lastDesc = await lastDescendantSeq(ref.id);
      insertSeq = (lastDesc ?? ref.seq_no) + 1;
    }
  }

  // 所有 seq >= insertSeq 的行 seq_no + 1
  await exec(
    `UPDATE project_wbs SET seq_no = seq_no + 1
     WHERE account_id = $1 AND project_id = $2 AND is_deleted = 0 AND seq_no >= $3`,
    [acc, projectId, insertSeq],
  );

  return doInsert(acc, projectId, parentId, level, insertSeq, now);
}

async function doInsert(
  acc: string,
  projectId: string,
  parentId: string | null,
  level: number,
  seq: number,
  now: string,
): Promise<ProjectWbs> {
  const row: ProjectWbs = {
    id: uuid(),
    account_id: acc,
    project_id: projectId,
    parent_id: parentId,
    seq_no: seq,
    level,
    type: null,
    item: '',
    progress_note: null,
    depends_on: '[]',
    assignee_member_ids: '[]',
    status: 'following',
    planned_start: null,
    planned_end: null,
    actual_start: null,
    actual_end: null,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO project_wbs
     (id, account_id, project_id, parent_id, seq_no, level, type, item, progress_note, depends_on, assignee_member_ids,
      status, planned_start, planned_end, actual_start, actual_end, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,0)`,
    [
      row.id,
      row.account_id,
      row.project_id,
      row.parent_id,
      row.seq_no,
      row.level,
      row.type,
      row.item,
      row.progress_note,
      row.depends_on,
      row.assignee_member_ids,
      row.status,
      row.planned_start,
      row.planned_end,
      row.actual_start,
      row.actual_end,
      now,
    ],
  );
  return row;
}

/** 找到某任务子树中最大的 seq_no */
async function lastDescendantSeq(rootId: string): Promise<number | null> {
  // 递归 CTE
  const rows = await query<{ max_seq: number | null }>(
    `WITH RECURSIVE tree(id, seq) AS (
       SELECT id, seq_no FROM project_wbs WHERE id = $1 AND is_deleted = 0
       UNION ALL
       SELECT w.id, w.seq_no FROM project_wbs w
       INNER JOIN tree t ON w.parent_id = t.id
       WHERE w.is_deleted = 0
     )
     SELECT MAX(seq) as max_seq FROM tree`,
    [rootId],
  );
  return rows[0]?.max_seq ?? null;
}

export async function updateWbs(id: string, patch: Partial<ProjectWbs>): Promise<void> {
  const allowed = [
    'type',
    'item',
    'progress_note',
    'depends_on',
    'assignee_member_ids',
    'status',
    'planned_start',
    'planned_end',
    'actual_start',
    'actual_end',
  ] as const;
  const now = new Date().toISOString();
  const setFrag: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const k of allowed) {
    if (k in patch) {
      setFrag.push(`${k} = $${i++}`);
      values.push((patch as any)[k] ?? null);
    }
  }
  setFrag.push(`updated_at = $${i++}`);
  values.push(now);
  values.push(id, accountId());
  await exec(
    `UPDATE project_wbs SET ${setFrag.join(', ')} WHERE id = $${i} AND account_id = $${i + 1} AND is_deleted = 0`,
    values,
  );
}

/** 递归软删除某任务及其所有后代 */
export async function softDeleteWbs(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  // 展开所有后代
  const allIds = new Set<string>();
  for (const id of ids) {
    const rows = await query<{ id: string }>(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM project_wbs WHERE id = $1 AND is_deleted = 0
         UNION ALL
         SELECT w.id FROM project_wbs w INNER JOIN tree t ON w.parent_id = t.id WHERE w.is_deleted = 0
       )
       SELECT id FROM tree`,
      [id],
    );
    rows.forEach((r) => allIds.add(r.id));
  }
  const arr = Array.from(allIds);
  const p = arr.map((_, i) => `$${i + 2}`).join(',');
  await exec(`UPDATE project_wbs SET is_deleted = 1, updated_at = $1 WHERE id IN (${p})`, [
    now,
    ...arr,
  ]);
}

/**
 * 计算层级序号：DFS 树，输出 "1"、"1-1"、"1-1-1" 这样的字符串
 * items 需按 seq_no 升序传入
 */
export function computeHierarchicalSeq(items: ProjectWbs[]): Map<string, string> {
  const byParent = new Map<string | null, ProjectWbs[]>();
  items.forEach((w) => {
    const key = w.parent_id ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(w);
    byParent.set(key, arr);
  });
  // 每一层按 seq_no 排序
  byParent.forEach((arr) => arr.sort((a, b) => a.seq_no - b.seq_no));

  const out = new Map<string, string>();
  function walk(parentId: string | null, prefix: string) {
    const children = byParent.get(parentId) ?? [];
    children.forEach((c, i) => {
      const label = prefix ? `${prefix}-${i + 1}` : String(i + 1);
      out.set(c.id, label);
      walk(c.id, label);
    });
  }
  walk(null, '');
  return out;
}

/** DFS 顺序：所有子任务紧跟父任务之后 */
export function flatOrderedByHierarchy(items: ProjectWbs[]): ProjectWbs[] {
  const byParent = new Map<string | null, ProjectWbs[]>();
  items.forEach((w) => {
    const key = w.parent_id ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(w);
    byParent.set(key, arr);
  });
  byParent.forEach((arr) => arr.sort((a, b) => a.seq_no - b.seq_no));

  const out: ProjectWbs[] = [];
  function walk(parentId: string | null) {
    const children = byParent.get(parentId) ?? [];
    for (const c of children) {
      out.push(c);
      walk(c.id);
    }
  }
  walk(null);
  return out;
}

/** 容错解析存储的前置任务 ID 列表；旧数据或损坏值视为空依赖。 */
export function dependencyIds(item: ProjectWbs): string[] {
  try {
    const parsed: unknown = JSON.parse(item.depends_on || '[]');
    return Array.isArray(parsed) ? Array.from(new Set(parsed.filter((value): value is string => typeof value === 'string'))) : [];
  } catch { return []; }
}

/** 容错解析负责人 ID 列表；损坏或旧数据视为空分配。 */
export function assigneeMemberIds(item: ProjectWbs): string[] {
  try {
    const parsed: unknown = JSON.parse(item.assignee_member_ids || '[]');
    return Array.isArray(parsed) ? Array.from(new Set(parsed.filter((value): value is string => typeof value === 'string'))) : [];
  } catch { return []; }
}

/** 修改 target 的依赖后是否会形成有向环。 */
export function createsDependencyCycle(items: ProjectWbs[], targetId: string, nextDependencies: string[]): boolean {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visiting = new Set<string>();
  function reachesTarget(id: string): boolean {
    if (id === targetId) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    const item = byId.get(id);
    const dependencies = id === targetId ? nextDependencies : item ? dependencyIds(item) : [];
    const result = dependencies.some(reachesTarget);
    visiting.delete(id);
    return result;
  }
  return nextDependencies.some(reachesTarget);
}

export type CriticalPathResult = { criticalIds: Set<string>; totalDays: number; hasCycle: boolean };

/**
 * 依据任务前置关系和计划工期计算 CPM 关键路径。
 * 没有完整起止日期的任务按 1 天处理，使新增任务也能参与依赖校验；实际日期不干预计划排期。
 */
export function computeCriticalPath(items: ProjectWbs[]): CriticalPathResult {
  const byId = new Map(items.map((item) => [item.id, item]));
  const dependencies = new Map(items.map((item) => [item.id, dependencyIds(item).filter((id) => byId.has(id))]));
  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let hasCycle = false;
  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) { hasCycle = true; return; }
    visiting.add(id);
    (dependencies.get(id) ?? []).forEach(visit);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }
  items.forEach((item) => visit(item.id));
  if (hasCycle) return { criticalIds: new Set(), totalDays: 0, hasCycle: true };

  const duration = new Map(items.map((item) => [item.id, plannedDurationDays(item)]));
  const earliestFinish = new Map<string, number>();
  order.forEach((id) => {
    const depFinish = Math.max(-1, ...(dependencies.get(id) ?? []).map((dep) => earliestFinish.get(dep) ?? -1));
    earliestFinish.set(id, depFinish + (duration.get(id) ?? 1));
  });
  const projectFinish = items.length ? Math.max(...Array.from(earliestFinish.values())) : -1;
  const totalDays = projectFinish + 1;
  const successors = new Map<string, string[]>();
  dependencies.forEach((deps, task) => deps.forEach((dep) => successors.set(dep, [...(successors.get(dep) ?? []), task])));
  const latestFinish = new Map<string, number>();
  [...order].reverse().forEach((id) => {
    const next = successors.get(id) ?? [];
    latestFinish.set(id, next.length
      ? Math.min(...next.map((successor) => (latestFinish.get(successor) ?? projectFinish) - (duration.get(successor) ?? 1)))
      : projectFinish);
  });
  const criticalIds = new Set<string>();
  order.forEach((id) => {
    const earlyStart = (earliestFinish.get(id) ?? 1) - (duration.get(id) ?? 1);
    const lateStart = (latestFinish.get(id) ?? projectFinish) - (duration.get(id) ?? 1);
    if (earlyStart === lateStart) criticalIds.add(id);
  });
  return { criticalIds, totalDays, hasCycle: false };
}

function plannedDurationDays(item: ProjectWbs): number {
  if (!item.planned_start || !item.planned_end) return 1;
  const start = Date.parse(`${item.planned_start}T00:00:00`);
  const end = Date.parse(`${item.planned_end}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.floor((end - start) / 86_400_000) + 1;
}
