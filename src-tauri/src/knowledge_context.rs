// =============================================================================
// knowledge_context.rs · 已授权本地资料的轻量检索
// =============================================================================
// 首版仅处理可直接读取的文本资料：Markdown、TXT、CSV、JSON、HTML、日志与代码文件。
// 每次读取有数量和字节上限，避免一次对话扫描整个磁盘或发送过多内容给模型。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};
use zip::ZipArchive;

const MAX_FILES: usize = 400;
const MAX_FILE_BYTES: usize = 96 * 1024;
const MAX_SNIPPETS: usize = 5;
const MAX_EXCERPT_CHARS: usize = 2600;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeContextRequest {
    pub sources: Vec<KnowledgeSourceInput>,
    pub query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSourceInput {
    pub id: String,
    pub source_type: String,
    pub source_path: String,
    pub include_subdirs: i64,
}

#[derive(Serialize)]
pub struct KnowledgeSnippet {
    pub source_id: String,
    pub title: String,
    pub path: String,
    pub excerpt: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemporaryAttachmentText {
    pub title: String,
    pub path: String,
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemporaryAttachmentImage {
    pub title: String,
    pub path: String,
    pub data_url: String,
}

fn is_text_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|item| item.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "txt"
            | "md"
            | "markdown"
            | "csv"
            | "json"
            | "yaml"
            | "yml"
            | "html"
            | "htm"
            | "log"
            | "xml"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "py"
            | "rs"
            | "sql"
            | "docx"
            | "xlsx"
            | "doc"
            | "xls"
            | "ppt"
            | "pptx"
            | "odt"
            | "ods"
            | "odp"
            | "pdf"
    )
}

/// 即便用户给资料库添加了磁盘根目录，也不递归进入常见凭据与浏览器资料目录。
/// 这是读取范围的底线，不影响用户正常授权的文档、项目和知识库目录。
fn is_protected_path(path: &Path) -> bool {
    let value = path
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    [
        "\\.ssh\\",
        "\\.gnupg\\",
        "\\.aws\\",
        "\\.azure\\",
        "\\.kube\\",
        "\\appdata\\roaming\\microsoft\\credentials\\",
        "\\appdata\\local\\microsoft\\credentials\\",
        "\\appdata\\local\\google\\chrome\\user data\\",
        "\\appdata\\local\\microsoft\\edge\\user data\\",
        "\\appdata\\roaming\\mozilla\\firefox\\profiles\\",
    ]
    .iter()
    .any(|segment| value.contains(segment))
}

fn collect_files(path: &Path, recursive: bool, out: &mut Vec<PathBuf>) {
    if out.len() >= MAX_FILES || is_protected_path(path) {
        return;
    }
    if path.is_file() {
        if is_text_file(path) {
            out.push(path.to_path_buf());
        }
        return;
    }
    if !path.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let candidate = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&candidate) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if candidate.is_file() && is_text_file(&candidate) {
            out.push(candidate);
        } else if recursive && candidate.is_dir() {
            collect_files(&candidate, true, out);
        }
    }
}

