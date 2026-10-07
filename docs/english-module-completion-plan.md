# 英语学习模块 · 完成方案与字段设计

> 文档定位：把「英语学习模块目前尚未完成的能力」整理成可直接开工的实现计划。每一项都给到入口页面、数据库字段、DAO 函数、UI 组件、验证点。方便你或后续接手者（含 Codex）按图施工。
>
> 阅读顺序建议：
> 1. 先读第 1 节，明确本次交付的范围边界；
> 2. 再读第 2 节，看整体交付分几批；
> 3. 各批次的具体设计在第 3-8 节。
>
> 相关文档：
> - `english-module-tech-design.md` — 前期整体技术设计（已定型的架构和数据模型）
> - `data-dictionary.md` — 全局字段说明
> - 本文件 — 仅覆盖「剩余功能」的收尾方案

---

## 1. 交付范围界定

### 1.1 已经完成、不再动的部分
- 数据库表结构 v1 + v2 迁移 + `item_kind` 补丁（本次会话已定）
- 单词本 CRUD、三 Tab 归类、多选、软删、行内改状态
- 翻译主页三分区（离线 / 引擎 / AI）、逐词收藏、翻译提供者管理
- SRS 复习页（Space + 1/2/3 + 撤销 + 间隔预览）
- 听写页（听音拼写 / 看中文写英文 + Diff 对比）
- 词条详情、备注、语境列表
- 全局划词提示卡 SelectionTooltip
- 英语设置三分区 + 我的等级
- 离线词典 ecdict 集成（前端只走 Tauri 命令）

### 1.2 本次要收口的部分（按优先级）
| 优先级 | 主题 | 目的 |
| --- | --- | --- |
| P0 | 每日打卡 / 学习记录 | 让今日页的「连续 X 天、本周 Y 词、今日进度」有真实数据 |
| P0 | 错词强化闭环 | 让 MistakesPage 的两个按钮真正进入「只练错词」流 |
| P0 | 听写回写 word_card | 听写正确/错误也影响 mastery、SRS 排期 |
| P1 | 翻译历史缓存 | 相同查询命中缓存，减少 API 调用 |
| P1 | 学习记录页 `/english/records` | 图表化展示每日打卡、评分分布 |
| P1 | 阅读模式 `/english/reading` | 导入短文、点词查、生词收藏 |
| P2 | SRS 自动化状态流转 | 连续 known 到一定次数自动置 mastered |
| P2 | 类型下拉的 seed | `english_type` 参数组的初始值 |
| P2 | v1 冗余翻译代码清理 | 删掉 `translators.ts` 与相关旧 setting_kv |

### 1.3 明确 **不在** 本轮范围
- 知识管理、AI 工具、快捷链接三个模块的开发
- Web 版移植
- 词根词缀 / 生词高亮阅读体验（会单列另一份文档）
- 云同步 / 多设备

---

## 2. 分批次交付计划

| 批次 | 内容 | 依赖 | 影响面 |
| --- | --- | --- | --- |
| 批次 A（P0 核心闭环） | 每日打卡 · 错词强化闭环 · 听写回写 word_card | 无 | 需要一次 schema 增量迁移；不破坏现有 UI |
| 批次 B（P1 提升体验） | 翻译历史缓存 · 学习记录页 · 阅读模式雏形 | 批次 A | 新增 1 个页面 + 1 处路由；重构 TranslatePage 里 useEffect |
| 批次 C（P2 收尾） | SRS 自动流转 · 类型 seed · 清理 v1 | 批次 A/B | 删除文件、静默变更用户没有感知 |

建议按批次串行开发。每批次开发完成必须走一遍第 9 节的验证清单。

---

## 3. 批次 A · 每日打卡 & 学习记录基座

### 3.1 目标
让「首页 EnglishTodayPage 顶部欢迎栏 / 进度环」有真实数据可显示。同时为将来「学习记录页」提供可查询的日度维度。

### 3.2 触发点（写入路径）
覆盖三处产生「学习行为」的地方：

| 事件 | 触发位置 | 写入含义 |
| --- | --- | --- |
| SRS 完成一次评分（unknown/vague/known） | `srs-dao.ts::rateWord` 完成后 | `reviewed_count += 1` |
| 听写完成一次作答（correct 或 wrong 均计） | `srs-dao.ts::logDictation` 完成后 | `reviewed_count += 1` |
| 新词首次进入 `learning`（`status=new → learning`） | `rateWord` 里 CASE WHEN 触发处 | `new_count += 1` |

