// =============================================================================
// wordnet.rs · Princeton WordNet `dict` 目录导入与本地查询
// =============================================================================
// 支持官方 WordNet 3.x 的 data.noun / data.verb / data.adj / data.adv 文件。

use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const WORDNET_ONLINE_BASE: &str = "https://raw.githubusercontent.com/delver/wordnet-db/master/dict";

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    Connection::open(dir.join("data.db")).map_err(|e| format!("打开数据库失败: {e}"))
}

fn builtin_enabled(conn: &Connection, key: &str) -> bool {
    conn.query_row(
        "SELECT value FROM setting_kv WHERE scope = 'app' AND key = ?1",
        params![key], |row| row.get::<_, String>(0),
    ).map(|value| value != "0").unwrap_or(true)
}

#[derive(Default, Clone)]
struct Synset {
    words: Vec<String>,
    antonym_offsets: Vec<String>,
    examples: Vec<String>,
}

#[derive(Default)]
struct Aggregate {
    synonyms: HashSet<String>,
    antonyms: HashSet<String>,
    examples: HashSet<String>,
}

#[derive(Serialize)]
pub struct WordNetEntry {
    pub word: String,
    pub synonyms: Vec<String>,
    pub antonyms: Vec<String>,
    pub examples: Vec<String>,
}

#[tauri::command]
pub fn wordnet_status(app: AppHandle) -> Result<i64, String> {
    let conn = open_db(&app)?;
    Ok(conn
        .query_row("SELECT COUNT(*) FROM dict_wordnet", [], |r| r.get(0))
        .unwrap_or(0))
}

#[tauri::command]
pub fn wordnet_lookup(app: AppHandle, word: String) -> Result<Option<WordNetEntry>, String> {
    let conn = open_db(&app)?;
    if !builtin_enabled(&conn, "dictionary.wordnet.enabled") { return Ok(None); }
    let normalized = normalize_word(&word);
    if normalized.is_empty() {
        return Ok(None);
    }
    let row = conn.query_row(
        "SELECT word, synonyms_json, antonyms_json, examples_json FROM dict_wordnet WHERE word = ?1",
        params![normalized],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)),
    );
    match row {
        Ok((word, synonyms, antonyms, examples)) => Ok(Some(WordNetEntry {
            word,
            synonyms: serde_json::from_str(&synonyms).unwrap_or_default(),
            antonyms: serde_json::from_str(&antonyms).unwrap_or_default(),
            examples: serde_json::from_str(&examples).unwrap_or_default(),
        })),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn wordnet_import_dir(app: AppHandle, directory_path: String) -> Result<u64, String> {
    let dir = PathBuf::from(&directory_path);
    if !dir.is_dir() {
        return Err(format!("找不到 WordNet dict 目录: {directory_path}"));
    }
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || import_directory(&app_clone, &dir))
        .await
        .map_err(|e| e.to_string())?
}

/// 从 WordNet 公开数据镜像手动更新四个 data.* 文件；入库逻辑与本地导入一致。
#[tauri::command]
pub async fn wordnet_update_online(app: AppHandle) -> Result<u64, String> {
    let client = reqwest::Client::builder().user_agent("personal-workstation/1.0").build().map_err(|e| e.to_string())?;
    let mut sources = Vec::new();
    for (name, pos) in [("data.noun", "n"), ("data.verb", "v"), ("data.adj", "a"), ("data.adv", "r")] {
        let text = client.get(format!("{WORDNET_ONLINE_BASE}/{name}")).send().await
            .map_err(|e| format!("下载 WordNet {name} 失败: {e}"))?
            .error_for_status().map_err(|e| format!("下载 WordNet {name} 失败: {e}"))?
            .text().await.map_err(|e| format!("读取 WordNet {name} 失败: {e}"))?;
        sources.push((pos.to_string(), text));
    }
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || import_sources(&app_clone, sources))
        .await.map_err(|e| e.to_string())?
}

