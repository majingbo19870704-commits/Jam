// =============================================================================
// db/project-risk-dao.ts · 项目风险
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

export interface ProjectRisk {
  id: string;
  account_id: string;
  project_id: string;
  seq_no: number;
  type_id: string | null;
  level: 'high' | 'mid' | 'low';
  risk: string;
  countermeasure: string | null;
  progress_note: string | null;
  status: 'following' | 'closed';
  remark: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export async function listRisks(projectId: string): Promise<ProjectRisk[]> {
  return query<ProjectRisk>(
    `SELECT * FROM project_risk
     WHERE account_id = $1 AND project_id = $2 AND is_deleted = 0
     ORDER BY seq_no ASC, created_at ASC`,
    [accountId(), projectId],
  );
}

/** 按 ID 读取当前账号的一条未删除项目风险。 */
export async function getRisk(id: string): Promise<ProjectRisk | null> {
  return queryOne<ProjectRisk>(
    `SELECT * FROM project_risk WHERE id = $1 AND account_id = $2 AND is_deleted = 0`,
    [id, accountId()],
  );
}

export async function createRisk(
  projectId: string,
  insertAt: 'end' | { afterSeq: number } | { beforeSeq: number } = 'end',
): Promise<ProjectRisk> {
  const now = new Date().toISOString();
  const acc = accountId();
  let seq: number;
  if (insertAt === 'end') {
    const r = await queryOne<{ n: number }>(
      `SELECT COUNT(*) as n FROM project_risk
       WHERE account_id = $1 AND project_id = $2 AND is_deleted = 0`,
      [acc, projectId],
    );
    seq = (r?.n ?? 0) + 1;
  } else {
    seq = 'afterSeq' in insertAt ? insertAt.afterSeq + 1 : insertAt.beforeSeq;
    await exec(
      `UPDATE project_risk SET seq_no = seq_no + 1
       WHERE account_id = $1 AND project_id = $2 AND is_deleted = 0 AND seq_no >= $3`,
      [acc, projectId, seq],
    );
  }
  const row: ProjectRisk = {
    id: uuid(),
    account_id: acc,
    project_id: projectId,
    seq_no: seq,
    type_id: null,
    level: 'mid',
    risk: '',
    countermeasure: null,
    progress_note: null,
    status: 'following',
    remark: null,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO project_risk
     (id, account_id, project_id, seq_no, type_id, level, risk, countermeasure,
      progress_note, status, remark, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,0)`,
    [
      row.id,
      row.account_id,
      row.project_id,
      row.seq_no,
      row.type_id,
      row.level,
      row.risk,
      row.countermeasure,
      row.progress_note,
      row.status,
      row.remark,
      now,
    ],
  );
  return row;
}

export async function updateRisk(id: string, patch: Partial<ProjectRisk>): Promise<void> {
  const allowed = [
    'type_id',
    'level',
    'risk',
    'countermeasure',
    'progress_note',
    'status',
    'remark',
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
    `UPDATE project_risk SET ${setFrag.join(', ')} WHERE id = $${i} AND account_id = $${i + 1} AND is_deleted = 0`,
    values,
  );
}

export async function softDeleteRisks(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  const p = ids.map((_, i) => `$${i + 2}`).join(',');
  await exec(`UPDATE project_risk SET is_deleted = 1, updated_at = $1 WHERE id IN (${p})`, [
    now,
    ...ids,
  ]);
}
