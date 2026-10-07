// =============================================================================
// db/project-member-dao.ts · 项目成员
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

export interface ProjectMember {
  id: string;
  account_id: string;
  project_id: string;
  seq_no: number;
  company: string | null;
  department: string | null;
  name: string;
  role: string | null;
  phone: string | null;
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

export async function listMembers(projectId: string): Promise<ProjectMember[]> {
  return query<ProjectMember>(
    `SELECT * FROM project_member
     WHERE account_id = $1 AND project_id = $2 AND is_deleted = 0
     ORDER BY seq_no ASC, created_at ASC`,
    [accountId(), projectId],
  );
}

/** 按 ID 读取当前账号的一条未删除项目成员。 */
export async function getMember(id: string): Promise<ProjectMember | null> {
  return queryOne<ProjectMember>(
    `SELECT * FROM project_member WHERE id = $1 AND account_id = $2 AND is_deleted = 0`,
    [id, accountId()],
  );
}

export async function createMember(
  projectId: string,
  insertAt: 'end' | { afterSeq: number } | { beforeSeq: number } = 'end',
): Promise<ProjectMember> {
  const now = new Date().toISOString();
  const acc = accountId();
  let seq: number;
  if (insertAt === 'end') {
    const r = await queryOne<{ n: number }>(
      `SELECT COUNT(*) as n FROM project_member
       WHERE account_id = $1 AND project_id = $2 AND is_deleted = 0`,
      [acc, projectId],
    );
    seq = (r?.n ?? 0) + 1;
  } else {
    seq = 'afterSeq' in insertAt ? insertAt.afterSeq + 1 : insertAt.beforeSeq;
    await exec(
      `UPDATE project_member SET seq_no = seq_no + 1
       WHERE account_id = $1 AND project_id = $2 AND is_deleted = 0 AND seq_no >= $3`,
      [acc, projectId, seq],
    );
  }
  const row: ProjectMember = {
    id: uuid(),
    account_id: acc,
    project_id: projectId,
    seq_no: seq,
    company: null,
    department: null,
    name: '',
    role: null,
    phone: null,
    remark: null,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO project_member
     (id, account_id, project_id, seq_no, company, department, name, role, phone, remark,
      created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,0)`,
    [
      row.id,
      row.account_id,
      row.project_id,
      row.seq_no,
      row.company,
      row.department,
      row.name,
      row.role,
      row.phone,
      row.remark,
      now,
    ],
  );
  return row;
}

export async function updateMember(id: string, patch: Partial<ProjectMember>): Promise<void> {
  const allowed = ['company', 'department', 'name', 'role', 'phone', 'remark'] as const;
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
    `UPDATE project_member SET ${setFrag.join(', ')} WHERE id = $${i} AND account_id = $${i + 1} AND is_deleted = 0`,
    values,
  );
}

export async function softDeleteMembers(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  const p = ids.map((_, i) => `$${i + 2}`).join(',');
  await exec(`UPDATE project_member SET is_deleted = 1, updated_at = $1 WHERE id IN (${p})`, [
    now,
    ...ids,
  ]);
}

/** 全表姓名去重自动补全（跨项目） */
export async function suggestNames(prefix: string): Promise<string[]> {
  if (!prefix.trim()) return [];
  const rows = await query<{ name: string }>(
    `SELECT DISTINCT name FROM project_member
     WHERE account_id = $1 AND is_deleted = 0 AND name LIKE $2
     ORDER BY name ASC LIMIT 8`,
    [accountId(), `${prefix}%`],
  );
  return rows.map((r) => r.name).filter(Boolean);
}