### 3.3 数据库字段

已有表 `word_checkin`（schema.sql:278）字段够用，暂不需要新增列：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID |
| account_id | TEXT | 多账号隔离 |
| checkin_date | TEXT | `YYYY-MM-DD`，本地日期 |
| reviewed_count | INTEGER | 当日"完成的学习动作"总数（复习 + 听写） |
| new_count | INTEGER | 当日"从 new → learning"的新词数 |
| created_at | TEXT | 首次生成该日打卡的时间戳 |

唯一索引 `(account_id, checkin_date)` 已存在（schema.sql:284）。

### 3.4 新增 DAO 函数

在 `src/db/english-dao.ts` 底部新增 `checkin` 分区，暴露以下函数：

```ts
/** 记录一次"学习动作"（复习/听写 evaluation），累加 reviewed_count */
export async function bumpCheckinReviewed(delta = 1): Promise<void>;

/** 记录一次"新词首次学习"，累加 new_count */
export async function bumpCheckinNew(delta = 1): Promise<void>;

/** 拉取"最近 N 天"的打卡序列，用于图表 / 连续天数计算 */
export async function listRecentCheckin(days = 30): Promise<WordCheckin[]>;

/** 计算当前"连续打卡天数"（今天有打卡开始向前连续计） */
export async function currentStreakDays(): Promise<number>;

/** 计算"本周（周一起算）已学新词数" */
export async function newWordsThisWeek(): Promise<number>;
```

实现要点：
- `bumpCheckinReviewed`/`bumpCheckinNew` 使用 `INSERT ... ON CONFLICT(account_id, checkin_date) DO UPDATE SET ... = ... + $delta`，一句 SQL 搞定「无则新建、有则累加」。
- 日期取 `new Date().toISOString().slice(0, 10)`，与项目已有约定一致。
- `currentStreakDays` 用 `WITH RECURSIVE` 或直接前端遍历 30 天序列（数据量小，前端计算更简单）。
- 索引：已有 `uq_checkin`，无须新加。

### 3.5 调用点接入

1. `srs-dao.ts::rateWord`（在 `applySrs` 之后、`INSERT srs_review_log` 之后）：
   ```ts
   await bumpCheckinReviewed(1);
   if (wasNewBefore && nextStatus === 'learning') {
     await bumpCheckinNew(1);
   }
   ```
   `wasNewBefore` 是 rateWord 已读到的 `card.status === 'new'` 判断结果。

2. `srs-dao.ts::logDictation` 末尾：
   ```ts
   await bumpCheckinReviewed(1);
   ```

### 3.6 UI 消费

改 `EnglishTodayPage.tsx`：
- 顶部欢迎行改为动态：
  ```ts
  const [streak, setStreak] = useState(0);
  const [weekNew, setWeekNew] = useState(0);
  const [today, setToday] = useState<WordCheckin | null>(null);
  ```
  三个数字分别来自 `currentStreakDays / newWordsThisWeek / listRecentCheckin(1)[0]`。
- `doneToday`：改为 `today?.reviewed_count ?? 0`；删除 `// TODO: M2 补` 注释。
- 进度环百分比：`(doneToday / dailyGoal) * 100`，`dailyGoal` 读 `setting_kv('app','english.daily_goal')`，缺省 20。

### 3.7 验证
- 从没做过任何复习/听写的账号，首页显示"连续 0 天 · 本周 0 词"。
- 完成一次 SRS 评分后，首页立刻显示"连续 1 天 · 今日 1"。
- 跨天再做一次，"连续 2 天"。中间空一天再做，"连续 1 天"。

---

## 4. 批次 A · 错词强化闭环

### 4.1 目标
让 `MistakesPage` 的两个按钮跳转过去后，**只练错词**，而不是跟主复习池一样。

### 4.2 现状
- `MistakesPage.tsx:46,50` 已经在 URL 里塞 `?mode=mistakes`
- `SrsReviewPage.tsx` / `DictationPage.tsx` 都用 `useSearchParams` 就能读到，但目前**未读**
- `srs-dao.ts::listMistakes` 已经能返回近 14 天错词

### 4.3 需要的改动

`srs-dao.ts` 层面无变动，已有 `listMistakes(limit)`。

`SrsReviewPage.tsx`：

