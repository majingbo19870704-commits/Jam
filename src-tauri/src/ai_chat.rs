// =============================================================================
// ai_chat.rs · 受控的大模型请求通道
// =============================================================================
// 前端只提交消息与连接 ID。此模块在 Rust 侧读取数据库中的连接和 API 密钥并发出 HTTPS 请求。

use crate::secrets;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

const STREAM_CANCELLED: &str = "用户已停止生成。";
static CANCELLED_STREAMS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn cancelled_streams() -> &'static Mutex<HashSet<String>> {
    CANCELLED_STREAMS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn stream_is_cancelled(request_id: &str) -> bool {
    cancelled_streams()
        .lock()
        .map(|items| items.contains(request_id))
        .unwrap_or(false)
}

fn clear_stream_cancellation(request_id: &str) {
    if let Ok(mut items) = cancelled_streams().lock() {
        items.remove(request_id);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub account_id: String,
    pub connection_id: String,
    pub model_id: Option<String>,
    pub fallback_connection_id: Option<String>,
    pub request_id: Option<String>,
    pub messages: Vec<AiChatMessage>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<AiChatImage>>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatImage {
    pub data_url: String,
}

#[derive(Serialize)]
pub struct AiChatResponse {
    pub content: String,
    pub model: String,
}

/// 模型连接的轻量级实测结果。测试会发送一条极短文本，因此仍会消耗服务商的一次请求额度。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTestResponse {
    pub model: String,
    pub latency_ms: u128,
    pub detail: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

/// A small, request-scoped event envelope for progressive replies. The request ID lets
/// multiple assistant surfaces listen to the same Tauri event without mixing content.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiChatStreamEvent {
    request_id: String,
    event: String,
    delta: Option<String>,
    model: Option<String>,
    error: Option<String>,
}

struct ChatResult {
    content: String,
    input_tokens: i64,
    output_tokens: i64,
}

#[derive(Clone)]
struct ProviderConnection {
    id: String,
    provider_kind: String,
    base_url: String,
    model_id: String,
    api_key: Option<String>,
    secret_ref: Option<String>,
    is_enabled: i64,
    daily_request_limit: Option<i64>,
    monthly_request_limit: Option<i64>,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn load_connection(
    app: &AppHandle,
    id: &str,
    account_id: &str,
) -> Result<ProviderConnection, String> {
    if id.len() > 128 || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-') {
        return Err("无效的模型连接。".into());
    }
    if !valid_identifier(account_id) {
        return Err("无效的账号。".into());
    }
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?
        .join("data.db");
    let db = Connection::open(db_path).map_err(|e| format!("读取模型连接失败: {e}"))?;
    db.query_row(
        "SELECT id, provider_kind, base_url, model_id, api_key, secret_ref, is_enabled, daily_request_limit, monthly_request_limit FROM assistant_provider_connection WHERE id = ?1 AND account_id = ?2 AND is_deleted = 0",
        params![id, account_id],
        |row| Ok(ProviderConnection { id: row.get(0)?, provider_kind: row.get(1)?, base_url: row.get(2)?, model_id: row.get(3)?, api_key: row.get(4)?, secret_ref: row.get(5)?, is_enabled: row.get(6)?, daily_request_limit: row.get(7)?, monthly_request_limit: row.get(8)? }),
    ).map_err(|_| "模型连接不存在或已删除。".into())
}

fn connection_api_key(app: &AppHandle, connection: &ProviderConnection) -> Result<Option<String>, String> {
    if let Some(key) = connection.api_key.as_deref().filter(|key| !key.trim().is_empty()) {
        return Ok(Some(key.to_string()));
    }
    match &connection.secret_ref {
        Some(reference) => Ok(Some(secrets::load_secret(app, reference)?)),
        None => Ok(None),
    }
}

/// 把旧版 DPAPI 密钥写入数据库，使其随工作站备份一起导出与恢复。
/// 单条迁移失败不会阻止其他模型连接继续使用。
#[tauri::command]
pub fn migrate_provider_secrets_to_database(app: AppHandle) -> Result<u64, String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?
        .join("data.db");
    let db = Connection::open(db_path).map_err(|e| format!("打开模型连接数据库失败: {e}"))?;
    let mut statement = db
        .prepare(
            "SELECT id, secret_ref FROM assistant_provider_connection
             WHERE (api_key IS NULL OR trim(api_key) = '') AND secret_ref IS NOT NULL",
        )
        .map_err(|e| format!("读取旧版模型密钥失败: {e}"))?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| format!("读取旧版模型密钥失败: {e}"))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    drop(statement);

    let mut migrated = 0_u64;
    for (id, secret_ref) in rows {
        let Ok(api_key) = secrets::load_secret(&app, &secret_ref) else {
            continue;
        };
        db.execute(
            "UPDATE assistant_provider_connection
             SET api_key = ?1, secret_ref = NULL, updated_at = ?2 WHERE id = ?3",
            params![api_key, chrono::Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| format!("写入模型密钥失败: {e}"))?;
        let _ = secrets::delete_secret(app.clone(), secret_ref);
        migrated += 1;
    }
    Ok(migrated)
}

