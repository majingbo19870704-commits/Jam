// =============================================================================
// db/param-dao.ts · 参数选项（4 组：事务/项目/风险/文件类型）
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query } from './client';
import { useAccountStore } from '@/stores/account';
import type { ParamOption } from '@/types';

export type ParamGroupCode =
  | 'work_type' | 'project_type' | 'risk_type'
  | 'english_type' | 'schedule_type';

export const PARAM_GROUP_LABELS: Record<ParamGroupCode, string> = {
  work_type:    '事务参数',
  project_type: '项目参数',
  risk_type:    '项目风险参数',
  english_type: '英语参数',
  schedule_type: '日程参数',
};

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

/** 列出某组下所有未删除的参数选项，按 seq_no 升序 */
export async function listByGroup(group: ParamGroupCode): Promise<ParamOption[]> {
  return query<ParamOption>(
    `SELECT * FROM param_option
     WHERE account_id = $1 AND group_code = $2 AND is_deleted = 0
     ORDER BY seq_no ASC, created_at ASC`,
    [accountId(), group],
  );
}

/** 追加一个参数 */
export async function addOption(group: ParamGroupCode, name: string): Promise<ParamOption> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('名称不能为空');

  const list = await listByGroup(group);
  if (list.some((o) => o.name === trimmed)) throw new Error('该名称已存在');

  const seq = list.length + 1;
  const now = new Date().toISOString();
  const row: ParamOption = {
    id: uuid(),
    account_id: accountId(),
    group_code: group,
    name: trimmed,
    seq_no: seq,
    is_system_default: 0,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO param_option
     (id, account_id, group_code, name, seq_no, is_system_default, created_at, updated_at, is_deleted)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $6, 0)`,
    [row.id, row.account_id, row.group_code, row.name, row.seq_no, now],
  );
  return row;
}

/** 重命名 */
export async function renameOption(id: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('名称不能为空');
  const now = new Date().toISOString();
  await exec(
    `UPDATE param_option SET name = $1, updated_at = $2 WHERE id = $3`,
    [trimmed, now, id],
  );
}

/**
 * 删除（软删除）
 * 若被业务表引用，返回引用数量供 UI 做二次确认；不阻塞删除
 */
export async function softDeleteOption(id: string): Promise<number> {
  // 简单起见：只在 UI 层给出提示；此处返回引用总数
  const usageQueries = [
    'SELECT COUNT(*) as n FROM work_item WHERE type_id = $1 AND is_deleted = 0',
    'SELECT COUNT(*) as n FROM project WHERE type_id = $1 AND is_deleted = 0',
    'SELECT COUNT(*) as n FROM project_risk WHERE type_id = $1 AND is_deleted = 0',
    'SELECT COUNT(*) as n FROM project_file WHERE type_id = $1 AND is_deleted = 0',
  ];
  let total = 0;
  for (const q of usageQueries) {
    try {
      const rows = await query<{ n: number }>(q, [id]);
      total += rows[0]?.n ?? 0;
    } catch { /* 表不存在时忽略 */ }
  }

  const now = new Date().toISOString();
  await exec(
    `UPDATE param_option SET is_deleted = 1, updated_at = $1 WHERE id = $2`,
    [now, id],
  );
  return total;
}

/** 拖拽排序：传入 id 数组顺序，把 seq_no 依次写入 */
export async function reorder(group: ParamGroupCode, ids: string[]): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i++) {
    await exec(
      `UPDATE param_option SET seq_no = $1, updated_at = $2
       WHERE id = $3 AND account_id = $4 AND group_code = $5`,
      [i + 1, now, ids[i], accountId(), group],
    );
  }
}