fn xml_text(xml: &str) -> String {
    let mut output = String::new();
    let mut text = String::new();
    let mut in_tag = false;
    for character in xml.chars() {
        match character {
            '<' => {
                if !text.is_empty() {
                    output.push_str(&text);
                    text.clear();
                }
                in_tag = true;
            }
            '>' => {
                if text.contains("/p")
                    || text.contains("/row")
                    || text.contains("/si")
                    || text.contains("/t")
                {
                    output.push('\n');
                }
                text.clear();
                in_tag = false;
            }
            _ if in_tag => text.push(character),
            _ => output.push(character),
        }
    }
    output
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn zip_entry_text(bytes: Vec<u8>, entry_names: impl Fn(&str) -> bool) -> String {
    let Ok(mut archive) = ZipArchive::new(Cursor::new(bytes)) else {
        return String::new();
    };
    let mut output = String::new();
    for index in 0..archive.len() {
        let Ok(mut entry) = archive.by_index(index) else {
            continue;
        };
        if !entry_names(entry.name()) {
            continue;
        }
        let mut xml = String::new();
        if entry
            .by_ref()
            .take(MAX_FILE_BYTES as u64)
            .read_to_string(&mut xml)
            .is_ok()
        {
            output.push_str(&xml_text(&xml));
            output.push('\n');
        }
    }
    output
}

fn pdf_literal_text(bytes: &[u8]) -> String {
    // 针对未压缩 PDF 文本对象的保守提取；扫描件/压缩流会返回空，避免误报。
    let raw = String::from_utf8_lossy(bytes);
    let mut output = String::new();
    let mut rest = raw.as_ref();
    while let Some(start) = rest.find('(') {
        let after = &rest[start + 1..];
        let Some(end) = after.find(')') else {
            break;
        };
        let fragment = &after[..end];
        if fragment.chars().filter(|ch| !ch.is_control()).count() >= 3 {
            output.push_str(fragment);
            output.push('\n');
        }
        rest = &after[end + 1..];
    }
    output
}

fn read_document_text(path: &Path) -> Option<String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let file = fs::File::open(path).ok()?;
    let mut text = String::new();
    if matches!(extension.as_str(), "doc" | "xls" | "ppt" | "pptx" | "odt" | "ods" | "odp") {
        text = convert_office_to_text(path)?;
    } else if matches!(extension.as_str(), "docx" | "xlsx" | "pdf") {
        let mut bytes = Vec::new();
        file.take((MAX_FILE_BYTES * 4) as u64)
            .read_to_end(&mut bytes)
            .ok()?;
        text = match extension.as_str() {
            "docx" => zip_entry_text(bytes, |name| name == "word/document.xml"),
            "xlsx" => zip_entry_text(bytes, |name| {
                name == "xl/sharedStrings.xml" || name.starts_with("xl/worksheets/")
            }),
            "pdf" => pdf_literal_text(&bytes),
            _ => String::new(),
        };
    } else {
        file.take(MAX_FILE_BYTES as u64)
            .read_to_string(&mut text)
            .ok()?;
    }
    if text.trim().is_empty() {
        return None;
    }
    Some(text)
}

