# 英语学习模块 · 技术设计文档 v1.0

> 与《个人工作站 · 英语学习模块功能规划方案 v3》配套。前者定义 What / Why，本文档定义 How。
> 版本：v1.0（2026-09-25）

---

## 一、总体架构

英语学习模块完全嵌入个人工作站（Tauri + React + SQLite），不引入独立进程或新的存储层。

```
┌─────────────────────────────────────────────────────────┐
│  React UI（Tauri WebView）                              │
│  · 今日学习 / 翻译 / 单词本 / 练习 / 阅读 / 学习记录     │
└──────┬──────────────────────────┬───────────────────────┘
       │                          │
       ▼                          ▼
┌──────────────────┐    ┌─────────────────────────────┐
│  本地 SQLite     │    │  Tauri Rust Command 层      │
│  · dict_ecdict   │    │  · translate_by_llm         │
│  · word_card     │    │  · dict_lookup              │
│  · word_context  │    │  · tts_speak (WebSpeech)    │
│  · srs_review_*  │    │  · store_api_key            │
│  ...             │    └──────────┬──────────────────┘
└──────────────────┘               │
                                   ▼
                          ┌──────────────────┐
                          │  外部 LLM API    │
                          │ (DeepSeek/Claude)│
                          └──────────────────┘
```

**关键决策**：
- 单词查询 **首选本地 ECDICT 词典**（离线、免费、快速）
- 句子翻译 / 语境释义 **走 LLM API**（用户在设置里填 Key）
- TTS 发音 **首选浏览器 Web Speech API**（免费、内置），需要更好音质可切换 Azure/Google TTS（V1.3）
- 跟读（Speech Recognition）**降级到 V1.3+**，V1.0-1.2 不做

---

## 二、数据模型

### 2.1 词典表（全局共享，不带 account_id）

**`dict_ecdict`** —— ECDICT 词典（首次启动时导入）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 自增 |
| word | TEXT NOT NULL | 单词 |
| phonetic | TEXT | 音标 |
| definition | TEXT | 英文释义 |
| translation | TEXT | 中文释义（多义用 \n 分隔）|
| pos | TEXT | 词性简写 |
| collins | INTEGER | Collins 星级 1-5 |
| oxford | INTEGER | 是否牛津 3000 |
| tag | TEXT | 分级标签（cet4/cet6/gre/ielts…）|
| bnc | INTEGER | BNC 词频排名 |
| frq | INTEGER | COCA 词频排名 |
| exchange | TEXT | 词形变换（p:过去式/d:过去分词/…）|

**索引**：`UNIQUE(word)`、`INDEX(tag)`、`INDEX(frq)`

**数据来源**：<https://github.com/skywind3000/ECDICT> 的 `ecdict.csv`（约 60MB / 900万词条）
- 应用首次启动时不导入
- 用户在「设置 → 英语学习 → 词典管理」点「下载并导入」触发
- 后台异步导入，用户可以看到进度条

### 2.2 业务表（账号隔离）

**`word_card`** —— 已在 schema v1.0 中；这一版扩展字段

| 字段 | 变更 | 说明 |
|---|---|---|
| id / account_id / word / pos / meaning / example / source / mastery / created_at | 已有 | - |
| **phonetic_uk** | 新增 | 英式音标 |
| **phonetic_us** | 新增 | 美式音标 |
| **meaning_context** | 新增 | 当前语境义（不同于 dict 的字典义）|
| **status** | 新增 | new / learning / mastered / paused |
| **tags** | 已有 | 逗号分隔的标签 |
| **notes** | 新增 | 用户备注 |
| **ease / interval_days / repetitions** | 扩展/新增 | SM-2 算法参数 |
| **last_review_at** | 新增 | 上次复习时间 |
| **next_review_at** | 已有 | 下次复习时间（保留）|

**`word_context`** —— 一个词的多个语境（多语境场景）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| account_id | TEXT FK | - |
| word_id | TEXT FK | 指向 word_card.id |
| sentence | TEXT | 语境句 |
| translation | TEXT | 该语境下的翻译 |
| source | TEXT | 来源（翻译 / 阅读 / 手动）|
| source_ref | TEXT | 关联的阅读文档 id 或翻译 query 记录 |
| created_at | TEXT | - |
| is_deleted | INTEGER | - |

**`sentence_bookmark`** —— 句子收藏

| 字段 | 类型 | 说明 |
|---|---|---|
| id / account_id | - | - |
| original | TEXT | 英文原句 |
| translation | TEXT | 中文译文 |
| alt_translations | TEXT | 其他表达（JSON 数组）|
| tags | TEXT | - |
| notes | TEXT | - |
| source | TEXT | - |
| created_at / updated_at / is_deleted | - | - |

**`query_history`** —— 查询历史