fn usage_key(format: &str) -> String {
    chrono::Utc::now().format(format).to_string()
}

fn enforce_request_limits(app: &AppHandle, connection: &ProviderConnection) -> Result<(), String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?
        .join("data.db");
    let db = Connection::open(db_path).map_err(|e| format!("读取用量失败: {e}"))?;
    for (limit, key, label) in [
        (
            connection.daily_request_limit,
            usage_key("day:%Y-%m-%d"),
            "单日",
        ),
        (
            connection.monthly_request_limit,
            usage_key("month:%Y-%m"),
            "单月",
        ),
    ] {
        if let Some(limit) = limit {
            if limit > 0 {
                let used: i64 = db.query_row("SELECT COALESCE(request_count, 0) FROM assistant_provider_usage WHERE provider_id = ?1 AND period_key = ?2", params![connection.id, key], |row| row.get(0)).unwrap_or(0);
                if used >= limit {
                    return Err(format!(
                        "模型连接已达到{}请求上限（{} 次），已按配置停止请求。",
                        label, limit
                    ));
                }
            }
        }
    }
    Ok(())
}

fn record_usage(
    app: &AppHandle,
    connection: &ProviderConnection,
    result: &ChatResult,
) -> Result<(), String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?
        .join("data.db");
    let db = Connection::open(db_path).map_err(|e| format!("记录用量失败: {e}"))?;
    let now = chrono::Utc::now().to_rfc3339();
    for key in [usage_key("day:%Y-%m-%d"), usage_key("month:%Y-%m")] {
        db.execute(
            "INSERT INTO assistant_provider_usage(provider_id,period_key,request_count,input_tokens,output_tokens,updated_at) VALUES (?1,?2,1,?3,?4,?5) ON CONFLICT(provider_id,period_key) DO UPDATE SET request_count=request_count+1,input_tokens=input_tokens+excluded.input_tokens,output_tokens=output_tokens+excluded.output_tokens,updated_at=excluded.updated_at",
            params![connection.id, key, result.input_tokens, result.output_tokens, now],
        ).map_err(|e| format!("记录用量失败: {e}"))?;
    }
    Ok(())
}

