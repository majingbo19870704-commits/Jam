// =============================================================================
// vault.rs · Obsidian Vault 的受控只读访问
// =============================================================================
//
// 此模块刻意不提供创建、写入、移动、重命名或删除命令。Vault 的唯一写入者是
// Obsidian；个人工作站只读取用户明确选择的目录，并对所有相对路径做边界校验。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use std::{
    cmp::Ordering,
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
    time::UNIX_EPOCH,
};
use url::Url;

const MAX_TREE_ENTRIES: usize = 8_000;
const MAX_TREE_DEPTH: usize = 32;
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PREVIEW_BYTES: u64 = 12 * 1024 * 1024;
const MAX_CONTEXT_FILES: usize = 1_200;
const MAX_CONTEXT_SNIPPETS: usize = 6;
const MAX_EXCERPT_CHARS: usize = 2_800;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub path: String,
    pub name: String,
    pub is_obsidian_vault: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultTreeEntry {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub extension: Option<String>,
    pub size: u64,
    pub modified_at: Option<i64>,
    pub children: Vec<VaultTreeEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFileContent {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub modified_at: Option<i64>,
    pub content: Option<String>,
    pub data_url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultDocumentIndex {
    pub path: String,
    pub name: String,
    pub title: String,
    pub tags: String,
    pub frontmatter: String,
    pub content: String,
    pub size: u64,
    pub modified_at: Option<i64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultKnowledgeSnippet {
    pub title: String,
    pub path: String,
    pub excerpt: String,
}

fn is_hidden_or_config_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            matches!(
                name,
                ".obsidian" | ".git" | "node_modules" | ".workstation-trash"
            )
        })
        .unwrap_or(false)
}

fn timestamp(metadata: &fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs() as i64)
}

fn root_path(root: &str) -> Result<PathBuf, String> {
    if root.trim().is_empty() || root.len() > 32_000 {
        return Err("知识库路径无效。".into());
    }
    let path = PathBuf::from(root);
    if !path.is_dir() {
        return Err("请选择可访问的知识库文件夹。".into());
    }
    fs::canonicalize(path).map_err(|_| "无法规范化知识库路径。".to_string())
}

fn relative_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn safe_relative(relative: &str) -> Result<PathBuf, String> {
    if relative.trim().is_empty() || relative.len() > 16_000 {
        return Err("资料路径无效。".into());
    }
    let path = Path::new(relative);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("资料路径超出了知识库范围。".into());
    }
    Ok(path.to_path_buf())
}

fn resolve_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = root.join(safe_relative(relative)?);
    let metadata = fs::symlink_metadata(&candidate).map_err(|_| "资料不存在或无法访问。")?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("只能读取知识库中的普通文件。".into());
    }
    let canonical = fs::canonicalize(candidate).map_err(|_| "无法读取资料路径。")?;
    if !canonical.starts_with(root) {
        return Err("资料路径超出了知识库范围。".into());
    }
    Ok(canonical)
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn is_text_extension(value: &str) -> bool {
    matches!(
        value,
        "md" | "markdown" | "txt" | "json" | "yaml" | "yml" | "csv"
    )
}

fn image_mime(value: &str) -> Option<&'static str> {
    match value {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn preview_mime(value: &str) -> Option<&'static str> {
    image_mime(value).or_else(|| {
        match value {
            "pdf" => Some("application/pdf"),
            "mp3" => Some("audio/mpeg"), "wav" => Some("audio/wav"), "ogg" => Some("audio/ogg"),
            "m4a" => Some("audio/mp4"), "aac" => Some("audio/aac"), "flac" => Some("audio/flac"),
            "mp4" => Some("video/mp4"), "webm" => Some("video/webm"), "mov" => Some("video/quicktime"),
            "ogv" => Some("video/ogg"),
            "docx" => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            "xlsx" | "xlsm" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            "xls" => Some("application/vnd.ms-excel"),
            _ => None,
        }
    })
}

