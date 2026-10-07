// =============================================================================
// db/account-dao.ts · 唯一主人档案的数据访问
//
// `account` / `account_id` 是早期数据模型留下的内部归属键。产品层不再提供
// 多账号、角色或管理员能力；任何业务数据都归唯一主人档案所有。
// =============================================================================

import { v4 as uuid } from 'uuid';
import { invoke } from '@tauri-apps/api/core';
import { exec, query, queryOne } from './client';
import type { Account } from '@/types';

/** 当前唯一主人；未初始化或存在多份旧数据等待用户选择时返回 null。 */
export async function getOwnerAccount(): Promise<Account | null> {
  return queryOne<Account>('SELECT * FROM account WHERE is_deleted = 0 AND is_owner = 1 LIMIT 1');
}

/** 仅在旧版多账号升级的首次初始化页使用，普通设置页不会暴露账号列表。 */
export async function listOwnerCandidates(): Promise<Account[]> {
  return query<Account>(
    `SELECT * FROM account
     WHERE is_deleted = 0 AND COALESCE(username, '') <> 'Admin'
     ORDER BY last_login_at DESC, created_at ASC`,
  );
}

function assertPassword(password: string) {
  if (password.length < 8) throw new Error('密码至少需要 8 位。');
}

/** 首次建立主人档案，或将旧版资料确认为唯一主人。恢复码只返回一次。 */
export async function initializeOwner(input: {
  displayName: string;
  password: string;
  sourceAccountId?: string;
}): Promise<{ account: Account; recoveryCode: string }> {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('请输入显示名称。');
  assertPassword(input.password);

  const passwordHash = await invoke<string>('hash_password', { password: input.password });
  const recoveryCode = await invoke<string>('generate_recovery_code');
  const recoveryHash = await invoke<string>('hash_recovery_code', { code: recoveryCode });
  const now = new Date().toISOString();
  const source = input.sourceAccountId
    ? await queryOne<Account>('SELECT * FROM account WHERE id = $1 AND is_deleted = 0', [
        input.sourceAccountId,
      ])
    : await queryOne<Account>(
        'SELECT * FROM account WHERE is_deleted = 0 AND is_owner = 1 LIMIT 1',
      );

  await exec('UPDATE account SET is_owner = 0 WHERE is_deleted = 0');
  if (source) {
    const username = source.username === 'Admin' ? 'owner' : source.username;
    await exec(
      `UPDATE account
       SET is_owner = 1, requires_setup = 0, username = $1, display_name = $2,
           password_hash = $3, recovery_code_hash = $4, last_login_at = $5
       WHERE id = $6`,
      [username, displayName, passwordHash, recoveryHash, now, source.id],
    );
    return {
      account: {
        ...source,
        username,
        display_name: displayName,
        password_hash: passwordHash,
        recovery_code_hash: recoveryHash,
        is_owner: 1,
        requires_setup: 0,
        last_login_at: now,
      },
      recoveryCode,
    };
  }

  const account: Account = {
    id: uuid(),
    username: 'owner',
    display_name: displayName,
    avatar_path: null,
    password_hash: passwordHash,
    recovery_code_hash: recoveryHash,
    preferences_json: '{}',
    created_at: now,
    last_login_at: now,
    is_deleted: 0,
    is_owner: 1,
    requires_setup: 0,
  };
  await exec(
    `INSERT INTO account
      (id, username, display_name, password_hash, recovery_code_hash, preferences_json, created_at, last_login_at, is_deleted, is_owner, requires_setup)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 0, 1, 0)`,
    [
      account.id,
      account.username,
      account.display_name,
      account.password_hash,
      account.recovery_code_hash,
      account.preferences_json,
      now,
    ],
  );
  await seedDefaultParams(account.id);
  return { account, recoveryCode };
}

/** 用户可维护自己的显示资料。 */
export async function updateOwnerProfile(input: {
  displayName: string;
  avatarPath?: string | null;
}) {
  const name = input.displayName.trim();
  if (!name) throw new Error('显示名称不能为空。');
  await exec(
    'UPDATE account SET display_name=$1, avatar_path=$2 WHERE is_owner=1 AND is_deleted=0',
    [name, input.avatarPath ?? null],
  );
}

