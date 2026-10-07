import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

export interface KnowledgeVault {
  id: string;
  account_id: string;
  name: string;
  root_path: string;
  is_default: number;
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

export interface VaultDocumentInput {
  path: string;
  name: string;
  title: string;
  tags: string;
  frontmatter: string;
  content: string;
  size: number;
  modifiedAt: number | null;
}

export interface VaultSearchResult {
  path: string;
  title: string;
  tags: string;
  modified_at: number | null;
  excerpt: string;
}

export interface KnowledgeAiSession {
  id: string;
  account_id: string;
  vault_id: string;
  question: string;
  answer: string;
  citations_json: string;
  created_at: string;
}

function accountId() {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('请先登录。');
  return id;
}

export async function listKnowledgeVaults() {
  return query<KnowledgeVault>(
    `SELECT * FROM knowledge_vault WHERE account_id = $1 AND is_deleted = 0
     ORDER BY is_default DESC, updated_at DESC`,
    [accountId()],
  );
}

export async function addOrSelectKnowledgeVault(name: string, rootPath: string) {
  const account = accountId();
  const current = await queryOne<KnowledgeVault>(
    `SELECT * FROM knowledge_vault WHERE account_id = $1 AND root_path = $2`,
    [account, rootPath],
  );
  const now = new Date().toISOString();
  if (current && current.is_deleted === 0) {
    await setDefaultKnowledgeVault(current.id);
    return { ...current, name, is_default: 1, updated_at: now };
  }
  if (current) {
    await exec(
      `UPDATE knowledge_vault SET is_default = 0 WHERE account_id = $1 AND is_deleted = 0`,
      [account],
    );
    await exec(
      `UPDATE knowledge_vault SET name = $1, is_default = 1, is_deleted = 0, updated_at = $2
       WHERE id = $3 AND account_id = $4`,
      [name, now, current.id, account],
    );
    return { ...current, name, is_default: 1, is_deleted: 0, updated_at: now };
  }
  const id = uuid();
  await exec(`UPDATE knowledge_vault SET is_default = 0 WHERE account_id = $1 AND is_deleted = 0`, [
    account,
  ]);
  await exec(
    `INSERT INTO knowledge_vault
      (id,account_id,name,root_path,is_default,last_scanned_at,created_at,updated_at,is_deleted)
     VALUES ($1,$2,$3,$4,1,NULL,$5,$5,0)`,
    [id, account, name, rootPath, now],
  );
  return {
    id,
    account_id: account,
    name,
    root_path: rootPath,
    is_default: 1,
    last_scanned_at: null,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  } as KnowledgeVault;
}

export async function setDefaultKnowledgeVault(id: string) {
  const account = accountId();
  const now = new Date().toISOString();
  await exec(`UPDATE knowledge_vault SET is_default = 0 WHERE account_id = $1 AND is_deleted = 0`, [
    account,
  ]);
  await exec(
    `UPDATE knowledge_vault SET is_default = 1, updated_at = $1
     WHERE id = $2 AND account_id = $3 AND is_deleted = 0`,
    [now, id, account],
  );
}

export async function removeKnowledgeVault(vaultId: string) {
  const account = accountId();
  const now = new Date().toISOString();
  await exec(`DELETE FROM knowledge_document_fts WHERE vault_id = $1`, [vaultId]);
  await exec(`DELETE FROM knowledge_document_index WHERE vault_id = $1`, [vaultId]);
  await exec(`DELETE FROM knowledge_file_index WHERE vault_id = $1`, [vaultId]);
  await exec(
    `UPDATE knowledge_vault SET is_deleted = 1, is_default = 0, updated_at = $1
     WHERE id = $2 AND account_id = $3`,
    [now, vaultId, account],
  );
}

export async function replaceKnowledgeVaultIndex(vaultId: string, docs: VaultDocumentInput[]) {
  const now = new Date().toISOString();
  await exec(`DELETE FROM knowledge_document_fts WHERE vault_id = $1`, [vaultId]);
  await exec(`DELETE FROM knowledge_document_index WHERE vault_id = $1`, [vaultId]);
  await exec(`DELETE FROM knowledge_file_index WHERE vault_id = $1`, [vaultId]);
  for (const doc of docs) {
    await exec(
      `INSERT INTO knowledge_document_index
       (vault_id,path,title,tags,frontmatter,content,size,modified_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        vaultId,
        doc.path,
        doc.title,
        doc.tags,
        doc.frontmatter,
        doc.content,
        doc.size,
        doc.modifiedAt,
        now,
      ],
    );
    await exec(
      `INSERT INTO knowledge_file_index(vault_id,path,name,extension,size,modified_at,updated_at)
       VALUES ($1,$2,$3,'md',$4,$5,$6)`,
      [vaultId, doc.path, doc.name, doc.size, doc.modifiedAt, now],
    );
    await exec(
      `INSERT INTO knowledge_document_fts(vault_id,path,title,content,tags) VALUES ($1,$2,$3,$4,$5)`,
      [vaultId, doc.path, doc.title, doc.content, doc.tags],
    );
  }
  await exec(
    `UPDATE knowledge_vault SET last_scanned_at = $1, updated_at = $1 WHERE id = $2 AND account_id = $3`,
    [now, vaultId, accountId()],
  );
}

export async function searchKnowledgeVault(vaultId: string, term: string, pathPrefix?: string) {
  const normalized = term.trim().replace(/["*^]/g, ' ').trim();
  if (!normalized) return [] as VaultSearchResult[];
  const prefix = pathPrefix?.trim() ? `${pathPrefix.replace(/\/$/, '')}/%` : '%';
  const likeTerm = `%${normalized}%`;

  // 文件名搜索（无论是否已索引都能命中）
  const fileResults = await query<VaultSearchResult>(
    `SELECT path, name AS title, '' AS tags, modified_at,
       '' AS excerpt
     FROM knowledge_file_index
     WHERE vault_id = $1 AND path LIKE $2
       AND (name LIKE $3 OR path LIKE $3)
     ORDER BY modified_at DESC LIMIT 30`,
    [vaultId, prefix, likeTerm],
  );

  // FTS 全文搜索（尝试精确短语，再回退前缀模糊）
  let ftsResults: VaultSearchResult[] = [];
  try {
    // 先尝试精确短语匹配
    ftsResults = await query<VaultSearchResult>(
      `SELECT d.path, d.title, d.tags, d.modified_at,
          snippet(knowledge_document_fts, 3, '<mark>', '</mark>', '…', 18) AS excerpt
       FROM knowledge_document_fts
       JOIN knowledge_document_index d ON d.vault_id = knowledge_document_fts.vault_id AND d.path = knowledge_document_fts.path
       WHERE knowledge_document_fts MATCH $1 AND d.vault_id = $2 AND d.path LIKE $3
       ORDER BY bm25(knowledge_document_fts) LIMIT 60`,
      [`"${normalized}"`, vaultId, prefix],
    );
  } catch {
    // 精确匹配失败时改用前缀匹配（每个词加 *）
    try {
      const ftsQuery = normalized.split(/\s+/).filter(Boolean).map((w) => `${w}*`).join(' ');
      ftsResults = await query<VaultSearchResult>(
        `SELECT d.path, d.title, d.tags, d.modified_at,
            snippet(knowledge_document_fts, 3, '<mark>', '</mark>', '…', 18) AS excerpt
         FROM knowledge_document_fts
         JOIN knowledge_document_index d ON d.vault_id = knowledge_document_fts.vault_id AND d.path = knowledge_document_fts.path
         WHERE knowledge_document_fts MATCH $1 AND d.vault_id = $2 AND d.path LIKE $3
         ORDER BY bm25(knowledge_document_fts) LIMIT 60`,
        [ftsQuery, vaultId, prefix],
      );
    } catch {
      // 最终回退：LIKE 模糊搜索内容
      ftsResults = await query<VaultSearchResult>(
        `SELECT path, title, tags, modified_at, substr(content, 1, 260) AS excerpt
         FROM knowledge_document_index
         WHERE vault_id = $1 AND path LIKE $2
           AND (title LIKE $3 OR tags LIKE $3 OR content LIKE $3)
         ORDER BY modified_at DESC LIMIT 60`,
        [vaultId, prefix, likeTerm],
      );
    }
  }

  // 合并：FTS结果优先，文件名结果补充（去重）
  const seen = new Set<string>(ftsResults.map((r) => r.path));
  const extra = fileResults.filter((r) => !seen.has(r.path));
  return [...ftsResults, ...extra].slice(0, 80);
}

export async function saveKnowledgeAiSession(
  vaultId: string,
  question: string,
  answer: string,
  citations: Array<{ title: string; path: string }>,
) {
  const now = new Date().toISOString();
  const row: KnowledgeAiSession = {
    id: uuid(),
    account_id: accountId(),
    vault_id: vaultId,
    question,
    answer,
    citations_json: JSON.stringify(citations),
    created_at: now,
  };
  await exec(
    `INSERT INTO knowledge_ai_session(id,account_id,vault_id,question,answer,citations_json,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      row.id,
      row.account_id,
      row.vault_id,
      row.question,
      row.answer,
      row.citations_json,
      row.created_at,
    ],
  );
  return row;
}

export async function listKnowledgeAiSessions(vaultId: string) {
  return query<KnowledgeAiSession>(
    `SELECT * FROM knowledge_ai_session WHERE account_id = $1 AND vault_id = $2
     ORDER BY created_at DESC LIMIT 20`,
    [accountId(), vaultId],
  );
}