fn validate_messages(messages: &[AiChatMessage]) -> Result<(), String> {
    if messages.is_empty() || messages.len() > 80 {
        return Err("消息数量无效。".into());
    }
    let size: usize = messages.iter().map(|message| message.content.len()).sum();
    if size > 160_000 {
        return Err("本次对话内容过长，请缩短后重试。".into());
    }
    for message in messages {
        if !matches!(message.role.as_str(), "system" | "user" | "assistant")
            || message.content.trim().is_empty()
        {
            return Err("消息格式无效。".into());
        }
        let images = message.images.as_deref().unwrap_or_default();
        if images.len() > 3 || (message.role != "user" && !images.is_empty()) {
            return Err("图片附件格式无效。".into());
        }
        for image in images {
            if image.data_url.len() > 7 * 1024 * 1024
                || ![
                    "data:image/png;base64,",
                    "data:image/jpeg;base64,",
                    "data:image/webp;base64,",
                ]
                .iter()
                .any(|prefix| image.data_url.starts_with(prefix))
            {
                return Err("图片附件仅支持不超过 5 MB 的 PNG、JPG/JPEG 或 WebP。".into());
            }
        }
    }
    Ok(())
}

fn openai_messages(messages: &[AiChatMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            let images = message.images.as_deref().unwrap_or_default();
            if images.is_empty() {
                json!({ "role": message.role, "content": message.content })
            } else {
                let mut content = vec![json!({ "type": "text", "text": message.content })];
                content.extend(images.iter().map(
                    |image| json!({ "type": "image_url", "image_url": { "url": image.data_url } }),
                ));
                json!({ "role": message.role, "content": content })
            }
        })
        .collect()
}

fn anthropic_messages(messages: &[AiChatMessage]) -> Result<Vec<Value>, String> {
    messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            let images = message.images.as_deref().unwrap_or_default();
            if images.is_empty() {
                Ok(json!({ "role": message.role, "content": message.content }))
            } else {
                let mut content = vec![json!({ "type": "text", "text": message.content })];
                for image in images {
                    let (header, data) =
                        image.data_url.split_once(",").ok_or("图片附件编码无效。")?;
                    let media_type = header
                        .strip_prefix("data:")
                        .and_then(|value| value.strip_suffix(";base64"))
                        .ok_or("图片附件编码无效。")?;
                    content.push(json!({
                        "type": "image",
                        "source": { "type": "base64", "media_type": media_type, "data": data }
                    }));
                }
                Ok(json!({ "role": message.role, "content": content }))
            }
        })
        .collect()
}

fn endpoint(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

/// 智谱的 OpenAI 兼容接口位于 /api/paas/v4。早期表单曾允许保存根域名，
/// 因此在请求侧也做一次兼容修正，避免旧连接在升级后仍然请求到错误地址。
fn openai_compatible_base_url(connection: &ProviderConnection) -> String {
    let base_url = connection.base_url.trim().trim_end_matches('/');
    if connection.provider_kind == "zhipu" && base_url == "https://open.bigmodel.cn" {
        "https://open.bigmodel.cn/api/paas/v4".to_string()
    } else {
        base_url.to_string()
    }
}

fn validate_provider_configuration(connection: &ProviderConnection) -> Result<(), String> {
    if connection.provider_kind == "zhipu"
        && !connection
            .model_id
            .trim()
            .to_ascii_lowercase()
            .starts_with("glm-")
    {
        return Err(
            "智谱 GLM 的模型 ID 配置无效：请在“模型连接”中填写 glm- 开头的模型名称（例如 glm-4.7-flash），不要填写 API Key、应用 ID 或模型接入点 ID。".into(),
        );
    }
    Ok(())
}

fn apply_model_override(
    mut connection: ProviderConnection,
    model_id: Option<&str>,
) -> Result<ProviderConnection, String> {
    let Some(model_id) = model_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(connection);
    };
    if model_id.len() > 160
        || !model_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '/' | ':')
        })
    {
        return Err("模型 ID 格式无效。".into());
    }
    connection.model_id = model_id.to_string();
    Ok(connection)
}

