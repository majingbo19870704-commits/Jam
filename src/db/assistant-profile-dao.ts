import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

export interface AssistantProfile {
  id: string;
  account_id: string;
  name: string;
  role_definition: string;
  avatar_key: string;
  default_provider_id: string | null;
  default_model_id: string | null;
  fallback_provider_id: string | null;
  default_model_label: string;
  knowledge_scope_json: string;
  tools_json: string;
  is_builtin: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function accountId() {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export async function ensureAssistantProfiles() {
  // 专业助理由用户自行创建；即使列表为空，也不自动重新生成预置项。
}

export async function listAssistantProfiles() {
  await ensureAssistantProfiles();
  const profiles = await query<AssistantProfile & { provider_display_name: string | null }>(
    `SELECT profile.*, connection.name AS provider_display_name
     FROM assistant_profile profile
     LEFT JOIN assistant_provider_connection connection
       ON connection.id = profile.default_provider_id
      AND connection.account_id = profile.account_id
      AND connection.is_deleted = 0
     WHERE profile.account_id = $1 AND profile.is_deleted = 0
     ORDER BY profile.is_enabled DESC, profile.is_builtin DESC, profile.created_at ASC`,
    [accountId()],
  );
  // 模型 ID 是 API 调用参数，不应作为界面中的模型名称显示。
  return profiles.map(({ provider_display_name, ...profile }) => ({
    ...profile,
    default_model_label: provider_display_name?.trim() || profile.default_model_label,
  }));
}

export async function createAssistantProfile(
  input: Pick<AssistantProfile, 'name' | 'role_definition' | 'avatar_key'>,
) {
  const now = new Date().toISOString();
  const row: AssistantProfile = {
    id: uuid(),
    account_id: accountId(),
    name: input.name.trim(),
    role_definition: input.role_definition.trim(),
    avatar_key: input.avatar_key || 'bot',
    default_provider_id: null,
    default_model_id: null,
    fallback_provider_id: null,
    default_model_label: '待配置模型',
    knowledge_scope_json: '[]',
    tools_json: '[]',
    is_builtin: 0,
    is_enabled: 1,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO assistant_profile
     (id,account_id,name,role_definition,avatar_key,default_provider_id,default_model_id,fallback_provider_id,default_model_label,knowledge_scope_json,tools_json,
      is_builtin,is_enabled,created_at,updated_at,is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0)`,
    [
      row.id,
      row.account_id,
      row.name,
      row.role_definition,
      row.avatar_key,
      row.default_provider_id,
      row.default_model_id,
      row.fallback_provider_id,
      row.default_model_label,
      row.knowledge_scope_json,
      row.tools_json,
      row.is_builtin,
      row.is_enabled,
      now,
      now,
    ],
  );
  return row;
}

/** 复制助理配置与其已授权资料范围；会话和操作记录始终保留在原助理。 */
export async function duplicateAssistantProfile(id: string): Promise<AssistantProfile> {
  const account = accountId();
  const original = await queryOne<AssistantProfile>(
    `SELECT * FROM assistant_profile WHERE id = $1 AND account_id = $2 AND is_deleted = 0`,
    [id, account],
  );
  if (!original) throw new Error('要复制的助理不存在。');
  const now = new Date().toISOString();
  const row: AssistantProfile = {
    ...original,
    id: uuid(),
    name: `${original.name} 副本`,
    is_builtin: 0,
    is_enabled: 1,
    created_at: now,
    updated_at: now,
  };
  await exec(
    `INSERT INTO assistant_profile
     (id,account_id,name,role_definition,avatar_key,default_provider_id,default_model_id,fallback_provider_id,default_model_label,knowledge_scope_json,tools_json,
      is_builtin,is_enabled,created_at,updated_at,is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,0)`,
    [
      row.id,
      row.account_id,
      row.name,
      row.role_definition,
      row.avatar_key,
      row.default_provider_id,
      row.default_model_id,
      row.fallback_provider_id,
      row.default_model_label,
      row.knowledge_scope_json,
      row.tools_json,
      row.is_builtin,
      row.is_enabled,
      now,
    ],
  );
  const sources = await query<{
    name: string;
    source_type: string;
    source_path: string;
    include_subdirs: number;
    is_enabled: number;
  }>(
    `SELECT name,source_type,source_path,include_subdirs,is_enabled FROM assistant_knowledge_source
     WHERE account_id = $1 AND profile_id = $2 AND is_deleted = 0`,
    [account, original.id],
  );
  for (const source of sources) {
    await exec(
      `INSERT INTO assistant_knowledge_source
       (id,account_id,profile_id,name,source_type,source_path,include_subdirs,is_enabled,created_at,updated_at,is_deleted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,0)`,
      [
        uuid(),
        account,
        row.id,
        source.name,
        source.source_type,
        source.source_path,
        source.include_subdirs,
        source.is_enabled,
        now,
      ],
    );
  }
  return row;
}

export async function updateAssistantProfile(
  id: string,
  patch: Partial<
    Pick<
      AssistantProfile,
      | 'name'
      | 'role_definition'
      | 'avatar_key'
      | 'is_enabled'
      | 'default_provider_id'
      | 'default_model_id'
      | 'fallback_provider_id'
      | 'default_model_label'
    >
  >,
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${column} = $${index++}`);
    values.push(value);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = $${index++}`);
  values.push(new Date().toISOString(), id, accountId());
  await exec(
    `UPDATE assistant_profile SET ${sets.join(', ')} WHERE id = $${index++} AND account_id = $${index}`,
    values,
  );
}

export async function deleteAssistantProfile(id: string) {
  await exec(
    `UPDATE assistant_profile SET is_deleted = 1, updated_at = $1 WHERE id = $2 AND account_id = $3`,
    [new Date().toISOString(), id, accountId()],
  );
}
