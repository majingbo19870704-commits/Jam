import { v4 as uuid } from 'uuid';
import { exec, query } from './client';
import { useAccountStore } from '@/stores/account';

export interface AiPromptTemplate {
  id: string;
  account_id: string;
  title: string;
  scene: string | null;
  content: string;
  variables_json: string | null;
  tags: string | null;
  use_count: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function accountId() {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export async function listAiPromptTemplates() {
  return query<AiPromptTemplate>(
    `SELECT * FROM ai_prompt
     WHERE account_id = $1 AND is_deleted = 0
     ORDER BY use_count DESC, updated_at DESC`,
    [accountId()],
  );
}

export async function saveAiPromptTemplate(input: { id?: string; title: string; content: string }) {
  const now = new Date().toISOString();
  if (input.id) {
    await exec(
      `UPDATE ai_prompt SET title = $1, content = $2, updated_at = $3
       WHERE id = $4 AND account_id = $5 AND is_deleted = 0`,
      [input.title.trim(), input.content.trim(), now, input.id, accountId()],
    );
    return input.id;
  }
  const id = uuid();
  await exec(
    `INSERT INTO ai_prompt
     (id,account_id,title,scene,content,variables_json,tags,use_count,created_at,updated_at,is_deleted)
     VALUES ($1,$2,$3,NULL,$4,'[]',NULL,0,$5,$5,0)`,
    [id, accountId(), input.title.trim(), input.content.trim(), now],
  );
  return id;
}

export async function markAiPromptTemplateUsed(id: string) {
  await exec(
    `UPDATE ai_prompt SET use_count = use_count + 1, updated_at = $1
     WHERE id = $2 AND account_id = $3 AND is_deleted = 0`,
    [new Date().toISOString(), id, accountId()],
  );
}

export async function deleteAiPromptTemplate(id: string) {
  await exec(
    `UPDATE ai_prompt SET is_deleted = 1, updated_at = $1 WHERE id = $2 AND account_id = $3`,
    [new Date().toISOString(), id, accountId()],
  );
}
