// =============================================================================
// db/english-dao.ts · 英语学习模块相关的 DAO
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query, queryOne, withTransaction } from './client';
import { useAccountStore } from '@/stores/account';
import { localDateKey } from '@/lib/local-date';

export type LearnStatus = 'new' | 'learning' | 'mastered' | 'paused';

/** 词条种类：word（单个词）/ phrase（短语，2-4 词）/ sentence（句子，含空格且更长） */
export type ItemKind = 'word' | 'phrase' | 'sentence';

export function detectKind(text: string): ItemKind {
  const t = text.trim();
  const spaces = (t.match(/\s+/g) ?? []).length;
  if (spaces === 0) return 'word';
  if (spaces <= 3 && t.length < 30) return 'phrase';
  return 'sentence';
}

export interface WordCard {
  id: string;
  account_id: string;
  word: string;
  pos: string | null;
  meaning: string | null;
  example: string | null;
  source: string | null;
  mastery: number;
  next_review_at: string | null;
  interval_days: number;
  easiness: number;
  review_count: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
  // 扩展字段（English module v1.0）
  phonetic_uk: string | null;
  phonetic_us: string | null;
  meaning_context: string | null;
  status: LearnStatus;
  tags: string | null;
  notes: string | null;
  repetitions: number;
  last_review_at: string | null;
  // v2.1：持久化的 Tab 归类（建卡时决定，不再随文本内容重算）
  item_kind: ItemKind | null;
}

export interface WordbookImportItem {
  word: string;
  kind: ItemKind;
  tags?: string | null;
  phonetic?: string | null;
  meaning?: string | null;
  status?: LearnStatus;
  next_review_at?: string | null;
  notes?: string | null;
}

/** ECDICT 中用于单词详情展示的补充字段。 */
export interface OfflineDictionaryEntry {
  phonetic?: string;
  translation?: string;
  exchange?: string;
  tag?: string;
  frq?: number;
}

/** 查询当前账号已启用的自定义词典，未命中时回退到内置 ECDICT。 */
export async function lookupOfflineDictionary<T extends OfflineDictionaryEntry = OfflineDictionaryEntry>(word: string): Promise<T | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T | null>('ecdict_lookup', { word: word.trim(), accountId: accountId() });
}

/** 英文前缀联想，包含当前账号启用的自定义词典。 */
export async function prefixOfflineDictionary(prefix: string, limit = 8): Promise<string[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string[]>('ecdict_prefix', { prefix: prefix.trim(), limit, accountId: accountId() });
}

/** 返回词形还原后的原形；无法判断时返回 null。 */
export async function lemmatizeOfflineDictionary(word: string): Promise<string | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('ecdict_lemmatize', { word: word.trim(), accountId: accountId() });
}

/**
 * 归类优先级：
 *  1) 持久化字段 item_kind（新建卡片时按当前 Tab 写入）
 *  2) 回退到基于文本的启发式 detectKind()
 *
 * 用于列表过滤与 Tab 计数，保证在编辑内容后不会跨 Tab 漂移。
 */
export function resolveKind(w: Pick<WordCard, 'word' | 'item_kind'>): ItemKind {
  if (w.item_kind === 'word' || w.item_kind === 'phrase' || w.item_kind === 'sentence') {
    return w.item_kind;
  }
  return detectKind(w.word);
}

export interface WordContext {
  id: string;
  account_id: string;
  word_id: string;
  sentence: string;
  translation: string | null;
  source: string | null;
  source_ref: string | null;
  created_at: string;
  is_deleted: number;
}

export interface WordCheckin {
  id: string;
  account_id: string;
  checkin_date: string; // YYYY-MM-DD
  reviewed_count: number;
  new_count: number;
  created_at: string;
}

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

