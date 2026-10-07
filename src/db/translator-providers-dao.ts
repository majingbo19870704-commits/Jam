// =============================================================================
// db/translator-providers-dao.ts · 三类翻译实例的 DAO
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query } from './client';
import { useAccountStore } from '@/stores/account';

// ---------- 通用 ----------
function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}
const now = () => new Date().toISOString();

// -----------------------------------------------------------------------------
// 离线词典
// -----------------------------------------------------------------------------
export interface DictSource {
  id: string;
  account_id: string;
  name: string;
  source_url: string | null;
  file_size: number;
  entry_count: number;
  format: string;
  data_table: string;
  is_enabled: number;
  seq_no: number;
  created_at: string;
  updated_at: string;
}

export async function listDictSources(): Promise<DictSource[]> {
  return query<DictSource>(
    `SELECT * FROM dict_source WHERE account_id = $1 AND is_deleted = 0 ORDER BY seq_no ASC, created_at ASC`,
    [accountId()],
  );
}
export async function createDictSource(input: Omit<DictSource, 'id' | 'account_id' | 'seq_no' | 'created_at' | 'updated_at' | 'is_enabled'> & { is_enabled?: number }) {
  const row: DictSource = {
    id: uuid(), account_id: accountId(), name: input.name,
    source_url: input.source_url ?? null,
    file_size: input.file_size ?? 0,
    entry_count: input.entry_count ?? 0,
    format: input.format || 'ecdict',
    data_table: input.data_table,
    is_enabled: input.is_enabled ?? 1,
    seq_no: 0, created_at: now(), updated_at: now(),
  };
  await exec(
    `INSERT INTO dict_source (id, account_id, name, source_url, file_size, entry_count, format, data_table, is_enabled, seq_no, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,0)`,
    [row.id, row.account_id, row.name, row.source_url, row.file_size, row.entry_count,
     row.format, row.data_table, row.is_enabled, row.seq_no, row.created_at],
  );
  return row;
}
export async function updateDictSource(id: string, patch: Partial<DictSource>) {
  const allowed = ['name', 'source_url', 'file_size', 'entry_count', 'format', 'is_enabled', 'seq_no'] as const;
  const setFrag: string[] = []; const values: unknown[] = []; let i = 1;
  for (const k of allowed) {
    if (k in patch) { setFrag.push(`${k} = $${i++}`); values.push((patch as any)[k] ?? null); }
  }
  setFrag.push(`updated_at = $${i++}`); values.push(now());
  values.push(id);
  await exec(`UPDATE dict_source SET ${setFrag.join(', ')} WHERE id = $${i}`, values);
}
export async function deleteDictSource(id: string) {
  await exec(`UPDATE dict_source SET is_deleted = 1, updated_at = $1 WHERE id = $2`, [now(), id]);
}

// -----------------------------------------------------------------------------
// 引擎实例
// -----------------------------------------------------------------------------
export interface EngineProvider {
  id: string;
  account_id: string;
  provider: string;
  display_name: string;
  credentials: string;    // JSON 字符串
  is_enabled: number;
  seq_no: number;
  created_at: string;
  updated_at: string;
}

export async function listEngineProviders(): Promise<EngineProvider[]> {
  return query<EngineProvider>(
    `SELECT * FROM engine_provider WHERE account_id = $1 AND is_deleted = 0 ORDER BY seq_no ASC, created_at ASC`,
    [accountId()],
  );
}
export async function createEngineProvider(input: {
  provider: string; display_name: string; credentials: Record<string, string>;
}) {
  const row: EngineProvider = {
    id: uuid(), account_id: accountId(),
    provider: input.provider, display_name: input.display_name,
    credentials: JSON.stringify(input.credentials),
    is_enabled: 1, seq_no: 0, created_at: now(), updated_at: now(),
  };
  await exec(
    `INSERT INTO engine_provider (id, account_id, provider, display_name, credentials, is_enabled, seq_no, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,1,0,$6,$6,0)`,
    [row.id, row.account_id, row.provider, row.display_name, row.credentials, row.created_at],
  );
  return row;
}
export async function updateEngineProvider(id: string, patch: {
  display_name?: string; credentials?: Record<string, string>; is_enabled?: number; seq_no?: number;
}) {
  const setFrag: string[] = []; const values: unknown[] = []; let i = 1;
  if (patch.display_name !== undefined) { setFrag.push(`display_name = $${i++}`); values.push(patch.display_name); }
  if (patch.credentials !== undefined) { setFrag.push(`credentials = $${i++}`); values.push(JSON.stringify(patch.credentials)); }
  if (patch.is_enabled !== undefined) { setFrag.push(`is_enabled = $${i++}`); values.push(patch.is_enabled); }
  if (patch.seq_no !== undefined) { setFrag.push(`seq_no = $${i++}`); values.push(patch.seq_no); }
  setFrag.push(`updated_at = $${i++}`); values.push(now());
  values.push(id);
  await exec(`UPDATE engine_provider SET ${setFrag.join(', ')} WHERE id = $${i}`, values);
}
export async function deleteEngineProvider(id: string) {
  await exec(`UPDATE engine_provider SET is_deleted = 1, updated_at = $1 WHERE id = $2`, [now(), id]);
}

// -----------------------------------------------------------------------------
// AI 实例
// -----------------------------------------------------------------------------
export interface AIProvider {
  id: string;
  account_id: string;
  provider: string;
  display_name: string;
  base_url: string | null;
  api_key: string | null;
  model: string | null;
  is_enabled: number;
  seq_no: number;
  created_at: string;
  updated_at: string;
}

export async function listAIProviders(): Promise<AIProvider[]> {
  return query<AIProvider>(
    `SELECT * FROM ai_provider WHERE account_id = $1 AND is_deleted = 0 ORDER BY seq_no ASC, created_at ASC`,
    [accountId()],
  );
}
export async function createAIProvider(input: {
  provider: string; display_name: string; base_url?: string;
  api_key?: string; model?: string;
}) {
  const row: AIProvider = {
    id: uuid(), account_id: accountId(),
    provider: input.provider, display_name: input.display_name,
    base_url: input.base_url ?? null,
    api_key: input.api_key ?? null,
    model: input.model ?? null,
    is_enabled: 1, seq_no: 0, created_at: now(), updated_at: now(),
  };
  await exec(
    `INSERT INTO ai_provider (id, account_id, provider, display_name, base_url, api_key, model, is_enabled, seq_no, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,0,$8,$8,0)`,
    [row.id, row.account_id, row.provider, row.display_name, row.base_url, row.api_key, row.model, row.created_at],
  );
  return row;
}
export async function updateAIProvider(id: string, patch: Partial<Omit<AIProvider, 'id' | 'account_id' | 'created_at' | 'updated_at'>>) {
  const allowed = ['provider', 'display_name', 'base_url', 'api_key', 'model', 'is_enabled', 'seq_no'] as const;
  const setFrag: string[] = []; const values: unknown[] = []; let i = 1;
  for (const k of allowed) {
    if (k in patch) { setFrag.push(`${k} = $${i++}`); values.push((patch as any)[k] ?? null); }
  }
  setFrag.push(`updated_at = $${i++}`); values.push(now());
  values.push(id);
  await exec(`UPDATE ai_provider SET ${setFrag.join(', ')} WHERE id = $${i}`, values);
}
export async function deleteAIProvider(id: string) {
  await exec(`UPDATE ai_provider SET is_deleted = 1, updated_at = $1 WHERE id = $2`, [now(), id]);
}
