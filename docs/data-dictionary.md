# 数据字典  ·  Data Dictionary v1.0

对应 `schema/schema.sql`。本文档为字段级说明，是所有数据访问层实现的唯一事实来源。

## 通用约定

- 主键 `id`：TEXT（UUID v4，全小写去连字符或标准形式均可）
- 时间戳字段：TEXT ISO 8601（`YYYY-MM-DDTHH:MM:SS.sssZ`）
- 日期字段：TEXT（`YYYY-MM-DD`）
- 账号隔离：所有业务表含 `account_id` 外键，查询层强制注入
- 软删除：`is_deleted INTEGER 0/1`；进入回收站的行 `is_deleted=1` 并在 `recycle_meta` 记录元信息
- 序号字段 `seq_no`：INTEGER，表示表内显示位置；插入/删除时由业务层重排

## 状态枚举

| 字段 | 值集 | 含义 |
|---|---|---|
| `work_item.status` | new / following / closed | 新建 / 跟进 / 闭环 |
| `project.status` | new / following / closed | 同上 |
| `project_wbs.status` | following / closed | 进度表任务粒度较细，无「新建」 |
| `project_risk.status` | following / closed | 同上 |
| `project_file.status` | valid / invalid | 有效 / 无效 |
| priority / level | high / mid / low | 优先级 / 风险等级 |
| `quick_link.kind` | url / path | 网址 / 本地路径 |

## 表清单

### 1. account 账号
| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID v4 |
| username | TEXT | UNIQUE NOT NULL | 登录名，全局唯一 |
| display_name | TEXT | NOT NULL | 显示名 |
| avatar_path | TEXT | | 头像相对路径 |
| password_hash | TEXT | NOT NULL | Argon2id 哈希 |
| recovery_code_hash | TEXT | NOT NULL | 一次性恢复码哈希 |
| preferences_json | TEXT | DEFAULT '{}' | 账号级偏好（主题/字体/时区）|
| created_at | TEXT | NOT NULL | - |
| last_login_at | TEXT | | 最后登录 |
| is_deleted | INTEGER | DEFAULT 0 | 软删除 |

### 2. param_option 参数选项
`group_code` 取值：`work_type` / `project_type` / `risk_type` / `file_type`。同一账号 + 同一组内 name 唯一（软删除后可复用）。`is_system_default=1` 的行禁止硬删除，只能禁用或改名。

### 3. work_item 工作事项
包含设计说明书 5.6 节全部 13 列 + 序号 + is_deleted。`completed_at` 有值时业务层自动置 `status=closed`。CHECK 约束保证 priority 与 status 的枚举合法性。

### 4. project 项目
字段设计与 work_item 类似但更简单，缺少 priority / planned_at / completed_at；这些能力下沉到 project_wbs。

### 5. project_wbs 项目进度 / WBS 任务
自引用 `parent_id` 支持嵌套；`level` 冗余存储层级方便渲染缩进。四个日期字段供甘特图两条条带使用。

### 6. project_risk 项目风险
`level` 枚举 high/mid/low，UI 呈现为徽章色。

### 7. project_file 项目文件
`rel_path` 相对于数据目录（例如 `accounts/{account_id}/files/{project_id}/{uuid}_{name}`）。`md5` 用于去重检测。删除时进入回收站，实际文件延迟清理。

### 8. project_member 项目成员
`name` 字段建索引，用于跨项目自动补全。

### 9. quick_link_group / quick_link 快捷链接
分组可嵌套一层。`kind='path'` 时业务层要过滤可执行文件（.exe/.bat/.cmd），只允许打开或定位。

### 10. note_folder / note 知识管理
支持三级嵌套；`content` 存 Markdown 原文。FTS5 虚拟表 `note_fts` 用于全文搜索。双向链接 `[[标题]]` 由业务层扫描 content 建立反向索引（本版本可临时不建持久表，运行时扫描即可）。

### 11. word_card / word_checkin 英语学习
SM-2 参数：`easiness` 默认 2.5；每次复习后按结果调整。`next_review_at` 建索引供「今日待复习」查询。

### 12. ai_prompt / ai_tool_link AI 工具
Prompt 变量以 JSON 数组存 `variables_json`：`[{"key":"topic","label":"主题","default":""}]`。

### 13. change_log 变更历史
只在关键字段变更时写入（业务层白名单）。行详情面板右侧的历史标签页从此表读取。

### 14. 辅助表
- `setting_kv`：全局/账号级 KV 配置。`scope='app'` 为应用级，其余为 account_id。
- `audit_log`：登录、备份、恢复等系统级操作日志。
- `recycle_meta`：回收站元数据，`expires_at` 到期由定时任务硬删。

## FTS5 虚拟表

| 表 | 字段 | 用于 |
|---|---|---|
| work_item_fts | description, progress_note, internal_pic, external_pic, remark | 工作管理搜索栏 |
| project_fts | name, progress_note, internal_pic, external_pic, remark | 项目管理搜索栏 |
| project_wbs_fts | item, progress_note, type | 项目进度搜索 |
| note_fts | title, content, tags | 知识管理搜索 |

`work_item_fts` 已配置 INSERT/UPDATE/DELETE 触发器自动同步；其它三张 FTS 表的触发器在实际启用对应模块时补齐（M4 阶段）。

## 迁移策略

- 每次 schema 变更新增一个 `migrations/NNN_desc.sql` 文件，按版本号顺序执行
- `schema_version` 表记录已应用版本
- 应用启动时对比当前版本，缺失则按顺序执行；执行成功后更新 version 记录
- 破坏性变更（drop column/rename）先复制数据到新表再删除旧表，保持向下兼容一个版本

## 备份 / 恢复

- 备份：SQLite `.backup` 或整文件复制 + 数据目录 files/ 打包 zip
- 恢复：解压 → 覆盖 db → 重启应用 → 校验 schema_version 匹配
- 差异更新（v2 目标）：基于 change_log 的增量导出
