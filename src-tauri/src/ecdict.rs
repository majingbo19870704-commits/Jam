// =============================================================================
// ecdict.rs · ECDICT 词典的导入与查询（直接用 rusqlite 打开同一个 data.db）
// =============================================================================
//
// 数据源：https://github.com/skywind3000/ECDICT （MIT）
// CSV 列（v3 精简版）：
//   word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange[,detail,audio]
// =============================================================================

use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const ECDICT_ONLINE_URL: &str = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv";

#[derive(Default, Clone, Serialize)]
pub struct DictProgress {
    pub running: bool,
    pub imported: u64,
    pub total_estimate: u64,
    pub last_error: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Default)]
pub struct DictProgressStore(pub Mutex<DictProgress>);

fn set_progress(store: &State<'_, DictProgressStore>, updater: impl FnOnce(&mut DictProgress)) {
    if let Ok(mut g) = store.0.lock() {
        updater(&mut g);
    }
}

#[tauri::command]
pub fn ecdict_progress(store: State<'_, DictProgressStore>) -> DictProgress {
    store.0.lock().map(|g| g.clone()).unwrap_or_default()
}

/// 打开与 tauri-plugin-sql 相同的 data.db
fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let db_path = data_dir.join("data.db");
    let conn = Connection::open(&db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    Ok(conn)
}

/// 内置词典默认启用；设置页写入 0 后才停用。
fn builtin_enabled(conn: &Connection, key: &str) -> bool {
    conn.query_row(
        "SELECT value FROM setting_kv WHERE scope = 'app' AND key = ?1",
        params![key], |row| row.get::<_, String>(0),
    ).map(|value| value != "0").unwrap_or(true)
}

/// 自定义词典共用一个实体表，以 source_id 隔离各个词典。这个建表动作也让旧版本
/// 已存在的 data.db 无须重建即可获得导入能力。
fn ensure_custom_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS dict_custom_entry (
            source_id TEXT NOT NULL,
            word TEXT NOT NULL,
            phonetic TEXT,
            definition TEXT,
            translation TEXT,
            pos TEXT,
            collins INTEGER,
            oxford INTEGER,
            tag TEXT,
            bnc INTEGER,
            frq INTEGER,
            exchange TEXT,
            PRIMARY KEY(source_id, word)
        );
        CREATE INDEX IF NOT EXISTS idx_dict_custom_entry_word
            ON dict_custom_entry(word);",
    )
    .map_err(|e| format!("创建自定义词典表失败: {e}"))
}

#[derive(Serialize)]
pub struct DictEntry {
    pub word: String,
    pub phonetic: Option<String>,
    pub definition: Option<String>,
    pub translation: Option<String>,
    pub pos: Option<String>,
    pub collins: Option<i32>,
    pub oxford: Option<i32>,
    pub tag: Option<String>,
    pub bnc: Option<i64>,
    pub frq: Option<i64>,
    pub exchange: Option<String>,
}

/// 词典行数
#[tauri::command]
pub fn ecdict_status(app: AppHandle) -> Result<i64, String> {
    let conn = open_db(&app)?;
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM dict_ecdict", [], |r| r.get(0))
        .unwrap_or(0);
    Ok(n)
}

