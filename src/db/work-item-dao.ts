// =============================================================================
// db/work-item-dao.ts · 工作事项 DAO
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';
import type { WorkItem, Priority, ReminderRepeat, StatusFull } from '@/types';

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export interface WorkItemFilter {
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
  typeIds?: string[];
  statuses?: StatusFull[];
  keyword?: string; // 全表模糊
}

/** 列表查询（当前账号） */
export async function listWorkItems(filter: WorkItemFilter = {}): Promise<WorkItem[]> {
  const wheres: string[] = ['account_id = $1', 'is_deleted = 0'];
  const params: unknown[] = [accountId()];
  let idx = 2;

  if (filter.dateFrom) {
    wheres.push(`date >= $${idx++}`);
    params.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    wheres.push(`date <= $${idx++}`);
    params.push(filter.dateTo);
  }
  if (filter.typeIds?.length) {
    const placeholders = filter.typeIds.map(() => `$${idx++}`).join(',');
    wheres.push(`type_id IN (${placeholders})`);
    params.push(...filter.typeIds);
  }
  if (filter.statuses?.length) {
    const placeholders = filter.statuses.map(() => `$${idx++}`).join(',');
    wheres.push(`status IN (${placeholders})`);
    params.push(...filter.statuses);
  }
  if (filter.keyword?.trim()) {
    const kw = `%${filter.keyword.trim()}%`;
    wheres.push(
      `(description LIKE $${idx} OR progress_note LIKE $${idx} OR internal_pic LIKE $${idx} OR external_pic LIKE $${idx} OR remark LIKE $${idx})`,
    );
    params.push(kw);
    idx++;
  }

  return query<WorkItem>(
    `SELECT * FROM work_item WHERE ${wheres.join(' AND ')} ORDER BY date ASC, seq_no ASC`,
    params,
  );
}

/** 按 ID 读取当前账号的一条未删除工作事项。 */
export async function getWorkItem(id: string): Promise<WorkItem | null> {
  return queryOne<WorkItem>(
    `SELECT * FROM work_item WHERE id = $1 AND account_id = $2 AND is_deleted = 0`,
    [id, accountId()],
  );
}

/** 统计：本年度总数/已完成/未完成/高优先未完 */
export async function statsThisYear() {
  const acc = accountId();
  const year = new Date().getFullYear();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rows = await query<{ status: string; priority: string; n: number }>(
    `SELECT status, priority, COUNT(*) as n FROM work_item
     WHERE account_id = $1 AND is_deleted = 0 AND date >= $2 AND date <= $3
     GROUP BY status, priority`,
    [acc, from, to],
  );
  let total = 0,
    closed = 0,
    highOpen = 0;
  for (const r of rows) {
    total += r.n;
    if (r.status === 'closed') closed += r.n;
    else if (r.priority === 'high') highOpen += r.n;
  }
  const open = total - closed;
  const rate = total > 0 ? Math.round((closed / total) * 100) : 0;
  return { total, closed, open, rate, highOpen };
}

/**
 * 新增一行
 * @param insertAt  'end'=末尾追加；{ afterSeq: n } 在 seq_no=n 之后插入；{ beforeSeq: n } 在其前插入
 */
