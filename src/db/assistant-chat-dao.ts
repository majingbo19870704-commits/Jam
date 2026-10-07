import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

export interface AssistantConversation {
  id: string;
  account_id: string;
  profile_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

export interface AssistantMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations_json: string;
  created_at: string;
}

function accountId() {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export async function getOrCreateAssistantConversation(profileId: string, title: string) {
  const account = accountId();
  const existing = await queryOne<AssistantConversation>(
    `SELECT * FROM assistant_conversation WHERE account_id = $1 AND profile_id = $2 AND is_deleted = 0
     ORDER BY updated_at DESC LIMIT 1`,
    [account, profileId],
  );
  if (existing) return existing;
  const now = new Date().toISOString();
  const conversation: AssistantConversation = {
    id: uuid(),
    account_id: account,
    profile_id: profileId,
    title,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO assistant_conversation (id,account_id,profile_id,title,created_at,updated_at,is_deleted)
     VALUES ($1,$2,$3,$4,$5,$5,0)`,
    [conversation.id, account, profileId, title, now],
  );
  return conversation;
}

export async function createAssistantConversation(profileId: string, title: string) {
  const now = new Date().toISOString();
  const conversation: AssistantConversation = {
    id: uuid(),
    account_id: accountId(),
    profile_id: profileId,
    title,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO assistant_conversation (id,account_id,profile_id,title,created_at,updated_at,is_deleted) VALUES ($1,$2,$3,$4,$5,$5,0)`,
    [conversation.id, conversation.account_id, profileId, title, now],
  );
  return conversation;
}

export async function listAssistantConversations(profileId: string) {
  return query<AssistantConversation>(
    `SELECT * FROM assistant_conversation WHERE account_id = $1 AND profile_id = $2 AND is_deleted = 0 ORDER BY updated_at DESC`,
    [accountId(), profileId],
  );
}

export async function renameAssistantConversation(id: string, title: string) {
  await exec(
    `UPDATE assistant_conversation SET title = $1, updated_at = $2 WHERE id = $3 AND account_id = $4 AND is_deleted = 0`,
    [title.trim() || '未命名对话', new Date().toISOString(), id, accountId()],
  );
}

export async function archiveAssistantConversation(id: string) {
  await exec(
    `UPDATE assistant_conversation SET is_deleted = 1, updated_at = $1 WHERE id = $2 AND account_id = $3`,
    [new Date().toISOString(), id, accountId()],
  );
}

export async function listAssistantMessages(conversationId: string) {
  return query<AssistantMessage>(
    `SELECT * FROM assistant_message WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId],
  );
}

export async function appendAssistantMessage(
  conversationId: string,
  role: AssistantMessage['role'],
  content: string,
  citations: unknown[] = [],
) {
  const now = new Date().toISOString();
  const message: AssistantMessage = {
    id: uuid(),
    conversation_id: conversationId,
    role,
    content,
    citations_json: '[]',
    created_at: now,
  };
  message.citations_json = JSON.stringify(citations);
  await exec(
    `INSERT INTO assistant_message (id,conversation_id,role,content,citations_json,created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [message.id, conversationId, role, content, message.citations_json, now],
  );
  await exec(`UPDATE assistant_conversation SET updated_at = $1 WHERE id = $2`, [
    now,
    conversationId,
  ]);
  return message;
}