/// 精确查词（大小写不敏感）
#[tauri::command]
pub fn ecdict_lookup(
    app: AppHandle,
    word: String,
    account_id: Option<String>,
) -> Result<Option<DictEntry>, String> {
    let conn = open_db(&app)?;
    let w = word.trim().to_lowercase();
    if let Some(account_id) = account_id.filter(|id| !id.trim().is_empty()) {
        ensure_custom_table(&conn)?;
        let mut custom = conn
            .prepare(
                "SELECT e.word, e.phonetic, e.definition, e.translation, e.pos,
                        e.collins, e.oxford, e.tag, e.bnc, e.frq, e.exchange
                 FROM dict_custom_entry e
                 JOIN dict_source s ON s.id = e.source_id
                 WHERE s.account_id = ?1 AND s.is_deleted = 0 AND s.is_enabled = 1
                   AND lower(e.word) = ?2
                 ORDER BY s.seq_no ASC, s.created_at ASC LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = custom.query(params![account_id, w]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            return Ok(Some(DictEntry {
                word: row.get(0).unwrap_or_default(), phonetic: row.get(1).ok(),
                definition: row.get(2).ok(), translation: row.get(3).ok(), pos: row.get(4).ok(),
                collins: row.get(5).ok(), oxford: row.get(6).ok(), tag: row.get(7).ok(),
                bnc: row.get(8).ok(), frq: row.get(9).ok(), exchange: row.get(10).ok(),
            }));
        }
    }
    if !builtin_enabled(&conn, "dictionary.ecdict.enabled") { return Ok(None); }
    let mut stmt = conn
        .prepare(
            "SELECT word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange
             FROM dict_ecdict WHERE lower(word) = ?1 LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![w]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(Some(DictEntry {
            word: row.get(0).unwrap_or_default(),
            phonetic: row.get(1).ok(),
            definition: row.get(2).ok(),
            translation: row.get(3).ok(),
            pos: row.get(4).ok(),
            collins: row.get(5).ok(),
            oxford: row.get(6).ok(),
            tag: row.get(7).ok(),
            bnc: row.get(8).ok(),
            frq: row.get(9).ok(),
            exchange: row.get(10).ok(),
        }))
    } else {
        Ok(None)
    }
}

/// 将 ECDICT 兼容 CSV 真正写入指定的自定义词典，而不是只保存一条来源元信息。
#[tauri::command]
pub async fn custom_dict_import_csv(
    app: AppHandle,
    source_id: String,
    csv_path: String,
) -> Result<u64, String> {
    let path = PathBuf::from(&csv_path);
    if !path.is_file() { return Err(format!("找不到 CSV 文件: {csv_path}")); }
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || -> Result<u64, String> {
        let mut conn = open_db(&app_clone)?;
        ensure_custom_table(&conn)?;
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM dict_source WHERE id = ?1 AND is_deleted = 0)",
            params![source_id], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if !exists { return Err("词典来源不存在或已删除。".into()); }
        let file = std::fs::File::open(&path).map_err(|e| format!("打开 CSV 失败: {e}"))?;
        let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(file);
        let headers = reader.headers().map_err(|e| format!("CSV 表头无效: {e}"))?.clone();
        let column = |name: &str, fallback: usize| -> usize {
            headers.iter().position(|h| h.trim().eq_ignore_ascii_case(name)).unwrap_or(fallback)
        };
        let word_col = column("word", 0);
        let phonetic_col = column("phonetic", 1);
        let definition_col = column("definition", 2);
        let translation_col = column("translation", 3);
        let pos_col = column("pos", 4);
        let collins_col = column("collins", 5);
        let oxford_col = column("oxford", 6);
        let tag_col = column("tag", 7);
        let bnc_col = column("bnc", 8);
        let frq_col = column("frq", 9);
        let exchange_col = column("exchange", 10);
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM dict_custom_entry WHERE source_id = ?1", params![source_id])
            .map_err(|e| e.to_string())?;
        let mut count = 0_u64;
        {
            let mut insert = tx.prepare(
                "INSERT OR REPLACE INTO dict_custom_entry
                 (source_id, word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            ).map_err(|e| e.to_string())?;
            for record in reader.records() {
                let row = match record { Ok(row) => row, Err(_) => continue };
                let word = row.get(word_col).unwrap_or("").trim();
                if word.is_empty() { continue; }
                insert.execute(params![
                    source_id, word, row.get(phonetic_col).unwrap_or(""), row.get(definition_col).unwrap_or(""),
                    row.get(translation_col).unwrap_or(""), row.get(pos_col).unwrap_or(""),
                    row.get(collins_col).unwrap_or("").parse::<i32>().unwrap_or(0),
                    row.get(oxford_col).unwrap_or("").parse::<i32>().unwrap_or(0), row.get(tag_col).unwrap_or(""),
                    row.get(bnc_col).unwrap_or("").parse::<i64>().unwrap_or(0),
                    row.get(frq_col).unwrap_or("").parse::<i64>().unwrap_or(0), row.get(exchange_col).unwrap_or(""),
                ]).map_err(|e| e.to_string())?;
                count += 1;
            }
        }
        tx.execute(
            "UPDATE dict_source SET file_size = ?1, entry_count = ?2, data_table = 'dict_custom_entry', updated_at = ?3 WHERE id = ?4",
            params![size as i64, count as i64, chrono::Local::now().to_rfc3339(), source_id],
        ).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(count)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn custom_dict_remove(app: AppHandle, source_id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    ensure_custom_table(&conn)?;
    conn.execute("DELETE FROM dict_custom_entry WHERE source_id = ?1", params![source_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 前缀查询：拼写建议
#[tauri::command]
pub fn ecdict_prefix(
    app: AppHandle,
    prefix: String,
    limit: Option<i64>,
    account_id: Option<String>,
) -> Result<Vec<String>, String> {
    let conn = open_db(&app)?;
    let p = prefix.trim().to_lowercase();
    if p.is_empty() {
        return Ok(vec![]);
    }
    let like = format!("{}%", p);
    let lim = limit.unwrap_or(20).min(50);
    let mut out = Vec::new();
    if let Some(account) = account_id.filter(|id| !id.trim().is_empty()) {
        ensure_custom_table(&conn)?;
        let mut custom = conn.prepare("SELECT e.word FROM dict_custom_entry e JOIN dict_source s ON s.id=e.source_id WHERE s.account_id=?1 AND s.is_deleted=0 AND s.is_enabled=1 AND lower(e.word) LIKE ?2 ORDER BY s.seq_no,e.word LIMIT ?3").map_err(|e| e.to_string())?;
        let rows = custom.query_map(params![account, like, lim], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        for row in rows { if let Ok(word) = row { out.push(word); } }
    }
    if out.len() >= lim as usize { out.truncate(lim as usize); return Ok(out); }
    if !builtin_enabled(&conn, "dictionary.ecdict.enabled") { return Ok(out); }
    let mut stmt = conn
        .prepare(
            "SELECT word FROM dict_ecdict
             WHERE lower(word) LIKE ?1
             ORDER BY COALESCE(frq, 999999) ASC, word ASC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![like, lim], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for r in rows {
        if let Ok(s) = r {
            if !out.iter().any(|existing| existing.eq_ignore_ascii_case(&s)) { out.push(s); }
            if out.len() >= lim as usize { break; }
        }
    }
    Ok(out)
}

/// 反向查询：给中文，找包含该中文释义的英文单词
///
/// 过滤策略（只返回常用词）：
///  - collins ≥ 2  或  oxford ≥ 1  或  frq 排名 ≤ 20000
///  - 优先原型（exchange 里没有 "0:xxx"，即它自己就是原型）
///  - 按 collins 降序 + 词频升序排序（越常用越靠前）
///  - 默认最多返回 8 条
#[tauri::command]
pub fn ecdict_reverse_lookup(
    app: AppHandle,
    chinese: String,
    limit: Option<i64>,
    account_id: Option<String>,
) -> Result<Vec<DictEntry>, String> {
    let conn = open_db(&app)?;
    let q = chinese.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let lim = limit.unwrap_or(8).min(30);
    let like = format!("%{}%", q);

    let mut out = vec![];
    if let Some(account) = account_id.filter(|id| !id.trim().is_empty()) {
        ensure_custom_table(&conn)?;
        let mut custom = conn.prepare("SELECT e.word,e.phonetic,e.definition,e.translation,e.pos,e.collins,e.oxford,e.tag,e.bnc,e.frq,e.exchange FROM dict_custom_entry e JOIN dict_source s ON s.id=e.source_id WHERE s.account_id=?1 AND s.is_deleted=0 AND s.is_enabled=1 AND (e.translation LIKE ?2 OR e.definition LIKE ?2) ORDER BY s.seq_no,e.word LIMIT ?3").map_err(|e| e.to_string())?;
        let rows = custom.query_map(params![account, like, lim], entry_from_row).map_err(|e| e.to_string())?;
        for row in rows { if let Ok(entry) = row { out.push(entry); } }
    }
    if out.len() >= lim as usize { out.truncate(lim as usize); return Ok(out); }
    if !builtin_enabled(&conn, "dictionary.ecdict.enabled") { return Ok(out); }
    let mut stmt = conn.prepare(
        "SELECT word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange
         FROM dict_ecdict
         WHERE translation LIKE ?1
           AND (
             COALESCE(collins, 0) >= 2
             OR COALESCE(oxford, 0) >= 1
             OR (COALESCE(frq, 999999) > 0 AND frq <= 20000)
           )
           AND (exchange IS NULL OR exchange NOT LIKE '%0:%')
         ORDER BY
           COALESCE(collins, 0) DESC,
           COALESCE(oxford, 0) DESC,
           COALESCE(frq, 999999) ASC
         LIMIT ?2",
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![like, lim], entry_from_row)
        .map_err(|e| e.to_string())?;
    for r in rows {
        if let Ok(e) = r {
            if !out.iter().any(|existing: &DictEntry| existing.word.eq_ignore_ascii_case(&e.word)) { out.push(e); }
            if out.len() >= lim as usize { break; }
        }
    }
    Ok(out)
}

/// 词形还原：通过 exchange 字段
#[tauri::command]
pub fn ecdict_lemmatize(app: AppHandle, word: String, account_id: Option<String>) -> Result<Option<String>, String> {
    let conn = open_db(&app)?;
    let w = word.trim().to_lowercase();
    let mut exch: Option<String> = None;
    if let Some(account) = account_id.filter(|id| !id.trim().is_empty()) {
        ensure_custom_table(&conn)?;
        exch = conn.query_row("SELECT e.exchange FROM dict_custom_entry e JOIN dict_source s ON s.id=e.source_id WHERE s.account_id=?1 AND s.is_deleted=0 AND s.is_enabled=1 AND lower(e.word)=?2 LIMIT 1", params![account, w], |r| r.get(0)).ok();
    }
    if exch.is_none() && builtin_enabled(&conn, "dictionary.ecdict.enabled") { exch = conn
        .query_row(
            "SELECT exchange FROM dict_ecdict WHERE lower(word) = ?1 LIMIT 1",
            params![w],
            |r| r.get(0),
        )
        .ok(); }
    let Some(exch) = exch else {
        return Ok(None);
    };
    for seg in exch.split('/') {
        if let Some((tag, val)) = seg.split_once(':') {
            if tag == "0" {
                let val = val.trim();
                if !val.is_empty() && val != "self" && val != w.as_str() {
                    return Ok(Some(val.to_string()));
                }
            }
        }
    }
    Ok(None)
}

fn entry_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DictEntry> {
    Ok(DictEntry { word: row.get(0).unwrap_or_default(), phonetic: row.get(1).ok(), definition: row.get(2).ok(), translation: row.get(3).ok(), pos: row.get(4).ok(), collins: row.get(5).ok(), oxford: row.get(6).ok(), tag: row.get(7).ok(), bnc: row.get(8).ok(), frq: row.get(9).ok(), exchange: row.get(10).ok() })
}

/// 导入 ECDICT CSV
#[tauri::command]
pub async fn ecdict_import_csv(
    app: AppHandle,
    store: State<'_, DictProgressStore>,
    csv_path: String,
) -> Result<u64, String> {
    let path = PathBuf::from(&csv_path);
    if !path.exists() {
        return Err(format!("找不到文件: {}", csv_path));
    }
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let total_estimate = size / 100;

    set_progress(&store, |g| {
        g.running = true;
        g.imported = 0;
        g.total_estimate = total_estimate;
        g.last_error = None;
        g.finished_at = None;
    });

    // 由于 rusqlite Connection 不 Send，我们把整个导入放在阻塞任务里
    let app_clone = app.clone();
    let path_clone = path.clone();

    let count = tokio::task::spawn_blocking(move || -> Result<u64, String> {
        let mut conn = open_db(&app_clone)?;
        // 清空重导
        conn.execute("DELETE FROM dict_ecdict", []).ok();
        conn.pragma_update(None, "synchronous", "OFF").ok();
        conn.pragma_update(None, "journal_mode", "MEMORY").ok();

        let file = std::fs::File::open(&path_clone).map_err(|e| format!("打开失败: {e}"))?;
        let mut rdr = csv::ReaderBuilder::new().has_headers(true).from_reader(file);

        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut count: u64 = 0;
        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO dict_ecdict
                 (word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"
            ).map_err(|e| e.to_string())?;

            for result in rdr.records() {
                let rec = match result { Ok(r) => r, Err(_) => continue };
                let word = rec.get(0).unwrap_or("").trim();
                if word.is_empty() { continue; }
                let phonetic = rec.get(1).unwrap_or("");
                let definition = rec.get(2).unwrap_or("");
                let translation = rec.get(3).unwrap_or("");
                let pos = rec.get(4).unwrap_or("");
                let collins: i32 = rec.get(5).unwrap_or("").parse().unwrap_or(0);
                let oxford: i32 = rec.get(6).unwrap_or("").parse().unwrap_or(0);
                let tag = rec.get(7).unwrap_or("");
                let bnc: i64 = rec.get(8).unwrap_or("").parse().unwrap_or(0);
                let frq: i64 = rec.get(9).unwrap_or("").parse().unwrap_or(0);
                let exchange = rec.get(10).unwrap_or("");

                if stmt.execute(params![
                    word, phonetic, definition, translation, pos,
                    collins, oxford, tag, bnc, frq, exchange
                ]).is_ok() {
                    count += 1;
                }
            }
            // stmt 在此块结束时被 drop，释放 tx 的借用
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(count)
    })
    .await
    .map_err(|e| e.to_string())??;

    set_progress(&store, |g| {
        g.running = false;
        g.imported = count;
        g.finished_at = Some(chrono::Local::now().to_rfc3339());
    });
    Ok(count)
}

/// 从 ECDICT 官方 GitHub 仓库手动联网更新。下载完成后在单个事务内替换数据表。
#[tauri::command]
pub async fn ecdict_update_online(
    app: AppHandle,
    store: State<'_, DictProgressStore>,
) -> Result<u64, String> {
    set_progress(&store, |g| {
        g.running = true; g.imported = 0; g.total_estimate = 0;
        g.last_error = None; g.finished_at = None;
    });
    let bytes = match reqwest::Client::builder().user_agent("personal-workstation/1.0").build()
        .map_err(|e| e.to_string())?
        .get(ECDICT_ONLINE_URL).send().await.map_err(|e| format!("下载 ECDICT 失败: {e}"))?
        .error_for_status().map_err(|e| format!("下载 ECDICT 失败: {e}"))?
        .bytes().await.map_err(|e| format!("读取 ECDICT 数据失败: {e}")) {
            Ok(value) => value,
            Err(error) => {
                set_progress(&store, |g| { g.running = false; g.last_error = Some(error.clone()); });
                return Err(error);
            }
        };
    set_progress(&store, |g| { g.total_estimate = (bytes.len() as u64 / 100).max(1); });
    let app_clone = app.clone();
    let count = tokio::task::spawn_blocking(move || -> Result<u64, String> {
        let mut conn = open_db(&app_clone)?;
        conn.pragma_update(None, "synchronous", "OFF").ok();
        conn.pragma_update(None, "journal_mode", "MEMORY").ok();
        let mut rdr = csv::ReaderBuilder::new().has_headers(true).from_reader(std::io::Cursor::new(bytes));
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM dict_ecdict", []).map_err(|e| e.to_string())?;
        let mut count = 0_u64;
        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO dict_ecdict
                 (word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            ).map_err(|e| e.to_string())?;
            for result in rdr.records() {
                let rec = match result { Ok(row) => row, Err(_) => continue };
                let word = rec.get(0).unwrap_or("").trim();
                if word.is_empty() { continue; }
                stmt.execute(params![word, rec.get(1).unwrap_or(""), rec.get(2).unwrap_or(""), rec.get(3).unwrap_or(""), rec.get(4).unwrap_or(""), rec.get(5).unwrap_or("").parse::<i32>().unwrap_or(0), rec.get(6).unwrap_or("").parse::<i32>().unwrap_or(0), rec.get(7).unwrap_or(""), rec.get(8).unwrap_or("").parse::<i64>().unwrap_or(0), rec.get(9).unwrap_or("").parse::<i64>().unwrap_or(0), rec.get(10).unwrap_or("")]).map_err(|e| e.to_string())?;
                count += 1;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(count)
    }).await.map_err(|e| e.to_string())??;
    set_progress(&store, |g| { g.running = false; g.imported = count; g.finished_at = Some(chrono::Local::now().to_rfc3339()); });
    Ok(count)
}
