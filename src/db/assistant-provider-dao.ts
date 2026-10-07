import { invoke } from '@tauri-apps/api/core';
import { v4 as uuid } from 'uuid';
import { exec, query } from './client';
import { useAccountStore } from '@/stores/account';

export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'qwen'
  | 'doubao'
  | 'kimi'
  | 'deepseek'
  | 'zhipu'
  | 'qianfan'
  | 'hunyuan'
  | 'siliconflow'
  | 'modelscope'
  | 'ollama'
  | 'custom';

export interface AssistantProviderConnection {
  id: string;
  account_id: string;
  name: string;
  provider_kind: ProviderKind;
  base_url: string;
  model_id: string;
  api_key: string | null;
  secret_ref: string | null;
  is_enabled: number;
  daily_request_limit: number | null;
  monthly_request_limit: number | null;
  last_tested_at: string | null;
  last_test_status: 'passed' | 'failed' | null;
  last_test_message: string | null;
  last_test_latency_ms: number | null;
  input_price_per_million_cny: number | null;
  output_price_per_million_cny: number | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

export interface ProviderConnectionInput {
  name: string;
  provider_kind: ProviderKind;
  base_url: string;
  model_id: string;
  api_key?: string;
  daily_request_limit?: number | null;
  monthly_request_limit?: number | null;
  input_price_per_million_cny?: number | null;
  output_price_per_million_cny?: number | null;
}
export interface ProviderUsageSummary {
  provider_id: string;
  today_requests: number;
  today_input_tokens: number;
  today_output_tokens: number;
  month_requests: number;
  month_input_tokens: number;
  month_output_tokens: number;
}

export interface ProviderConnectionTestResult {
  model: string;
  latencyMs: number;
  detail: string;
  inputTokens: number;
  outputTokens: number;
}

function accountId() {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export async function listAssistantProviderConnections() {
  return query<AssistantProviderConnection>(
    `SELECT * FROM assistant_provider_connection
     WHERE account_id = $1 AND is_deleted = 0 ORDER BY is_enabled DESC, created_at ASC`,
    [accountId()],
  );
}

export async function listAssistantProviderModels(connectionId: string) {
  return invoke<string[]>('ai_list_models', { accountId: accountId(), connectionId });
}

export async function testAssistantProviderConnection(connectionId: string) {
  return invoke<ProviderConnectionTestResult>('ai_test_connection', {
    accountId: accountId(),
    connectionId,
  });
}

export async function saveAssistantProviderConnectionTest(
  id: string,
  status: 'passed' | 'failed',
  message: string,
  latencyMs: number | null,
) {
  await exec(
    `UPDATE assistant_provider_connection
     SET last_tested_at = $1, last_test_status = $2, last_test_message = $3,
         last_test_latency_ms = $4, updated_at = $1
     WHERE id = $5 AND account_id = $6 AND is_deleted = 0`,
    [new Date().toISOString(), status, message.slice(0, 600), latencyMs, id, accountId()],
  );
}

export async function setAssistantProviderConnectionEnabled(id: string, enabled: boolean) {
  await exec(
    `UPDATE assistant_provider_connection SET is_enabled = $1, updated_at = $2
     WHERE id = $3 AND account_id = $4 AND is_deleted = 0`,
    [enabled ? 1 : 0, new Date().toISOString(), id, accountId()],
  );
}

export async function listAssistantProviderUsage() {
  const timestamp = new Date().toISOString();
  return query<ProviderUsageSummary>(
    `SELECT p.id AS provider_id,
      COALESCE(day.request_count, 0) AS today_requests,
      COALESCE(day.input_tokens, 0) AS today_input_tokens,
      COALESCE(day.output_tokens, 0) AS today_output_tokens,
      COALESCE(month.request_count, 0) AS month_requests,
      COALESCE(month.input_tokens, 0) AS month_input_tokens,
      COALESCE(month.output_tokens, 0) AS month_output_tokens
     FROM assistant_provider_connection p
     LEFT JOIN assistant_provider_usage day ON day.provider_id = p.id AND day.period_key = $2
     LEFT JOIN assistant_provider_usage month ON month.provider_id = p.id AND month.period_key = $3
     WHERE p.account_id = $1 AND p.is_deleted = 0`,
    [accountId(), `day:${timestamp.slice(0, 10)}`, `month:${timestamp.slice(0, 7)}`],
  );
}

export async function connectionHasKey(connection: AssistantProviderConnection) {
  if (connection.api_key?.trim()) return true;
  if (!connection.secret_ref) return false;
  return invoke<boolean>('has_secret', { secretRef: connection.secret_ref });
}

export async function createAssistantProviderConnection(input: ProviderConnectionInput) {
  const now = new Date().toISOString();
  const id = uuid();
  const account = accountId();
  const requiresKey = input.provider_kind !== 'ollama';
  if (requiresKey && !input.api_key?.trim()) throw new Error('请填写 API 密钥。');
  await exec(
    `INSERT INTO assistant_provider_connection
     (id,account_id,name,provider_kind,base_url,model_id,api_key,secret_ref,is_enabled,daily_request_limit,monthly_request_limit,input_price_per_million_cny,output_price_per_million_cny,created_at,updated_at,is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,1,$8,$9,$10,$11,$12,$12,0)`,
    [
      id,
      account,
      input.name.trim(),
      input.provider_kind,
      input.base_url.trim(),
      input.model_id.trim(),
      requiresKey ? input.api_key!.trim() : null,
      input.daily_request_limit ?? null,
      input.monthly_request_limit ?? null,
      input.input_price_per_million_cny ?? null,
      input.output_price_per_million_cny ?? null,
      now,
    ],
  );
  return id;
}

export async function updateAssistantProviderConnection(
  id: string,
  input: ProviderConnectionInput,
) {
  const account = accountId();
  const rows = await query<AssistantProviderConnection>(
    `SELECT * FROM assistant_provider_connection WHERE id = $1 AND account_id = $2 AND is_deleted = 0`,
    [id, account],
  );
  const row = rows[0];
  if (!row) throw new Error('模型连接不存在。');
  const requiresKey = input.provider_kind !== 'ollama';
  const apiKey = input.api_key?.trim() || row.api_key || null;
  if (requiresKey && !apiKey && !(await connectionHasKey(row)))
    throw new Error('请填写 API 密钥。');
  const keepLegacySecret = requiresKey && !apiKey && row.secret_ref;
  if (row.secret_ref && !keepLegacySecret)
    await invoke('delete_secret', { secretRef: row.secret_ref }).catch(() => undefined);
  await exec(
    `UPDATE assistant_provider_connection
     SET name = $1, provider_kind = $2, base_url = $3, model_id = $4, api_key = $5, secret_ref = $6, daily_request_limit = $7, monthly_request_limit = $8,
         input_price_per_million_cny = $9, output_price_per_million_cny = $10, updated_at = $11
     WHERE id = $12 AND account_id = $13`,
    [
      input.name.trim(),
      input.provider_kind,
      input.base_url.trim(),
      input.model_id.trim(),
      requiresKey ? apiKey : null,
      keepLegacySecret ?? null,
      input.daily_request_limit ?? null,
      input.monthly_request_limit ?? null,
      input.input_price_per_million_cny ?? null,
      input.output_price_per_million_cny ?? null,
      new Date().toISOString(),
      id,
      account,
    ],
  );
}

export async function deleteAssistantProviderConnection(connection: AssistantProviderConnection) {
  const account = accountId();
  await exec(
    `UPDATE assistant_provider_connection SET is_deleted = 1, updated_at = $1 WHERE id = $2 AND account_id = $3`,
    [new Date().toISOString(), connection.id, account],
  );
  await exec(
    `UPDATE assistant_profile SET default_provider_id = NULL, default_model_id = NULL, default_model_label = '待配置模型', updated_at = $1
     WHERE account_id = $2 AND default_provider_id = $3`,
    [new Date().toISOString(), account, connection.id],
  );
  if (connection.secret_ref)
    await invoke('delete_secret', { secretRef: connection.secret_ref }).catch(() => undefined);
}
