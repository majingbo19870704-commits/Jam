// =============================================================================
// db/client.ts · SQLite 数据库连接单例
// =============================================================================
//
// 通过 tauri-plugin-sql 提供的 Database 类连接数据文件。
// 数据库路径由 Tauri 壳解析：`sqlite:data.db` 会落到 app data dir。
// schema.sql 的执行由 Tauri 壳的 migrations 机制在首次启动时完成。
// =============================================================================

import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { v4 as uuid } from 'uuid';
// Vite 的 ?raw import 把 schema.sql 内容作为字符串引入
import schemaSql from '../../schema/schema.sql?raw';

let _db: Database | null = null;
let _schemaEnsured = false;

/**
 * 获取数据库连接（单例）
 * 首次调用时：
 *   1. Tauri 壳里配置的 migrations 会尝试自动执行 schema.sql
 *   2. 我们再做一次前端自查，若 account 表不存在则手动补建
 *      （防止迁移在部分环境下静默失败）
 */
export async function getDb(): Promise<Database> {
  if (_db && _schemaEnsured) return _db;
  if (!_db) _db = await Database.load('sqlite:data.db');
  if (!_schemaEnsured) {
    await ensureSchema(_db);
    // 兼容旧版 DPAPI 密钥：迁移到数据库后便可随数据备份完整恢复。
    await invoke('migrate_provider_secrets_to_database').catch((error) =>
      console.warn('[provider key migration] skipped:', error),
    );
    _schemaEnsured = true;
  }
  return _db;
}

/**
 * 恢复备份前释放 Tauri SQL 的连接池，Windows 才能原子替换 data.db。
 * 下次任意 DAO 调用会自动打开新连接并重新执行必要迁移。
 */
export async function closeDbConnection(): Promise<void> {
  if (!_db) return;
  await _db.close();
  _db = null;
  _schemaEnsured = false;
}

/**
 * 自查 schema，如果核心表不存在则手动执行 schema.sql
 * 分段执行：SQL 按 `;` 拆分，跳过注释行与空段
 * 同时执行增量迁移（如为已存在的 word_card 补字段）
 */
async function ensureSchema(db: Database) {
  const check = await db.select<Array<{ n: number }>>(
    `SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='account'`,
  );
  const hasAccount = check?.[0]?.n > 0;

  if (!hasAccount) {
    const statements = splitSql(schemaSql);
    for (const stmt of statements) {
      try {
        await db.execute(stmt);
      } catch (e) {
        console.error('[schema init] failed at statement:', stmt.slice(0, 80), e);
        throw e;
      }
    }
  } else {
    // 已有库：拉取所有 "English module" 相关块（CREATE TABLE IF NOT EXISTS 幂等）
    const patchStart = schemaSql.indexOf('-- English module v1.0');
    if (patchStart >= 0) {
      const patchSql = schemaSql.slice(patchStart);
      const statements = splitSql(patchSql);
      for (const stmt of statements) {
        try {
          await db.execute(stmt);
        } catch (e) {
          console.warn('[schema patch] skip:', stmt.slice(0, 60), e);
        }
      }
    }
  }

  // 应用级 PRAGMA
  try {
    await db.execute('PRAGMA foreign_keys = ON;');
  } catch {
    /* ignore */
  }

  // word_card v2 迁移（补字段）
  await migrateWordCardV2(db);

  // 英语模块 v3 迁移（query_history 扩字段等）
  await migrateEnglishV3(db);

  // AI 助手 v1：专业助理、会话与消息表
  await migrateAiAssistantV1(db);

  // 知识库 v2：Obsidian Vault 只读浏览、全文检索和 AI 会话
  await migrateKnowledgeVaultV2(db);
  await migrateNotificationsV1(db);
  await migratePerformanceIndexesV1(db);
  await migrateWorkRemindersV1(db);
  await migrateScheduleEventsV1(db);
  await backfillScheduleTypeSeed(db);
  await migrateProjectDependenciesV1(db);
  await migrateProjectAssigneesV1(db);
  await migrateProjectFileArchiveV1(db);
  await migrateMaterialManagementV1(db);
  await migrateSingleOwnerV2(db);
}