| 字段 | 类型 | 说明 |
|---|---|---|
| id / account_id | - | - |
| query_text | TEXT | 用户输入内容 |
| query_type | TEXT | word / phrase / sentence_en / sentence_zh |
| result_json | TEXT | 缓存结果（LLM 返回结构化数据）|
| created_at | TEXT | - |

**`read_document`** —— 阅读材料

| 字段 | 类型 | 说明 |
|---|---|---|
| id / account_id | - | - |
| title | TEXT | 标题（用户填写或默认）|
| content | TEXT | 原文 |
| word_count | INTEGER | 词数 |
| words_found | TEXT | 已发现的生词 ID 列表 JSON |
| created_at / updated_at / is_deleted | - | - |

**`srs_review_log`** —— 每次复习评分历史（用于错词判定和统计）

| 字段 | 类型 | 说明 |
|---|---|---|
| id / account_id | - | - |
| word_id | TEXT FK | - |
| rating | TEXT | unknown / vague / known / skip |
| interval_before / interval_after | INTEGER | 天 |
| ease_before / ease_after | REAL | - |
| reviewed_at | TEXT | - |

**`dictation_log`** —— 听写日志

| 字段 | 类型 | 说明 |
|---|---|---|
| id / account_id / word_id | - | - |
| mode | TEXT | listen_spell / cn2en |
| user_input | TEXT | 用户输入 |
| correct | INTEGER | 0/1 |
| answered_at | TEXT | - |

**`known_word_hint_off`** —— 用户"我认识"过但没收藏的词（生词高亮排除表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id / account_id | - | - |
| word | TEXT | 单词 |
| created_at | TEXT | - |

其它沿用：`word_checkin`（已有，日打卡）。

### 2.3 状态与规则

| 状态 | SRS 队列 | 生词高亮 | 说明 |
|---|---|---|---|
| new | 是（间隔 = 1 天）| 是 | 刚收藏 |
| learning | 是（SM-2 计算）| 是 | 正在复习 |
| mastered | 否 | 否（可在设置开启）| 已掌握 |
| paused | 否 | 是 | 暂停学习 |

**"我认识"逻辑**：
- 词还没在单词本 → 写入 `known_word_hint_off` → 以后不高亮
- 词已在单词本 → status 改为 `mastered`

---

## 三、SRS 算法（SM-2 简化版）

**参数初值**：
- `ease = 2.5`
- `interval = 0`
- `repetitions = 0`

**每次复习后**（评分 rating）：

```typescript
function nextReview(rating: 'unknown' | 'vague' | 'known', card) {
  const q = rating === 'unknown' ? 0 : rating === 'vague' ? 3 : 5;

  if (q < 3) {
    card.repetitions = 0;
    card.interval_days = 1;
  } else {
    card.repetitions += 1;
    if (card.repetitions === 1)      card.interval_days = 1;
    else if (card.repetitions === 2) card.interval_days = 3;
    else card.interval_days = Math.round(card.interval_days * card.ease);
  }
  card.ease = Math.max(1.3, card.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  card.last_review_at = now;
  card.next_review_at = today + card.interval_days days;
}
```

**错词判定**：`srs_review_log` 里最近 5 次 `unknown` 或 `dictation_log` 最近 3 次错误 → 加入错词强化

**错词退出**：连续 3 次 `known` / 连续 2 次听写正确 → 从错词队列移除

---

## 四、翻译 / 查词 API 接入

### 4.1 API Key 管理

- 系统设置 → 英语学习 → API 配置
- 支持多家 provider（DeepSeek / Claude / OpenAI / 自定义 base_url）
- Key 加密存储在 Rust 侧的 `setting_kv` 表，加密方式 AES-256-GCM，密钥由 Argon2 从当前账号密码派生
- 前端调用统一走 Tauri command `translate_by_llm`，前端拿不到 Key 明文

### 4.2 三个 LLM 调用场景

**场景 1：句子翻译（en→zh 或 zh→en）**
```
Prompt:
你是专业的英汉互译。请将以下{方向}翻译，返回严格 JSON：
{
  "natural": "自然口语化的翻译",
  "formal": "正式书面语翻译（可选，仅当有明显差异时）",
  "keywords": ["句中的关键词/短语"]
}
原文：{text}
```

**场景 2：单词的当前语境义**（在句子里的具体含义）
```
Prompt:
在下面这句话里，"{word}" 是什么意思？请返回严格 JSON：
{
  "meaning": "该词在此语境中的中文含义",
  "pos": "词性",
  "explanation": "为什么是这个意思（1 句话）"
}
句子：{sentence}
```

**场景 3：拓展信息**（点开"其他释义"、"常用搭配"时按需请求）
```
Prompt:
返回单词 "{word}" 的：{
  "collocations": ["常用搭配"],
  "synonyms": [...], "antonyms": [...],
  "etymology": "词根词缀（可选）"
}
```

### 4.3 缓存策略