fn import_directory(app: &AppHandle, dir: &Path) -> Result<u64, String> {
    let mut sources = Vec::new();
    let mut found = 0;
    for (name, pos) in [
        ("data.noun", "n"),
        ("data.verb", "v"),
        ("data.adj", "a"),
        ("data.adv", "r"),
    ] {
        let path = dir.join(name);
        if !path.is_file() {
            continue;
        }
        found += 1;
        let source =
            std::fs::read_to_string(&path).map_err(|e| format!("读取 {name} 失败: {e}"))?;
        sources.push((pos.to_string(), source));
    }
    if found == 0 {
        return Err("所选目录不含 data.noun、data.verb、data.adj 或 data.adv。请选择 WordNet 的 dict 目录。".into());
    }

    import_sources(app, sources)
}

fn import_sources(app: &AppHandle, sources: Vec<(String, String)>) -> Result<u64, String> {
    let mut synsets: HashMap<String, Synset> = HashMap::new();
    for (pos, source) in sources {
        for line in source.lines() {
            if let Some((offset, set)) = parse_data_line(line, &pos) { synsets.insert(offset, set); }
        }
    }
    let mut entries: HashMap<String, Aggregate> = HashMap::new();
    for set in synsets.values() {
        let target_words: Vec<String> = set
            .antonym_offsets
            .iter()
            .filter_map(|offset| synsets.get(offset))
            .flat_map(|target| target.words.iter().cloned())
            .collect();
        for word in &set.words {
            let current = entries.entry(word.clone()).or_default();
            for synonym in &set.words {
                if synonym != word {
                    current.synonyms.insert(synonym.clone());
                }
            }
            for antonym in &target_words {
                if antonym != word {
                    current.antonyms.insert(antonym.clone());
                }
            }
            for example in &set.examples {
                current.examples.insert(example.clone());
            }
        }
    }

    let mut conn = open_db(app)?;
    conn.execute("DELETE FROM dict_wordnet", [])
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut count = 0_u64;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO dict_wordnet (word, synonyms_json, antonyms_json, examples_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'))",
        ).map_err(|e| e.to_string())?;
        for (word, values) in entries {
            let mut synonyms: Vec<_> = values.synonyms.into_iter().collect();
            synonyms.sort();
            let mut antonyms: Vec<_> = values.antonyms.into_iter().collect();
            antonyms.sort();
            let mut examples: Vec<_> = values.examples.into_iter().collect();
            examples.sort();
            examples.truncate(8);
            stmt.execute(params![
                word,
                serde_json::to_string(&synonyms).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&antonyms).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&examples).unwrap_or_else(|_| "[]".into()),
            ])
            .map_err(|e| e.to_string())?;
            count += 1;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(count)
}

fn parse_data_line(line: &str, file_pos: &str) -> Option<(String, Synset)> {
    if !line.as_bytes().first()?.is_ascii_digit() {
        return None;
    }
    let (data, gloss) = line.split_once('|').unwrap_or((line, ""));
    let tokens: Vec<&str> = data.split_whitespace().collect();
    if tokens.len() < 5 {
        return None;
    }
    // WordNet 的 offset 只在同一 data.* 文件内唯一。形容词卫星词条(ss_type=s)
    // 的 pointer 仍使用 `a`，因此这里用文件词性而不是 ss_type 作为键。
    let offset = format!("{}:{file_pos}", tokens[0]);
    let word_count = usize::from_str_radix(tokens[3], 16).ok()?;
    let mut cursor = 4;
    let mut words = Vec::new();
    for _ in 0..word_count {
        let raw = *tokens.get(cursor)?;
        words.push(normalize_word(raw));
        cursor += 2; // word + lex_id
    }
    let pointer_count: usize = tokens.get(cursor)?.parse().ok()?;
    cursor += 1;
    let mut antonym_offsets = Vec::new();
    for _ in 0..pointer_count {
        let symbol = *tokens.get(cursor)?;
        let target_offset = *tokens.get(cursor + 1)?;
        let target_pos = *tokens.get(cursor + 2)?;
        if symbol == "!" {
            antonym_offsets.push(format!("{target_offset}:{target_pos}"));
        }
        cursor += 4;
    }
    let examples = quoted_fragments(gloss);
    Some((
        offset,
        Synset {
            words,
            antonym_offsets,
            examples,
        },
    ))
}

fn quoted_fragments(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find('"') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('"') else {
            break;
        };
        let value = after[..end].trim();
        if !value.is_empty() {
            out.push(value.to_string());
        }
        rest = &after[end + 1..];
    }
    out
}

fn normalize_word(value: &str) -> String {
    value.trim().to_lowercase().replace('_', " ")
}
