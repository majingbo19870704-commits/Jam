# 个人工作站 · 项目交接文档

> 写给接手开发者（Codex 或其他）。阅读顺序：本文 → `docs/english-module-tech-design.md` → `schema/schema.sql` → 对应模块源码。
> 最后更新：2026-09-25

---

## 一、项目概况

个人桌面工具软件，覆盖七个一级模块：

| 模块 | 路由 | 完成状态 |
|---|---|---|
| 仪表盘 | `/dashboard` | ✅ 完成（真实数据接入、工作完成热力图） |
| 工作管理 | `/work` | ✅ 完成（CRUD、状态流转、抽屉详情、xlsx 导出） |
| 项目管理 | `/project` | ✅ 完成（列表、详情、成员/文件/风险/WBS+甘特图） |
| 知识管理 | `/knowledge` | ✅ 完成（Obsidian 只读阅览、全文索引、AI 问答） |
| 英语学习 | `/english` | ✅ 完成（见第三节，阅读页支持生词高亮） |
| AI 工具 | `/ai-tools` | ✅ 完成（分组管理、一键导入预置工具） |
| 快捷链接 | `/quick-links` | ✅ 完成（URL/路径、分组、搜索） |
| 全局设置 | `/settings` | ✅ 完成（账号、参数组、回收站、备份） |

**所有模块已开发完成。**

---

## 二、技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri 2.x（Rust 内核） |
| 前端 | React 18 + TypeScript 5 strict |
| 构建 | Vite 5 |
| CSS | Tailwind CSS 3.4（原子化，无组件库） |
| 图标 | lucide-react |
| 状态 | Zustand 5 |
| 数据库 | SQLite（`tauri-plugin-sql`，前端直连） |
| 路由 | react-router-dom v6 |
| 依赖 | uuid、date-fns、mammoth、xlsx |

**无 recharts / echarts**：所有图表用纯 SVG / CSS 手写（见 `EnglishRecordsPage.tsx`）。

---

## 三、英语学习模块（最复杂，重点说明）

### 3.1 子页面地图

| 路由 | 文件 | 说明 |
|---|---|---|
| `/english` | `EnglishTodayPage.tsx` | 今日学习首页，连续天数/进度环 |
| `/english/translate` | `TranslatePage.tsx` | 多引擎翻译，带缓存（24h TTL）|
| `/english/wordbook` | `WordbookPage.tsx` | 单词本三 Tab（单词/短语/例句） |
| `/english/word/:id` | `WordDetailPage.tsx` | 词条详情+语境列表 |
| `/english/practice` | `PracticePage.tsx` | 练习入口（SRS/听写/错词） |
| `/english/practice/srs` | `SrsReviewPage.tsx` | SRS 间隔复习，支持 `?mode=mistakes` |
| `/english/practice/dictation` | `DictationPage.tsx` | 听写，支持 `?mode=mistakes` |
| `/english/practice/mistakes` | `MistakesPage.tsx` | 错词列表入口 |
| `/english/reading` | `EnglishReadingPage.tsx` | 阅读文章列表 |
| `/english/reading/:id` | `ReadingDocumentPage.tsx` | 文章详情，划词收藏 |
| `/english/records` | `EnglishRecordsPage.tsx` | 学习记录（热力图/折线/饼图） |
| `/english/settings` | `EnglishSettingsPage.tsx` | 翻译引擎/AI/词典/学习偏好 |

### 3.2 关键 DAO 文件

| 文件 | 职责 |
|---|---|
| `src/db/english-dao.ts` | WordCard CRUD、打卡（word_checkin）、阅读文档（read_document）、翻译缓存（query_history）、设置（setting_kv） |
| `src/db/srs-dao.ts` | SRS 评分（rateWord）、听写记录（logDictation）、错词列表、学习记录统计 |
| `src/db/translator-providers-dao.ts` | 翻译引擎实例（ai_provider 表） |
| `src/lib/translators-v2.ts` | 多引擎翻译运行时，带缓存查找 |
| `src/lib/srs.ts` | SM-2 算法纯函数 |

### 3.3 重要设计决策

**item_kind 持久化**：`word_card` 表有 `item_kind TEXT`（'word'|'phrase'|'sentence'），新增时写入、筛选时用 `resolveKind(w)`（优先读 DB 字段，fallback 文本启发式）。不要只用文本启发式判断 Tab，否则数据会串 Tab。

**skipCheckin 模式**：`rateWord(wordId, rating, { skipCheckin: true })` 用于听写场景，避免 `reviewed_count` 被 logDictation + rateWord 各计一次。

**migration 策略**：`client.ts` 的迁移函数用 `PRAGMA table_info(表名)` 检查列是否存在，不用 marker 表判断。所有 ALTER 都做列存在检查，幂等安全。

**翻译缓存**：`query_history` 表存缓存，TTL 24h，key 为 `(account_id, query_text, query_type, provider_instance_id, direction)`。

**SRS 自动 mastered**：`rateWord` 里当 rating=known、repetitions≥`english.master_min_reps`（默认3）、interval_days≥`english.master_min_interval`（默认21）时自动将 status 置 mastered。阈值从 `setting_kv` 读取。