// -----------------------------------------------------------------------------
// 单词卡
// -----------------------------------------------------------------------------
export async function listWords(filter?: {
  status?: LearnStatus;
  keyword?: string;
  tag?: string;
}): Promise<WordCard[]> {
  const acc = accountId();
  const wheres: string[] = ['account_id = $1', 'is_deleted = 0'];
  const params: unknown[] = [acc];
  let idx = 2;
  if (filter?.status) {
    wheres.push(`status = $${idx++}`);
    params.push(filter.status);
  }
  if (filter?.tag) {
    wheres.push(`tags LIKE $${idx++}`);
    params.push(`%${filter.tag}%`);
  }
  if (filter?.keyword?.trim()) {
    wheres.push(`(word LIKE $${idx} OR meaning LIKE $${idx} OR meaning_context LIKE $${idx})`);
    params.push(`%${filter.keyword.trim()}%`);
    idx++;
  }
  return query<WordCard>(
    `SELECT * FROM word_card WHERE ${wheres.join(' AND ')}
     ORDER BY (CASE WHEN next_review_at IS NULL THEN 1 ELSE 0 END), next_review_at ASC, created_at DESC`,
    params,
  );
}

export async function findWordByText(word: string): Promise<WordCard | null> {
  return queryOne<WordCard>(
    `SELECT * FROM word_card WHERE account_id = $1 AND lower(word) = $2 AND is_deleted = 0 LIMIT 1`,
    [accountId(), word.trim().toLowerCase()],
  );
}

export async function getWord(id: string): Promise<WordCard | null> {
  return queryOne<WordCard>(
    `SELECT * FROM word_card WHERE id = $1 AND account_id = $2 AND is_deleted = 0`,
    [id, accountId()],
  );
}

/**
 * 手动新增一条空白词条到指定位置
 *  - anchor='end'：末尾（当前最大 created_at + 1 分钟）
 *  - anchor='above'/'below'：在参考行的 created_at 前一秒 / 后一秒
 * 用户可以再双击编辑单词内容
 */
export async function insertBlankWord(opts: {
  anchor: 'end' | 'above' | 'below';
  refCreatedAt?: string;
  word?: string;
  kind?: ItemKind; // 决定占位符字数，从而落到对应 Tab
}): Promise<WordCard> {
  const acc = accountId();
  let ts = new Date();
  if (opts.anchor !== 'end' && opts.refCreatedAt) {
    ts = new Date(opts.refCreatedAt);
    // 上方插入：往前 1 秒；下方：往后 1 秒。因为默认排序里是 created_at DESC，这里做反向逻辑：
    //   listWords 是按 next_review_at ASC, created_at DESC 排序，
    //   插入到"上方"（视觉上前面）= created_at 更大 = +1s；
    //   "下方" = created_at 更小 = -1s
    ts.setSeconds(ts.getSeconds() + (opts.anchor === 'above' ? 1 : -1));
  }
  const nowIso = ts.toISOString();
  const id = uuid();
  // 生成默认占位符（视觉/编辑体验用），归类由 item_kind 决定
  const defaultByKind: Record<ItemKind, string> = {
    word: 'newword',
    phrase: 'new phrase',
    sentence: 'A new example sentence here.',
  };
  const kind: ItemKind = opts.kind ?? 'word';
  const wordText = opts.word ?? defaultByKind[kind];
  await exec(
    `INSERT INTO word_card (id, account_id, word, pos, meaning, meaning_context, example, source,
       phonetic_uk, phonetic_us, tags, mastery, next_review_at, interval_days, easiness, review_count,
       status, repetitions, item_kind, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,NULL,NULL,NULL,NULL,'manual',NULL,NULL,NULL,0,$4,1,2.5,0,'new',0,$5,$6,$6,0)`,
    [id, acc, wordText, localDateKey(), kind, nowIso],
  );
  const w = await getWord(id);
  return w!;
}