#[tauri::command]
pub fn validate_vault(root: String) -> Result<VaultStatus, String> {
    let root = root_path(&root)?;
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("知识库")
        .to_string();
    Ok(VaultStatus {
        path: root.to_string_lossy().to_string(),
        name,
        is_obsidian_vault: root.join(".obsidian").is_dir(),
    })
}

fn build_tree(root: &Path, folder: &Path, depth: usize, count: &mut usize) -> Vec<VaultTreeEntry> {
    if depth > MAX_TREE_DEPTH || *count >= MAX_TREE_ENTRIES {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut output = Vec::new();
    for entry in entries.flatten() {
        if *count >= MAX_TREE_ENTRIES {
            break;
        }
        let path = entry.path();
        if is_hidden_or_config_dir(&path) {
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        *count += 1;
        let is_dir = metadata.is_dir();
        output.push(VaultTreeEntry {
            path: relative_path(relative),
            name: entry.file_name().to_string_lossy().to_string(),
            kind: if is_dir {
                "directory".into()
            } else {
                "file".into()
            },
            extension: (!is_dir)
                .then(|| extension(&path))
                .filter(|value| !value.is_empty()),
            size: if is_dir { 0 } else { metadata.len() },
            modified_at: timestamp(&metadata),
            children: if is_dir {
                build_tree(root, &path, depth + 1, count)
            } else {
                Vec::new()
            },
        });
    }
    output.sort_by(
        |left, right| match (left.kind.as_str(), right.kind.as_str()) {
            ("directory", "file") => Ordering::Less,
            ("file", "directory") => Ordering::Greater,
            _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
        },
    );
    output
}

#[tauri::command]
pub fn list_vault_tree(root: String) -> Result<Vec<VaultTreeEntry>, String> {
    let root = root_path(&root)?;
    let mut count = 0;
    Ok(build_tree(&root, &root, 0, &mut count))
}

#[tauri::command]
pub fn read_vault_file(root: String, path: String) -> Result<VaultFileContent, String> {
    let root = root_path(&root)?;
    let file = resolve_file(&root, &path)?;
    let metadata = fs::metadata(&file).map_err(|_| "无法读取资料信息。")?;
    let ext = extension(&file);
    let content = if is_text_extension(&ext) {
        if metadata.len() > MAX_TEXT_BYTES {
            return Err("文本资料超过 2 MB，请在 Obsidian 中打开查看。".into());
        }
        Some(fs::read_to_string(&file).map_err(|_| "该文本资料不是可读取的 UTF-8 文件。")?)
    } else {
        None
    };
    let data_url = if content.is_none() {
        preview_mime(&ext).and_then(|mime| {
            if metadata.len() > MAX_PREVIEW_BYTES {
                return None;
            }
            fs::read(&file)
                .ok()
                .map(|bytes| format!("data:{mime};base64,{}", BASE64.encode(bytes)))
        })
    } else {
        None
    };
    Ok(VaultFileContent {
        path,
        name: file
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("资料")
            .to_string(),
        extension: ext,
        size: metadata.len(),
        modified_at: timestamp(&metadata),
        content,
        data_url,
    })
}

/// 将知识库范围内的 Office 文档转换成 PDF 后直接返回数据 URL。
/// 仅接受已通过 resolve_file 边界校验的文件，临时转换目录会立刻清理。
#[tauri::command]
pub fn convert_vault_office_to_pdf(root: String, path: String) -> Result<String, String> {
    let root = root_path(&root)?;
    let source = resolve_file(&root, &path)?;
    let ext = extension(&source);
    if !matches!(ext.as_str(), "doc" | "docx" | "ppt" | "pptx" | "xls" | "xlsx" | "xlsm") {
        return Err("该文件不是可转换的 Office 文档。".into());
    }
    let soffice = crate::files::find_libreoffice()
        .ok_or("未检测到 LibreOffice，暂时无法转换此 Office 文档。")?;
    let out = std::env::temp_dir().join(format!("personal-workstation-vault-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&out).map_err(|e| format!("创建预览目录失败: {e}"))?;
    let result = (|| -> Result<String, String> {
        let status = Command::new(soffice)
            .args(["--headless", "--convert-to", "pdf", "--outdir"])
            .arg(&out).arg(&source).status()
            .map_err(|e| format!("启动 LibreOffice 失败: {e}"))?;
        if !status.success() { return Err("LibreOffice 转换失败。".into()); }
        let pdf = out.join(format!("{}.pdf", source.file_stem().and_then(|n| n.to_str()).ok_or("文件名无效。")?));
        let bytes = fs::read(&pdf).map_err(|_| "未找到 Office 转换后的 PDF。")?;
        Ok(format!("data:application/pdf;base64,{}", BASE64.encode(bytes)))
    })();
    let _ = fs::remove_dir_all(&out);
    result
}

/// 使用 Windows 已注册的 obsidian:// 协议打开当前 Vault 文件。
/// 优先尝试 cmd /c start（最可靠），再回退 explorer.exe。
#[tauri::command]
pub fn open_obsidian_file(root: String, path: String) -> Result<(), String> {
    let root = root_path(&root)?;
    let file = resolve_file(&root, &path)?;
    let vault_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("无法识别知识库名称。")?;
    let relative = file
        .strip_prefix(&root)
        .map(relative_path)
        .map_err(|_| "资料路径超出了知识库范围。")?;
    let mut url = Url::parse("obsidian://open").map_err(|_| "无法创建 Obsidian 打开链接。")?;
    url.query_pairs_mut()
        .append_pair("vault", vault_name)
        .append_pair("file", &relative);
    let url_str = url.as_str().to_string();
    // 优先用 cmd /c start 触发协议（最可靠），失败再尝试 explorer.exe
    let ok = Command::new("cmd")
        .args(["/c", "start", "", &url_str])
        .spawn()
        .is_ok();
    if !ok {
        Command::new("explorer.exe")
            .arg(&url_str)
            .spawn()
            .map_err(|_| "无法调用 Obsidian。请确认 Obsidian 已安装且已打开过该知识库。")?;
    }
    Ok(())
}

fn tags_from_markdown(content: &str) -> String {
    let mut tags = Vec::new();
    for word in content.split_whitespace() {
        let tag = word.trim_matches(|char: char| {
            !char.is_alphanumeric() && char != '#' && char != '/' && char != '-'
        });
        if let Some(value) = tag.strip_prefix('#').filter(|value| !value.is_empty()) {
            if !tags.iter().any(|item: &String| item == value) {
                tags.push(value.to_string());
            }
        }
    }
    tags.into_iter().take(30).collect::<Vec<_>>().join(", ")
}

fn markdown_parts(content: &str, fallback: &str) -> (String, String, String, String) {
    let mut body = content;
    let mut frontmatter = String::new();
    if let Some(rest) = content.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            frontmatter = rest[..end].to_string();
            body = &rest[end + 4..];
        }
    }
    let title = body
        .lines()
        .find_map(|line| line.trim().strip_prefix("# "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string();
    let tags = tags_from_markdown(content);
    (title, tags, frontmatter, body.to_string())
}

fn collect_markdown(root: &Path, folder: &Path, output: &mut Vec<PathBuf>) {
    if output.len() >= MAX_CONTEXT_FILES || is_hidden_or_config_dir(folder) {
        return;
    }
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        if output.len() >= MAX_CONTEXT_FILES {
            break;
        }
        let path = entry.path();
        if is_hidden_or_config_dir(&path) {
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            collect_markdown(root, &path, output);
        } else if metadata.is_file() && is_text_extension(&extension(&path)) {
            output.push(path);
        }
    }
}

#[tauri::command]
pub fn scan_vault_documents(root: String) -> Result<Vec<VaultDocumentIndex>, String> {
    let root = root_path(&root)?;
    let mut files = Vec::new();
    collect_markdown(&root, &root, &mut files);
    let mut documents = Vec::new();
    for file in files {
        let Ok(metadata) = fs::metadata(&file) else {
            continue;
        };
        if metadata.len() > MAX_TEXT_BYTES {
            continue;
        }
        let Ok(content) = fs::read_to_string(&file) else {
            continue;
        };
        let Ok(relative) = file.strip_prefix(&root) else {
            continue;
        };
        let name = file
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("笔记")
            .to_string();
        let (title, tags, frontmatter, body) = markdown_parts(&content, &name);
        documents.push(VaultDocumentIndex {
            path: relative_path(relative),
            name,
            title,
            tags,
            frontmatter,
            content: body,
            size: metadata.len(),
            modified_at: timestamp(&metadata),
        });
    }
    documents.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(documents)
}

fn terms(query: &str) -> Vec<String> {
    let lowered = query.to_lowercase();
    let mut values = lowered
        .split_whitespace()
        .filter(|term| term.chars().count() >= 2)
        .map(str::to_string)
        .collect::<Vec<_>>();
    if values.is_empty() && lowered.chars().count() >= 2 {
        values.push(lowered);
    }
    values
}

fn excerpt(text: &str, query: &str) -> Option<(String, usize)> {
    let lowered = text.to_lowercase();
    let terms = terms(query);
    let score = if terms.is_empty() {
        1
    } else {
        terms
            .iter()
            .map(|term| lowered.matches(term).count().min(20))
            .sum()
    };
    if score == 0 {
        return None;
    }
    let start_at = terms
        .iter()
        .find_map(|term| lowered.find(term))
        .unwrap_or(0);
    let start = text[..start_at]
        .char_indices()
        .rev()
        .nth(180)
        .map(|(index, _)| index)
        .unwrap_or(0);
    Some((
        text[start..].chars().take(MAX_EXCERPT_CHARS).collect(),
        score,
    ))
}

#[tauri::command]
pub fn build_vault_ai_context(
    root: String,
    query: String,
    scope_path: Option<String>,
    scope_kind: String,
) -> Result<Vec<VaultKnowledgeSnippet>, String> {
    let root = root_path(&root)?;
    let scope = match scope_kind.as_str() {
        "vault" => root.clone(),
        "folder" | "file" => {
            let value = scope_path.as_deref().ok_or("请先选择资料范围。")?;
            let candidate = root.join(safe_relative(value)?);
            let canonical = fs::canonicalize(&candidate).map_err(|_| "资料范围不存在。")?;
            if !canonical.starts_with(&root) {
                return Err("资料范围超出了知识库。".into());
            }
            canonical
        }
        _ => return Err("资料范围无效。".into()),
    };
    let mut files = Vec::new();
    if scope_kind == "file" {
        let metadata = fs::symlink_metadata(&scope).map_err(|_| "无法读取当前资料。")?;
        if !metadata.file_type().is_symlink()
            && is_text_extension(&extension(&scope))
        {
            files.push(scope);
        }
    } else {
        collect_markdown(&root, &scope, &mut files);
    }
    let mut candidates = Vec::new();
    for file in files {
        let Ok(metadata) = fs::metadata(&file) else {
            continue;
        };
        if metadata.len() > MAX_TEXT_BYTES {
            continue;
        }
        let Ok(content) = fs::read_to_string(&file) else {
            continue;
        };
        let Some((excerpt, score)) = excerpt(&content, &query) else {
            continue;
        };
        let relative = file
            .strip_prefix(&root)
            .map(relative_path)
            .unwrap_or_else(|_| file.to_string_lossy().to_string());
        let name = file
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("资料")
            .to_string();
        candidates.push((
            VaultKnowledgeSnippet {
                title: name,
                path: relative,
                excerpt,
            },
            score,
        ));
    }
    candidates.sort_by(|left, right| {
        right
            .1
            .cmp(&left.1)
            .then_with(|| left.0.path.cmp(&right.0.path))
    });
    Ok(candidates
        .into_iter()
        .take(MAX_CONTEXT_SNIPPETS)
        .map(|(item, _)| item)
        .collect())
}