#[tauri::command]
pub async fn ai_list_models(
    app: AppHandle,
    account_id: String,
    connection_id: String,
) -> Result<Vec<String>, String> {
    let connection = load_connection(&app, &connection_id, &account_id)?;
    if connection.is_enabled == 0 {
        return Err("该 AI 供应商已停用，请先启用后读取模型。".into());
    }
    let api_key = connection_api_key(&app, &connection)?;
    let url = if connection.provider_kind == "anthropic" {
        if connection.base_url.trim_end_matches('/').ends_with("/v1") {
            endpoint(&connection.base_url, "models")
        } else {
            endpoint(&connection.base_url, "v1/models")
        }
    } else {
        endpoint(&openai_compatible_base_url(&connection), "models")
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("PersonalWorkstation/0.1")
        .build()
        .map_err(|e| format!("初始化网络请求失败: {e}"))?;
    let mut request = client.get(url);
    if connection.provider_kind == "anthropic" {
        request = request
            .header("x-api-key", api_key.ok_or("Claude API 需要密钥。")?)
            .header("anthropic-version", "2023-06-01");
    } else if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("读取模型列表失败: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取模型列表响应失败: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "模型列表接口返回 {status}: {}",
            body.chars().take(300).collect::<String>()
        ));
    }
    let payload: Value = serde_json::from_str(&body)
        .map_err(|_| "模型列表接口返回了无法识别的内容。".to_string())?;
    let mut models = payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    if models.is_empty() {
        return Err("该供应商没有返回可选择的模型；可在模型 ID 输入框中手动填写。".into());
    }
    Ok(models)
}

fn emit_stream_event(
    app: &AppHandle,
    request_id: &str,
    event: &str,
    delta: Option<String>,
    model: Option<String>,
    error: Option<String>,
) {
    let _ = app.emit(
        "ai-chat-stream",
        AiChatStreamEvent {
            request_id: request_id.to_string(),
            event: event.to_string(),
            delta,
            model,
            error,
        },
    );
}

async fn chat_openai_compatible(
    connection: &ProviderConnection,
    api_key: Option<String>,
    messages: &[AiChatMessage],
) -> Result<ChatResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .user_agent("PersonalWorkstation/0.1")
        .build()
        .map_err(|e| format!("初始化网络请求失败: {e}"))?;
    let mut request = client
        .post(endpoint(
            &openai_compatible_base_url(connection),
            "chat/completions",
        ))
        .json(&json!({ "model": connection.model_id, "messages": openai_messages(messages), "stream": false }));
    if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("模型服务连接失败: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取模型响应失败: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "模型服务返回 {status}: {}",
            body.chars().take(500).collect::<String>()
        ));
    }
    let json: Value =
        serde_json::from_str(&body).map_err(|_| "模型服务返回了无法识别的内容。".to_string())?;
    let content = json
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|text| !text.trim().is_empty())
        .ok_or("模型响应中没有可显示的文本。".to_string())?;
    Ok(ChatResult {
        content,
        input_tokens: json
            .pointer("/usage/prompt_tokens")
            .and_then(Value::as_i64)
            .unwrap_or(0),
        output_tokens: json
            .pointer("/usage/completion_tokens")
            .and_then(Value::as_i64)
            .unwrap_or(0),
    })
}