```ts
const [params] = useSearchParams();
const mode = params.get('mode'); // null | 'mistakes'

useEffect(() => {
  (async () => {
    const rows = mode === 'mistakes'
      ? await listMistakes(30)
      : await listDueForReview(40);
    setQueue(rows);
  })();
}, [mode]);
```

页面顶部 badge：`mode==='mistakes'` 时显示「错词强化模式」小标签，颜色 warn，让用户明确当前是特殊队列。

`DictationPage.tsx` 同理：

```ts
const rows = mode === 'mistakes'
  ? await listMistakes(20)
  : await listDueForDictation(20);
```

### 4.4 完成态

进入错词强化流程后：
- 全部答完 → 显示「本轮错词已重刷一遍」→ 跳回 `/english/practice/mistakes`
- 主流程则维持原来「跳回今日页」

### 4.5 验证
- 错词页两个按钮跳转，SrsReviewPage 顶部出现"错词强化"badge。
- 完成 3 个错词后，MistakesPage 的错词表少了这 3 条（因为最近有 known 评分，`listMistakes` SQL 天然不再包含）。

---

## 5. 批次 A · 听写回写 word_card

### 5.1 目标
听写正确 / 错误也影响单词的 SRS 状态。而不是像现在只写日志、词条排期完全不动。

### 5.2 逻辑
- 听写正确 → 视同一次 `known` 的评分（q=5）
- 听写错误 → 视同一次 `unknown` 的评分（q=0）

好处：MistakesPage 的错词池能同步反映听写错的词；用户复习一遍就能把听写错的重新排到明天。

### 5.3 DAO 改动
`srs-dao.ts::logDictation` 现签名：
```ts
export async function logDictation(wordId, mode, userInput, correct)
```
末尾追加一次 `rateWord`：

```ts
await logDictationLogOnly(wordId, mode, userInput, correct);
await rateWord(wordId, correct ? 'known' : 'unknown');
```

拆一个私有函数 `logDictationLogOnly` 保留原「只写日志」能力，避免 rateWord 里再调用 logDictation 造成循环。

### 5.4 副作用与规避
- `rateWord` 会写 `srs_review_log`，这样一次听写会同时产生 `dictation_log` 和 `srs_review_log` 两条记录 —— 这是有意的。学习记录页可以分开展示。
- `bumpCheckinReviewed` 只在 rateWord 中调一次，不会因为「一次听写触发一次 rateWord」而重复计（因为 logDictation 已经调过一次）。因此 rateWord 需要一个可选参数 `skipCheckin=false` 来避免重复：

```ts
export async function rateWord(wordId: string, rating: Rating, opts?: { skipCheckin?: boolean }) { ... }
// logDictation 的调用：
await rateWord(wordId, correct ? 'known' : 'unknown', { skipCheckin: true });
```

### 5.5 验证
- 听写错 5 个词，去错词页应看到这 5 个词。
- 听写正确一个此前的错词，24 小时后再打开错词页，该词消失（`listMistakes` 是"最近 14 天且最后一次为 unknown 或 correct=0"的条件？—— 实际 SQL 应改为「最近 14 天出现过 unknown 且**不存在**更近的 known」，这条 SQL 一起在批次 A 里修）。
- 日历打卡：一次听写只算一次 reviewed_count，不会 double。

---

## 6. 批次 B · 翻译历史缓存

### 6.1 现状
`insertQueryHistory / findQueryCache` 已经写好，但 `TranslatePage.tsx` 完全没调。每次翻译都发引擎/AI 请求。

### 6.2 设计原则
- 只对**引擎翻译 & AI 翻译**做缓存；离线翻译无成本，不缓存。
- 缓存粒度：`(query_text, query_type, provider_instance_id, direction)` 四元组。
- 缓存时效：24 小时（同一个词一天内多次查询，直接命中）。
- 用户点"强制刷新"按钮，可绕过缓存。

### 6.3 数据库调整
`query_history` 表现有字段（schema.sql:473）：`id / account_id / query_text / query_type / result_json / created_at`。

需要新增字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| provider_instance_id | TEXT | 记录来自哪个引擎/AI 实例 |
| direction | TEXT | `en2zh` / `zh2en` |

对应的 ALTER TABLE 迁移在 `client.ts` 追加一个新 migration（类似 word_card 的做法，靠 PRAGMA table_info 判断）。

### 6.4 DAO 调整