export async function createWorkItem(
  input: {
    date: string;
    type_id?: string | null;
    priority?: Priority;
    description: string;
    progress_note?: string | null;
    planned_at?: string | null;
    reminder_at?: string | null;
    reminder_repeat?: ReminderRepeat | null;
    internal_pic?: string | null;
    external_pic?: string | null;
    remark?: string | null;
  },
  insertAt: 'end' | { afterSeq: number } | { beforeSeq: number } = 'end',
): Promise<WorkItem> {
  const now = new Date().toISOString();
  const acc = accountId();

  // 决定 seq_no
  let seq: number;
  if (insertAt === 'end') {
    const seqRow = await queryOne<{ n: number }>(
      'SELECT COUNT(*) as n FROM work_item WHERE account_id = $1 AND is_deleted = 0',
      [acc],
    );
    seq = (seqRow?.n ?? 0) + 1;
  } else {
    seq = 'afterSeq' in insertAt ? insertAt.afterSeq + 1 : insertAt.beforeSeq;
    // 把 >= seq 的所有行的 seq_no 后移
    await exec(
      `UPDATE work_item SET seq_no = seq_no + 1
       WHERE account_id = $1 AND is_deleted = 0 AND seq_no >= $2`,
      [acc, seq],
    );
  }

  const row: WorkItem = {
    id: uuid(),
    account_id: acc,
    seq_no: seq,
    date: input.date,
    type_id: input.type_id ?? null,
    priority: input.priority ?? 'mid',
    description: input.description,
    progress_note: input.progress_note ?? null,
    planned_at: input.planned_at ?? null,
    reminder_at: input.reminder_at ?? null,
    reminder_repeat: input.reminder_repeat ?? 'none',
    completed_at: null,
    status: 'new',
    internal_pic: input.internal_pic ?? null,
    external_pic: input.external_pic ?? null,
    remark: input.remark ?? null,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO work_item
     (id, account_id, seq_no, date, type_id, priority, description, progress_note,
      planned_at, reminder_at, reminder_repeat, completed_at, status, internal_pic, external_pic, remark,
      created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,0)`,
    [
      row.id,
      row.account_id,
      row.seq_no,
      row.date,
      row.type_id,
      row.priority,
      row.description,
      row.progress_note,
      row.planned_at,
      row.reminder_at,
      row.reminder_repeat,
      row.completed_at,
      row.status,
      row.internal_pic,
      row.external_pic,
      row.remark,
      now,
    ],
  );
  return row;
}

/** 更新任意字段（部分更新） */
export async function updateWorkItem(id: string, patch: Partial<WorkItem>): Promise<void> {
  const allowed = [
    'date',
    'type_id',
    'priority',
    'description',
    'progress_note',
    'planned_at',
    'reminder_at',
    'reminder_repeat',
    'completed_at',
    'status',
    'internal_pic',
    'external_pic',
    'remark',
  ] as const;
  const now = new Date().toISOString();
  const setFrag: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const k of allowed) {
    if (k in patch) {
      setFrag.push(`${k} = $${idx++}`);
      values.push((patch as any)[k] ?? null);
    }
  }
  // 完成时间赋值时自动置状态为 closed
  if ('completed_at' in patch && patch.completed_at) {
    if (!('status' in patch)) {
      setFrag.push(`status = $${idx++}`);
      values.push('closed');
    }
  }
  setFrag.push(`updated_at = $${idx++}`);
  values.push(now);
  values.push(id, accountId());

  await exec(
    `UPDATE work_item SET ${setFrag.join(', ')} WHERE id = $${idx} AND account_id = $${idx + 1} AND is_deleted = 0`,
    values,
  );
}

/** 软删除（批量），随后重排 seq_no */
export async function softDeleteBatch(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
  await exec(`UPDATE work_item SET is_deleted = 1, updated_at = $1 WHERE id IN (${placeholders})`, [
    now,
    ...ids,
  ]);
  await resequence();
}

/**
 * 序号规范化：把当前账号未删除的所有行按当前 seq_no 排序后，重新赋值为 1..N 连续序号
 * 用于删除或插入后保证序号连续
 */
export async function resequence(): Promise<void> {
  const acc = accountId();
  const rows = await query<{ id: string }>(
    `SELECT id FROM work_item
     WHERE account_id = $1 AND is_deleted = 0
     ORDER BY seq_no ASC, created_at ASC`,
    [acc],
  );
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i++) {
    await exec(`UPDATE work_item SET seq_no = $1, updated_at = $2 WHERE id = $3`, [
      i + 1,
      now,
      rows[i].id,
    ]);
  }
}

/**
 * 状态自动流转：把当前账号所有 status=new 且 date < 今天 的行改为 following
 * 应用启动时调用一次
 */
export async function autoAdvanceStatus(): Promise<number> {
  const acc = accountId();
  const today = fmtToday();
  const rows = await query<{ id: string }>(
    `SELECT id FROM work_item
     WHERE account_id = $1 AND is_deleted = 0 AND status = 'new' AND date < $2`,
    [acc, today],
  );
  const now = new Date().toISOString();
  for (const r of rows) {
    await exec(`UPDATE work_item SET status = 'following', updated_at = $1 WHERE id = $2`, [
      now,
      r.id,
    ]);
  }
  return rows.length;
}

function fmtToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
