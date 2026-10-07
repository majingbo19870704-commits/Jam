// =============================================================================
// db/quick-link-dao.ts · 快捷链接（网址 / 本地路径）
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

export interface QuickLink {
  id: string;
  account_id: string;
  group_id: string | null;
  seq_no: number;
  kind: 'url' | 'path';
  name: string;
  url_or_path: string;
  icon_path: string | null;
  tags: string | null;
  click_count: number;
  last_used_at: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

export interface QuickLinkGroup {
  id: string;
  account_id: string;
  parent_id: string | null;
  seq_no: number;
  name: string;
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
// 分组
// -----------------------------------------------------------------------------
export async function listGroups(): Promise<QuickLinkGroup[]> {
  return query<QuickLinkGroup>(
    `SELECT * FROM quick_link_group
     WHERE account_id = $1 AND is_deleted = 0
     ORDER BY seq_no ASC, created_at ASC`,
    [accountId()],
  );
}

export async function createGroup(name: string): Promise<QuickLinkGroup> {
  const now = new Date().toISOString();
  const acc = accountId();
  const r = await queryOne<{ n: number }>(
    `SELECT COUNT(*) as n FROM quick_link_group WHERE account_id = $1 AND is_deleted = 0`,
    [acc],
  );
  const row: QuickLinkGroup = {
    id: uuid(), account_id: acc, parent_id: null, seq_no: (r?.n ?? 0) + 1,
    name, created_at: now, updated_at: now, is_deleted: 0,
  };
  await exec(
    `INSERT INTO quick_link_group (id, account_id, parent_id, seq_no, name, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$6,0)`,
    [row.id, row.account_id, row.parent_id, row.seq_no, row.name, now],
  );
  return row;
}

export async function renameGroup(id: string, name: string): Promise<void> {
  const now = new Date().toISOString();
  await exec(
    `UPDATE quick_link_group SET name = $1, updated_at = $2 WHERE id = $3`,
    [name, now, id],
  );
}

export async function deleteGroup(id: string): Promise<void> {
  const now = new Date().toISOString();
  await exec(`UPDATE quick_link_group SET is_deleted = 1, updated_at = $1 WHERE id = $2`, [now, id]);
  // 把该分组下的链接移到未分组
  await exec(`UPDATE quick_link SET group_id = NULL, updated_at = $1 WHERE group_id = $2`, [now, id]);
}

// -----------------------------------------------------------------------------
// 链接
// -----------------------------------------------------------------------------
export async function listLinks(groupId?: string | null): Promise<QuickLink[]> {
  const acc = accountId();
  if (groupId === undefined) {
    return query<QuickLink>(
      `SELECT * FROM quick_link WHERE account_id = $1 AND is_deleted = 0
       ORDER BY seq_no ASC, created_at ASC`,
      [acc],
    );
  }
  if (groupId === null) {
    return query<QuickLink>(
      `SELECT * FROM quick_link WHERE account_id = $1 AND is_deleted = 0 AND group_id IS NULL
       ORDER BY seq_no ASC, created_at ASC`,
      [acc],
    );
  }
  return query<QuickLink>(
    `SELECT * FROM quick_link WHERE account_id = $1 AND is_deleted = 0 AND group_id = $2
     ORDER BY seq_no ASC, created_at ASC`,
    [acc, groupId],
  );
}

export async function createLink(input: {
  groupId: string | null;
  kind: 'url' | 'path';
  name: string;
  url_or_path: string;
  remark?: string;
}): Promise<QuickLink> {
  const now = new Date().toISOString();
  const acc = accountId();
  const r = await queryOne<{ n: number }>(
    `SELECT COUNT(*) as n FROM quick_link WHERE account_id = $1 AND is_deleted = 0`,
    [acc],
  );
  const row: QuickLink = {
    id: uuid(), account_id: acc, group_id: input.groupId, seq_no: (r?.n ?? 0) + 1,
    kind: input.kind, name: input.name, url_or_path: input.url_or_path,
    icon_path: null, tags: null, click_count: 0, last_used_at: null,
    remark: input.remark ?? null, created_at: now, updated_at: now, is_deleted: 0,
  };
  await exec(
    `INSERT INTO quick_link
     (id, account_id, group_id, seq_no, kind, name, url_or_path, icon_path, tags,
      click_count, last_used_at, remark, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,0)`,
    [row.id, row.account_id, row.group_id, row.seq_no, row.kind, row.name,
      row.url_or_path, row.icon_path, row.tags, row.click_count,
      row.last_used_at, row.remark, now],
  );
  return row;
}

export async function updateLink(id: string, patch: Partial<QuickLink>): Promise<void> {
  const allowed = ['group_id', 'kind', 'name', 'url_or_path', 'icon_path', 'tags', 'remark'] as const;
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
  setFrag.push(`updated_at = $${i++}`); values.push(now);
  values.push(id);
  await exec(`UPDATE quick_link SET ${setFrag.join(', ')} WHERE id = $${i}`, values);
}

export async function tickClick(id: string): Promise<void> {
  const now = new Date().toISOString();
  await exec(
    `UPDATE quick_link SET click_count = click_count + 1, last_used_at = $1 WHERE id = $2`,
    [now, id],
  );
}

export async function deleteLink(id: string): Promise<void> {
  const now = new Date().toISOString();
  await exec(`UPDATE quick_link SET is_deleted = 1, updated_at = $1 WHERE id = $2`, [now, id]);
}
