// =============================================================================
// db/project-dao.ts · 项目 DAO
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';
import type { Project, StatusFull } from '@/types';

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export interface ProjectFilter {
  dateFrom?: string;
  dateTo?: string;
  typeIds?: string[];
  statuses?: StatusFull[];
  keyword?: string;
}

export async function getProject(id: string): Promise<Project | null> {
  return queryOne<Project>(
    `SELECT * FROM project WHERE id = $1 AND account_id = $2 AND is_deleted = 0`,
    [id, accountId()],
  );
}

export async function listProjects(f: ProjectFilter = {}): Promise<Project[]> {
  const wheres: string[] = ['account_id = $1', 'is_deleted = 0'];
  const params: unknown[] = [accountId()];
  let idx = 2;
  if (f.dateFrom) {
    wheres.push(`date >= $${idx++}`);
    params.push(f.dateFrom);
  }
  if (f.dateTo) {
    wheres.push(`date <= $${idx++}`);
    params.push(f.dateTo);
  }
  if (f.typeIds?.length) {
    const p = f.typeIds.map(() => `$${idx++}`).join(',');
    wheres.push(`type_id IN (${p})`);
    params.push(...f.typeIds);
  }
  if (f.statuses?.length) {
    const p = f.statuses.map(() => `$${idx++}`).join(',');
    wheres.push(`status IN (${p})`);
    params.push(...f.statuses);
  }
  if (f.keyword?.trim()) {
    const kw = `%${f.keyword.trim()}%`;
    wheres.push(
      `(name LIKE $${idx} OR progress_note LIKE $${idx} OR internal_pic LIKE $${idx} OR external_pic LIKE $${idx} OR remark LIKE $${idx})`,
    );
    params.push(kw);
    idx++;
  }
  return query<Project>(
    `SELECT * FROM project WHERE ${wheres.join(' AND ')} ORDER BY date ASC, seq_no ASC`,
    params,
  );
}

export async function statsThisYear() {
  const acc = accountId();
  const year = new Date().getFullYear();
  const rows = await query<{ status: string; n: number }>(
    `SELECT status, COUNT(*) as n FROM project
     WHERE account_id = $1 AND is_deleted = 0
       AND date >= $2 AND date <= $3
     GROUP BY status`,
    [acc, `${year}-01-01`, `${year}-12-31`],
  );
  let total = 0,
    closed = 0;
  for (const r of rows) {
    total += r.n;
    if (r.status === 'closed') closed += r.n;
  }
  const open = total - closed;
  const rate = total > 0 ? Math.round((closed / total) * 100) : 0;
  return { total, closed, open, rate };
}

export async function createProject(
  input: {
    date: string;
    type_id?: string | null;
    name: string;
    progress_note?: string | null;
    internal_pic?: string | null;
    external_pic?: string | null;
    remark?: string | null;
  },
  insertAt: 'end' | { afterSeq: number } | { beforeSeq: number } = 'end',
): Promise<Project> {
  const now = new Date().toISOString();
  const acc = accountId();
  let seq: number;
  if (insertAt === 'end') {
    const seqRow = await queryOne<{ n: number }>(
      'SELECT COUNT(*) as n FROM project WHERE account_id = $1 AND is_deleted = 0',
      [acc],
    );
    seq = (seqRow?.n ?? 0) + 1;
  } else {
    seq = 'afterSeq' in insertAt ? insertAt.afterSeq + 1 : insertAt.beforeSeq;
    await exec(
      `UPDATE project SET seq_no = seq_no + 1
       WHERE account_id = $1 AND is_deleted = 0 AND seq_no >= $2`,
      [acc, seq],
    );
  }
  const row: Project = {
    id: uuid(),
    account_id: acc,
    seq_no: seq,
    date: input.date,
    type_id: input.type_id ?? null,
    name: input.name,
    progress_note: input.progress_note ?? null,
    status: 'new',
    internal_pic: input.internal_pic ?? null,
    external_pic: input.external_pic ?? null,
    remark: input.remark ?? null,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO project (id, account_id, seq_no, date, type_id, name, progress_note,
      status, internal_pic, external_pic, remark, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,0)`,
    [
      row.id,
      row.account_id,
      row.seq_no,
      row.date,
      row.type_id,
      row.name,
      row.progress_note,
      row.status,
      row.internal_pic,
      row.external_pic,
      row.remark,
      now,
    ],
  );
  return row;
}

/** 序号规范化 */
export async function resequence(): Promise<void> {
  const acc = accountId();
  const rows = await query<{ id: string }>(
    `SELECT id FROM project WHERE account_id = $1 AND is_deleted = 0
     ORDER BY seq_no ASC, created_at ASC`,
    [acc],
  );
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i++) {
    await exec(`UPDATE project SET seq_no = $1, updated_at = $2 WHERE id = $3`, [
      i + 1,
      now,
      rows[i].id,
    ]);
  }
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  const allowed = [
    'date',
    'type_id',
    'name',
    'progress_note',
    'status',
    'internal_pic',
    'external_pic',
    'archive_root',
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
  setFrag.push(`updated_at = $${idx++}`);
  values.push(now);
  values.push(id, accountId());
  await exec(
    `UPDATE project SET ${setFrag.join(', ')} WHERE id = $${idx} AND account_id = $${idx + 1} AND is_deleted = 0`,
    values,
  );
}

export async function softDeleteBatch(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
  await exec(`UPDATE project SET is_deleted = 1, updated_at = $1 WHERE id IN (${placeholders})`, [
    now,
    ...ids,
  ]);
  await resequence();
}
