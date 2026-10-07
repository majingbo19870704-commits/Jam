// =============================================================================
// db/srs-dao.ts · SRS 相关的查询、评分、错词判定
// =============================================================================
import { v4 as uuid } from 'uuid';
import { exec, query, queryOne } from './client';
import { useAccountStore } from '@/stores/account';
import { applySrs, type Rating, type SrsState } from '@/lib/srs';
import { localDateKey } from '@/lib/local-date';
import { bumpCheckinReviewed, bumpCheckinNew, getSetting, type WordCard } from './english-dao';

function accountId(): string {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

function todayStr(): string {
  return localDateKey();
}

/**
 * 今日待复习的词：
 *  - status ∈ (new, learning)
 *  - 且 next_review_at 为空 或 ≤ 今天
 *  - 新收藏的词（status = new）无论 next_review_at 是什么日期都算今日待复习
 */
export async function listDueForReview(limit = 40): Promise<WordCard[]> {
  const acc = accountId();
  const today = todayStr();
  return query<WordCard>(
    `SELECT * FROM word_card
     WHERE account_id = $1 AND is_deleted = 0
       AND status IN ('new', 'learning')
       AND (
         status = 'new'
         OR next_review_at IS NULL
         OR next_review_at <= $2
       )
     ORDER BY (CASE WHEN next_review_at IS NULL THEN 1 ELSE 0 END),
              next_review_at ASC, created_at ASC
     LIMIT $3`,
    [acc, today, limit],
  );
}

/** 待听写：与 SRS 相同池子，可选 */
export async function listDueForDictation(limit = 20): Promise<WordCard[]> {
  return listDueForReview(limit);
}

/** 错词：最近一次 SRS 有 unknown，或最近听写错误 */
export async function listMistakes(limit = 30): Promise<WordCard[]> {
  const acc = accountId();
  return query<WordCard>(
    `SELECT DISTINCT w.* FROM word_card w
     WHERE w.account_id = $1 AND w.is_deleted = 0
       AND w.status IN ('new', 'learning')
       AND (
         EXISTS (SELECT 1 FROM srs_review_log l
                 WHERE l.word_id = w.id AND l.rating = 'unknown'
                 AND l.reviewed_at >= datetime('now', '-14 days'))
         OR
         EXISTS (SELECT 1 FROM dictation_log d
                 WHERE d.word_id = w.id AND d.correct = 0
                 AND d.answered_at >= datetime('now', '-14 days'))
       )
     ORDER BY w.updated_at DESC
     LIMIT $2`,
    [acc, limit],
  );
}

/** 统计概览：今日待复习/听写/错词数 */
export async function statsDue() {
  const [due, mistakes] = await Promise.all([listDueForReview(999), listMistakes(999)]);
  return { review: due.length, dictation: due.length, mistakes: mistakes.length };
}

/**
 * 应用一次 SRS 评分
 *
 * @param opts.skipCheckin  为 true 时不做 word_checkin 累加；
 *                          用于「听写日志已经累加过 reviewed_count」的场景，避免重复计。
 */
export async function rateWord(
  wordId: string,
  rating: Rating,
  opts?: { skipCheckin?: boolean },
): Promise<void> {
  const row = await queryOne<WordCard>(`SELECT * FROM word_card WHERE id = $1`, [wordId]);
  if (!row) return;
  const wasNew = row.status === 'new';
  const prev: SrsState = {
    ease: row.easiness ?? 2.5,
    interval_days: row.interval_days ?? 1,
    repetitions: row.repetitions ?? 0,
  };
  const next = applySrs(prev, rating);
  const now = new Date().toISOString();

  await exec(
    `UPDATE word_card SET
       easiness = $1, interval_days = $2, repetitions = $3,
       next_review_at = $4, last_review_at = $5, review_count = review_count + 1,
       status = CASE WHEN status = 'new' THEN 'learning' ELSE status END,
       updated_at = $5
     WHERE id = $6`,
    [next.ease, next.interval_days, next.repetitions, next.nextReviewDate, now, wordId],
  );

  await exec(
    `INSERT INTO srs_review_log (id, account_id, word_id, rating,
       interval_before, interval_after, ease_before, ease_after, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [uuid(), accountId(), wordId, rating,
      prev.interval_days, next.interval_days,
      prev.ease, next.ease, now],
  );

  // 自动置 mastered：仅当本次评 known、重复次数与间隔均达阈值
  if (rating === 'known') {
    try {
      const [repThresholdStr, intThresholdStr] = await Promise.all([
        getSetting('app', 'english.master_min_reps'),
        getSetting('app', 'english.master_min_interval'),
      ]);
      const repThreshold = parseInt(repThresholdStr || '3', 10);
      const intThreshold = parseInt(intThresholdStr || '21', 10);
      if (next.repetitions >= repThreshold && next.interval_days >= intThreshold) {
        await exec(
          `UPDATE word_card SET status = 'mastered', updated_at = $1
           WHERE id = $2 AND status != 'mastered'`,
          [now, wordId],
        );
      }
    } catch (e) {
      console.warn('[rateWord] auto-mastered check failed:', e);
    }
  }

  // 打卡累加：默认累加；来自 logDictation 的调用需 skipCheckin 避免与听写自身的 reviewed 计数重复
  if (!opts?.skipCheckin) {
    try {
      await bumpCheckinReviewed(1);
      if (wasNew) await bumpCheckinNew(1);
    } catch (e) {
      // 打卡失败不影响核心 SRS 流程
      console.warn('[rateWord] bump checkin failed:', e);
    }
  } else if (wasNew) {
    // skipCheckin 只跳过 reviewed 那部分（因为调用方已计），new_count 仍要计
    try { await bumpCheckinNew(1); } catch (e) { console.warn('[rateWord] bump new failed:', e); }
  }
}

/** 撤销上一次评分：从日志表读上一次，恢复 word_card 状态；仅撤销最近一次 */
export async function undoLastRating(wordId: string): Promise<void> {
  const last = await queryOne<{
    id: string; interval_before: number; ease_before: number;
  }>(`SELECT id, interval_before, ease_before FROM srs_review_log
      WHERE word_id = $1 AND account_id = $2
      ORDER BY reviewed_at DESC LIMIT 1`,
     [wordId, accountId()]);
  if (!last) return;
  await exec(
    `UPDATE word_card SET interval_days = $1, easiness = $2,
       review_count = MAX(0, review_count - 1)
     WHERE id = $3`,
    [last.interval_before, last.ease_before, wordId],
  );
  await exec(`DELETE FROM srs_review_log WHERE id = $1`, [last.id]);
}

/**
 * 学习记录页专用：统计 SRS 评分分布
 * @param fromDate  形如 '2026-09-01'（含起，闭区间）；不传则不限起点
 */
export async function statsReviewByRating(fromDate?: string): Promise<Array<{ rating: string; n: number }>> {
  const acc = accountId();
  const params: unknown[] = [acc];
  let where = 'account_id = $1';
  if (fromDate) {
    params.push(fromDate);
    where += ' AND reviewed_at >= $2';
  }
  return query<{ rating: string; n: number }>(
    `SELECT rating, COUNT(*) as n FROM srs_review_log
     WHERE ${where} GROUP BY rating`,
    params,
  );
}

/**
 * 学习记录页专用：混合时间线（复习 + 听写），按 created_at DESC 合并
 */
export interface Activity {
  kind: 'srs' | 'dictation';
  word_id: string;
  word: string;
  detail: string;      // srs: 'unknown'|'vague'|'known'  dictation: 'correct'|'wrong'
  created_at: string;
}

export async function listRecentActivities(limit = 20): Promise<Activity[]> {
  const acc = accountId();
  const rows = await query<{
    kind: 'srs' | 'dictation';
    word_id: string;
    word: string;
    detail: string;
    created_at: string;
  }>(
    `SELECT * FROM (
       SELECT 'srs' as kind, l.word_id, w.word, l.rating as detail, l.reviewed_at as created_at
       FROM srs_review_log l JOIN word_card w ON w.id = l.word_id
       WHERE l.account_id = $1
       UNION ALL
       SELECT 'dictation' as kind, d.word_id, w.word,
              CASE WHEN d.correct = 1 THEN 'correct' ELSE 'wrong' END as detail,
              d.answered_at as created_at
       FROM dictation_log d JOIN word_card w ON w.id = d.word_id
       WHERE d.account_id = $1
     ) t
     ORDER BY created_at DESC
     LIMIT $2`,
    [acc, limit],
  );
  return rows;
}

/**
 * 记录一次听写：
 *  1. 写 dictation_log
 *  2. 打卡 reviewed_count +1
 *  3. 联动 SRS 评分：correct → 'known'，wrong → 'unknown'
 *     rateWord 用 skipCheckin=true，避免 reviewed_count 被计两次
 */
export async function logDictation(
  wordId: string,
  mode: 'listen_spell' | 'cn2en',
  userInput: string,
  correct: boolean,
) {
  await exec(
    `INSERT INTO dictation_log (id, account_id, word_id, mode, user_input, correct, answered_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [uuid(), accountId(), wordId, mode, userInput, correct ? 1 : 0, new Date().toISOString()],
  );

  try {
    await bumpCheckinReviewed(1);
  } catch (e) {
    console.warn('[logDictation] bump checkin failed:', e);
  }

  try {
    await rateWord(wordId, correct ? 'known' : 'unknown', { skipCheckin: true });
  } catch (e) {
    console.warn('[logDictation] rateWord failed:', e);
  }
}