export async function changeOwnerPassword(currentPassword: string, nextPassword: string) {
  assertPassword(nextPassword);
  const account = await getOwnerAccount();
  if (!account) throw new Error('账号不存在。');
  const valid = await invoke<boolean>('verify_password', {
    password: currentPassword,
    hash: account.password_hash,
  });
  if (!valid) throw new Error('当前密码不正确。');
  const hash = await invoke<string>('hash_password', { password: nextPassword });
  await exec('UPDATE account SET password_hash=$1 WHERE id=$2', [hash, account.id]);
}

interface OwnerPreferences {
  require_password_on_start?: boolean;
  [key: string]: unknown;
}

function parseOwnerPreferences(raw?: string): OwnerPreferences {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as OwnerPreferences)
      : {};
  } catch {
    return {};
  }
}

/** 是否在每次打开软件时验证主人密码。 */
export function ownerRequiresPasswordOnStart(account: Pick<Account, 'preferences_json'>): boolean {
  return parseOwnerPreferences(account.preferences_json).require_password_on_start === true;
}

export async function getOwnerPasswordRequirement(): Promise<boolean> {
  const account = await getOwnerAccount();
  return account ? ownerRequiresPasswordOnStart(account) : false;
}

export async function setOwnerPasswordRequirement(required: boolean): Promise<void> {
  const account = await getOwnerAccount();
  if (!account) throw new Error('账号不存在。');
  const preferences = parseOwnerPreferences(account.preferences_json);
  preferences.require_password_on_start = required;
  await exec('UPDATE account SET preferences_json=$1 WHERE id=$2', [
    JSON.stringify(preferences),
    account.id,
  ]);
}

export async function verifyOwnerPassword(password: string): Promise<boolean> {
  const account = await getOwnerAccount();
  if (!account) return false;
  return invoke<boolean>('verify_password', { password, hash: account.password_hash });
}

/** 在确认当前密码后换发恢复码，旧恢复码立即失效。 */
export async function rotateOwnerRecoveryCode(currentPassword: string): Promise<string> {
  const account = await getOwnerAccount();
  if (!account) throw new Error('未初始化主人档案。');
  const valid = await invoke<boolean>('verify_password', {
    password: currentPassword,
    hash: account.password_hash,
  });
  if (!valid) throw new Error('当前密码不正确。');
  const recoveryCode = await invoke<string>('generate_recovery_code');
  const recoveryHash = await invoke<string>('hash_recovery_code', { code: recoveryCode });
  await exec('UPDATE account SET recovery_code_hash=$1 WHERE id=$2', [recoveryHash, account.id]);
  return recoveryCode;
}

// -----------------------------------------------------------------------------
// 默认参数灌入
// -----------------------------------------------------------------------------
const DEFAULT_PARAMS: Array<{
  group_code:
    'work_type' | 'project_type' | 'risk_type' | 'english_type' | 'schedule_type';
  items: string[];
}> = [
  { group_code: 'work_type', items: ['工作', '生活', '学习', '其他'] },
  { group_code: 'project_type', items: ['工艺', '工装', '设备', '新品'] },
  { group_code: 'risk_type', items: ['技术', '进度', '供应', '质量', '成本', '其他'] },
  { group_code: 'english_type', items: ['工作', '学习', '生活', '雅思', '托福', 'CET-4', 'CET-6'] },
  { group_code: 'schedule_type', items: ['工作', '项目', '学习', '个人'] },
];

async function seedDefaultParams(accountId: string) {
  const now = new Date().toISOString();
  for (const group of DEFAULT_PARAMS) {
    for (let i = 0; i < group.items.length; i++) {
      await exec(
        `INSERT INTO param_option (id, account_id, group_code, name, seq_no, is_system_default, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $6)`,
        [uuid(), accountId, group.group_code, group.items[i], i + 1, now],
      );
    }
  }
  const types = ['产品资料', '工艺资料', '质量资料', '其他资料', '项目资料'];
  for (let index = 0; index < types.length; index++) {
    await exec(
      `INSERT INTO material_file_parameter (id, account_id, material_type, file_type, remark, seq_no, created_at, updated_at, is_deleted)
       VALUES ($1, $2, $3, '其他', NULL, $4, $5, $5, 0)`,
      [uuid(), accountId, types[index], index + 1, now],
    );
  }
  await exec(
    `INSERT INTO material_setting (account_id, archive_root, recycle_retention_days, updated_at)
     VALUES ($1, NULL, 7, $2)`,
    [accountId, now],
  );
}
