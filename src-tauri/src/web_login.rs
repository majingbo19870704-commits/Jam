// 受控的网页工作区自动填充。
//
// 密码只在 Rust 内从 Windows DPAPI 解密，并直接注入指定的内置 WebView；它不会
// 返回给前端、SQLite 或模型。只允许 AI 工作台所属的内置或独立浏览器标签，并且
// 网页源必须与用户配置的登录地址同源，避免把凭据填到跳转后的第三方页面。

use crate::secrets;
use rusqlite::{params, Connection};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

const EMBEDDED_BROWSER_LABEL: &str = "ai-workbench-browser";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillWebLoginRequest {
    pub account_id: String,
    pub workspace_id: String,
    pub webview_label: Option<String>,
}

struct WebAccount {
    login_url: String,
    username: String,
    secret_ref: String,
    username_selector: String,
    password_selector: String,
    submit_selector: Option<String>,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn workspace_window_label(workspace_id: &str) -> String {
    format!(
        "ai-workspace-{}",
        workspace_id
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '/' | ':') {
                    character
                } else {
                    '-'
                }
            })
            .collect::<String>()
    )
}

fn load_web_account(app: &AppHandle, request: &FillWebLoginRequest) -> Result<WebAccount, String> {
    if !valid_identifier(&request.account_id) || !valid_identifier(&request.workspace_id) {
        return Err("无效的网页工作区。".into());
    }
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?
        .join("data.db");
    let db = Connection::open(db_path).map_err(|error| format!("读取登录配置失败: {error}"))?;
    db.query_row(
        "SELECT login_url, username, secret_ref, username_selector, password_selector, submit_selector
         FROM ai_web_account
         WHERE account_id = ?1 AND workspace_id = ?2 AND is_deleted = 0",
        params![request.account_id, request.workspace_id],
        |row| {
            Ok(WebAccount {
                login_url: row.get(0)?,
                username: row.get(1)?,
                secret_ref: row.get(2)?,
                username_selector: row.get(3)?,
                password_selector: row.get(4)?,
                submit_selector: row.get(5)?,
            })
        },
    )
    .map_err(|_| "此网页工作区尚未设置登录资料。".into())
}

fn value(value: &str) -> Result<String, String> {
    serde_json::to_string(value).map_err(|_| "无法生成登录数据。".into())
}

#[tauri::command]
pub fn fill_configured_web_login(
    app: AppHandle,
    request: FillWebLoginRequest,
) -> Result<(), String> {
    let profile = load_web_account(&app, &request)?;
    let password = secrets::load_secret(&app, &profile.secret_ref)
        .map_err(|_| "无法读取网站密码，请在登录配置中重新保存。")?;
    let login_url =
        url::Url::parse(&profile.login_url).map_err(|_| "登录地址无效，请在登录配置中检查。")?;
    if !matches!(login_url.scheme(), "https" | "http") {
        return Err("登录地址必须是 http:// 或 https:// 网址。".into());
    }

    let target_origin = login_url.origin().ascii_serialization();
    let script = format!(
        r#"(() => {{
          const targetOrigin = {target_origin};
          if (window.location.origin !== targetOrigin) return;
          const setNativeValue = (element, nextValue) => {{
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (descriptor?.set) descriptor.set.call(element, nextValue);
            else element.value = nextValue;
            element.dispatchEvent(new Event('input', {{ bubbles: true }}));
            element.dispatchEvent(new Event('change', {{ bubbles: true }}));
          }};
          const username = document.querySelector({username_selector});
          const password = document.querySelector({password_selector});
          if (!(username instanceof HTMLInputElement) || !(password instanceof HTMLInputElement)) return;
          setNativeValue(username, {username});
          setNativeValue(password, {password});
          const submitSelector = {submit_selector};
          if (submitSelector) {{
            const submit = document.querySelector(submitSelector);
            if (submit instanceof HTMLElement) submit.click();
          }}
        }})();"#,
        target_origin = value(&target_origin)?,
        username_selector = value(&profile.username_selector)?,
        password_selector = value(&profile.password_selector)?,
        username = value(&profile.username)?,
        password = value(&password)?,
        submit_selector =
            serde_json::to_string(&profile.submit_selector).map_err(|_| "无法生成登录数据。")?,
    );
    let expected_window_label = workspace_window_label(&request.workspace_id);
    let webview_label = request
        .webview_label
        .as_deref()
        .unwrap_or(EMBEDDED_BROWSER_LABEL);
    if webview_label != EMBEDDED_BROWSER_LABEL && webview_label != expected_window_label {
        return Err("无效的网页窗口。".into());
    }
    let webview = app
        .get_webview(webview_label)
        .ok_or("网页浏览器尚未就绪，请先打开该网页服务。")?;
    let current_origin = webview
        .url()
        .map_err(|error| format!("无法读取当前网页地址: {error}"))?
        .origin()
        .ascii_serialization();
    if current_origin != target_origin {
        return Err("请先在内置浏览器中打开此服务的登录页面，再自动填充。".into());
    }
    webview
        .eval(script)
        .map_err(|error| format!("无法填充登录表单: {error}"))
}
