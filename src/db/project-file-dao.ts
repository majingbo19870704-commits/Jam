// =============================================================================
// db/project-file-dao.ts · 项目文件（M2 简化版：仅记录文件路径引用）
// M3 阶段会补文件复制到应用数据目录 + 内嵌预览
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

export interface ProjectFile {
  id: string;
  account_id: string;
  project_id: string;
  seq_no: number;
  type_id: string | null;
  file_parameter_id: string | null;
  display_name: string;
  original_name: string;
  rel_path: string;
  archive_path: string | null;
  size_bytes: number;
  md5: string | null;
  ext: string | null;
  status: 'valid' | 'invalid';
  remark: string | null;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export async function listFiles(projectId: string): Promise<ProjectFile[]> {
  return query<ProjectFile>(
    `SELECT * FROM project_file
     WHERE account_id = $1 AND project_id = $2 AND is_deleted = 0
     ORDER BY seq_no ASC, created_at ASC`,
    [accountId(), projectId],
  );
}

/**
 * 上传文件：复制到应用数据目录；若项目设置了归档地址，再同步复制到项目归档目录。
 * @param sourcePath 源文件绝对路径（来自 open dialog）
 */
export async function attachFile(
  projectId: string,
  input: { sourcePath: string; originalName: string; fileParameterId?: string | null },
): Promise<ProjectFile> {
  const now = new Date().toISOString();
  const acc = accountId();

  // 调 Rust 侧复制
  const { invoke } = await import('@tauri-apps/api/core');
  const archiveProject = await queryOne<{ name: string; archive_root: string | null }>(
    `SELECT name, archive_root FROM project
     WHERE id = $1 AND account_id = $2 AND is_deleted = 0`,
    [projectId, acc],
  );
  const archiveType = input.fileParameterId
    ? await queryOne<{ name: string }>(
      `SELECT file_type AS name FROM material_file_parameter
       WHERE id = $1 AND account_id = $2 AND is_deleted = 0`,
      [input.fileParameterId, acc],
    )
    : null;
  const copyResult = await invoke<{
    rel_path: string;
    abs_path: string;
    archive_path?: string | null;
    size_bytes: number;
    md5: string;
  }>('copy_file_to_data', {
    accountId: acc,
    projectId,
    srcPath: input.sourcePath,
    originalName: input.originalName,
    archiveRoot: archiveProject?.archive_root ?? null,
    projectName: archiveProject?.name ?? '未命名项目',
    archiveCategory: archiveType?.name ?? '未分类',
  });

  const ext = input.originalName.includes('.')
    ? input.originalName.split('.').pop()!.toLowerCase()
    : null;

  const r = await queryOne<{ n: number }>(
    `SELECT COUNT(*) as n FROM project_file
     WHERE account_id = $1 AND project_id = $2 AND is_deleted = 0`,
    [acc, projectId],
  );
  const seq = (r?.n ?? 0) + 1;
  const row: ProjectFile = {
    id: uuid(), account_id: acc, project_id: projectId, seq_no: seq,
    type_id: null, file_parameter_id: input.fileParameterId ?? null,
    display_name: input.originalName,
    original_name: input.originalName,
    rel_path: copyResult.rel_path,
    archive_path: copyResult.archive_path ?? null,
    size_bytes: copyResult.size_bytes,
    md5: copyResult.md5 || null,
    ext,
    status: 'valid', remark: null, uploaded_at: now,
    created_at: now, updated_at: now, is_deleted: 0,
  };
  try {
    await exec(
      `INSERT INTO project_file
       (id, account_id, project_id, seq_no, type_id, file_parameter_id, display_name, original_name,
        rel_path, archive_path, size_bytes, md5, ext, status, remark, uploaded_at,
        created_at, updated_at, is_deleted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,0)`,
      [row.id, row.account_id, row.project_id, row.seq_no, row.type_id, row.file_parameter_id,
        row.display_name, row.original_name, row.rel_path, row.archive_path, row.size_bytes,
        row.md5, row.ext, row.status, row.remark, row.uploaded_at, now],
    );
  } catch (error) {
    // 复制已完成但数据库登记失败时，立即回收本次新建副本，避免遗留无归属文件。
    await invoke('delete_file', { relPath: copyResult.rel_path }).catch(() => undefined);
    throw error;
  }
  return row;
}

export async function updateFile(id: string, patch: Partial<ProjectFile>): Promise<void> {
  const allowed = ['file_parameter_id', 'display_name', 'status', 'remark'] as const;
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
  await exec(`UPDATE project_file SET ${setFrag.join(', ')} WHERE id = $${i}`, values);
}

export async function softDeleteFiles(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const acc = accountId();
  const placeholders = ids.map((_, index) => `$${index + 2}`).join(',');
  const archived = await query<{ archive_path: string | null }>(
    `SELECT archive_path FROM project_file
     WHERE account_id = $1 AND id IN (${placeholders}) AND is_deleted = 0 AND archive_path IS NOT NULL`,
    [acc, ...ids],
  );
  const archivePaths = Array.from(new Set(
    archived.map((item) => item.archive_path).filter((path): path is string => Boolean(path)),
  ));
  if (archivePaths.length) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke<number>('delete_project_archive_files', { archivePaths });
  }
  const now = new Date().toISOString();
  await exec(
    `UPDATE project_file SET is_deleted = 1, updated_at = $1
     WHERE account_id = $2 AND id IN (${ids.map((_, index) => `$${index + 3}`).join(',')})`,
    [now, acc, ...ids],
  );
}