/** 资料管理：独立参数表、归档设置与文件登记。老库按默认资料分类补齐配置。 */
async function migrateMaterialManagementV1(db: Database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS material_brand (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, remark TEXT, seq_no INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_material_brand_name ON material_brand(account_id, name) WHERE is_deleted = 0`,
    `CREATE TABLE IF NOT EXISTS material_model (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, brand TEXT, client_model TEXT NOT NULL, skyworth_model TEXT NOT NULL, remark TEXT, seq_no INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS material_file_parameter (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, material_type TEXT NOT NULL, file_type TEXT NOT NULL, remark TEXT, seq_no INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_material_file_type ON material_file_parameter(account_id, file_type) WHERE is_deleted = 0`,
    `CREATE TABLE IF NOT EXISTS material_setting (account_id TEXT PRIMARY KEY, archive_root TEXT, recycle_retention_days INTEGER NOT NULL DEFAULT 7, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS material_file (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, seq_no INTEGER NOT NULL DEFAULT 0, material_type TEXT NOT NULL, file_parameter_id TEXT NOT NULL, original_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'valid', brand_id TEXT, client_model_id TEXT, skyworth_model_id TEXT, archive_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_material_file_account ON material_file(account_id, is_deleted, seq_no)`,
  ];
  try {
    for (const statement of statements) await db.execute(statement);
    const columns = await db.select<Array<{ name: string }>>('PRAGMA table_info(project_file)');
    if (!columns.some((column) => column.name === 'file_parameter_id'))
      await db.execute('ALTER TABLE project_file ADD COLUMN file_parameter_id TEXT');
    const modelColumns = await db.select<Array<{ name: string }>>('PRAGMA table_info(material_model)');
    if (!modelColumns.some((column) => column.name === 'brand'))
      await db.execute('ALTER TABLE material_model ADD COLUMN brand TEXT');
    const fileParameterColumns = await db.select<Array<{ name: string }>>('PRAGMA table_info(material_file_parameter)');
    if (!fileParameterColumns.some((column) => column.name === 'is_draft'))
      await db.execute('ALTER TABLE material_file_parameter ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0');
    const accounts = await db.select<Array<{ id: string }>>('SELECT id FROM account WHERE is_deleted = 0');
    const types = ['产品资料', '工艺资料', '质量资料', '其他资料', '项目资料'];
    const now = new Date().toISOString();
    for (const account of accounts) {
      await db.execute(`INSERT OR IGNORE INTO material_setting (account_id, archive_root, recycle_retention_days, updated_at) VALUES ($1, NULL, 7, $2)`, [account.id, now]);
      const existing = await db.select<Array<{ n: number }>>(`SELECT COUNT(*) AS n FROM material_file_parameter WHERE account_id=$1 AND is_deleted=0`, [account.id]);
      if ((existing[0]?.n ?? 0) === 0) for (let index = 0; index < types.length; index++) await db.execute(
        `INSERT INTO material_file_parameter (id, account_id, material_type, file_type, remark, seq_no, created_at, updated_at, is_deleted) VALUES ($1,$2,$3,'其他',NULL,$4,$5,$5,0)`,
        [uuid(), account.id, types[index], index + 1, now],
      );
    }
  } catch (error) { console.warn('[migrateMaterialManagementV1] failed:', error); }
}

/**
 * 单一主人档案迁移。
 *
 * 旧版曾创建默认 Admin 账户并提供多账号入口。新版不再创建任何默认账户：
 * - 新库保持无主人，首次启动进入一次性初始化；
 * - 仅一个非 Admin 旧账户时自动将其保留为主人；
 * - 多个旧账户时不猜测、不合并，要求用户在一次性初始化页选择；
 * - 仅有旧 Admin 时强制重新初始化，杜绝 Admin/Admin 默认凭据继续可用。
 */
async function migrateSingleOwnerV2(db: Database) {
  for (const statement of [
    'ALTER TABLE account ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE account ADD COLUMN requires_setup INTEGER NOT NULL DEFAULT 0',
  ]) {
    try {
      await db.execute(statement);
    } catch {
      /* 已存在字段 */
    }
  }
  const accounts = await db.select<Array<{ id: string; username: string; is_owner: number }>>(
    `SELECT id, username, COALESCE(is_owner, 0) AS is_owner
     FROM account WHERE is_deleted = 0 ORDER BY last_login_at DESC, created_at ASC`,
  );
  if (accounts.some((account) => account.is_owner === 1)) return;
  const realProfiles = accounts.filter((account) => account.username !== 'Admin');
  if (realProfiles.length === 1) {
    await db.execute('UPDATE account SET is_owner = 1 WHERE id = $1', [realProfiles[0].id]);
  } else if (accounts.length === 1 && accounts[0].username === 'Admin') {
    await db.execute('UPDATE account SET is_owner = 1, requires_setup = 1 WHERE id = $1', [
      accounts[0].id,
    ]);
  }
}

/** 独立日程表：日程与工作事项分别管理，但共用本地提醒与通知中心。 */
async function migrateScheduleEventsV1(db: Database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS schedule_event (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), title TEXT NOT NULL,
      starts_at TEXT NOT NULL, ends_at TEXT, all_day INTEGER NOT NULL DEFAULT 0,
      reminder_at TEXT, snooze_until TEXT, reminder_repeat TEXT NOT NULL DEFAULT 'none', type_id TEXT,
      color TEXT NOT NULL DEFAULT '#4D7CFE', repeat_until TEXT, repeat_exdates TEXT NOT NULL DEFAULT '[]', notes TEXT, completed_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0)`,
    'CREATE INDEX IF NOT EXISTS idx_schedule_event_time ON schedule_event(account_id, starts_at, is_deleted)',
    'CREATE INDEX IF NOT EXISTS idx_schedule_event_reminder ON schedule_event(account_id, reminder_at, is_deleted)',
  ];
  for (const statement of statements) {
    try {
      await db.execute(statement);
    } catch (error) {
      console.warn('[migrateScheduleEventsV1] failed:', error);
    }
  }
  try {
    const columns = await db.select<Array<{ name: string }>>('PRAGMA table_info(schedule_event)');
    const additions: Record<string, string> = {
      completed_at: 'TEXT',
      snooze_until: 'TEXT',
      type_id: 'TEXT',
      repeat_until: 'TEXT',
      repeat_exdates: "TEXT NOT NULL DEFAULT '[]'",
    };
    for (const [name, definition] of Object.entries(additions)) {
      if (!columns.some((column) => column.name === name))
        await db.execute(`ALTER TABLE schedule_event ADD COLUMN ${name} ${definition}`);
    }
  } catch (error) {
    console.warn('[migrateScheduleEventsV1] completion migration failed:', error);
  }
}

/** 为既有账号补齐可自定义的日程类型。颜色由设置项按类型 ID 保存。 */
async function backfillScheduleTypeSeed(db: Database) {
  const items = ['工作', '项目', '学习', '个人'];
  const now = new Date().toISOString();
  try {
    const accounts = await db.select<Array<{ id: string }>>(
      `SELECT id FROM account WHERE COALESCE(is_deleted, 0) = 0`,
    );
    for (const account of accounts) {
      const existing = await db.select<Array<{ n: number }>>(
        `SELECT COUNT(*) as n FROM param_option
         WHERE account_id = $1 AND group_code = 'schedule_type' AND is_deleted = 0`,
        [account.id],
      );
      if ((existing[0]?.n ?? 0) > 0) continue;
      for (let index = 0; index < items.length; index++) {
        await db.execute(
          `INSERT INTO param_option (id, account_id, group_code, name, seq_no, is_system_default, created_at, updated_at, is_deleted)
           VALUES ($1, $2, 'schedule_type', $3, $4, 1, $5, $5, 0)`,
          [uuid(), account.id, items[index], index + 1, now],
        );
      }
    }
    const palette = ['#4D7CFE', '#E17A36', '#179C70', '#9761E8'];
    for (const account of accounts) {
      const types = await db.select<Array<{ id: string }>>(
        `SELECT id FROM param_option WHERE account_id=$1 AND group_code='schedule_type' AND is_deleted=0 ORDER BY seq_no`,
        [account.id],
      );
      for (let index = 0; index < Math.min(types.length, palette.length); index++) {
        await db.execute(
          `UPDATE schedule_event SET type_id=$1 WHERE account_id=$2 AND is_deleted=0 AND type_id IS NULL AND color=$3`,
          [types[index].id, account.id, palette[index]],
        );
      }
    }
  } catch (error) {
    console.warn('[backfillScheduleTypeSeed] failed:', error);
  }
}

/** 为既有 WBS 任务补前置依赖列表。JSON 字段保存任务 ID，保证改名不影响排期关系。 */
async function migrateProjectDependenciesV1(db: Database) {
  try {
    const columns = await db.select<Array<{ name: string }>>('PRAGMA table_info(project_wbs)');
    if (!columns.some((column) => column.name === 'depends_on'))
      await db.execute("ALTER TABLE project_wbs ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]'");
  } catch (error) {
    console.warn('[migrateProjectDependenciesV1] failed:', error);
  }
}

/** 为 WBS 任务补负责人列表，以成员 ID 保存，改名后分配关系不受影响。 */
async function migrateProjectAssigneesV1(db: Database) {
  try {
    const columns = await db.select<Array<{ name: string }>>('PRAGMA table_info(project_wbs)');
    if (!columns.some((column) => column.name === 'assignee_member_ids'))
      await db.execute(
        "ALTER TABLE project_wbs ADD COLUMN assignee_member_ids TEXT NOT NULL DEFAULT '[]'",
      );
  } catch (error) {
    console.warn('[migrateProjectAssigneesV1] failed:', error);
  }
}

/** 为项目文件补外部归档地址：项目保存归档根目录，文件保存实际归档路径。 */
async function migrateProjectFileArchiveV1(db: Database) {
  try {
    const projectColumns = await db.select<Array<{ name: string }>>('PRAGMA table_info(project)');
    if (!projectColumns.some((column) => column.name === 'archive_root'))
      await db.execute('ALTER TABLE project ADD COLUMN archive_root TEXT');
    const fileColumns = await db.select<Array<{ name: string }>>('PRAGMA table_info(project_file)');
    if (!fileColumns.some((column) => column.name === 'archive_path'))
      await db.execute('ALTER TABLE project_file ADD COLUMN archive_path TEXT');
  } catch (error) {
    console.warn('[migrateProjectFileArchiveV1] failed:', error);
  }
}

/** 为既有工作事项补齐精确到分钟的提醒时间。 */
async function migrateWorkRemindersV1(db: Database) {
  try {
    const columns = await db.select<Array<{ name: string }>>('PRAGMA table_info(work_item)');
    if (!columns.some((column) => column.name === 'reminder_at'))
      await db.execute('ALTER TABLE work_item ADD COLUMN reminder_at TEXT');
    if (!columns.some((column) => column.name === 'reminder_repeat'))
      await db.execute(
        "ALTER TABLE work_item ADD COLUMN reminder_repeat TEXT NOT NULL DEFAULT 'none'",
      );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_work_item_reminder ON work_item(account_id, reminder_at, is_deleted)',
    );
  } catch (error) {
    console.warn('[migrateWorkRemindersV1] failed:', error);
  }
}

/**
 * 面向既有数据库补齐按账号过滤的复合索引。
 * 页面列表和全局搜索都以 account_id + is_deleted 作为第一层筛选，
 * 因此不需要扫描其他账号的历史数据。
 */
async function migratePerformanceIndexesV1(db: Database) {
  const statements = [
    'CREATE INDEX IF NOT EXISTS idx_wbs_account ON project_wbs(account_id, is_deleted)',
    'CREATE INDEX IF NOT EXISTS idx_risk_account ON project_risk(account_id, is_deleted)',
    'CREATE INDEX IF NOT EXISTS idx_file_account ON project_file(account_id, is_deleted)',
    'CREATE INDEX IF NOT EXISTS idx_member_account ON project_member(account_id, is_deleted)',
  ];
  for (const statement of statements) {
    try {
      await db.execute(statement);
    } catch (error) {
      console.warn('[migratePerformanceIndexesV1] failed:', error);
    }
  }
}

async function migrateNotificationsV1(db: Database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS notification (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), kind TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, link TEXT, dedupe_key TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, read_at TEXT,
      UNIQUE(account_id, dedupe_key))`,
    `CREATE INDEX IF NOT EXISTS idx_notification_inbox
      ON notification(account_id, is_read, created_at DESC)`,
  ];
  for (const statement of statements) {
    try {
      await db.execute(statement);
    } catch (error) {
      console.warn('[migrateNotificationsV1] failed:', error);
    }
  }
}

async function migrateKnowledgeVaultV2(db: Database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS knowledge_vault (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), name TEXT NOT NULL,
      root_path TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, last_scanned_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0,
      UNIQUE(account_id, root_path))`,
    `CREATE INDEX IF NOT EXISTS idx_knowledge_vault_account
      ON knowledge_vault(account_id, is_deleted, is_default)`,
    `CREATE TABLE IF NOT EXISTS knowledge_file_index (
      vault_id TEXT NOT NULL REFERENCES knowledge_vault(id), path TEXT NOT NULL, name TEXT NOT NULL,
      extension TEXT, size INTEGER NOT NULL DEFAULT 0, modified_at INTEGER, updated_at TEXT NOT NULL,
      PRIMARY KEY(vault_id, path))`,
    `CREATE TABLE IF NOT EXISTS knowledge_document_index (
      vault_id TEXT NOT NULL REFERENCES knowledge_vault(id), path TEXT NOT NULL, title TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '', frontmatter TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0, modified_at INTEGER, updated_at TEXT NOT NULL,
      PRIMARY KEY(vault_id, path))`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_document_fts USING fts5(
      vault_id UNINDEXED, path UNINDEXED, title, content, tags, tokenize='unicode61')`,
    `CREATE TABLE IF NOT EXISTS knowledge_ai_session (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), vault_id TEXT NOT NULL REFERENCES knowledge_vault(id),
      question TEXT NOT NULL, answer TEXT NOT NULL, citations_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_knowledge_ai_session_vault
      ON knowledge_ai_session(account_id, vault_id, created_at DESC)`,
  ];
  for (const statement of statements) {
    try {
      await db.execute(statement);
    } catch (e) {
      console.warn('[migrateKnowledgeVaultV2] failed:', e);
    }
  }
}

/**
 * 检查并补齐 word_card 表的英语模块新字段
 *
 * 迁移原则：
 *  1) 不再单纯依赖 marker 表判断"已迁移"，因为一旦迁移函数中途新增了字段，
 *     旧库带着 marker 会跳过新加的字段导致 INSERT 失败。
 *  2) 每次启动都用 PRAGMA table_info(word_card) 拿到真实列表，
 *     对缺失列执行 ALTER。存在则直接跳过。
 *  3) marker 表仅保留兼容语义，写入最新版本号。
 */
async function migrateWordCardV2(db: Database) {
  // 拉取当前 word_card 真实列
  let existingCols = new Set<string>();
  try {
    const cols = await db.select<Array<{ name: string }>>(`PRAGMA table_info(word_card)`);
    existingCols = new Set(cols.map((c) => c.name));
  } catch (e) {
    console.warn('[migrateWordCardV2] PRAGMA table_info failed:', e);
    return;
  }
  if (existingCols.size === 0) return; // word_card 不存在（一般不会走到这）

  // 需要保证存在的列（列名 → ALTER SQL）
  const required: Record<string, string> = {
    phonetic_uk: `ALTER TABLE word_card ADD COLUMN phonetic_uk TEXT`,
    phonetic_us: `ALTER TABLE word_card ADD COLUMN phonetic_us TEXT`,
    meaning_context: `ALTER TABLE word_card ADD COLUMN meaning_context TEXT`,
    status: `ALTER TABLE word_card ADD COLUMN status TEXT DEFAULT 'new'`,
    tags: `ALTER TABLE word_card ADD COLUMN tags TEXT`,
    notes: `ALTER TABLE word_card ADD COLUMN notes TEXT`,
    repetitions: `ALTER TABLE word_card ADD COLUMN repetitions INTEGER DEFAULT 0`,
    last_review_at: `ALTER TABLE word_card ADD COLUMN last_review_at TEXT`,
    item_kind: `ALTER TABLE word_card ADD COLUMN item_kind TEXT`,
  };

  for (const [col, sql] of Object.entries(required)) {
    if (existingCols.has(col)) continue;
    try {
      await db.execute(sql);
      console.info('[migrateWordCardV2] added column:', col);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes('duplicate column')) {
        console.warn('[migrateWordCardV2] failed:', sql, msg);
      }
    }
  }

  // marker 表（兼容用），写入最新版本号 v=2 表示到 item_kind 一版
  try {
    await db.execute(
      'CREATE TABLE IF NOT EXISTS word_card_v2_migration_marker (v INTEGER PRIMARY KEY)',
    );
    await db.execute('INSERT OR IGNORE INTO word_card_v2_migration_marker(v) VALUES (2)');
  } catch {
    /* ignore */
  }

  // 回填 item_kind：只对 NULL 行做，规则与 detectKind() 保持一致
  try {
    await db.execute(
      `UPDATE word_card SET item_kind = 'word'
       WHERE item_kind IS NULL AND instr(word, ' ') = 0`,
    );
    await db.execute(
      `UPDATE word_card SET item_kind = 'phrase'
       WHERE item_kind IS NULL
         AND (length(word) - length(replace(word, ' ', ''))) <= 3
         AND length(word) < 30`,
    );
    await db.execute(`UPDATE word_card SET item_kind = 'sentence' WHERE item_kind IS NULL`);
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_word_kind ON word_card(account_id, item_kind, is_deleted)`,
    );
  } catch (e) {
    console.warn('[migrateWordCardV2] backfill item_kind failed:', e);
  }
}

