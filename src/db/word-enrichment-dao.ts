// =============================================================================
// word-enrichment-dao.ts · 单词同反义词、词根与例句的账号级缓存
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, queryOne } from './client';
import { useAccountStore } from '@/stores/account';

export type EnrichmentSource = 'wordnet' | 'ai' | 'mixed' | 'none';

export interface WordEnrichment {
  id: string;
  account_id: string;
  word_id: string;
  synonyms: string[];
  antonyms: string[];
  root_analysis: string | null;
  examples: string[];
  source: EnrichmentSource;
  created_at: string;
  updated_at: string;
}

function accountId() {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

function stringList(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

export async function getWordEnrichment(wordId: string): Promise<WordEnrichment | null> {
  const row = await queryOne<Omit<WordEnrichment, 'synonyms' | 'antonyms' | 'examples'> & {
    synonyms_json: string; antonyms_json: string; examples_json: string;
  }>(
    `SELECT * FROM word_enrichment WHERE account_id = $1 AND word_id = $2`,
    [accountId(), wordId],
  );
  if (!row) return null;
  return {
    ...row,
    synonyms: stringList(row.synonyms_json),
    antonyms: stringList(row.antonyms_json),
    examples: stringList(row.examples_json),
  };
}

export async function saveWordEnrichment(wordId: string, patch: {
  synonyms: string[]; antonyms: string[]; root_analysis?: string | null;
  examples: string[]; source: EnrichmentSource;
}): Promise<void> {
  const id = accountId();
  const now = new Date().toISOString();
  const current = await getWordEnrichment(wordId);
  const values = [
    JSON.stringify(unique(patch.synonyms)), JSON.stringify(unique(patch.antonyms)),
    patch.root_analysis?.trim() || null, JSON.stringify(unique(patch.examples)), patch.source, now,
  ];
  if (current) {
    await exec(
      `UPDATE word_enrichment SET synonyms_json = $1, antonyms_json = $2, root_analysis = $3,
       examples_json = $4, source = $5, updated_at = $6 WHERE id = $7`,
      [...values, current.id],
    );
  } else {
    await exec(
      `INSERT INTO word_enrichment
       (id, account_id, word_id, synonyms_json, antonyms_json, root_analysis, examples_json, source, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [uuid(), id, wordId, ...values.slice(0, 5), now],
    );
  }
}

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