---

## 四、数据库

### 4.1 Schema 文件
`schema/schema.sql` — 全量 DDL，所有表和索引。

### 4.2 核心表一览

| 表 | 说明 |
|---|---|
| `account` | 多账号，所有业务表都有 `account_id` 外键 |
| `setting_kv` | 键值配置，scope='app' 为全局，scope=accountId 为账号级 |
| `param_option` | 参数组（工作类型/项目类型/英语类型等），`group_code` 分组 |
| `work_item` | 工作事项 |
| `project` / `project_member` / `project_file` / `project_risk` / `project_wbs` | 项目管理 |
| `word_card` | 单词卡片（含 SRS 字段、item_kind） |
| `word_context` | 单词语境/例句 |
| `srs_review_log` | SRS 评分历史 |
| `dictation_log` | 听写记录 |
| `word_checkin` | 每日打卡（reviewed_count / new_count），唯一索引 (account_id, checkin_date) |
| `query_history` | 翻译缓存 |
| `read_document` | 阅读文章 |
| `ai_provider` | 翻译/AI 提供商实例配置 |
| `quick_link_group` / `quick_link` | 快捷链接 |
| `ai_tool_link` | AI 工具快捷入口（group_name 字段做分组，无专用分组表） |
| `note_folder` / `note` | 知识管理（表已建，页面未开发） |

### 4.3 迁移机制

`src/db/client.ts` 的 `ensureSchema()` 在每次启动时执行：
1. 若 `account` 表不存在 → 执行全量 `schema.sql`
2. 若已有库 → 执行 `schema.sql` 中 `-- English module v1.0` 之后的块（`CREATE TABLE IF NOT EXISTS` 幂等）
3. `migrateWordCardV2(db)` — 用 PRAGMA 检查并补 word_card 缺失列
4. `migrateEnglishV3(db)` — 补 query_history 字段、回填 english_type seed、清理旧 setting_kv

---

## 五、全局组件与约定

### 5.1 CSS 类名约定（`src/index.css` / Tailwind config）

| 类 | 用途 |
|---|---|
| `.card` | 白底圆角卡片容器 |
| `.card-title` / `.card-body` | 卡片子区域 |
| `.btn` / `.btn-primary` | 按钮 |
| `.input` / `.input-lite` | 输入框 |
| `.icon-btn` | 图标按钮（24×24 hover 圆角） |
| `.modal-backdrop` / `.modal` | 模态弹窗 |
| `.form-label` | 表单标签 |
| `.text-ink-2/3/4` | 文字层级（ink-2深、ink-3中、ink-4浅） |
| `.text-danger` | 红色危险操作 |
| `.num` | 数字专用字体（tabular-nums） |
| `.text-accent` / `.bg-accent-tint` | 主题色 |

### 5.2 通用组件（`src/components/`）

- `MetricCard` — 指标卡片
- `StatusChip` / `PriorityChip` — 内联标签
- `PagePlaceholder` — 占位页（未开发模块用）
- `SelectionTooltip`（在 `EnglishShell.tsx` 挂载）— 全局划词弹出翻译/收藏

### 5.3 Store（`src/stores/`）

- `useAccountStore` — 当前 accountId，所有 DAO 通过它取 accountId
- 其他 store 按需查阅

### 5.4 路由文件

`src/app/router.tsx` — 所有路由定义在此，新增页面在这里注册。

---

## 六、未完成 / 待开发事项

所有原计划功能已全部实现。以下是可选的后续增强方向（非必需）：

| 项目 | 说明 |
|---|---|
| 阅读模块词频分析 | 按用户等级标记文章中的陌生词，需接入词频数据库 |
| 阅读模块进度保存 | 记录每篇文章的滚动位置，下次打开自动定位 |
| 知识库笔记编辑 | 当前知识管理为只读模式，可考虑在应用内直接编辑 Markdown |
| 数据导出增强 | 项目、英语单词本等模块可补充 xlsx 导出（工作事项已有） |

---

## 七、开发环境启动

```bash
# 安装依赖
cd personal-workstation
npm install

# 启动开发服务器（Tauri + Vite）
npm run tauri dev
# 或使用根目录的 bat 脚本：
# 3-启动应用.bat（自动释放 1420 端口再启动）
```

**端口**：Vite 固定占用 1420（`vite.config.ts` 中 `strictPort: true`）。若启动报端口占用，运行根目录的 `释放端口.bat`。

**数据库位置**：Tauri app data dir，Windows 下通常在 `%APPDATA%\com.personal-workstation.app\data.db`。

---

## 八、参考文档

| 文档 | 内容 |
|---|---|
| `docs/english-module-tech-design.md` | 英语模块完整技术设计（数据模型、API、SRS 算法） |
| `docs/english-module-completion-plan.md` | 英语模块三批次收口方案（已全部完成） |
| `docs/data-dictionary.md` | 全局字段说明 |
| `docs/M0-getting-started.md` | 环境搭建与首次运行 |
| `schema/schema.sql` | 完整数据库 DDL（最权威的 schema 来源） |
