// =============================================================================
// http_proxy.rs · Rust 侧 HTTP 代理
// =============================================================================
//
// 前端调百度/DeepL/OpenAI 会遇到 CORS，Tauri WebView 也一样。
// 让前端把请求内容传过来，Rust 用 reqwest 发出，把响应回传给前端。
// =============================================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize)]
pub struct HttpProxyRequest {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Serialize)]
pub struct HttpProxyResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[tauri::command]
pub async fn http_proxy(req: HttpProxyRequest) -> Result<HttpProxyResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("PersonalWorkstation/0.1")
        // 允许自签证书 / 老 TLS —— 用 Windows 自带证书链
        .danger_accept_invalid_certs(false)
        // 使用系统代理设置
        .use_native_tls()
        .build()
        .map_err(|e| format!("client build: {e}"))?;

    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .map_err(|e| format!("bad method: {e}"))?;

    let mut builder = client.request(method, &req.url);
    if let Some(hs) = req.headers {
        for (k, v) in hs {
            builder = builder.header(&k, &v);
        }
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let resp = builder.send().await.map_err(|e| format!("send: {e}"))?;
    let status = resp.status().as_u16();
    let headers: HashMap<String, String> = resp
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|s| (k.to_string(), s.to_string())))
        .collect();
    let body = resp.text().await.map_err(|e| format!("read body: {e}"))?;

    Ok(HttpProxyResponse {
        status,
        headers,
        body,
    })
}