/**
 * 英语模块 v3 迁移
 *  - query_history 追加 provider_instance_id / direction 字段（用于翻译缓存）
 *  - 清理 v1 遗留的 setting_kv（保留在批次 C，暂不做）
 */
async function migrateEnglishV3(db: Database) {
  try {
    const cols = await db.select<Array<{ name: string }>>(`PRAGMA table_info(query_history)`);
    const has = new Set(cols.map((c) => c.name));
    if (!has.has('provider_instance_id')) {
      await db.execute(`ALTER TABLE query_history ADD COLUMN provider_instance_id TEXT`);
    }
    if (!has.has('direction')) {
      await db.execute(`ALTER TABLE query_history ADD COLUMN direction TEXT`);
    }
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_qh_lookup
       ON query_history(account_id, query_text, query_type, provider_instance_id, direction, created_at)`,
    );
  } catch (e) {
    console.warn('[migrateEnglishV3] failed:', e);
  }

  // 为已存在但缺 english_type 参数组的老账号补 seed
  try {
    await backfillEnglishTypeSeed(db);
  } catch (e) {
    console.warn('[migrateEnglishV3] backfill english_type seed failed:', e);
  }

  // 清理 v1 翻译遗留的 setting_kv 键（translators.ts 已废弃）
  try {
    const legacyKeys = [
      'english.llm_provider',
      'english.llm_key',
      'english.llm_model',
      'english.llm_base',
      'english.baidu_appid',
      'english.baidu_secret',
      'english.deepl_key',
      'english.engine_llm',
      'english.engine_baidu',
      'english.engine_deepl',
    ];
    for (const k of legacyKeys) {
      await db.execute(`DELETE FROM setting_kv WHERE scope = 'app' AND key = $1`, [k]);
    }
  } catch (e) {
    console.warn('[migrateEnglishV3] purge legacy setting_kv failed:', e);
  }
}

async function migrateAiAssistantV1(db: Database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS assistant_profile (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), name TEXT NOT NULL,
      role_definition TEXT NOT NULL, avatar_key TEXT NOT NULL DEFAULT 'bot',
      default_provider_id TEXT, default_model_id TEXT, fallback_provider_id TEXT,
      default_model_label TEXT NOT NULL DEFAULT '待配置模型', knowledge_scope_json TEXT NOT NULL DEFAULT '[]',
      tools_json TEXT NOT NULL DEFAULT '[]', is_builtin INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_assistant_profile_account
      ON assistant_profile(account_id, is_deleted, is_enabled)`,
    `CREATE TABLE IF NOT EXISTS assistant_conversation (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id),
      profile_id TEXT NOT NULL REFERENCES assistant_profile(id), title TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_assistant_conversation_profile
      ON assistant_conversation(profile_id, is_deleted, updated_at)`,
    `CREATE TABLE IF NOT EXISTS assistant_message (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES assistant_conversation(id),
      role TEXT NOT NULL, content TEXT NOT NULL, citations_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_assistant_message_conversation
      ON assistant_message(conversation_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS assistant_provider_connection (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), name TEXT NOT NULL,
      provider_kind TEXT NOT NULL, base_url TEXT NOT NULL, model_id TEXT NOT NULL, api_key TEXT, secret_ref TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1, daily_request_limit INTEGER, monthly_request_limit INTEGER,
      last_tested_at TEXT, last_test_status TEXT, last_test_message TEXT, last_test_latency_ms INTEGER,
      input_price_per_million_cny REAL, output_price_per_million_cny REAL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_assistant_provider_account
      ON assistant_provider_connection(account_id, is_deleted, is_enabled)`,
    `CREATE TABLE IF NOT EXISTS assistant_provider_usage (
      provider_id TEXT NOT NULL REFERENCES assistant_provider_connection(id), period_key TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL, PRIMARY KEY (provider_id, period_key))`,
    `CREATE TABLE IF NOT EXISTS assistant_knowledge_source (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id),
      profile_id TEXT NOT NULL REFERENCES assistant_profile(id), name TEXT NOT NULL, source_type TEXT NOT NULL,
      source_path TEXT NOT NULL, include_subdirs INTEGER NOT NULL DEFAULT 1, is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_assistant_knowledge_profile
      ON assistant_knowledge_source(profile_id, is_deleted, is_enabled)`,
    `CREATE TABLE IF NOT EXISTS assistant_global_knowledge_source (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), name TEXT NOT NULL,
      source_type TEXT NOT NULL, source_path TEXT NOT NULL, include_subdirs INTEGER NOT NULL DEFAULT 1,
      is_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_assistant_global_knowledge_account
      ON assistant_global_knowledge_source(account_id, is_deleted, is_enabled)`,
    `CREATE TABLE IF NOT EXISTS assistant_action_request (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id), profile_id TEXT NOT NULL REFERENCES assistant_profile(id),
      conversation_id TEXT, action_kind TEXT NOT NULL, summary TEXT NOT NULL, payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, resolved_at TEXT, error_message TEXT,
      result_summary TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_assistant_action_profile
      ON assistant_action_request(profile_id, status, created_at)`,
    `CREATE TABLE IF NOT EXISTS assistant_action_authorization (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id),
      profile_id TEXT NOT NULL REFERENCES assistant_profile(id), action_kind TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(account_id, profile_id, action_kind))`,
    `CREATE INDEX IF NOT EXISTS idx_assistant_action_authorization
      ON assistant_action_authorization(account_id, profile_id, is_enabled)`,
    `CREATE TABLE IF NOT EXISTS assistant_workflow (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id),
      profile_id TEXT NOT NULL REFERENCES assistant_profile(id), name TEXT NOT NULL,
      action_kind TEXT NOT NULL, payload_json TEXT NOT NULL, is_enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT, last_run_status TEXT, schedule_minutes INTEGER, last_scheduled_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_assistant_workflow_profile
      ON assistant_workflow(account_id, profile_id, is_deleted, is_enabled)`,
    `CREATE TABLE IF NOT EXISTS ai_web_account (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id),
      workspace_id TEXT NOT NULL REFERENCES ai_tool_link(id), login_url TEXT NOT NULL,
      username TEXT NOT NULL, secret_ref TEXT NOT NULL, username_selector TEXT NOT NULL,
      password_selector TEXT NOT NULL, submit_selector TEXT, auto_login INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_web_account_workspace
      ON ai_web_account(account_id, workspace_id) WHERE is_deleted = 0`,
    `CREATE INDEX IF NOT EXISTS idx_ai_web_account_workspace
      ON ai_web_account(account_id, workspace_id, is_deleted)`,
  ];
  for (const statement of statements) {
    try {
      await db.execute(statement);
    } catch (e) {
      console.warn('[migrateAiAssistantV1] failed:', e);
    }
  }
  try {
    const columns = await db.select<Array<{ name: string }>>(
      `PRAGMA table_info(assistant_profile)`,
    );
    for (const name of ['default_provider_id', 'default_model_id', 'fallback_provider_id']) {
      if (!columns.some((column) => column.name === name)) {
        await db.execute(`ALTER TABLE assistant_profile ADD COLUMN ${name} TEXT`);
      }
    }
  } catch (e) {
    console.warn('[migrateAiAssistantV1] default provider migration failed:', e);
  }
  try {
    const columns = await db.select<Array<{ name: string }>>(
      `PRAGMA table_info(assistant_provider_connection)`,
    );
    const required: Record<string, string> = {
      api_key: 'TEXT',
      daily_request_limit: 'INTEGER',
      monthly_request_limit: 'INTEGER',
      last_tested_at: 'TEXT',
      last_test_status: 'TEXT',
      last_test_message: 'TEXT',
      last_test_latency_ms: 'INTEGER',
      input_price_per_million_cny: 'REAL',
      output_price_per_million_cny: 'REAL',
    };
    for (const [name, type] of Object.entries(required)) {
      if (!columns.some((column) => column.name === name))
        await db.execute(`ALTER TABLE assistant_provider_connection ADD COLUMN ${name} ${type}`);
    }
  } catch (e) {
    console.warn('[migrateAiAssistantV1] provider limit migration failed:', e);
  }
  try {
    // 智谱已将旧的 glm-4-flash 引导替换为 glm-4.7-flash。仅迁移本应用过去
    // 默认写入的精确旧值，不触碰用户主动配置的其他 GLM 模型。
    await db.execute(
      `UPDATE assistant_provider_connection
       SET model_id = 'glm-4.7-flash', updated_at = $1
       WHERE provider_kind = 'zhipu' AND lower(trim(model_id)) = 'glm-4-flash' AND is_deleted = 0`,
      [new Date().toISOString()],
    );
  } catch (e) {
    console.warn('[migrateAiAssistantV1] Zhipu model migration failed:', e);
  }
  try {
    const columns = await db.select<Array<{ name: string }>>(
      `PRAGMA table_info(assistant_provider_usage)`,
    );
    for (const name of ['input_tokens', 'output_tokens']) {
      if (!columns.some((column) => column.name === name)) {
        await db.execute(
          `ALTER TABLE assistant_provider_usage ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`,
        );
      }
    }
  } catch (e) {
    console.warn('[migrateAiAssistantV1] provider usage migration failed:', e);
  }
  try {
    const columns = await db.select<Array<{ name: string }>>(
      `PRAGMA table_info(assistant_action_request)`,
    );
    if (!columns.some((column) => column.name === 'result_summary')) {
      await db.execute(`ALTER TABLE assistant_action_request ADD COLUMN result_summary TEXT`);
    }
  } catch (e) {
    console.warn('[migrateAiAssistantV1] action result migration failed:', e);
  }
  try {
    const columns = await db.select<Array<{ name: string }>>(
      `PRAGMA table_info(assistant_workflow)`,
    );
    const required: Record<string, string> = {
      schedule_minutes: 'INTEGER',
      last_scheduled_at: 'TEXT',
    };
    for (const [name, type] of Object.entries(required)) {
      if (!columns.some((column) => column.name === name)) {
        await db.execute(`ALTER TABLE assistant_workflow ADD COLUMN ${name} ${type}`);
      }
    }
  } catch (e) {
    console.warn('[migrateAiAssistantV1] workflow schedule migration failed:', e);
  }
}

