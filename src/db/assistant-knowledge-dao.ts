import { v4 as uuid } from 'uuid';
import { exec, query } from './client';
import { useAccountStore } from '@/stores/account';

export interface AssistantKnowledgeSource {
  id: string;
  account_id: string;
  profile_id: string;
  name: string;
  source_type: 'file' | 'folder';
  source_path: string;
  include_subdirs: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

export interface AssistantGlobalKnowledgeSource {
  id: string;
  account_id: string;
  name: string;
  source_type: 'file' | 'folder';
  source_path: string;
  include_subdirs: number;
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

export async function listAssistantKnowledgeSources(profileId: string) {
  return query<AssistantKnowledgeSource>(
    `SELECT * FROM assistant_knowledge_source
     WHERE account_id = $1 AND profile_id = $2 AND is_deleted = 0 ORDER BY created_at ASC`,
    [accountId(), profileId],
  );
}

export async function addAssistantKnowledgeSource(
  input: Pick<AssistantKnowledgeSource, 'profile_id' | 'name' | 'source_type' | 'source_path'>,
) {
  const now = new Date().toISOString();
  const source: AssistantKnowledgeSource = {
    id: uuid(),
    account_id: accountId(),
    profile_id: input.profile_id,
    name: input.name,
    source_type: input.source_type,
    source_path: input.source_path,
    include_subdirs: input.source_type === 'folder' ? 1 : 0,
    is_enabled: 1,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO assistant_knowledge_source
     (id,account_id,profile_id,name,source_type,source_path,include_subdirs,is_enabled,created_at,updated_at,is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$8,0)`,
    [
      source.id,
      source.account_id,
      source.profile_id,
      source.name,
      source.source_type,
      source.source_path,
      source.include_subdirs,
      now,
    ],
  );
  return source;
}

export async function deleteAssistantKnowledgeSource(id: string) {
  await exec(
    `UPDATE assistant_knowledge_source SET is_deleted = 1, updated_at = $1 WHERE id = $2 AND account_id = $3`,
    [new Date().toISOString(), id, accountId()],
  );
}

export async function listAssistantGlobalKnowledgeSources() {
  return query<AssistantGlobalKnowledgeSource>(
    `SELECT * FROM assistant_global_knowledge_source
     WHERE account_id = $1 AND is_deleted = 0 AND is_enabled = 1 ORDER BY created_at ASC`,
    [accountId()],
  );
}

export async function addAssistantGlobalKnowledgeSource(
  input: Pick<AssistantGlobalKnowledgeSource, 'name' | 'source_type' | 'source_path'>,
) {
  const now = new Date().toISOString();
  const source: AssistantGlobalKnowledgeSource = {
    id: uuid(),
    account_id: accountId(),
    name: input.name,
    source_type: input.source_type,
    source_path: input.source_path,
    include_subdirs: input.source_type === 'folder' ? 1 : 0,
    is_enabled: 1,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO assistant_global_knowledge_source
     (id,account_id,name,source_type,source_path,include_subdirs,is_enabled,created_at,updated_at,is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7,$7,0)`,
    [
      source.id,
      source.account_id,
      source.name,
      source.source_type,
      source.source_path,
      source.include_subdirs,
      now,
    ],
  );
  return source;
}

export async function deleteAssistantGlobalKnowledgeSource(id: string) {
  await exec(
    `UPDATE assistant_global_knowledge_source SET is_deleted = 1, updated_at = $1
     WHERE id = $2 AND account_id = $3`,
    [new Date().toISOString(), id, accountId()],
  );
}