/** 新建单词卡；若已存在同 word，返回已有并追加语境 */
export async function createOrAppendWord(input: {
  word: string;
  pos?: string | null;
  meaning?: string | null;
  meaning_context?: string | null;
  phonetic_uk?: string | null;
  phonetic_us?: string | null;
  example?: string | null;
  source?: string | null;
  tags?: string | null;
  sentence?: string | null;
  translation?: string | null;
}): Promise<{ word: WordCard; created: boolean }> {
  const existing = await findWordByText(input.word);
  const now = new Date().toISOString();
  if (existing) {
    if (input.sentence) {
      await exec(
        `INSERT INTO word_context (id, account_id, word_id, sentence, translation, source, created_at, is_deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
        [
          uuid(),
          accountId(),
          existing.id,
          input.sentence,
          input.translation ?? null,
          input.source ?? null,
          now,
        ],
      );
    }
    return { word: existing, created: false };
  }
  const acc = accountId();
  const id = uuid();
  const kind = detectKind(input.word);
  await exec(
    `INSERT INTO word_card (id, account_id, word, pos, meaning, meaning_context, example, source,
       phonetic_uk, phonetic_us, tags, mastery, next_review_at, interval_days, easiness, review_count,
       status, repetitions, item_kind, created_at, updated_at, is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,1,2.5,0,'new',0,$13,$14,$14,0)`,
    [
      id,
      acc,
      input.word.trim(),
      input.pos ?? null,
      input.meaning ?? null,
      input.meaning_context ?? input.meaning ?? null,
      input.example ?? null,
      input.source ?? null,
      input.phonetic_uk ?? null,
      input.phonetic_us ?? null,
      input.tags ?? null,
      localDateKey(), // 新收藏当天就进复习
      kind,
      now,
    ],
  );
  if (input.sentence) {
    await exec(
      `INSERT INTO word_context (id, account_id, word_id, sentence, translation, source, created_at, is_deleted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
      [uuid(), acc, id, input.sentence, input.translation ?? null, input.source ?? null, now],
    );
  }
  const w = await getWord(id);
  return { word: w!, created: true };
}

export async function updateWord(id: string, patch: Partial<WordCard>): Promise<void> {
  const allowed = [
    'word',
    'pos',
    'meaning',
    'meaning_context',
    'example',
    'phonetic_uk',
    'phonetic_us',
    'status',
    'tags',
    'notes',
    'item_kind',
    'mastery',
    'next_review_at',
    'interval_days',
    'easiness',
    'review_count',
    'repetitions',
    'last_review_at',
  ] as const;
  const now = new Date().toISOString();
  const setFrag: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const k of allowed) {
    if (k in patch) {
      setFrag.push(`${k} = $${i++}`);
      values.push((patch as any)[k] ?? null);
    }
  }
  setFrag.push(`updated_at = $${i++}`);
  values.push(now);
  values.push(id);
  values.push(accountId());
  await exec(
    `UPDATE word_card SET ${setFrag.join(', ')} WHERE id = $${i} AND account_id = $${i + 1} AND is_deleted = 0`,
    values,
  );
}

/**
 * 使用内置 ECDICT 回填一个英文单词的展示字段。
 * 仅由单词本中用户首次录入或修改单词时调用：离线词典没有命中时不改变原有内容。
 */
export async function fillWordFromOfflineDictionary(
  id: string,
  word: string,
): Promise<OfflineDictionaryEntry | null> {
  const normalized = word.trim();
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(normalized)) return null;
  try {
    const entry = await lookupOfflineDictionary(normalized);
    if (!entry) return null;

    const fields: string[] = [];
    const values: unknown[] = [];
    let index = 1;
    if (entry.translation?.trim()) {
      fields.push(`meaning = $${index++}`, `meaning_context = $${index++}`);
      values.push(entry.translation.trim(), entry.translation.trim());
    }
    if (entry.phonetic?.trim()) {
      fields.push(`phonetic_us = $${index++}`);
      values.push(entry.phonetic.trim());
    }
    if (fields.length) {
      fields.push(`updated_at = $${index++}`);
      values.push(new Date().toISOString());
      values.push(id, accountId());
      await exec(
        `UPDATE word_card SET ${fields.join(', ')} WHERE id = $${index++} AND account_id = $${index}`,
        values,
      );
    }
    return entry;
  } catch (error) {
    // 离线词典未导入或当前不在 Tauri 环境时，仍保留用户刚保存的单词。
    console.warn('[fillWordFromOfflineDictionary] lookup failed:', error);
    return null;
  }
}