/**
 * 老账号补 english_type 参数组
 *  - 检查每个账号是否已有 english_type 的选项，没有则灌入默认 7 项
 *  - 与 account-dao.ts::DEFAULT_PARAMS 中的 english_type 保持一致
 */
async function backfillEnglishTypeSeed(db: Database) {
  const items = ['工作', '学习', '生活', '雅思', '托福', 'CET-4', 'CET-6'];
  const now = new Date().toISOString();
  const accounts = await db.select<Array<{ id: string }>>(
    `SELECT id FROM account WHERE COALESCE(is_deleted, 0) = 0`,
  );
  for (const a of accounts) {
    const existed = await db.select<Array<{ n: number }>>(
      `SELECT COUNT(*) as n FROM param_option
       WHERE account_id = $1 AND group_code = 'english_type' AND is_deleted = 0`,
      [a.id],
    );
    if ((existed?.[0]?.n ?? 0) > 0) continue;
    for (let i = 0; i < items.length; i++) {
      await db.execute(
        `INSERT INTO param_option (id, account_id, group_code, name, seq_no, is_system_default, created_at, updated_at, is_deleted)
         VALUES ($1, $2, 'english_type', $3, $4, 1, $5, $5, 0)`,
        [uuid(), a.id, items[i], i + 1, now],
      );
    }
  }
}

/** 简易 SQL 分号切分：去掉行注释与空段 */
function splitSql(sql: string): string[] {
  const noLineComments = sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, '').trimEnd())
    .join('\n');
  return noLineComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 便捷方法：执行 SQL（INSERT/UPDATE/DELETE） */
export async function exec(sql: string, params: unknown[] = []) {
  const db = await getDb();
  return db.execute(sql, params);
}

/**
 * 将一批相关写入作为单个 SQLite 事务提交。
 * 导入中任一数据库写入失败时撤销本批已写入的记录，避免出现“提示失败但只导入了一半”。
 * 回调内须使用本文件导出的 DAO / exec / query，确保复用同一数据库连接。
 */
export async function withTransaction<T>(work: () => Promise<T>): Promise<T> {
  const db = await getDb();
  await db.execute('BEGIN IMMEDIATE');
  try {
    const value = await work();
    await db.execute('COMMIT');
    return value;
  } catch (error) {
    try {
      await db.execute('ROLLBACK');
    } catch {
      /* transaction may already be closed */
    }
    throw error;
  }
}

/** 便捷方法：查询多行 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

/** 便捷方法：查询单行（0 或 1 行） */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