```ts
export interface QueryCacheKey {
  query_text: string;
  query_type: 'engine' | 'ai';
  provider_instance_id: string;
  direction: 'en2zh' | 'zh2en';
}

export async function findQueryCache(k: QueryCacheKey, ttlHours = 24): Promise<TranslationCard | null>;
export async function insertQueryHistory(k: QueryCacheKey, card: TranslationCard): Promise<void>;
```

`findQueryCache` SQL 里加 `AND created_at >= datetime('now', '-24 hours')`。

### 6.5 TranslatePage 接入
`runTranslate` 里对每个实例：
```ts
const cached = await findQueryCache({ query_text, query_type, provider_instance_id, direction });
if (cached && !forceRefresh) return cached;
const fresh = await callProvider(...);
await insertQueryHistory({ ... }, fresh);
return fresh;
```

顶部"翻译"按钮旁加一个 🔄 按钮 = 强制刷新。

### 6.6 验证
- 翻译同一个句子两次，第二次瞬间返回（DevTools Network 无请求）。
- 点强制刷新，看到重新请求发出。
- 24 小时后自动过期。

---

## 7. 批次 B · 学习记录页 `/english/records`

### 7.1 目标
把 `router.tsx:57` 那个 `<div>学习记录 · M3 阶段实现</div>` 换成真正的页面。

### 7.2 页面结构

```
+----------------------------------------------------+
| 学习记录                                            |
| [近 7 天 / 近 30 天 / 全部]   [导出 CSV]           |
+----------------------------------------------------+
| 打卡热力图（GitHub 风格 · 12 周 × 7）              |
+----------------------------------------------------+
| 每日复习趋势折线（reviewed / new 双线）             |
+----------------------------------------------------+
| SRS 评分分布饼图（unknown / vague / known）        |
+----------------------------------------------------+
| 最近 20 条学习记录时间线                            |
|   · 2026-09-25 14:32  复习 "abandon" → known       |
|   · 2026-09-25 14:31  听写 "elicit" → 错误         |
+----------------------------------------------------+
```

### 7.3 数据来源

| 图表 | 数据源 | 查询 |
| --- | --- | --- |
| 热力图 | `word_checkin` | `SELECT checkin_date, reviewed_count FROM word_checkin WHERE account_id=? AND checkin_date >= date('now','-84 day') ORDER BY checkin_date` |
| 折线图 | `word_checkin` | 同上加 `new_count` |
| 饼图 | `srs_review_log` | `SELECT rating, COUNT(*) FROM srs_review_log WHERE ... GROUP BY rating` |
| 时间线 | `srs_review_log` + `dictation_log` UNION | 各取 20 条按 created_at DESC |

### 7.4 组件设计
- `EnglishRecordsPage.tsx` 主页
- 热力图和折线用 Recharts；饼图同（项目已经在 dashboard 用了 Recharts，无新增依赖）
- 时间线用现成的 `card` 样式，图标区分「复习」和「听写」

### 7.5 DAO 新增

```ts
// 在 srs-dao.ts
export async function statsReviewByRating(fromDate: string): Promise<{ rating: string; n: number }[]>;
export async function listRecentActivities(limit = 20): Promise<Activity[]>;

interface Activity {
  kind: 'srs' | 'dictation';
  word: string;
  word_id: string;
  detail: string; // "known" | "unknown" | "correct" | "wrong"
  created_at: string;
}
```

### 7.6 验证
- 打卡 3 天后，热力图有 3 个绿格。
- 折线图能看到 reviewed 每天的数字。
- 饼图三个扇区加起来 = 日志总数。
- 时间线点每一行能跳到词详情。

---

## 8. 批次 B · 阅读模式雏形 `/english/reading`

### 8.1 目标
提供最小可用的「英文短文阅读 + 点词查」体验。不做生词高亮、不做 Anki 导入这些复杂功能。

### 8.2 数据库

`read_document` 表（schema.sql:485）已经建好，字段：
- `id / account_id / title / content / source_url / word_count / created_at / updated_at / is_deleted`

DAO 需要在 `english-dao.ts` 新增：

```ts
export interface ReadDocument { ... }
export async function listDocuments(): Promise<ReadDocument[]>;
export async function createDocument(input: { title: string; content: string; source_url?: string }): Promise<ReadDocument>;
export async function getDocument(id: string): Promise<ReadDocument | null>;
export async function softDeleteDocument(id: string): Promise<void>;
```

### 8.3 页面

```
/english/reading                # 文档列表
/english/reading/:id            # 单文档阅读
```

列表页：卡片网格，每张卡片显示标题、字数、创建时间、"打开"按钮。