/// 用 LibreOffice 将旧 Office 文件转换到受控临时目录后读取。未安装时返回 None，
/// 不会把二进制内容误当成文本或把临时内容留下。
fn convert_office_to_text(path: &Path) -> Option<String> {
    let soffice = crate::files::find_libreoffice()?;
    let output_dir = std::env::temp_dir().join(format!("pw-office-text-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&output_dir).ok()?;
    let result = (|| {
        let status = std::process::Command::new(soffice)
            .args(["--headless", "--convert-to", "txt:Text", "--outdir"])
            .arg(&output_dir)
            .arg(path)
            .status()
            .ok()?;
        if !status.success() { return None; }
        let expected = output_dir.join(format!("{}.txt", path.file_stem()?.to_string_lossy()));
        let output = if expected.is_file() { expected } else {
            fs::read_dir(&output_dir).ok()?.filter_map(Result::ok).map(|entry| entry.path())
                .find(|candidate| candidate.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case("txt")))?
        };
        let mut text = String::new();
        fs::File::open(output).ok()?.take(MAX_FILE_BYTES as u64).read_to_string(&mut text).ok()?;
        Some(text)
    })();
    let _ = fs::remove_dir_all(&output_dir);
    result
}

/// 读取用户在本次对话中手动选择的一份资料。它不登记到知识库，也不保留文件内容；
/// 前端只把截取文本用于当前一次模型请求。
#[tauri::command]
pub fn read_temporary_attachment(path: String) -> Result<TemporaryAttachmentText, String> {
    if path.len() > 32_000 {
        return Err("附件路径过长。".into());
    }
    let path = PathBuf::from(path);
    if !path.is_file() || is_protected_path(&path) || !is_text_file(&path) {
        return Err("仅可读取手动选择的文本、Office 文档或可提取文字的 PDF 文件。".into());
    }
    let metadata = fs::metadata(&path).map_err(|_| "无法读取附件信息。")?;
    if metadata.len() > (MAX_FILE_BYTES as u64) * 4 {
        return Err("单个附件不能超过 384 KB。请先导出或拆分所需内容。".into());
    }
    let content = read_document_text(&path)
        .ok_or("未能从该附件提取文字。扫描件、加密 PDF，或未安装 LibreOffice 的旧版 Office 文档暂不支持。")?
        .chars()
        .take(12_000)
        .collect::<String>();
    Ok(TemporaryAttachmentText {
        title: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("临时附件")
            .to_string(),
        path: path.to_string_lossy().to_string(),
        content,
    })
}

/// 把用户手动选择的图片编码成一次性 data URL，供支持视觉能力的模型请求使用。
/// 图片字节不会写入数据库、知识库或应用数据目录。
#[tauri::command]
pub fn read_temporary_image(path: String) -> Result<TemporaryAttachmentImage, String> {
    if path.len() > 32_000 {
        return Err("附件路径过长。".into());
    }
    let path = PathBuf::from(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let media_type = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => return Err("仅支持 PNG、JPG/JPEG 或 WebP 图片。".into()),
    };
    if !path.is_file() || is_protected_path(&path) {
        return Err("无法读取此图片。".into());
    }
    let bytes = fs::read(&path).map_err(|_| "无法读取图片。")?;
    if bytes.is_empty() || bytes.len() > 5 * 1024 * 1024 {
        return Err("单张图片必须大于 0 且不超过 5 MB。".into());
    }
    Ok(TemporaryAttachmentImage {
        title: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("图片附件")
            .to_string(),
        path: path.to_string_lossy().to_string(),
        data_url: format!("data:{media_type};base64,{}", BASE64.encode(bytes)),
    })
}

fn cjk_character(character: char) -> bool {
    matches!(character,
        '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{f900}'..='\u{faff}'
    )
}

/// 从提问中提取可用于本地资料检索的词项。
/// 对连续中文字符补充双字词，避免“项目进度风险”这类无空格提问只能整句匹配。
fn query_terms(query: &str) -> Vec<String> {
    let normalized = query.to_lowercase();
    let mut terms = normalized
        .split_whitespace()
        .filter(|term| term.chars().count() >= 2)
        .map(str::to_string)
        .collect::<Vec<_>>();

    let mut cjk_run = Vec::new();
    let mut append_cjk_terms = |run: &mut Vec<char>| {
        if run.len() >= 2 {
            for pair in run.windows(2) {
                let token = pair.iter().collect::<String>();
                if !terms.contains(&token) {
                    terms.push(token);
                }
            }
        }
        run.clear();
    };
    for character in normalized.chars() {
        if cjk_character(character) {
            cjk_run.push(character);
        } else {
            append_cjk_terms(&mut cjk_run);
        }
    }
    append_cjk_terms(&mut cjk_run);
    terms
}

fn read_excerpt(path: &Path, query: &str) -> Option<(String, i32)> {
    let text = read_document_text(path)?;
    let normalized = text.to_lowercase();
    let terms = query_terms(query);
    let score = if terms.is_empty() {
        1
    } else {
        terms
            .iter()
            .map(|term| normalized.matches(term).count().min(20) as i32)
            .sum()
    };
    if !terms.is_empty() && score == 0 {
        return None;
    }
    let offset = terms
        .iter()
        .find_map(|term| normalized.find(term))
        .unwrap_or(0);
    let start = text[..offset]
        .char_indices()
        .rev()
        .nth(160)
        .map(|(index, _)| index)
        .unwrap_or(0);
    let excerpt: String = text[start..].chars().take(MAX_EXCERPT_CHARS).collect();
    Some((excerpt, score))
}

#[tauri::command]
pub fn build_knowledge_context(
    req: KnowledgeContextRequest,
) -> Result<Vec<KnowledgeSnippet>, String> {
    if req.sources.len() > 40 {
        return Err("一次最多使用 40 个资料来源。".into());
    }
    let mut candidates: Vec<(KnowledgeSnippet, i32)> = Vec::new();
    for source in req.sources {
        if source.id.len() > 128 || !matches!(source.source_type.as_str(), "file" | "folder") {
            continue;
        }
        let mut files = Vec::new();
        collect_files(
            Path::new(&source.source_path),
            source.source_type == "folder" && source.include_subdirs != 0,
            &mut files,
        );
        for file in files {
            if let Some((excerpt, score)) = read_excerpt(&file, &req.query) {
                candidates.push((
                    KnowledgeSnippet {
                        source_id: source.id.clone(),
                        title: file
                            .file_name()
                            .and_then(|value| value.to_str())
                            .unwrap_or("资料文件")
                            .to_string(),
                        path: file.to_string_lossy().to_string(),
                        excerpt,
                    },
                    score,
                ));
            }
        }
    }
    candidates.sort_by(|left, right| {
        right
            .1
            .cmp(&left.1)
            .then_with(|| left.0.path.cmp(&right.0.path))
    });
    Ok(candidates
        .into_iter()
        .take(MAX_SNIPPETS)
        .map(|(snippet, _)| snippet)
        .collect())
}