export async function softDeleteWords(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  const p = ids.map((_, i) => `$${i + 2}`).join(',');
  await exec(`UPDATE word_card SET is_deleted = 1, updated_at = $1 WHERE id IN (${p})`, [
    now,
    ...ids,
  ]);
}

/**
 * 单词本批量导入：当前标签的词条独立入库，已有相同内容（忽略大小写）的同类词条不会覆盖。
 * 所有有效记录在同一事务内写入，发生数据库异常时整批回滚。
 */
export async function importWordbookCards(items: WordbookImportItem[]): Promise<{ created: number; skipped: number }> {
  if (items.length > 10_000) throw new Error('单次最多导入 10,000 条。');
  const acc = accountId();
  const existing = await query<Pick<WordCard, 'word' | 'item_kind'>>(
    `SELECT word, item_kind FROM word_card WHERE account_id = $1 AND is_deleted = 0`,
    [acc],
  );
  const keys = new Set(existing.map((item) => `${resolveKind(item)}:${item.word.trim().toLocaleLowerCase()}`));
  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  await withTransaction(async () => {
    for (const item of items) {
      const word = item.word.trim();
      const key = `${item.kind}:${word.toLocaleLowerCase()}`;
      if (!word || keys.has(key)) {
        skipped += 1;
        continue;
      }
      const status = item.status ?? 'new';
      const nextReview = item.next_review_at ?? ((status === 'new' || status === 'learning') ? localDateKey() : null);
      await exec(
        `INSERT INTO word_card (id, account_id, word, pos, meaning, meaning_context, example, source,
           phonetic_uk, phonetic_us, tags, notes, mastery, next_review_at, interval_days, easiness, review_count,
           status, repetitions, item_kind, created_at, updated_at, is_deleted)
         VALUES ($1,$2,$3,NULL,$4,$4,NULL,'import',$5,$5,$6,$7,0,$8,1,2.5,0,$9,0,$10,$11,$11,0)`,
        [
          uuid(), acc, word, item.meaning?.trim() || null, item.phonetic?.trim() || null,
          item.tags ?? null, item.notes?.trim() || null, nextReview, status, item.kind, now,
        ],
      );
      keys.add(key);
      created += 1;
    }
  });
  return { created, skipped };
}

/** 按单词文本取消收藏（软删除） */
export async function removeByText(word: string): Promise<boolean> {
  const w = await findWordByText(word);
  if (!w) return false;
  await softDeleteWords([w.id]);
  return true;
}

/** 检查单词是否已收藏 */
export async function isFavored(word: string): Promise<boolean> {
  const w = await findWordByText(word);
  return !!w;
}

/** 统计仪表数据 */
export async function statsWord() {
  const acc = accountId();
  const rows = await query<{ status: string; n: number }>(
    `SELECT status, COUNT(*) as n FROM word_card
     WHERE account_id = $1 AND is_deleted = 0 GROUP BY status`,
    [acc],
  );
  const stats = { total: 0, new: 0, learning: 0, mastered: 0, paused: 0 };
  for (const r of rows) {
    stats.total += r.n;
    (stats as any)[r.status] = r.n;
  }
  return stats;
}

// -----------------------------------------------------------------------------
// 语境
// -----------------------------------------------------------------------------
export async function listContexts(wordId: string): Promise<WordContext[]> {
  return query<WordContext>(
    `SELECT * FROM word_context WHERE word_id = $1 AND is_deleted = 0 ORDER BY created_at DESC`,
    [wordId],
  );
}

// -----------------------------------------------------------------------------
// 每日打卡
// -----------------------------------------------------------------------------
/**
 * INSERT ... ON CONFLICT DO UPDATE 累加当日打卡的某一列
 * 私有工具，被 bumpCheckinReviewed / bumpCheckinNew 复用
 */