阅读页：
- 左侧：文档正文（用 `<div>` 渲染，段落 `<p>`）
- 右侧：一个空的划词卡容器（复用现有 SelectionTooltip）
- 顶部：文档标题、字数、"删除"按钮

点词查复用现有 `SelectionTooltip`：选中英文单词 → 弹卡 → "收藏"按钮 → 走 `createOrAppendWord` 并把当前段落作为 `sentence` 存到 `word_context.source_ref='reading:{doc_id}'`。

### 8.4 新建文档

列表页顶部按钮："粘贴文本创建"（打开一个 Modal，textarea + 标题输入）。

后续扩展点：从 URL 抓取正文（放到批次 C 或以后）。

### 8.5 验证
- 粘贴一段英文，创建文档，标题、字数正确。
- 打开文档，选中一个单词 → 弹卡 → 收藏 → 到单词本能看到，"来源"字段显示 `reading:{title 前 20 字}`。
- 删除文档，列表不再显示；单词本已收藏的词不受影响。

---

## 9. 批次 C · P2 收尾项

### 9.1 SRS 自动流转到 mastered

**当前**：状态从 `learning → mastered` 只能手动点。
**目标**：连续 3 次评 known 且 `interval_days >= 21` 时，自动置 `mastered`。

改动点：`srs-dao.ts::rateWord` 里在写完 `word_card` 之后追加：
```ts
if (rating === 'known' && card.repetitions >= 3 && interval >= 21) {
  await exec(`UPDATE word_card SET status='mastered' WHERE id=$1`, [wordId]);
}
```

阈值可以从 setting_kv 读，缺省 (3, 21)。设置页新增两个 input。

### 9.2 english_type 参数组的 seed

`WordbookPage.tsx:63` 已经会拉 `param_option` 里 `group='english_type'` 的选项，但仓库没有 seed。

需要在 `schema/seed.sql` 追加：

```sql
INSERT OR IGNORE INTO param_group (id, name, description) VALUES
  ('english_type', '英语类型', '单词本的自定义分类');
INSERT OR IGNORE INTO param_option (id, group_id, name, color, seq_no) VALUES
  ('en_type_general',  'english_type', '通用词汇', '#2E5BFF', 1),
  ('en_type_business', 'english_type', '商务英语', '#8B5CF6', 2),
  ('en_type_academic', 'english_type', '学术词汇', '#EF4444', 3),
  ('en_type_daily',    'english_type', '日常口语', '#10B981', 4),
  ('en_type_tech',     'english_type', '科技/IT', '#F59E0B', 5);
```

`seed.sql` 的执行由 `ensureSchema` 或首次登录时触发（需要确认现在项目里 seed 的执行入口在哪；如果没有，加一段"账号首次创建时执行 seed 到该账号"的逻辑，或者直接把 `param_option` 改成"跨账号共享"）。

### 9.3 清理 v1 冗余翻译代码

删除：
- `src/lib/translators.ts` 整个文件
- `setting_kv` 中所有 `english.baidu_appid / secret / deepl_key / engine_llm / engine_baidu / engine_deepl / llm_provider / llm_key / llm_model / llm_base` —— 用一段 migration SQL 一次性清理
- 检查是否有引用 `translators.ts` 的地方（应该只有一些死代码 import）

### 9.4 SelectionTooltip 支持短语查询
现在只能识别单个词（`SelectionTooltip.tsx:41` 的正则 `/^[A-Za-z\-']+$/`）。
改为：允许 2-4 个词的短语，走 `ecdict_lookup` 逐词查 + 展示。（可选，若时间紧可推到 P3）

---

## 10. 数据库迁移汇总

本次交付需要一次增量迁移，集中在 `client.ts::migrateWordCardV2` 之后追加一个 `migrateEnglishV3` 函数：

```ts
async function migrateEnglishV3(db: Database) {
  // 1. query_history 新增字段
  const cols = await db.select<{name:string}[]>(`PRAGMA table_info(query_history)`);
  const has = new Set(cols.map(c => c.name));
  if (!has.has('provider_instance_id')) {
    await db.execute(`ALTER TABLE query_history ADD COLUMN provider_instance_id TEXT`);
  }
  if (!has.has('direction')) {
    await db.execute(`ALTER TABLE query_history ADD COLUMN direction TEXT`);
  }
  // 2. 清理 v1 冗余 setting_kv
  const legacyKeys = [
    'english.llm_provider','english.llm_key','english.llm_model','english.llm_base',
    'english.baidu_appid','english.baidu_secret','english.deepl_key',
    'english.engine_llm','english.engine_baidu','english.engine_deepl',
  ];
  for (const k of legacyKeys) {
    await db.execute(`DELETE FROM setting_kv WHERE scope='app' AND key=$1`, [k]);
  }
  // 3. english_type seed（幂等）
  await db.execute(`INSERT OR IGNORE INTO param_group ...`);
  await db.execute(`INSERT OR IGNORE INTO param_option ...`);
}
```

