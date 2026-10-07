-- =============================================================================
-- 个人工作站  Personal Workstation
-- Schema v1.0  ·  SQLite 3.40+  ·  2026-09-24
-- =============================================================================
-- 约定：
--   - 主键：TEXT UUID v4
--   - 时间：TEXT ISO 8601（YYYY-MM-DDTHH:MM:SS.sssZ）
--   - 状态：TEXT 枚举，值集见字段注释
--   - 软删除：is_deleted INTEGER 0/1；实际清理由回收站策略执行
--   - 账号隔离：所有业务表均有 account_id 外键；查询强制注入
--   - 命名：表名单数、字段 snake_case
-- =============================================================================
-- 注意：PRAGMA 语句已移出，改由前端在获取连接后设置
-- 原因：tauri-plugin-sql 的迁移在事务中执行，PRAGMA journal_mode 无法在事务中生效
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. account 账号
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account (
  id                  TEXT    PRIMARY KEY,
  username            TEXT    NOT NULL UNIQUE,
  display_name        TEXT    NOT NULL,
  avatar_path         TEXT,                          -- 相对数据目录的相对路径
  password_hash       TEXT    NOT NULL,              -- Argon2id
  recovery_code_hash  TEXT    NOT NULL,              -- 一次性恢复码哈希
  preferences_json    TEXT    DEFAULT '{}',          -- 账号级配置（主题/字体/时区等）
  created_at          TEXT    NOT NULL,
  last_login_at       TEXT,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_account_username ON account(username) WHERE is_deleted = 0;

-- -----------------------------------------------------------------------------
-- 2. param_option 参数选项（四组共用）
-- -----------------------------------------------------------------------------
-- group_code: work_type | project_type | risk_type | file_type
CREATE TABLE IF NOT EXISTS param_option (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  group_code          TEXT    NOT NULL,
  name                TEXT    NOT NULL,
  seq_no              INTEGER NOT NULL DEFAULT 0,
  is_system_default   INTEGER NOT NULL DEFAULT 0,    -- 1 = 预置，禁止删除
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_param_option_group ON param_option(account_id, group_code, is_deleted);
CREATE UNIQUE INDEX IF NOT EXISTS uq_param_option_name ON param_option(account_id, group_code, name) WHERE is_deleted = 0;

-- -----------------------------------------------------------------------------
-- 2.1 资料管理参数与资料文件
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_brand (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), name TEXT NOT NULL,
  remark TEXT, seq_no INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_brand_name ON material_brand(account_id, name) WHERE is_deleted = 0;
CREATE TABLE IF NOT EXISTS material_model (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), brand TEXT, client_model TEXT NOT NULL,
  skyworth_model TEXT NOT NULL, remark TEXT, seq_no INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS material_file_parameter (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), material_type TEXT NOT NULL,
  file_type TEXT NOT NULL, remark TEXT, seq_no INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0,
  is_draft INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_file_type ON material_file_parameter(account_id, file_type) WHERE is_deleted = 0;
CREATE TABLE IF NOT EXISTS material_setting (
  account_id TEXT PRIMARY KEY REFERENCES account(id), archive_root TEXT,
  recycle_retention_days INTEGER NOT NULL DEFAULT 7, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS material_file (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), seq_no INTEGER NOT NULL DEFAULT 0,
  material_type TEXT NOT NULL, file_parameter_id TEXT NOT NULL REFERENCES material_file_parameter(id),
  original_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'valid' CHECK(status IN ('valid','invalid')),
  brand_id TEXT, client_model_id TEXT, skyworth_model_id TEXT, archive_path TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_material_file_account ON material_file(account_id, is_deleted, seq_no);
CREATE INDEX IF NOT EXISTS idx_material_file_type ON material_file(account_id, material_type, is_deleted);

-- -----------------------------------------------------------------------------
-- 3. work_item 工作事项
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_item (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  seq_no              INTEGER NOT NULL DEFAULT 0,    -- 表内位置；行操作后重排
  date                TEXT    NOT NULL,              -- YYYY-MM-DD
  type_id             TEXT             REFERENCES param_option(id),
  priority            TEXT    NOT NULL DEFAULT 'mid' CHECK (priority IN ('high','mid','low')),
  description         TEXT    NOT NULL,
  progress_note       TEXT,
  planned_at          TEXT,                          -- YYYY-MM-DD
  reminder_at         TEXT,                          -- 本地时间 YYYY-MM-DDTHH:mm；为空则不单独提醒
  reminder_repeat     TEXT    NOT NULL DEFAULT 'none' CHECK (reminder_repeat IN ('none','daily','weekly','monthly')),
  completed_at        TEXT,                          -- YYYY-MM-DD；填写触发 status=closed
  status              TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new','following','closed')),
  internal_pic        TEXT,
  external_pic        TEXT,
  remark              TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_work_item_account ON work_item(account_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_work_item_status  ON work_item(account_id, status, is_deleted);
CREATE INDEX IF NOT EXISTS idx_work_item_date    ON work_item(account_id, date);
CREATE INDEX IF NOT EXISTS idx_work_item_planned ON work_item(account_id, planned_at);
CREATE INDEX IF NOT EXISTS idx_work_item_reminder ON work_item(account_id, reminder_at, is_deleted);

-- -----------------------------------------------------------------------------
-- 3.1 schedule_event 独立日程（不与工作事项耦合）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_event (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  title               TEXT    NOT NULL,
  starts_at           TEXT    NOT NULL,              -- 本地时间 YYYY-MM-DDTHH:mm
  ends_at             TEXT,
  all_day             INTEGER NOT NULL DEFAULT 0,
  reminder_at         TEXT,
  snooze_until        TEXT,                          -- 提醒弹窗的临时稍后提醒时间
  reminder_repeat     TEXT    NOT NULL DEFAULT 'none' CHECK (reminder_repeat IN ('none','daily','weekly','monthly')),
  color               TEXT    NOT NULL DEFAULT '#4D7CFE',
  notes               TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_schedule_event_time ON schedule_event(account_id, starts_at, is_deleted);
CREATE INDEX IF NOT EXISTS idx_schedule_event_reminder ON schedule_event(account_id, reminder_at, is_deleted);

-- -----------------------------------------------------------------------------
-- 4. project 项目
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  seq_no              INTEGER NOT NULL DEFAULT 0,
  date                TEXT    NOT NULL,
  type_id             TEXT             REFERENCES param_option(id),
  name                TEXT    NOT NULL,
  progress_note       TEXT,
  status              TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new','following','closed')),
  internal_pic        TEXT,
  external_pic        TEXT,
  archive_root        TEXT,                            -- 项目文件外部归档根目录
  remark              TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_project_account ON project(account_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_project_status  ON project(account_id, status, is_deleted);
CREATE INDEX IF NOT EXISTS idx_project_name    ON project(account_id, name);

-- -----------------------------------------------------------------------------
-- 5. project_wbs 项目进度 / WBS 任务
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_wbs (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  project_id          TEXT    NOT NULL REFERENCES project(id),
  parent_id           TEXT             REFERENCES project_wbs(id),  -- 自引用，支持嵌套
  seq_no              INTEGER NOT NULL DEFAULT 0,
  level               INTEGER NOT NULL DEFAULT 1,                   -- 层级 1..N
  type                TEXT,
  item                TEXT    NOT NULL,
  progress_note       TEXT,
  depends_on          TEXT    NOT NULL DEFAULT '[]', -- JSON task id array；前置任务
  assignee_member_ids TEXT    NOT NULL DEFAULT '[]', -- JSON project_member id array；任务负责人
  status              TEXT    NOT NULL DEFAULT 'following' CHECK (status IN ('following','closed')),
  planned_start       TEXT,
  planned_end         TEXT,
  actual_start        TEXT,
  actual_end          TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_wbs_project ON project_wbs(project_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_wbs_parent  ON project_wbs(parent_id);
CREATE INDEX IF NOT EXISTS idx_wbs_account ON project_wbs(account_id, is_deleted);

-- -----------------------------------------------------------------------------
-- 6. project_risk 项目风险
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_risk (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  project_id          TEXT    NOT NULL REFERENCES project(id),
  seq_no              INTEGER NOT NULL DEFAULT 0,
  type_id             TEXT             REFERENCES param_option(id),
  level               TEXT    NOT NULL DEFAULT 'mid' CHECK (level IN ('high','mid','low')),
  risk                TEXT    NOT NULL,
  countermeasure      TEXT,
  progress_note       TEXT,
  status              TEXT    NOT NULL DEFAULT 'following' CHECK (status IN ('following','closed')),
  remark              TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_risk_project ON project_risk(project_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_risk_account ON project_risk(account_id, is_deleted);

-- -----------------------------------------------------------------------------
-- 7. project_file 项目文件
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_file (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  project_id          TEXT    NOT NULL REFERENCES project(id),
  seq_no              INTEGER NOT NULL DEFAULT 0,
  type_id             TEXT             REFERENCES param_option(id),
  display_name        TEXT    NOT NULL,
  original_name       TEXT    NOT NULL,
  rel_path            TEXT    NOT NULL,               -- 相对 data_dir 的路径
  archive_path        TEXT,                            -- 外部归档后的绝对路径（可为空）
  size_bytes          INTEGER NOT NULL DEFAULT 0,
  md5                 TEXT,
  ext                 TEXT,
  status              TEXT    NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','invalid')),
  remark              TEXT,
  uploaded_at         TEXT    NOT NULL,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_file_project ON project_file(project_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_file_account ON project_file(account_id, is_deleted);

-- -----------------------------------------------------------------------------
-- 8. project_member 项目成员
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_member (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  project_id          TEXT    NOT NULL REFERENCES project(id),
  seq_no              INTEGER NOT NULL DEFAULT 0,
  company             TEXT,
  department          TEXT,
  name                TEXT    NOT NULL,
  role                TEXT,
  phone               TEXT,
  remark              TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_member_project ON project_member(project_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_member_name    ON project_member(account_id, name);
CREATE INDEX IF NOT EXISTS idx_member_account ON project_member(account_id, is_deleted);

-- -----------------------------------------------------------------------------
-- 9. quick_link 快捷链接
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quick_link_group (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  parent_id           TEXT             REFERENCES quick_link_group(id),
  seq_no              INTEGER NOT NULL DEFAULT 0,
  name                TEXT    NOT NULL,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quick_link (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  group_id            TEXT             REFERENCES quick_link_group(id),
  seq_no              INTEGER NOT NULL DEFAULT 0,
  kind                TEXT    NOT NULL CHECK (kind IN ('url','path')),
  name                TEXT    NOT NULL,
  url_or_path         TEXT    NOT NULL,
  icon_path           TEXT,
  tags                TEXT,                            -- 逗号分隔
  click_count         INTEGER NOT NULL DEFAULT 0,
  last_used_at        TEXT,
  remark              TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qlink_account ON quick_link(account_id, is_deleted);

-- -----------------------------------------------------------------------------
-- 10. note / note_folder 知识管理
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS note_folder (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  parent_id           TEXT             REFERENCES note_folder(id),
  seq_no              INTEGER NOT NULL DEFAULT 0,
  name                TEXT    NOT NULL,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS note (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  folder_id           TEXT             REFERENCES note_folder(id),
  title               TEXT    NOT NULL,
  content             TEXT,                            -- Markdown
  tags                TEXT,                            -- 逗号分隔
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_note_folder  ON note(folder_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_note_account ON note(account_id, is_deleted);

-- -----------------------------------------------------------------------------
-- 11. word_card 英语学习
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS word_card (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  word                TEXT    NOT NULL,
  pos                 TEXT,                            -- 词性
  meaning             TEXT,
  example             TEXT,
  source              TEXT,
  mastery             INTEGER NOT NULL DEFAULT 0,      -- 0-5
  next_review_at      TEXT,
  interval_days       INTEGER NOT NULL DEFAULT 1,
  easiness            REAL    NOT NULL DEFAULT 2.5,    -- SM-2
  review_count        INTEGER NOT NULL DEFAULT 0,
  item_kind           TEXT,                            -- 'word' | 'phrase' | 'sentence'，持久化 Tab 归类
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_word_due ON word_card(account_id, next_review_at, is_deleted);
CREATE INDEX IF NOT EXISTS idx_word_kind ON word_card(account_id, item_kind, is_deleted);

CREATE TABLE IF NOT EXISTS word_checkin (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  checkin_date        TEXT    NOT NULL,               -- YYYY-MM-DD
  reviewed_count      INTEGER NOT NULL DEFAULT 0,
  new_count           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkin ON word_checkin(account_id, checkin_date);

-- -----------------------------------------------------------------------------
-- 12. ai_prompt AI Prompt 模板
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_prompt (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  title               TEXT    NOT NULL,
  scene               TEXT,
  content             TEXT    NOT NULL,
  variables_json      TEXT    DEFAULT '[]',
  tags                TEXT,
  use_count           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_tool_link (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  group_name          TEXT,
  seq_no              INTEGER NOT NULL DEFAULT 0,
  name                TEXT    NOT NULL,
  url                 TEXT    NOT NULL,
  description         TEXT,
  icon_path           TEXT,
  click_count         INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_tool_account ON ai_tool_link(account_id, is_deleted);

-- 网页工作区登录配置：用户名与选择器保存在数据库；密码只保存到 Windows DPAPI 加密的密钥存储。
CREATE TABLE IF NOT EXISTS ai_web_account (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  workspace_id        TEXT    NOT NULL REFERENCES ai_tool_link(id),
  login_url           TEXT    NOT NULL,
  username            TEXT    NOT NULL,
  secret_ref          TEXT    NOT NULL,
  username_selector   TEXT    NOT NULL,
  password_selector   TEXT    NOT NULL,
  submit_selector     TEXT,
  auto_login          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_web_account_workspace
  ON ai_web_account(account_id, workspace_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_ai_web_account_workspace
  ON ai_web_account(account_id, workspace_id, is_deleted);

-- -----------------------------------------------------------------------------
-- 12.1 AI Assistant · 专业助理与会话
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_profile (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  name                TEXT    NOT NULL,
  role_definition     TEXT    NOT NULL,
  avatar_key          TEXT    NOT NULL DEFAULT 'bot',
  default_provider_id TEXT,
  default_model_id    TEXT,
  fallback_provider_id TEXT,
  default_model_label TEXT    NOT NULL DEFAULT '待配置模型',
  knowledge_scope_json TEXT   NOT NULL DEFAULT '[]',
  tools_json          TEXT    NOT NULL DEFAULT '[]',
  is_builtin          INTEGER NOT NULL DEFAULT 0,
  is_enabled          INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assistant_profile_account ON assistant_profile(account_id, is_deleted, is_enabled);

CREATE TABLE IF NOT EXISTS assistant_conversation (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  profile_id          TEXT    NOT NULL REFERENCES assistant_profile(id),
  title               TEXT    NOT NULL,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assistant_conversation_profile ON assistant_conversation(profile_id, is_deleted, updated_at);

CREATE TABLE IF NOT EXISTS assistant_message (
  id                  TEXT    PRIMARY KEY,
  conversation_id     TEXT    NOT NULL REFERENCES assistant_conversation(id),
  role                TEXT    NOT NULL,
  content             TEXT    NOT NULL,
  citations_json      TEXT    NOT NULL DEFAULT '[]',
  created_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistant_message_conversation ON assistant_message(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS assistant_provider_connection (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  name                TEXT    NOT NULL,
  provider_kind       TEXT    NOT NULL,
  base_url            TEXT    NOT NULL,
  model_id            TEXT    NOT NULL,
  api_key             TEXT,
  secret_ref          TEXT,
  is_enabled          INTEGER NOT NULL DEFAULT 1,
  daily_request_limit INTEGER,
  monthly_request_limit INTEGER,
  last_tested_at      TEXT,
  last_test_status    TEXT,
  last_test_message   TEXT,
  last_test_latency_ms INTEGER,
  input_price_per_million_cny REAL,
  output_price_per_million_cny REAL,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assistant_provider_account ON assistant_provider_connection(account_id, is_deleted, is_enabled);

CREATE TABLE IF NOT EXISTS assistant_provider_usage (
  provider_id         TEXT    NOT NULL REFERENCES assistant_provider_connection(id),
  period_key          TEXT    NOT NULL,
  request_count       INTEGER NOT NULL DEFAULT 0,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT    NOT NULL,
  PRIMARY KEY (provider_id, period_key)
);

CREATE TABLE IF NOT EXISTS assistant_knowledge_source (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  profile_id          TEXT    NOT NULL REFERENCES assistant_profile(id),
  name                TEXT    NOT NULL,
  source_type         TEXT    NOT NULL,
  source_path         TEXT    NOT NULL,
  include_subdirs     INTEGER NOT NULL DEFAULT 1,
  is_enabled          INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assistant_knowledge_profile ON assistant_knowledge_source(profile_id, is_deleted, is_enabled);

-- 用户明确添加后可供所有专业助理复用的资料来源；仍只在提问相关时提取少量片段。
CREATE TABLE IF NOT EXISTS assistant_global_knowledge_source (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  name                TEXT    NOT NULL,
  source_type         TEXT    NOT NULL,
  source_path         TEXT    NOT NULL,
  include_subdirs     INTEGER NOT NULL DEFAULT 1,
  is_enabled          INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assistant_global_knowledge_account
  ON assistant_global_knowledge_source(account_id, is_deleted, is_enabled);

-- -----------------------------------------------------------------------------
-- Obsidian Vault 只读浏览与检索（原始文件不写入数据库）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_vault (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  name                TEXT    NOT NULL,
  root_path           TEXT    NOT NULL,
  is_default          INTEGER NOT NULL DEFAULT 0,
  last_scanned_at     TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0,
  UNIQUE(account_id, root_path)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_vault_account
  ON knowledge_vault(account_id, is_deleted, is_default);

CREATE TABLE IF NOT EXISTS knowledge_file_index (
  vault_id            TEXT    NOT NULL REFERENCES knowledge_vault(id),
  path                TEXT    NOT NULL,
  name                TEXT    NOT NULL,
  extension           TEXT,
  size                INTEGER NOT NULL DEFAULT 0,
  modified_at         INTEGER,
  updated_at          TEXT    NOT NULL,
  PRIMARY KEY (vault_id, path)
);

CREATE TABLE IF NOT EXISTS knowledge_document_index (
  vault_id            TEXT    NOT NULL REFERENCES knowledge_vault(id),
  path                TEXT    NOT NULL,
  title               TEXT    NOT NULL,
  tags                TEXT    NOT NULL DEFAULT '',
  frontmatter         TEXT    NOT NULL DEFAULT '',
  content             TEXT    NOT NULL DEFAULT '',
  size                INTEGER NOT NULL DEFAULT 0,
  modified_at         INTEGER,
  updated_at          TEXT    NOT NULL,
  PRIMARY KEY (vault_id, path)
);
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_document_fts USING fts5(
  vault_id UNINDEXED, path UNINDEXED, title, content, tags, tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS knowledge_ai_session (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  vault_id            TEXT    NOT NULL REFERENCES knowledge_vault(id),
  question            TEXT    NOT NULL,
  answer              TEXT    NOT NULL,
  citations_json      TEXT    NOT NULL DEFAULT '[]',
  created_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_ai_session_vault
  ON knowledge_ai_session(account_id, vault_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assistant_action_request (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  profile_id          TEXT    NOT NULL REFERENCES assistant_profile(id),
  conversation_id     TEXT,
  action_kind         TEXT    NOT NULL,
  summary             TEXT    NOT NULL,
  payload_json        TEXT    NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'pending',
  created_at          TEXT    NOT NULL,
  resolved_at         TEXT,
  error_message       TEXT,
  result_summary      TEXT
);
CREATE INDEX IF NOT EXISTS idx_assistant_action_profile ON assistant_action_request(profile_id, status, created_at);

-- 用户显式授权的重复性 AI 操作。按专业助理与操作类别隔离，随时可关闭。
CREATE TABLE IF NOT EXISTS assistant_action_authorization (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  profile_id          TEXT    NOT NULL REFERENCES assistant_profile(id),
  action_kind         TEXT    NOT NULL,
  is_enabled          INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  UNIQUE(account_id, profile_id, action_kind)
);
CREATE INDEX IF NOT EXISTS idx_assistant_action_authorization
  ON assistant_action_authorization(account_id, profile_id, is_enabled);

-- 用户从已确认操作保存的自动化流程。定时流程仅在个人工作站运行期间触发。
CREATE TABLE IF NOT EXISTS assistant_workflow (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  profile_id          TEXT    NOT NULL REFERENCES assistant_profile(id),
  name                TEXT    NOT NULL,
  action_kind         TEXT    NOT NULL,
  payload_json        TEXT    NOT NULL,
  is_enabled          INTEGER NOT NULL DEFAULT 1,
  last_run_at         TEXT,
  last_run_status     TEXT,
  schedule_minutes    INTEGER,
  last_scheduled_at   TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assistant_workflow_profile
  ON assistant_workflow(account_id, profile_id, is_deleted, is_enabled);

-- -----------------------------------------------------------------------------
-- 13. change_log 变更历史
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_log (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  table_name          TEXT    NOT NULL,
  row_id              TEXT    NOT NULL,
  field               TEXT    NOT NULL,
  old_value           TEXT,
  new_value           TEXT,
  changed_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changelog_row ON change_log(table_name, row_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_changelog_acct ON change_log(account_id, changed_at);

-- -----------------------------------------------------------------------------
-- 14. 辅助表：setting_kv / audit_log / recycle_meta
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS setting_kv (
  scope               TEXT    NOT NULL,               -- 'app' | account_id
  key                 TEXT    NOT NULL,
  value               TEXT,
  updated_at          TEXT    NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT,                            -- 系统级操作可为空
  action              TEXT    NOT NULL,                -- login/logout/backup/restore/...
  detail              TEXT,
  ip_or_host          TEXT,
  created_at          TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS recycle_meta (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  source_table        TEXT    NOT NULL,
  source_id           TEXT    NOT NULL,
  summary             TEXT,                            -- 摘要文本，用于回收站列表展示
  deleted_at          TEXT    NOT NULL,
  expires_at          TEXT    NOT NULL,                -- 到期后由清理任务硬删
  restored_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_recycle_account ON recycle_meta(account_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_recycle_expires ON recycle_meta(expires_at);

-- =============================================================================
-- FTS5 全文搜索虚拟表
-- =============================================================================
CREATE VIRTUAL TABLE IF NOT EXISTS work_item_fts USING fts5(
  description, progress_note, internal_pic, external_pic, remark,
  content='work_item', content_rowid='rowid', tokenize="unicode61"
);
CREATE VIRTUAL TABLE IF NOT EXISTS project_fts USING fts5(
  name, progress_note, internal_pic, external_pic, remark,
  content='project', content_rowid='rowid', tokenize="unicode61"
);
CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
  title, content, tags,
  content='note', content_rowid='rowid', tokenize="unicode61"
);
CREATE VIRTUAL TABLE IF NOT EXISTS project_wbs_fts USING fts5(
  item, progress_note, type,
  content='project_wbs', content_rowid='rowid', tokenize="unicode61"
);

-- FTS 同步触发器（work_item）
CREATE TRIGGER IF NOT EXISTS work_item_ai AFTER INSERT ON work_item BEGIN
  INSERT INTO work_item_fts(rowid, description, progress_note, internal_pic, external_pic, remark)
  VALUES (new.rowid, new.description, new.progress_note, new.internal_pic, new.external_pic, new.remark);
END;
CREATE TRIGGER IF NOT EXISTS work_item_ad AFTER DELETE ON work_item BEGIN
  INSERT INTO work_item_fts(work_item_fts, rowid, description, progress_note, internal_pic, external_pic, remark)
  VALUES ('delete', old.rowid, old.description, old.progress_note, old.internal_pic, old.external_pic, old.remark);
END;
CREATE TRIGGER IF NOT EXISTS work_item_au AFTER UPDATE ON work_item BEGIN
  INSERT INTO work_item_fts(work_item_fts, rowid, description, progress_note, internal_pic, external_pic, remark)
  VALUES ('delete', old.rowid, old.description, old.progress_note, old.internal_pic, old.external_pic, old.remark);
  INSERT INTO work_item_fts(rowid, description, progress_note, internal_pic, external_pic, remark)
  VALUES (new.rowid, new.description, new.progress_note, new.internal_pic, new.external_pic, new.remark);
END;

-- =============================================================================
-- English module v1.0（2026-09-25 追加）
-- =============================================================================

-- 1) 全局词典（不带 account_id，全局共享）
CREATE TABLE IF NOT EXISTS dict_ecdict (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  word                TEXT    NOT NULL,
  phonetic            TEXT,
  definition          TEXT,
  translation         TEXT,
  pos                 TEXT,
  collins             INTEGER,
  oxford              INTEGER,
  tag                 TEXT,
  bnc                 INTEGER,
  frq                 INTEGER,
  exchange            TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dict_word ON dict_ecdict(word);
CREATE INDEX IF NOT EXISTS idx_dict_frq       ON dict_ecdict(frq);
CREATE INDEX IF NOT EXISTS idx_dict_tag       ON dict_ecdict(tag);

-- 1.1) WordNet 离线语义库（全局共享）。由设置页导入官方 dict 目录后写入。
CREATE TABLE IF NOT EXISTS dict_wordnet (
  word                TEXT    PRIMARY KEY,
  synonyms_json       TEXT    NOT NULL DEFAULT '[]',
  antonyms_json       TEXT    NOT NULL DEFAULT '[]',
  examples_json       TEXT    NOT NULL DEFAULT '[]',
  updated_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dict_wordnet_word ON dict_wordnet(word);

-- 1.2) 单词扩展信息缓存。WordNet 先填充；AI 只补齐缺失的信息，结果按账号保存。
CREATE TABLE IF NOT EXISTS word_enrichment (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  word_id             TEXT    NOT NULL REFERENCES word_card(id),
  synonyms_json       TEXT    NOT NULL DEFAULT '[]',
  antonyms_json       TEXT    NOT NULL DEFAULT '[]',
  root_analysis       TEXT,
  examples_json       TEXT    NOT NULL DEFAULT '[]',
  source              TEXT    NOT NULL DEFAULT 'none',
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  UNIQUE(account_id, word_id)
);
CREATE INDEX IF NOT EXISTS idx_word_enrichment_word ON word_enrichment(account_id, word_id);

-- 2) 扩展 word_card：新增字段（是否存在通过 ALTER TABLE 迁移；schema.sql 是首建，直接写全字段）
--    注意：schema v1.0 已经建了 word_card，若数据库已经存在，需要走独立 migration 补字段
CREATE TABLE IF NOT EXISTS word_card_v2_migration_marker (v INTEGER PRIMARY KEY);
-- 前端启动时若发现 marker 不存在，会执行以下 ALTER：
--   ALTER TABLE word_card ADD COLUMN phonetic_uk TEXT;
--   ALTER TABLE word_card ADD COLUMN phonetic_us TEXT;
--   ALTER TABLE word_card ADD COLUMN meaning_context TEXT;
--   ALTER TABLE word_card ADD COLUMN status TEXT DEFAULT 'new';
--   ALTER TABLE word_card ADD COLUMN tags TEXT;
--   ALTER TABLE word_card ADD COLUMN notes TEXT;
--   ALTER TABLE word_card ADD COLUMN repetitions INTEGER DEFAULT 0;
--   ALTER TABLE word_card ADD COLUMN last_review_at TEXT;
--   ALTER TABLE word_card ADD COLUMN item_kind TEXT;   -- v2.1 持久化 Tab 归类

-- 3) 一个词的多个语境
CREATE TABLE IF NOT EXISTS word_context (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  word_id             TEXT    NOT NULL REFERENCES word_card(id),
  sentence            TEXT    NOT NULL,
  translation         TEXT,
  source              TEXT,
  source_ref          TEXT,
  created_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_word_context_word ON word_context(word_id, is_deleted);

-- 4) 句子收藏
CREATE TABLE IF NOT EXISTS sentence_bookmark (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  original            TEXT    NOT NULL,
  translation         TEXT,
  alt_translations    TEXT,
  tags                TEXT,
  notes               TEXT,
  source              TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sentence_bookmark_account ON sentence_bookmark(account_id, is_deleted);

-- 5) 查询历史（同时是 LLM 结果缓存）
CREATE TABLE IF NOT EXISTS query_history (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  query_text          TEXT    NOT NULL,
  query_type          TEXT    NOT NULL,       -- word / phrase / sentence_en / sentence_zh
  result_json         TEXT,
  created_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_query_history_account ON query_history(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_history_text    ON query_history(account_id, query_text);

-- 6) 阅读材料
CREATE TABLE IF NOT EXISTS read_document (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  title               TEXT,
  content             TEXT    NOT NULL,
  word_count          INTEGER NOT NULL DEFAULT 0,
  words_found         TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);

-- 7) SRS 复习日志
CREATE TABLE IF NOT EXISTS srs_review_log (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  word_id             TEXT    NOT NULL REFERENCES word_card(id),
  rating              TEXT    NOT NULL,       -- unknown / vague / known / skip
  interval_before     INTEGER,
  interval_after      INTEGER,
  ease_before         REAL,
  ease_after          REAL,
  reviewed_at         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_srs_log_word ON srs_review_log(word_id, reviewed_at);

-- 8) 听写日志
CREATE TABLE IF NOT EXISTS dictation_log (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  word_id             TEXT    NOT NULL REFERENCES word_card(id),
  mode                TEXT    NOT NULL,       -- listen_spell / cn2en
  user_input          TEXT,
  correct             INTEGER NOT NULL DEFAULT 0,
  answered_at         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dictation_word ON dictation_log(word_id, answered_at);

-- 9) 用户"我认识"清单（没收藏但也不高亮）
CREATE TABLE IF NOT EXISTS known_word_hint_off (
  id                  TEXT    PRIMARY KEY,
  account_id          TEXT    NOT NULL REFERENCES account(id),
  word                TEXT    NOT NULL,
  created_at          TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_known_word_hint ON known_word_hint_off(account_id, word);

-- =============================================================================
-- schema_version 迁移版本
-- =============================================================================
CREATE TABLE IF NOT EXISTS schema_version (
  version             INTEGER PRIMARY KEY,
  applied_at          TEXT    NOT NULL,
  note                TEXT
);
INSERT OR IGNORE INTO schema_version(version, applied_at, note) VALUES (1, datetime('now'), 'Initial schema v1.0');
INSERT OR IGNORE INTO schema_version(version, applied_at, note) VALUES (2, datetime('now'), 'English module tables v1.0');

-- =============================================================================
-- English module v1.1 · 多实例翻译配置
-- =============================================================================
CREATE TABLE IF NOT EXISTS dict_source (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES account(id),
  name          TEXT NOT NULL,
  source_url    TEXT,
  file_size     INTEGER DEFAULT 0,
  entry_count   INTEGER DEFAULT 0,
  format        TEXT DEFAULT 'ecdict',
  data_table    TEXT NOT NULL,
  is_enabled    INTEGER DEFAULT 1,
  seq_no        INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  is_deleted    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dict_source_account ON dict_source(account_id, is_deleted);

CREATE TABLE IF NOT EXISTS engine_provider (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES account(id),
  provider      TEXT NOT NULL,        -- baidu/deepl/youdao/tencent/volc/google/azure/custom
  display_name  TEXT NOT NULL,
  credentials   TEXT DEFAULT '{}',    -- JSON: 各家的字段
  is_enabled    INTEGER DEFAULT 1,
  seq_no        INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  is_deleted    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_engine_provider_account ON engine_provider(account_id, is_deleted);

CREATE TABLE IF NOT EXISTS ai_provider (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES account(id),
  provider      TEXT NOT NULL,        -- deepseek/openai/anthropic/kimi/qwen/glm/volc/siliconflow/openrouter/custom
  display_name  TEXT NOT NULL,
  base_url      TEXT,
  api_key       TEXT,
  model         TEXT,
  is_enabled    INTEGER DEFAULT 1,
  seq_no        INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  is_deleted    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_provider_account ON ai_provider(account_id, is_deleted);

INSERT OR IGNORE INTO schema_version(version, applied_at, note) VALUES (3, datetime('now'), 'English v1.1 multi-instance translation config');