- 每次 LLM 请求成功后，把 `(query, result)` 写入 `query_history`
- 命中缓存直接返回，不再请求
- 手动"重新查询"可绕过缓存

---

## 五、生词高亮算法

**输入**：一段英文文本 + 用户等级设置（cet4 / cet6 / ielts / advanced）

**流程**：
1. 分词（简单：按空格 + 标点切分；进阶：加 wink-nlp）
2. 词形还原（用 ECDICT 的 exchange 字段回溯原型）
3. 对每个原型词判断：
   - 在 `known_word_hint_off` 里 → 不高亮
   - 在 `word_card` 且 status=mastered → 不高亮（可设置开启）
   - 在 `word_card` 但 status≠mastered → 高亮（浅蓝）
   - 不在词典或超过用户等级的对应词频 → 高亮（琥珀色）
   - 其它 → 不高亮

**性能**：单篇文章 <5000 词，前端解析 <200ms

---

## 六、UI 组件规划

| 组件 | 说明 | 复用 |
|---|---|---|
| WordCard | 统一的单词卡（音标+发音+义项+操作）| 全模块共用 |
| SentenceView | 带生词高亮的句子渲染器 | 翻译页/阅读页共用 |
| SrsCard | 复习卡片（正反面 + 三态评分）| 复习页 |
| DictationInput | 听写输入框（听音/看中文两种模式）| 听写页 |
| TodayTaskCard | 今日任务大卡片 | 今日学习首页 |
| TranslateForm | 翻译输入表单（自动检测 / 中英切换）| 翻译页 / 命令面板 |
| ReadingReader | 阅读器（文本渲染 + 生词侧边栏）| 阅读页 |

**通用交互组件**已在工作站有：`ResizableTh`、`InlineText/Select/Date`、`MetricCard`、`useTableZoom`、`StatusChip` —— 单词本表格直接复用。

---

## 七、Tauri Rust 命令清单

| 命令 | 用途 |
|---|---|
| `dict_import_ecdict` | 导入 ECDICT CSV 到 SQLite |
| `dict_import_progress` | 查询导入进度（poll）|
| `dict_lookup` | 查一个词的字典结果（毫秒级）|
| `dict_lookup_prefix` | 拼写建议（前缀匹配）|
| `dict_lemmatize` | 词形还原（went → go）|
| `translate_by_llm` | 走 LLM 翻译，接收 { text, direction, task } 返回 JSON |
| `store_api_key` / `get_api_key` | 加密存 Key |
| `tts_play` | 前端调用即可用 Web Speech，Rust 命令保留供未来接 Azure |

---

## 八、开发路线（结合工作站现状）

### V1.0 M1｜数据层 + 单词本（2-3 天）

- 迁移脚本扩展 word_card 字段 + 新增 word_context/query_history/known_word_hint_off/read_document/srs_review_log/dictation_log/sentence_bookmark 表
- ECDICT 导入命令（Rust）
- 单词本页（复用工作管理表格模式）
- 单词详情页 / 快速收藏 API
- 系统设置里加"词典管理"和"API Key" 面板

### V1.0 M2｜翻译页 + 查词（2 天）

- 输入区（自动检测）
- 英文单词查询：命中 dict_ecdict 直接返回 + 可选 LLM 补充语境义
- 英文句子翻译：LLM 走 en→zh
- 中文查词/翻译：LLM 走 zh→en
- 生词点选 → Tooltip → 快速收藏
- 查询历史

### V1.0 M3｜今日学习首页（0.5 天）

- 顶部任务卡（今日复习 / 听写 / 错词）
- 学习进度环
- 快速入口 4 个方块
- 空态引导

### V1.1｜练习中心（3-4 天）

- SRS 复习页（SM-2）
- 听写页（听音 / 看中文两模式）
- 错词强化聚合
- 生词高亮 + Tooltip + "我认识"

### V1.2｜阅读 + 记录（2 天）

- 阅读模式
- 句子收藏
- 学习记录页（数据 → 问题 → 动作）

### V1.3｜增强（2-3 天）

- 常用搭配 / 同义反义 / 词根词缀（LLM 按需拉取）
- 更丰富统计
- 跟读（Web Speech Recognition，可选）

---

## 九、待用户后续确认

1. **LLM Provider 首选**：DeepSeek（便宜）/ Claude（贵但强）/ OpenAI ？—— 建议 DeepSeek，成本约 1 元/百万 Token
2. **ECDICT 词典安装包**是否内嵌到应用（+60MB）还是首次启动下载？—— 建议**首次下载**，用户可以选择跳过
3. **每日复习目标**默认 20 个？听写默认 10 个？—— 与方案一致
4. **英语等级默认值**：CET-4？—— 由用户在设置里选

---

## 十、文档变更历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-25 | 初版：与功能方案 v3 对齐，明确数据模型 / LLM 接入 / SRS 算法 / Rust 命令清单 / 开发路线 |