在 `ensureSchema` 末尾调用 `await migrateEnglishV3(_db)`。

---

## 11. 开发验证清单（每批次开发完必过）

### 11.1 批次 A 验证
- [ ] 完成 1 次 SRS 评分，`word_checkin` 表出现今天的行
- [ ] 首页顶部数字 = 真实计数（不再是 0）
- [ ] MistakesPage 两个按钮跳转后，页面 badge 显示"错词强化"
- [ ] 听写错 3 个词，去错词页能看到这 3 个
- [ ] `srs_review_log`、`dictation_log`、`word_checkin` 三张表都有对应记录
- [ ] 跨天场景：连续 3 天各评一次 → 首页显示"连续 3 天"

### 11.2 批次 B 验证
- [ ] 翻译"apple"两次，第二次不发起网络请求
- [ ] 强制刷新按钮生效
- [ ] `/english/records` 打开无报错，四个图能显示
- [ ] `/english/reading` 能创建文档、能划词收藏

### 11.3 批次 C 验证
- [ ] 一个词连续评 3 次 known 后 status 自动变 `mastered`
- [ ] 单词本类型下拉能选到"通用/商务/学术/日常/科技"5 个默认值
- [ ] `setting_kv` 表里已无 v1 遗留 key
- [ ] 全项目 grep `translators.ts` 无引用，文件已删

---

## 12. 时间估算

按一人开发估算：
- 批次 A：1.5 - 2 天
- 批次 B：2 - 3 天
- 批次 C：0.5 天

总计约 4 - 5.5 天。可以拆到两周内穿插进行。

---

## 13. 变更文件清单（预览）

批次 A 需要动的文件：
- `src/db/english-dao.ts` — 加 checkin 分区（约 60 行）
- `src/db/srs-dao.ts` — rateWord/logDictation 追加打卡；logDictation 联动 rateWord
- `src/db/client.ts` — 无需改（word_checkin 表已存在）
- `src/modules/english/EnglishTodayPage.tsx` — 顶部数字接入
- `src/modules/english/SrsReviewPage.tsx` — mode=mistakes 分支
- `src/modules/english/DictationPage.tsx` — mode=mistakes 分支

批次 B 新增/改动文件：
- `src/db/client.ts` — 加 migrateEnglishV3
- `src/db/english-dao.ts` — findQueryCache/insertQueryHistory 签名调整
- `src/modules/english/TranslatePage.tsx` — 缓存接入 + 刷新按钮
- **新增** `src/modules/english/EnglishRecordsPage.tsx`
- **新增** `src/modules/english/EnglishReadingPage.tsx`（列表）
- **新增** `src/modules/english/ReadingDocumentPage.tsx`（详情）
- `src/app/router.tsx` — 移除占位 div，挂真页面

批次 C：
- 删除 `src/lib/translators.ts`
- `schema/seed.sql` — 追加 english_type 组

---

## 14. 风险与备注

1. **schema 迁移风险**：新增列不影响存量数据，仅担心 `PRAGMA table_info` 在极旧版本 SQLite 上的差异。项目用 Tauri plugin-sql 打包的是较新 sqlite，无需担心。
2. **rateWord 与 logDictation 相互调用**：必须小心循环调用，方案 5.3 里用 `skipCheckin` flag 拆开。
3. **参数组 seed 时机**：`param_option` 若是 account 级，需要在"创建账号"流程里也执行 seed 一次；若是全局共享，migrate 时执行即可。这一处需要在开发时**先确认 param_option 的 account 归属再决定**。
4. **听写视为 SRS 评分的语义**：这是产品决策，如果你不希望"听写错也影响 SRS 排期"，可以把 5.3 的联动改成开关（setting_kv 存 `english.dictation_affects_srs`）。

---

*文档版本：v1 · 2026-09-25*
*作者：Claude · 基于本次会话对英语模块的完整盘点*

