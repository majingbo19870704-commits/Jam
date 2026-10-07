// =============================================================================
// db/ai-web-account-dao.ts · AI 网页工作区的登录资料配置
// =============================================================================
// 密码不进入 SQLite。此文件只保存登录名、页面地址和表单选择器；密码交给
// Rust 侧的 Windows DPAPI 密钥库，自动填充时也不返回至前端或模型。

import { invoke } from '@tauri-apps/api/core';
import { v4 as uuid } from 'uuid';
import { exec, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

export interface AiWebAccount {
  id: string;
  account_id: string;
  workspace_id: string;
  login_url: string;
  username: string;
  secret_ref: string;
  username_selector: string;
  password_selector: string;
  submit_selector: string | null;
  auto_login: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

export interface WebAccountDraft {
  loginUrl: string;
  username: string;
  password?: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector?: string;
  autoLogin: boolean;
}

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export async function getAiWebAccount(workspaceId: string): Promise<AiWebAccount | null> {
  return queryOne<AiWebAccount>(
    `SELECT * FROM ai_web_account
     WHERE account_id = $1 AND workspace_id = $2 AND is_deleted = 0`,
    [accountId(), workspaceId],
  );
}

export async function saveAiWebAccount(
  workspaceId: string,
  draft: WebAccountDraft,
): Promise<AiWebAccount> {
  const account_id = accountId();
  const now = new Date().toISOString();
  const current = await getAiWebAccount(workspaceId);
  const password = draft.password ?? '';
  if (!current && !password) throw new Error('请设置网站密码。');

  const row: AiWebAccount = current ?? {
    id: uuid(),
    account_id,
    workspace_id: workspaceId,
    login_url: '',
    username: '',
    secret_ref: `web-account-${uuid()}`,
    username_selector: '',
    password_selector: '',
    submit_selector: null,
    auto_login: 0,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  row.login_url = draft.loginUrl.trim();
  row.username = draft.username.trim();
  row.username_selector = draft.usernameSelector.trim();
  row.password_selector = draft.passwordSelector.trim();
  row.submit_selector = draft.submitSelector?.trim() || null;
  row.auto_login = draft.autoLogin ? 1 : 0;
  row.updated_at = now;

  if (!row.login_url || !row.username || !row.username_selector || !row.password_selector) {
    throw new Error('请完整填写登录地址、账号和两个输入框选择器。');
  }
  try {
    const url = new URL(row.login_url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error('登录地址必须是 http:// 或 https:// 网址。');
  }

  if (password) await invoke('store_secret', { secretRef: row.secret_ref, secret: password });
  if (current) {
    await exec(
      `UPDATE ai_web_account SET login_url = $1, username = $2, username_selector = $3,
       password_selector = $4, submit_selector = $5, auto_login = $6, updated_at = $7
       WHERE id = $8 AND account_id = $9`,
      [
        row.login_url,
        row.username,
        row.username_selector,
        row.password_selector,
        row.submit_selector,
        row.auto_login,
        now,
        row.id,
        account_id,
      ],
    );
  } else {
    await exec(
      `INSERT INTO ai_web_account
       (id, account_id, workspace_id, login_url, username, secret_ref, username_selector,
        password_selector, submit_selector, auto_login, created_at, updated_at, is_deleted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,0)`,
      [
        row.id,
        account_id,
        workspaceId,
        row.login_url,
        row.username,
        row.secret_ref,
        row.username_selector,
        row.password_selector,
        row.submit_selector,
        row.auto_login,
        now,
      ],
    );
  }
  return row;
}

export async function hasAiWebAccountPassword(row: AiWebAccount): Promise<boolean> {
  return invoke<boolean>('has_secret', { secretRef: row.secret_ref });
}

export async function deleteAiWebAccount(workspaceId: string): Promise<void> {
  const row = await getAiWebAccount(workspaceId);
  if (!row) return;
  await invoke('delete_secret', { secretRef: row.secret_ref });
  await exec(
    `UPDATE ai_web_account SET is_deleted = 1, updated_at = $1
     WHERE id = $2 AND account_id = $3`,
    [new Date().toISOString(), row.id, accountId()],
  );
}
