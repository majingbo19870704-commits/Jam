// =============================================================================
// db/base-dao.ts · 通用 DAO 基类
// =============================================================================
//
// 提供的能力：
//   - 自动注入 account_id（除 account / setting_kv / audit_log 等系统表外）
//   - 自动填充 created_at / updated_at / is_deleted
//   - 软删除：delete() 只把 is_deleted 置 1 并写入 recycle_meta
//   - 主键：UUID v4
//
// 使用示例：
//   const workItemDao = new BaseDao<WorkItem>('work_item');
//   await workItemDao.insert({ description: '...', ... });
// =============================================================================

import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

/** 需要账号隔离的业务表清单（未在此列表内的表由外部自行管理 account_id） */
const ACCOUNT_SCOPED_TABLES = new Set([
  'param_option',
  'work_item',
  'project',
  'project_wbs',
  'project_risk',
  'project_file',
  'project_member',
  'quick_link',
  'quick_link_group',
  'note',
  'note_folder',
  'word_card',
  'word_checkin',
  'ai_prompt',
  'ai_tool_link',
  'change_log',
  'recycle_meta',
]);

export interface EntityBase {
  id: string;
  account_id?: string;
  created_at?: string;
  updated_at?: string;
  is_deleted?: number;
}

export class BaseDao<T extends EntityBase> {
  constructor(public readonly table: string) {}

  protected requireAccountId(): string | null {
    if (!ACCOUNT_SCOPED_TABLES.has(this.table)) return null;
    const acc = useAccountStore.getState().currentAccountId;
    if (!acc) throw new Error(`No current account when writing ${this.table}`);
    return acc;
  }

  protected now(): string {
    return new Date().toISOString();
  }

  /** 插入一行；自动填充 id / account_id / 时间戳 */
  async insert(data: Partial<T>): Promise<T> {
    const id = data.id ?? uuid();
    const now = this.now();
    const accountId = this.requireAccountId();

    const merged: Record<string, unknown> = {
      ...data,
      id,
      created_at: data.created_at ?? now,
      updated_at: data.updated_at ?? now,
      is_deleted: 0,
    };
    if (accountId) merged.account_id = accountId;

    const keys = Object.keys(merged);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map((k) => merged[k]);

    await exec(
      `INSERT INTO ${this.table} (${keys.join(', ')}) VALUES (${placeholders})`,
      values,
    );
    return merged as unknown as T;
  }

  /** 更新指定 id 的行 */
  async update(id: string, patch: Partial<T>): Promise<void> {
    const now = this.now();
    const setFields = { ...patch, updated_at: now } as Record<string, unknown>;
    // id 不允许改
    delete setFields.id;

    const keys = Object.keys(setFields);
    if (keys.length === 0) return;

    const assignments = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map((k) => setFields[k]);
    values.push(id);

    await exec(
      `UPDATE ${this.table} SET ${assignments} WHERE id = $${keys.length + 1}`,
      values,
    );
  }

  /** 软删除：进入回收站 */
  async softDelete(id: string, summary?: string): Promise<void> {
    const now = this.now();
    await exec(
      `UPDATE ${this.table} SET is_deleted = 1, updated_at = $1 WHERE id = $2`,
      [now, id],
    );
    const accountId = this.requireAccountId();
    if (accountId && this.table !== 'recycle_meta') {
      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      await exec(
        `INSERT INTO recycle_meta (id, account_id, source_table, source_id, summary, deleted_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uuid(), accountId, this.table, id, summary ?? null, now, expiresAt],
      );
    }
  }

  /** 从回收站恢复 */
  async restore(id: string): Promise<void> {
    const now = this.now();
    await exec(
      `UPDATE ${this.table} SET is_deleted = 0, updated_at = $1 WHERE id = $2`,
      [now, id],
    );
    await exec(
      `UPDATE recycle_meta SET restored_at = $1 WHERE source_table = $2 AND source_id = $3`,
      [now, this.table, id],
    );
  }

  /** 硬删除（谨慎；一般由回收站清理任务调用） */
  async hardDelete(id: string): Promise<void> {
    await exec(`DELETE FROM ${this.table} WHERE id = $1`, [id]);
  }

  /** 根据 id 查询 */
  async findById(id: string): Promise<T | null> {
    return queryOne<T>(
      `SELECT * FROM ${this.table} WHERE id = $1 AND is_deleted = 0`,
      [id],
    );
  }

  /** 当前账号下的所有未删除行 */
  async findAll(orderBy = 'seq_no ASC'): Promise<T[]> {
    const accountId = this.requireAccountId();
    if (accountId) {
      return query<T>(
        `SELECT * FROM ${this.table} WHERE account_id = $1 AND is_deleted = 0 ORDER BY ${orderBy}`,
        [accountId],
      );
    }
    return query<T>(
      `SELECT * FROM ${this.table} WHERE is_deleted = 0 ORDER BY ${orderBy}`,
    );
  }
}