async function bumpCheckinColumn(
  col: 'reviewed_count' | 'new_count',
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  const acc = accountId();
  const date = localDateKey();
  const now = new Date().toISOString();
  const reviewed = col === 'reviewed_count' ? delta : 0;
  const newv = col === 'new_count' ? delta : 0;
  await exec(
    `INSERT INTO word_checkin (id, account_id, checkin_date, reviewed_count, new_count, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(account_id, checkin_date) DO UPDATE SET
       reviewed_count = reviewed_count + $4,
       new_count      = new_count      + $5`,
    [uuid(), acc, date, reviewed, newv, now],
  );
}

/** 记录一次「学习动作」（复习 / 听写 evaluation），累加 reviewed_count */
export async function bumpCheckinReviewed(delta = 1): Promise<void> {
  await bumpCheckinColumn('reviewed_count', delta);
}

/** 记录一次「新词首次学习」（status: new → learning），累加 new_count */
export async function bumpCheckinNew(delta = 1): Promise<void> {
  await bumpCheckinColumn('new_count', delta);
}

/** 拉取最近 N 天的打卡记录，按日期升序 */
export async function listRecentCheckin(days = 30): Promise<WordCheckin[]> {
  const acc = accountId();
  return query<WordCheckin>(
    `SELECT * FROM word_checkin
     WHERE account_id = $1 AND checkin_date >= date('now', $2)
     ORDER BY checkin_date ASC`,
    [acc, `-${days - 1} day`],
  );
}

/** 今日打卡记录（可能为 null，代表今天还没学过） */
export async function getTodayCheckin(): Promise<WordCheckin | null> {
  const acc = accountId();
  return queryOne<WordCheckin>(
    `SELECT * FROM word_checkin WHERE account_id = $1 AND checkin_date = $2`,
    [acc, localDateKey()],
  );
}

/**
 * 计算当前"连续打卡天数"
 * 规则：从今天开始向前，遇到第一个没有打卡的日期就停止
 * 如果今天还没打卡，则从"昨天"起算（不打断连续）
 */
export async function currentStreakDays(): Promise<number> {
  // 拿最近 400 天的数据（覆盖一年多），前端算 streak
  const rows = await listRecentCheckin(400);
  const dateSet = new Set(
    rows.filter((r) => r.reviewed_count > 0 || r.new_count > 0).map((r) => r.checkin_date),
  );
  if (dateSet.size === 0) return 0;

  // 从今天开始往前数
  const today = new Date();
  const todayStr = localDateKey();
  const hasToday = dateSet.has(todayStr);

  let streak = 0;
  const cursor = new Date(today);
  if (!hasToday) cursor.setDate(cursor.getDate() - 1);

  for (;;) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const dd = String(cursor.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${dd}`;
    if (!dateSet.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * 本周（周一起算）已新学的词数
 * SQLite 的 strftime('%w') 星期天=0，所以周一 = 1..周日 = 0，需要换算
 */
export async function newWordsThisWeek(): Promise<number> {
  const acc = accountId();
  // 本地时间算出本周一的日期
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const daysFromMonday = (day + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  const mondayStr = `${y}-${m}-${dd}`;

  const row = await queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(new_count), 0) as total FROM word_checkin
     WHERE account_id = $1 AND checkin_date >= $2`,
    [acc, mondayStr],
  );
  return row?.total ?? 0;
}

