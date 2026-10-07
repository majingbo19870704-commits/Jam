// =============================================================================
// db/recycle-dao.ts · 回收站（跨模块）
// 直接扫描所有业务表 is_deleted=1 的行，聚合展示
// =============================================================================
import { exec, query } from './client';
import { invoke } from '@tauri-apps/api/core';
import { useAccountStore } from '@/stores/account';

export interface RecycleRow {
  table: string;
  id: string;
  summary: string;
  updated_at: string;
}

const SOURCES = [
  { table: 'work_item',        title: '工作事项', field: 'description' },
  { table: 'project',          title: '项目',     field: 'name' },
  { table: 'project_wbs',      title: '项目任务', field: 'item' },
  { table: 'project_risk',     title: '项目风险', field: 'risk' },
  { table: 'project_file',     title: '项目文件', field: 'display_name' },
  { table: 'project_member',   title: '项目成员', field: 'name' },
  { table: 'quick_link',       title: '快捷链接', field: 'name' },
  { table: 'note',             title: '笔记',     field: 'title' },
  { table: 'material_file',    title: '资料文件', field: 'original_name' },
];

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

/** 汇总所有软删除数据 */
export async function listRecycle(): Promise<Array<RecycleRow & { source: string }>> {
  const acc = accountId();
  await pruneExpiredMaterialFiles(acc);
  const out: Array<RecycleRow & { source: string }> = [];
  for (const src of SOURCES) {
    try {
      const rows = await query<{ id: string; summary: string; updated_at: string }>(
        `SELECT id, COALESCE(${src.field}, '') as summary, updated_at
         FROM ${src.table}
         WHERE account_id = $1 AND is_deleted = 1
         ORDER BY updated_at DESC`,
        [acc],
      );
      rows.forEach((r) => out.push({
        table: src.table, source: src.title,
        id: r.id, summary: r.summary || '(空)', updated_at: r.updated_at,
      }));
    } catch { /* 表还没建就跳过 */ }
  }
  return out.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
}

export async function restoreRow(table: string, id: string): Promise<void> {
  const now = new Date().toISOString();
  if (table === 'material_file') {
    const file = await query<{ id: string; account_id: string; material_type: string; file_parameter_id: string; original_name: string; archive_path: string }>('SELECT id,account_id,material_type,file_parameter_id,original_name,archive_path FROM material_file WHERE id=$1 AND account_id=$2 AND is_deleted=1', [id, accountId()]);
    if (!file[0]) throw new Error('资料回收记录不存在。');
    const setting = await query<{ archive_root: string | null }>('SELECT archive_root FROM material_setting WHERE account_id=$1', [accountId()]);
    if (!setting[0]?.archive_root) throw new Error('未配置资料归档地址，无法恢复资料文件。');
    const parameter = await query<{ file_type: string }>('SELECT file_type FROM material_file_parameter WHERE id=$1 AND account_id=$2', [file[0].file_parameter_id, accountId()]);
    if (!parameter[0]?.file_type) throw new Error('原文件类型参数不存在，无法恢复资料文件。');
    const archivePath = await invoke<string>('move_material_file', {
      sourcePath: file[0].archive_path,
      archiveRoot: setting[0].archive_root,
      materialType: file[0].material_type,
      fileType: parameter[0].file_type,
      originalName: file[0].original_name,
      replaceExisting: false,
    });
    await exec('UPDATE material_file SET archive_path=$1,is_deleted=0,updated_at=$2 WHERE id=$3 AND account_id=$4', [archivePath, now, id, accountId()]);
    return;
  }
  await exec(`UPDATE ${table} SET is_deleted = 0, updated_at = $1 WHERE id = $2`, [now, id]);
}

export async function purgeRow(table: string, id: string): Promise<void> {
  if (table === 'material_file') {
    const rows = await query<{ archive_path: string }>('SELECT archive_path FROM material_file WHERE id=$1', [id]);
    if (rows[0]?.archive_path) await invoke('delete_material_files', { paths: [rows[0].archive_path] });
  }
  await exec(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

export async function emptyAll(): Promise<number> {
  const acc = accountId();
  let n = 0;
  for (const src of SOURCES) {
    try {
      const before = await query<{ n: number }>(
        `SELECT COUNT(*) as n FROM ${src.table} WHERE account_id = $1 AND is_deleted = 1`,
        [acc],
      );
      n += before[0]?.n ?? 0;
      if (src.table === 'material_file') {
        const files = await query<{ archive_path: string }>('SELECT archive_path FROM material_file WHERE account_id=$1 AND is_deleted=1', [acc]);
        if (files.length) await invoke('delete_material_files', { paths: files.map((file) => file.archive_path) });
      }
      await exec(`DELETE FROM ${src.table} WHERE account_id = $1 AND is_deleted = 1`, [acc]);
    } catch { /* ignore */ }
  }
  return n;
}

async function pruneExpiredMaterialFiles(acc: string) {
  try {
    const setting = await query<{ recycle_retention_days: number }>('SELECT recycle_retention_days FROM material_setting WHERE account_id=$1', [acc]);
    const days = Math.max(1, setting[0]?.recycle_retention_days ?? 7);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const files = await query<{ id: string; archive_path: string }>('SELECT id,archive_path FROM material_file WHERE account_id=$1 AND is_deleted=1 AND updated_at < $2', [acc, cutoff]);
    if (!files.length) return;
    await invoke('delete_material_files', { paths: files.map((file) => file.archive_path) });
    await exec(`DELETE FROM material_file WHERE account_id=$1 AND is_deleted=1 AND updated_at < $2`, [acc, cutoff]);
  } catch (error) { console.warn('[material recycle prune] skipped:', error); }
}
