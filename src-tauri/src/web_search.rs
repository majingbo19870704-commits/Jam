// =============================================================================
// web_search.rs · 公开网页检索（仅在前端显式开启时调用）
// =============================================================================

use serde::{Deserialize, Serialize};
use std::net::IpAddr;

#[derive(Deserialize)]
pub struct WebSearchRequest {
    pub query: String,
}

#[derive(Serialize)]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub published_at: String,
}

#[derive(Deserialize)]
pub struct WebPageFetchRequest {
    pub urls: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebPageContent {
    pub url: String,
    pub title: String,
    pub content: String,
}

fn decode_xml(value: &str) -> String {
    value
        .replace("<![CDATA[", "")
        .replace("]]>", "")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
}

fn tag_value(block: &str, tag: &str) -> String {
    let start = format!("<{tag}>");
    let end = format!("</{tag}>");
    block
        .find(&start)
        .and_then(|from| {
            let content = &block[from + start.len()..];
            content.find(&end).map(|to| decode_xml(&content[..to]))
        })
        .unwrap_or_default()
}

fn remove_tag_section(mut html: String, tag: &str) -> String {
    let opening = format!("<{tag}");
    let closing = format!("</{tag}>");
    loop {
        let lower = html.to_ascii_lowercase();
        let Some(start) = lower.find(&opening) else {
            break;
        };
        let after_start = &lower[start..];
        let Some(relative_end) = after_start.find(&closing) else {
            html.truncate(start);
            break;
        };
        let end = start + relative_end + closing.len();
        html.replace_range(start..end, " ");
    }
    html
}

fn html_to_text(html: &str) -> String {
    let html = remove_tag_section(remove_tag_section(html.to_string(), "script"), "style");
    let mut text = String::with_capacity(html.len().min(80_000));
    let mut inside_tag = false;
    let mut last_was_space = true;
    for character in html.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => {
                inside_tag = false;
                if !last_was_space {
                    text.push(' ');
                    last_was_space = true;
                }
            }
            value if !inside_tag => {
                if value.is_whitespace() {
                    if !last_was_space {
                        text.push(' ');
                        last_was_space = true;
                    }
                } else {
                    text.push(value);
                    last_was_space = false;
                }
            }
            _ => {}
        }
    }
    decode_xml(&text)
        .replace("&nbsp;", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_public_web_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return false;
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(value)
                if value.is_private()
                    || value.is_loopback()
                    || value.is_link_local()
                    || value.is_unspecified() =>
            {
                return false
            }
            IpAddr::V6(value)
                if value.is_loopback()
                    || value.is_unique_local()
                    || value.is_unicast_link_local()
                    || value.is_unspecified() =>
            {
                return false
            }
            _ => {}
        }
    }
    true
}

/// 仅抓取用户已在联网搜索中获得的公开网页。禁用重定向并拒绝私有地址，
/// 防止“深度阅读”被用作访问本机或局域网资源的通道。
#[tauri::command]
pub async fn web_fetch_pages(req: WebPageFetchRequest) -> Result<Vec<WebPageContent>, String> {
    if req.urls.is_empty() || req.urls.len() > 3 {
        return Err("一次最多深度阅读 3 个网页。".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("PersonalWorkstation/0.1")
        .build()
        .map_err(|e| format!("初始化网页阅读失败: {e}"))?;
    let mut pages = Vec::new();
    for url in req.urls {
        if !is_public_web_url(&url) {
            continue;
        }
        let Ok(response) = client.get(&url).send().await else {
            continue;
        };
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|size| size > 2_000_000)
        {
            continue;
        }
        let Ok(body) = response.text().await else {
            continue;
        };
        let content = html_to_text(&body);
        if content.len() < 120 {
            continue;
        }
        let title = tag_value(&body, "title");
        pages.push(WebPageContent {
            url,
            title: if title.trim().is_empty() {
                "网页正文".to_string()
            } else {
                title.chars().take(180).collect()
            },
            content: content.chars().take(9_000).collect(),
        });
    }
    Ok(pages)
}

#[tauri::command]
pub async fn web_search(req: WebSearchRequest) -> Result<Vec<WebSearchResult>, String> {
    let query = req.query.trim();
    if query.is_empty() || query.len() > 500 {
        return Err("请输入 1 至 500 个字符的搜索内容。".into());
    }
    let mut url = reqwest::Url::parse("https://www.bing.com/search")
        .map_err(|e| format!("搜索地址无效: {e}"))?;
    url.query_pairs_mut()
        .append_pair("format", "rss")
        .append_pair("q", query);
    let body = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("PersonalWorkstation/0.1")
        .build()
        .map_err(|e| format!("初始化搜索失败: {e}"))?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("联网搜索失败: {e}"))?
        .text()
        .await
        .map_err(|e| format!("读取搜索结果失败: {e}"))?;
    let mut results = Vec::new();
    for item in body.split("<item>").skip(1).take(6) {
        let title = tag_value(item, "title");
        let link = tag_value(item, "link");
        let description = tag_value(item, "description")
            .replace("<b>", "")
            .replace("</b>", "");
        let published_at = tag_value(item, "pubDate");
        if !title.is_empty() && link.starts_with("http") {
            results.push(WebSearchResult {
                title,
                url: link,
                snippet: description.chars().take(700).collect(),
                published_at,
            });
        }
    }
    Ok(results)
}