// -----------------------------------------------------------------------------
// 阅读文档
// -----------------------------------------------------------------------------
export interface ReadDocument {
  id: string;
  account_id: string;
  title: string | null;
  content: string;
  word_count: number;
  words_found: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function countEnglishWords(text: string): number {
  const m = text.match(/[A-Za-z][A-Za-z'-]*/g);
  return m ? m.length : 0;
}

export async function listDocuments(): Promise<ReadDocument[]> {
  const acc = accountId();
  return query<ReadDocument>(
    `SELECT * FROM read_document
     WHERE account_id = $1 AND is_deleted = 0
     ORDER BY updated_at DESC`,
    [acc],
  );
}

export async function getDocument(id: string): Promise<ReadDocument | null> {
  return queryOne<ReadDocument>(`SELECT * FROM read_document WHERE id = $1 AND is_deleted = 0`, [
    id,
  ]);
}

export async function createDocument(input: {
  title?: string | null;
  content: string;
}): Promise<ReadDocument> {
  const acc = accountId();
  const id = uuid();
  const now = new Date().toISOString();
  const wc = countEnglishWords(input.content);
  await exec(
    `INSERT INTO read_document (id, account_id, title, content, word_count, words_found,
       created_at, updated_at, is_deleted)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $6, 0)`,
    [id, acc, input.title?.trim() || null, input.content, wc, now],
  );
  const d = await getDocument(id);
  return d!;
}

export async function updateDocument(
  id: string,
  patch: { title?: string | null; content?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if ('title' in patch) {
    fields.push(`title = $${i++}`);
    params.push(patch.title ?? null);
  }
  if ('content' in patch && typeof patch.content === 'string') {
    fields.push(`content = $${i++}`);
    params.push(patch.content);
    fields.push(`word_count = $${i++}`);
    params.push(countEnglishWords(patch.content));
  }
  fields.push(`updated_at = $${i++}`);
  params.push(now);
  params.push(id);
  await exec(`UPDATE read_document SET ${fields.join(', ')} WHERE id = $${i}`, params);
}

export async function softDeleteDocument(id: string): Promise<void> {
  const now = new Date().toISOString();
  await exec(`UPDATE read_document SET is_deleted = 1, updated_at = $1 WHERE id = $2`, [now, id]);
}

// -----------------------------------------------------------------------------
// 查询历史 / 翻译缓存
// -----------------------------------------------------------------------------
export interface QueryCacheKey {
  query_text: string;
  query_type: 'engine' | 'ai' | 'dict' | string;
  provider_instance_id?: string | null;
  direction?: 'en2zh' | 'zh2en' | null;
}

/** 写入一条翻译历史（同时作为缓存条目） */
export async function insertQueryHistory<T = unknown>(k: QueryCacheKey, result: T): Promise<void> {
  await exec(
    `INSERT INTO query_history (id, account_id, query_text, query_type,
       provider_instance_id, direction, result_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      uuid(),
      accountId(),
      k.query_text,
      k.query_type,
      k.provider_instance_id ?? null,
      k.direction ?? null,
      JSON.stringify(result),
      new Date().toISOString(),
    ],
  );
}

/**
 * 命中缓存返回结果对象，否则 null
 * @param ttlHours 缓存有效期（小时），默认 24
 */
export async function findQueryCache<T = unknown>(
  k: QueryCacheKey,
  ttlHours = 24,
): Promise<T | null> {
  const wheres: string[] = ['account_id = $1', 'query_text = $2', 'query_type = $3'];
  const params: unknown[] = [accountId(), k.query_text, k.query_type];
  let idx = 4;
  if (k.provider_instance_id !== undefined && k.provider_instance_id !== null) {
    wheres.push(`provider_instance_id = $${idx++}`);
    params.push(k.provider_instance_id);
  }
  if (k.direction !== undefined && k.direction !== null) {
    wheres.push(`direction = $${idx++}`);
    params.push(k.direction);
  }
  wheres.push(`created_at >= datetime('now', $${idx++})`);
  params.push(`-${ttlHours} hours`);

  const row = await queryOne<{ result_json: string }>(
    `SELECT result_json FROM query_history
     WHERE ${wheres.join(' AND ')}
     ORDER BY created_at DESC LIMIT 1`,
    params,
  );
  if (!row) return null;
  try {
    return JSON.parse(row.result_json) as T;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// 设置（LLM Key、词典状态等）
// -----------------------------------------------------------------------------
export async function getSetting(scope: string, key: string): Promise<string | null> {
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM setting_kv WHERE scope = $1 AND key = $2`,
    [scope, key],
  );
  return row?.value ?? null;
}
export async function setSetting(scope: string, key: string, value: string) {
  const now = new Date().toISOString();
  await exec(
    `INSERT INTO setting_kv (scope, key, value, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [scope, key, value, now],
  );
}
