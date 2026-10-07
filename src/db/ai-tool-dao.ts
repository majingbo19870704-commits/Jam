// =============================================================================
// db/ai-tool-dao.ts · AI 工具快捷入口
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

export interface AiToolLink {
  id: string;
  account_id: string;
  group_name: string | null;
  seq_no: number;
  name: string;
  url: string;
  description: string | null;
  icon_path: string | null;
  click_count: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

// -----------------------------------------------------------------------------
// 列表
// -----------------------------------------------------------------------------
export async function listAiTools(groupName?: string | null): Promise<AiToolLink[]> {
  const acc = accountId();
  if (groupName === undefined) {
    return query<AiToolLink>(
      `SELECT * FROM ai_tool_link WHERE account_id = $1 AND is_deleted = 0
       ORDER BY group_name ASC, seq_no ASC, created_at ASC`,
      [acc],
    );
  }
  if (groupName === null) {
    return query<AiToolLink>(
      `SELECT * FROM ai_tool_link WHERE account_id = $1 AND is_deleted = 0 AND group_name IS NULL
       ORDER BY seq_no ASC, created_at ASC`,
      [acc],
    );
  }
  return query<AiToolLink>(
    `SELECT * FROM ai_tool_link WHERE account_id = $1 AND is_deleted = 0 AND group_name = $2
     ORDER BY seq_no ASC, created_at ASC`,
    [acc, groupName],
  );
}

/** 所有不重复的分组名列表（按首次出现顺序） */
export async function listAiToolGroups(): Promise<string[]> {
  const acc = accountId();
  const rows = await query<{ group_name: string | null }>(
    `SELECT DISTINCT group_name FROM ai_tool_link
     WHERE account_id = $1 AND is_deleted = 0 AND group_name IS NOT NULL
     ORDER BY group_name ASC`,
    [acc],
  );
  return rows.map((r) => r.group_name as string);
}

// -----------------------------------------------------------------------------
// 创建 / 更新 / 删除
// -----------------------------------------------------------------------------
export async function createAiTool(input: {
  groupName: string | null;
  name: string;
  url: string;
  description?: string;
}): Promise<AiToolLink> {
  const now = new Date().toISOString();
  const acc = accountId();
  const r = await queryOne<{ n: number }>(
    `SELECT COUNT(*) as n FROM ai_tool_link WHERE account_id = $1 AND is_deleted = 0`,
    [acc],
  );
  const row: AiToolLink = {
    id: uuid(),
    account_id: acc,
    group_name: input.groupName,
    seq_no: (r?.n ?? 0) + 1,
    name: input.name,
    url: input.url,
    description: input.description ?? null,
    icon_path: null,
    click_count: 0,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO ai_tool_link
     (id, account_id, group_name, seq_no, name, url, description, icon_path,
      click_count, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$9,0)`,
    [
      row.id,
      row.account_id,
      row.group_name,
      row.seq_no,
      row.name,
      row.url,
      row.description,
      row.icon_path,
      now,
    ],
  );
  return row;
}

export async function updateAiTool(
  id: string,
  patch: {
    groupName?: string | null;
    name?: string;
    url?: string;
    description?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if ('groupName' in patch) {
    sets.push(`group_name = $${i++}`);
    vals.push(patch.groupName ?? null);
  }
  if ('name' in patch) {
    sets.push(`name = $${i++}`);
    vals.push(patch.name);
  }
  if ('url' in patch) {
    sets.push(`url = $${i++}`);
    vals.push(patch.url);
  }
  if ('description' in patch) {
    sets.push(`description = $${i++}`);
    vals.push(patch.description ?? null);
  }
  sets.push(`updated_at = $${i++}`);
  vals.push(now);
  vals.push(id);
  vals.push(accountId());
  await exec(
    `UPDATE ai_tool_link SET ${sets.join(', ')} WHERE id = $${i} AND account_id = $${i + 1}`,
    vals,
  );
}

export async function deleteAiTool(id: string): Promise<void> {
  const now = new Date().toISOString();
  await exec(
    `UPDATE ai_tool_link SET is_deleted = 1, updated_at = $1 WHERE id = $2 AND account_id = $3`,
    [now, id, accountId()],
  );
}

/** 按传入顺序重新编号。页面仅传递当前账号、当前分组中已经加载的条目。 */
export async function reorderAiTools(ids: string[], groupName: string | null): Promise<void> {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return;
  const acc = accountId();
  const now = new Date().toISOString();
  for (const [index, id] of ids.entries()) {
    if (groupName === null) {
      await exec(
        `UPDATE ai_tool_link SET seq_no = $1, updated_at = $2
         WHERE id = $3 AND account_id = $4 AND group_name IS NULL AND is_deleted = 0`,
        [index + 1, now, id, acc],
      );
    } else {
      await exec(
        `UPDATE ai_tool_link SET seq_no = $1, updated_at = $2
         WHERE id = $3 AND account_id = $4 AND group_name = $5 AND is_deleted = 0`,
        [index + 1, now, id, acc, groupName],
      );
    }
  }
}

export async function tickAiToolClick(id: string): Promise<void> {
  const now = new Date().toISOString();
  await exec(
    `UPDATE ai_tool_link SET click_count = click_count + 1, updated_at = $1 WHERE id = $2`,
    [now, id],
  );
}

/** 批量重命名某个分组 */
export async function renameAiToolGroup(oldName: string, newName: string): Promise<void> {
  const now = new Date().toISOString();
  await exec(
    `UPDATE ai_tool_link SET group_name = $1, updated_at = $2
     WHERE account_id = $3 AND group_name = $4 AND is_deleted = 0`,
    [newName, now, accountId(), oldName],
  );
}

/** 把某分组下所有工具移到未分组，再物理删除分组名（无专用分组表，靠 group_name 字段区分） */
export async function deleteAiToolGroup(groupName: string): Promise<void> {
  const now = new Date().toISOString();
  await exec(
    `UPDATE ai_tool_link SET group_name = NULL, updated_at = $1
     WHERE account_id = $2 AND group_name = $3 AND is_deleted = 0`,
    [now, accountId(), groupName],
  );
}