async fn chat_openai_compatible_stream(
    app: &AppHandle,
    request_id: &str,
    connection: &ProviderConnection,
    api_key: Option<String>,
    messages: &[AiChatMessage],
) -> Result<ChatResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .user_agent("PersonalWorkstation/0.1")
        .build()
        .map_err(|e| format!("初始化网络请求失败: {e}"))?;
    let mut request = client
        .post(endpoint(
            &openai_compatible_base_url(connection),
            "chat/completions",
        ))
        .json(&json!({
            "model": connection.model_id,
            "messages": openai_messages(messages),
            "stream": true,
            "stream_options": { "include_usage": true }
        }));
    if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }
    let mut response = request
        .send()
        .await
        .map_err(|e| format!("模型服务连接失败: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .map_err(|e| format!("读取模型响应失败: {e}"))?;
        return Err(format!(
            "模型服务返回 {status}: {}",
            body.chars().take(500).collect::<String>()
        ));
    }
    let mut content = String::new();
    let mut input_tokens = 0;
    let mut output_tokens = 0;
    let mut buffer = String::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取模型流失败: {e}"))?
    {
        if stream_is_cancelled(request_id) {
            return Err(STREAM_CANCELLED.into());
        }
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(end) = buffer.find('\n') {
            let line = buffer[..end].trim().to_string();
            buffer = buffer[end + 1..].to_string();
            let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if data == "[DONE]" {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(delta) = event
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
            {
                content.push_str(delta);
                emit_stream_event(
                    app,
                    request_id,
                    "chunk",
                    Some(delta.to_string()),
                    None,
                    None,
                );
            }
            input_tokens = input_tokens.max(
                event
                    .pointer("/usage/prompt_tokens")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
            );
            output_tokens = output_tokens.max(
                event
                    .pointer("/usage/completion_tokens")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
            );
        }
    }
    if content.trim().is_empty() {
        Err("模型响应中没有可显示的文本。".into())
    } else {
        Ok(ChatResult {
            content,
            input_tokens,
            output_tokens,
        })
    }
}

async fn chat_anthropic(
    connection: &ProviderConnection,
    api_key: String,
    messages: &[AiChatMessage],
) -> Result<ChatResult, String> {
    let system = messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let conversation = anthropic_messages(messages)?;
    let url = if connection.base_url.trim_end_matches('/').ends_with("/v1") {
        endpoint(&connection.base_url, "messages")
    } else {
        endpoint(&connection.base_url, "v1/messages")
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .user_agent("PersonalWorkstation/0.1")
        .build()
        .map_err(|e| format!("初始化网络请求失败: {e}"))?;
    let response = client.post(url).header("x-api-key", api_key).header("anthropic-version", "2023-06-01")
        .json(&json!({ "model": connection.model_id, "max_tokens": 2048, "system": system, "messages": conversation }))
        .send().await.map_err(|e| format!("模型服务连接失败: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取模型响应失败: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "模型服务返回 {status}: {}",
            body.chars().take(500).collect::<String>()
        ));
    }
    let json: Value =
        serde_json::from_str(&body).map_err(|_| "模型服务返回了无法识别的内容。".to_string())?;
    let content = json
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<String>();
    if content.trim().is_empty() {
        Err("模型响应中没有可显示的文本。".into())
    } else {
        Ok(ChatResult {
            content,
            input_tokens: json
                .pointer("/usage/input_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            output_tokens: json
                .pointer("/usage/output_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        })
    }
}

async fn chat_anthropic_stream(
    app: &AppHandle,
    request_id: &str,
    connection: &ProviderConnection,
    api_key: String,
    messages: &[AiChatMessage],
) -> Result<ChatResult, String> {
    let system = messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let conversation = anthropic_messages(messages)?;
    let url = if connection.base_url.trim_end_matches('/').ends_with("/v1") {
        endpoint(&connection.base_url, "messages")
    } else {
        endpoint(&connection.base_url, "v1/messages")
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .user_agent("PersonalWorkstation/0.1")
        .build()
        .map_err(|e| format!("初始化网络请求失败: {e}"))?;
    let mut response = client
        .post(url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": connection.model_id,
            "max_tokens": 2048,
            "system": system,
            "messages": conversation,
            "stream": true
        }))
        .send()
        .await
        .map_err(|e| format!("模型服务连接失败: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .map_err(|e| format!("读取模型响应失败: {e}"))?;
        return Err(format!(
            "模型服务返回 {status}: {}",
            body.chars().take(500).collect::<String>()
        ));
    }
    let mut content = String::new();
    let mut input_tokens = 0;
    let mut output_tokens = 0;
    let mut buffer = String::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取模型流失败: {e}"))?
    {
        if stream_is_cancelled(request_id) {
            return Err(STREAM_CANCELLED.into());
        }
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(end) = buffer.find('\n') {
            let line = buffer[..end].trim().to_string();
            buffer = buffer[end + 1..].to_string();
            let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            let Ok(event) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(delta) = event
                .pointer("/delta/text")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
            {
                content.push_str(delta);
                emit_stream_event(
                    app,
                    request_id,
                    "chunk",
                    Some(delta.to_string()),
                    None,
                    None,
                );
            }
            input_tokens = input_tokens.max(
                event
                    .pointer("/message/usage/input_tokens")
                    .or_else(|| event.pointer("/usage/input_tokens"))
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
            );
            output_tokens = output_tokens.max(
                event
                    .pointer("/usage/output_tokens")
                    .and_then(Value::as_i64)
                    .unwrap_or(0),
            );
        }
    }
    if content.trim().is_empty() {
        Err("模型响应中没有可显示的文本。".into())
    } else {
        Ok(ChatResult {
            content,
            input_tokens,
            output_tokens,
        })
    }
}

async fn request_with_connection(
    app: &AppHandle,
    connection: &ProviderConnection,
    messages: &[AiChatMessage],
) -> Result<ChatResult, String> {
    if connection.is_enabled == 0 {
        return Err("该模型连接已停用。".into());
    }
    validate_provider_configuration(connection)?;
    enforce_request_limits(app, connection)?;
    let key = connection_api_key(app, connection)?;
    let content = if connection.provider_kind == "anthropic" {
        chat_anthropic(connection, key.ok_or("Claude API 需要密钥。")?, messages).await?
    } else {
        chat_openai_compatible(connection, key, messages).await?
    };
    record_usage(app, connection, &content)?;
    Ok(content)
}

async fn request_with_streaming_connection(
    app: &AppHandle,
    request_id: &str,
    connection: &ProviderConnection,
    messages: &[AiChatMessage],
) -> Result<ChatResult, String> {
    if connection.is_enabled == 0 {
        return Err("该模型连接已停用。".into());
    }
    validate_provider_configuration(connection)?;
    enforce_request_limits(app, connection)?;
    let key = connection_api_key(app, connection)?;
    let result = if connection.provider_kind == "anthropic" {
        chat_anthropic_stream(
            app,
            request_id,
            connection,
            key.ok_or("Claude API 需要密钥。")?,
            messages,
        )
        .await?
    } else {
        chat_openai_compatible_stream(app, request_id, connection, key, messages).await?
    };
    record_usage(app, connection, &result)?;
    Ok(result)
}

fn fallback_eligible(error: &str) -> bool {
    error.contains("达到单日请求上限")
        || error.contains("达到单月请求上限")
        || error.contains("模型服务连接失败")
        || [" 429", " 500", " 502", " 503", " 504"]
            .iter()
            .any(|code| error.contains(code))
}

#[tauri::command]
pub async fn ai_test_connection(
    app: AppHandle,
    account_id: String,
    connection_id: String,
) -> Result<AiConnectionTestResponse, String> {
    let connection = load_connection(&app, &connection_id, &account_id)?;
    validate_provider_configuration(&connection)?;

    // 测试连接不要求事先勾选“在 AI 助手中启用”，方便用户在启用前完成校验；
    // 但仍沿用调用额度限制和本机密钥读取规则。
    let mut test_connection = connection.clone();
    test_connection.is_enabled = 1;
    let started = std::time::Instant::now();
    let result = request_with_connection(
        &app,
        &test_connection,
        &[AiChatMessage {
            role: "user".to_string(),
            content: "请只回复：连接正常".to_string(),
            images: None,
        }],
    )
    .await?;
    Ok(AiConnectionTestResponse {
        model: test_connection.model_id,
        latency_ms: started.elapsed().as_millis(),
        detail: "已收到有效文本回复。".to_string(),
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
    })
}

#[tauri::command]
pub async fn ai_chat(app: AppHandle, req: AiChatRequest) -> Result<AiChatResponse, String> {
    validate_messages(&req.messages)?;
    let connection = apply_model_override(
        load_connection(&app, &req.connection_id, &req.account_id)?,
        req.model_id.as_deref(),
    )?;
    match request_with_connection(&app, &connection, &req.messages).await {
        Ok(result) => Ok(AiChatResponse {
            content: result.content,
            model: connection.model_id,
        }),
        Err(primary_error) => {
            let fallback_id = req
                .fallback_connection_id
                .as_deref()
                .filter(|id| *id != req.connection_id);
            if !fallback_eligible(&primary_error) || fallback_id.is_none() {
                return Err(primary_error);
            }
            let fallback = load_connection(&app, fallback_id.unwrap(), &req.account_id)?;
            request_with_connection(&app, &fallback, &req.messages)
                .await
                .map(|result| AiChatResponse {
                    content: result.content,
                    model: fallback.model_id,
                })
                .map_err(|fallback_error| {
                    format!("主模型失败：{primary_error}\n备用模型也失败：{fallback_error}")
                })
        }
    }
}

#[tauri::command]
pub fn ai_cancel_chat_stream(request_id: String) -> Result<(), String> {
    if !valid_identifier(&request_id) {
        return Err("无效的流式请求标识。".into());
    }
    cancelled_streams()
        .lock()
        .map_err(|_| "无法停止当前生成。".to_string())?
        .insert(request_id);
    Ok(())
}

#[tauri::command]
pub async fn ai_chat_stream(app: AppHandle, req: AiChatRequest) -> Result<(), String> {
    let request_id = req
        .request_id
        .as_deref()
        .filter(|id| valid_identifier(id))
        .ok_or("无效的流式请求标识。")?
        .to_string();
    if let Err(error) = validate_messages(&req.messages) {
        emit_stream_event(&app, &request_id, "error", None, None, Some(error));
        return Ok(());
    }
    let connection = match load_connection(&app, &req.connection_id, &req.account_id)
        .and_then(|connection| apply_model_override(connection, req.model_id.as_deref()))
    {
        Ok(connection) => connection,
        Err(error) => {
            emit_stream_event(&app, &request_id, "error", None, None, Some(error));
            return Ok(());
        }
    };
    let result = match request_with_streaming_connection(
        &app,
        &request_id,
        &connection,
        &req.messages,
    )
    .await
    {
        Ok(result) => Ok((result, connection.model_id.clone())),
        Err(primary_error) => {
            let fallback_id = req
                .fallback_connection_id
                .as_deref()
                .filter(|id| *id != req.connection_id);
            if !fallback_eligible(&primary_error) || fallback_id.is_none() {
                Err(primary_error)
            } else {
                // 主模型在流中断开时，前端必须先丢弃不完整内容，避免把两种模型的回答拼接。
                emit_stream_event(&app, &request_id, "reset", None, None, None);
                match load_connection(&app, fallback_id.unwrap(), &req.account_id) {
                    Ok(fallback) => request_with_streaming_connection(
                        &app,
                        &request_id,
                        &fallback,
                        &req.messages,
                    )
                    .await
                    .map(|result| (result, fallback.model_id))
                    .map_err(|fallback_error| {
                        format!("主模型失败：{primary_error}\n备用模型也失败：{fallback_error}")
                    }),
                    Err(error) => Err(format!(
                        "主模型失败：{primary_error}\n备用模型不可用：{error}"
                    )),
                }
            }
        }
    };
    match result {
        Ok((_result, model)) => {
            emit_stream_event(&app, &request_id, "done", None, Some(model), None)
        }
        Err(error) if error == STREAM_CANCELLED => {
            emit_stream_event(&app, &request_id, "cancelled", None, None, None)
        }
        Err(error) => emit_stream_event(&app, &request_id, "error", None, None, Some(error)),
    }
    clear_stream_cancellation(&request_id);
    Ok(())
}
