// =============================================================================
// files.rs · 项目文件的复制、读取、导出
// =============================================================================
//
// 关键点：
//   - 所有 relative_path 都是相对于 app_data_dir 的路径
//   - 目录形如：{app_data}/accounts/{account_id}/files/{project_id}/{uuid}_{name}
//   - 前端只需传递 account_id / project_id / src_path / original_name，
//     后端负责生成安全路径 + 复制
// =============================================================================

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(serde::Serialize)]
pub struct CopyResult {
    pub rel_path: String,
    pub abs_path: String,
    pub archive_path: Option<String>,
    pub size_bytes: u64,
    pub md5: String,
}

/// 文本预览只读取文件开头，避免大日志或导出数据卡住渲染进程。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPreview {
    pub content: String,
    pub truncated: bool,
    pub total_bytes: u64,
}

/// 外部资料归档文件的只读预览数据。资料归档位置由用户选择，不能使用
/// 相对 app_data 路径的预览命令；这里仍严格限制为普通绝对文件。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalTextPreview {
    pub content: String,
    pub truncated: bool,
    pub total_bytes: u64,
}

fn checked_external_file(path_value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path_value);
    if !path.is_absolute() {
        return Err("资料文件路径必须是绝对路径。".into());
    }
    let metadata = fs::symlink_metadata(&path).map_err(|e| format!("无法读取资料文件：{e}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("资料文件不是可预览的普通文件。".into());
    }
    Ok(path)
}

/// 仅供资料管理的应用内查看器读取归档文件，不会调用系统默认程序。
#[tauri::command]
pub fn read_material_file_base64(path: String) -> Result<String, String> {
    use base64::Engine;
    const MAX_PREVIEW_BYTES: u64 = 30 * 1024 * 1024;
    let file = checked_external_file(&path)?;
    let size = fs::metadata(&file).map_err(|e| format!("读取文件信息失败：{e}"))?.len();
    if size > MAX_PREVIEW_BYTES {
        return Err("文件超过 30 MB，不能在应用内加载预览。".into());
    }
    let bytes = fs::read(&file).map_err(|e| format!("读取资料文件失败：{e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn read_material_file_text_preview(path: String) -> Result<ExternalTextPreview, String> {
    const PREVIEW_BYTES: u64 = 1_000_000;
    let file_path = checked_external_file(&path)?;
    let total_bytes = fs::metadata(&file_path).map_err(|e| format!("读取文件信息失败：{e}"))?.len();
    let file = fs::File::open(&file_path).map_err(|e| format!("读取资料文件失败：{e}"))?;
    let mut bytes = Vec::with_capacity(PREVIEW_BYTES as usize);
    file.take(PREVIEW_BYTES).read_to_end(&mut bytes).map_err(|e| format!("读取资料文件失败：{e}"))?;
    Ok(ExternalTextPreview {
        content: String::from_utf8_lossy(&bytes).to_string(),
        truncated: total_bytes > PREVIEW_BYTES,
        total_bytes,
    })
}

/// 批量导入前的只读源文件检查结果。前端据此在确认前就展示失效路径，
/// 避免用户等待复制阶段才得知网络盘断开、文件被移走或路径实际指向目录。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFileInspection {
    pub path: String,
    pub ready: bool,
    pub size_bytes: u64,
    pub reason: Option<String>,
}

#[tauri::command]
pub fn inspect_source_files(paths: Vec<String>) -> Result<Vec<SourceFileInspection>, String> {
    if paths.len() > 10_000 {
        return Err("一次最多检查 10,000 个导入源文件。".into());
    }
    Ok(paths
        .into_iter()
        .map(|path| {
            if path.is_empty() || path.len() > 32_000 {
                return SourceFileInspection {
                    path,
                    ready: false,
                    size_bytes: 0,
                    reason: Some("路径为空或过长。".into()),
                };
            }
            let candidate = Path::new(&path);
            if !candidate.is_absolute() {
                return SourceFileInspection {
                    path,
                    ready: false,
                    size_bytes: 0,
                    reason: Some("必须使用本机绝对路径。".into()),
                };
            }
            match fs::metadata(candidate) {
                Ok(metadata) if metadata.is_file() => match fs::File::open(candidate) {
                    Ok(_) => SourceFileInspection {
                        path,
                        ready: true,
                        size_bytes: metadata.len(),
                        reason: None,
                    },
                    Err(error) => SourceFileInspection {
                        path,
                        ready: false,
                        size_bytes: 0,
                        reason: Some(format!("文件不可读取：{error}")),
                    },
                },
                Ok(_) => SourceFileInspection {
                    path,
                    ready: false,
                    size_bytes: 0,
                    reason: Some("该路径不是文件。".into()),
                },
                Err(error) => SourceFileInspection {
                    path,
                    ready: false,
                    size_bytes: 0,
                    reason: Some(format!("文件不存在或无法访问：{error}")),
                },
            }
        })
        .collect())
}

/// 把源文件复制到应用数据目录，返回结果
#[tauri::command]
pub async fn copy_file_to_data(
    app: AppHandle,
    account_id: String,
    project_id: String,
    src_path: String,
    original_name: String,
    archive_root: Option<String>,
    project_name: Option<String>,
    archive_category: Option<String>,
) -> Result<CopyResult, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;

    let mut dest_dir = data_dir.clone();
    dest_dir.push("accounts");
    dest_dir.push(&account_id);
    dest_dir.push("files");
    dest_dir.push(&project_id);
    fs::create_dir_all(&dest_dir).map_err(|e| format!("创建目录失败: {e}"))?;

    let uuid = uuid::Uuid::new_v4().simple().to_string();
    let safe_name = sanitize(&original_name);
    let file_name = format!("{uuid}_{safe_name}");
    let mut dest_path = dest_dir.clone();
    dest_path.push(&file_name);

    fs::copy(&src_path, &dest_path).map_err(|e| format!("复制失败: {e}"))?;

    // 用户配置归档根目录时，同步写入“归档根目录 / 项目名 / 文件类型”。
    // 应用数据目录中的副本始终保留，确保外部磁盘暂时不可用时仍能预览和备份。
    let archive_path = match archive_root.filter(|value| !value.trim().is_empty()) {
        Some(root) => match copy_to_project_archive(
            &src_path,
            &root,
            project_name.as_deref().unwrap_or("未命名项目"),
            archive_category.as_deref().unwrap_or("未分类"),
            &safe_name,
        ) {
            Ok(path) => Some(path.to_string_lossy().to_string()),
            Err(error) => {
                let _ = fs::remove_file(&dest_path);
                return Err(error);
            }
        },
        None => None,
    };

    // 大小 + md5
    let size = fs::metadata(&dest_path)
        .map_err(|e| format!("读元数据失败: {e}"))?
        .len();
    let md5 = compute_md5(&dest_path).unwrap_or_default();

    // 相对 app_data_dir 的路径
    let rel = pathdiff::diff_paths(&dest_path, &data_dir)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| dest_path.to_string_lossy().to_string());

    Ok(CopyResult {
        rel_path: rel,
        abs_path: dest_path.to_string_lossy().to_string(),
        archive_path,
        size_bytes: size,
        md5,
    })
}

/// 选择归档地址时立即建立项目目录，便于用户在资源管理器中定位项目资料。
#[tauri::command]
pub fn prepare_project_archive(archive_root: String, project_name: String) -> Result<String, String> {
    let root = validate_archive_root(&archive_root)?;
    let project_dir = root.join(safe_folder_name(&project_name, "未命名项目"));
    fs::create_dir_all(&project_dir).map_err(|e| format!("创建项目归档目录失败: {e}"))?;
    Ok(project_dir.to_string_lossy().to_string())
}

/// 资料管理：在“根目录/资料类型/文件类型”中复制一个文件。
/// 同名文件默认拒绝覆盖，由界面明确确认后才传 replace_existing=true。
#[tauri::command]
pub fn copy_material_file(
    source_path: String,
    archive_root: String,
    material_type: String,
    file_type: String,
    original_name: String,
    replace_existing: bool,
) -> Result<String, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_absolute() || !source.is_file() { return Err("源文件不存在或不可读取。".into()); }
    let target = material_archive_path(&archive_root, &material_type, &file_type, &original_name)?;
    copy_or_replace(&source, &target, replace_existing)?;
    Ok(target.to_string_lossy().to_string())
}

/// 修改资料分类时移动实体文件，并始终保持由参数定义的文件夹结构。
#[tauri::command]
pub fn move_material_file(
    source_path: String,
    archive_root: String,
    material_type: String,
    file_type: String,
    original_name: String,
    replace_existing: bool,
) -> Result<String, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_absolute() || !source.is_file() { return Err("原归档文件不存在或不可读取。".into()); }
    let target = material_archive_path(&archive_root, &material_type, &file_type, &original_name)?;
    if source == target { return Ok(target.to_string_lossy().to_string()); }
    if target.exists() {
        if !replace_existing { return Err(format!("目标位置已存在同名文件：{}", target.display())); }
        fs::remove_file(&target).map_err(|e| format!("无法替换目标文件：{e}"))?;
    }
    fs::rename(&source, &target).or_else(|_| { fs::copy(&source, &target).map(|_| ()).and_then(|_| fs::remove_file(&source)) }).map_err(|e| format!("移动资料文件失败：{e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// 资料行进入系统回收站时，同步把实体文件移出原有“资料类型/文件类型”目录。
/// 每条记录使用独立目录，避免不同类型的同名文件互相覆盖。
#[tauri::command]
pub fn move_material_file_to_recycle(
    source_path: String,
    archive_root: String,
    record_id: String,
    original_name: String,
) -> Result<String, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_absolute() || !source.is_file() {
        return Err("原归档文件不存在或不可读取。".into());
    }
    let root = validate_archive_root(&archive_root)?;
    let target_dir = root
        .join("_系统回收站")
        .join("资料文件")
        .join(safe_folder_name(&record_id, "未命名记录"));
    fs::create_dir_all(&target_dir).map_err(|e| format!("创建资料回收站目录失败：{e}"))?;
    let target = target_dir.join(sanitize(&original_name));
    if target.exists() {
        return Err(format!("资料回收站中已存在同名文件：{}", target.display()));
    }
    fs::rename(&source, &target)
        .or_else(|_| fs::copy(&source, &target).map(|_| ()).and_then(|_| fs::remove_file(&source)))
        .map_err(|e| format!("移入资料回收站失败：{e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[derive(serde::Deserialize)]
pub struct MaterialArchiveParameter {
    pub material_type: String,
    pub file_type: String,
}

/// 用户确定归档地址后，按当前参数表创建“资料类型/文件类型”完整目录树。
#[tauri::command]
pub fn prepare_material_archive(archive_root: String, parameters: Vec<MaterialArchiveParameter>) -> Result<String, String> {
    let root = validate_archive_root(&archive_root)?;
    for parameter in parameters {
        if parameter.material_type.trim().is_empty() || parameter.file_type.trim().is_empty() { continue; }
        let directory = root.join(safe_folder_name(&parameter.material_type, "未分类资料")).join(safe_folder_name(&parameter.file_type, "未分类文件"));
        fs::create_dir_all(directory).map_err(|e| format!("创建资料归档文件夹失败：{e}"))?;
    }
    Ok(root.to_string_lossy().to_string())
}

/// 删除已不再被参数表使用的空文件类型目录；若有未登记文件则拒绝删除，避免误伤手工文件。
#[tauri::command]
pub fn remove_empty_material_archive_folder(archive_root: String, material_type: String, file_type: String) -> Result<(), String> {
    let root = validate_archive_root(&archive_root)?;
    let type_dir = root.join(safe_folder_name(&material_type, "未分类资料"));
    let file_dir = type_dir.join(safe_folder_name(&file_type, "未分类文件"));
    if file_dir.exists() {
        fs::remove_dir(&file_dir).map_err(|error| format!("文件类型目录不为空，未删除：{error}"))?;
    }
    if type_dir.exists() && fs::read_dir(&type_dir).map_err(|e| e.to_string())?.next().is_none() {
        fs::remove_dir(&type_dir).map_err(|e| format!("删除空资料类型目录失败：{e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_material_files(paths: Vec<String>) -> Result<u64, String> {
    delete_project_archive_files(paths)
}

fn material_archive_path(root_value: &str, material_type: &str, file_type: &str, original_name: &str) -> Result<PathBuf, String> {
    let root = validate_archive_root(root_value)?;
    let directory = root.join(safe_folder_name(material_type, "未分类资料")).join(safe_folder_name(file_type, "未分类文件"));
    fs::create_dir_all(&directory).map_err(|e| format!("创建资料归档文件夹失败：{e}"))?;
    Ok(directory.join(sanitize(original_name)))
}

fn copy_or_replace(source: &Path, target: &Path, replace_existing: bool) -> Result<(), String> {
    if target.exists() {
        if !replace_existing { return Err(format!("目标位置已存在同名文件：{}", target.display())); }
        fs::remove_file(target).map_err(|e| format!("无法替换目标文件：{e}"))?;
    }
    fs::copy(source, target).map_err(|e| format!("归档资料文件失败：{e}"))?;
    Ok(())
}

/// 把 rel_path 解析成绝对路径（供前端读文件时用）
#[tauri::command]
pub fn resolve_data_path(app: AppHandle, rel_path: String) -> Result<String, String> {
    let mut base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    for seg in rel_path.split(['/', '\\']) {
        if seg == ".." || seg.is_empty() {
            continue;
        }
        base.push(seg);
    }
    Ok(base.to_string_lossy().to_string())
}

/// 读取文件为 base64（用于内嵌预览）
#[tauri::command]
pub fn read_file_base64(app: AppHandle, rel_path: String) -> Result<String, String> {
    use base64::Engine;
    let mut base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    for seg in rel_path.split(['/', '\\']) {
        if seg == ".." || seg.is_empty() {
            continue;
        }
        base.push(seg);
    }
    let bytes = fs::read(&base).map_err(|e| format!("读取失败: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// 读取文件为文本（用于 md / txt 预览）
#[tauri::command]
pub fn read_file_text(app: AppHandle, rel_path: String) -> Result<String, String> {
    let mut base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    for seg in rel_path.split(['/', '\\']) {
        if seg == ".." || seg.is_empty() {
            continue;
        }
        base.push(seg);
    }
    fs::read_to_string(&base).map_err(|e| format!("读取失败: {e}"))
}

/// 分块读取文本预览；完整文件仍可通过“用系统程序打开”查看。
#[tauri::command]
pub fn read_file_text_preview(app: AppHandle, rel_path: String) -> Result<TextPreview, String> {
    const PREVIEW_BYTES: u64 = 1_000_000;
    let mut base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    for seg in rel_path.split(['/', '\\']) {
        if seg == ".." || seg.is_empty() {
            continue;
        }
        base.push(seg);
    }
    let total_bytes = fs::metadata(&base).map_err(|e| format!("读取文件信息失败: {e}"))?.len();
    let input = fs::File::open(&base).map_err(|e| format!("读取失败: {e}"))?;
    let mut bytes = Vec::with_capacity(PREVIEW_BYTES as usize);
    input
        .take(PREVIEW_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取失败: {e}"))?;
    Ok(TextPreview {
        content: String::from_utf8_lossy(&bytes).to_string(),
        truncated: total_bytes > PREVIEW_BYTES,
        total_bytes,
    })
}

/// 检查 LibreOffice 是否可用；返回可执行路径或 null
#[tauri::command]
pub fn find_libreoffice() -> Option<String> {
    // Windows：先查 PATH，再查常见安装目录
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = std::process::Command::new("where").arg("soffice").output() {
            if out.status.success() {
                if let Some(line) = String::from_utf8_lossy(&out.stdout).lines().next() {
                    let p = line.trim().to_string();
                    if !p.is_empty() {
                        return Some(p);
                    }
                }
            }
        }
        let candidates = [
            "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
            "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
        ];
        for c in candidates {
            if std::path::Path::new(c).exists() {
                return Some(c.to_string());
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(out) = std::process::Command::new("which").arg("soffice").output() {
            if out.status.success() {
                if let Some(line) = String::from_utf8_lossy(&out.stdout).lines().next() {
                    return Some(line.trim().to_string());
                }
            }
        }
        None
    }
}

/// 用 LibreOffice 把源文件转成 PDF，写入 preview_cache/{md5}.pdf
/// 返回 PDF 的相对路径（相对 app_data_dir）；若已有缓存直接返回
#[tauri::command]
pub async fn convert_to_pdf(app: AppHandle, rel_path: String) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;

    // 源绝对路径
    let mut src = data_dir.clone();
    for seg in rel_path.split(['/', '\\']) {
        if seg == ".." || seg.is_empty() {
            continue;
        }
        src.push(seg);
    }
    if !src.exists() {
        return Err(format!("源文件不存在: {}", src.display()));
    }

    // 缓存目录
    let mut cache_dir = data_dir.clone();
    cache_dir.push("preview_cache");
    fs::create_dir_all(&cache_dir).map_err(|e| format!("创建缓存目录失败: {e}"))?;

    // 缓存文件名：源文件的 md5
    let md5 = compute_md5(&src).unwrap_or_else(|| "unknown".into());
    let mut cache_path = cache_dir.clone();
    cache_path.push(format!("{md5}.pdf"));

    // 缓存命中直接返回
    if cache_path.exists() {
        let rel = pathdiff::diff_paths(&cache_path, &data_dir)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|| cache_path.to_string_lossy().to_string());
        return Ok(rel);
    }

    // 找 LibreOffice
    let soffice = find_libreoffice().ok_or_else(|| {
        "未检测到 LibreOffice。请先安装：https://www.libreoffice.org/download/".to_string()
    })?;

    // 转换：soffice --headless --convert-to pdf --outdir <cache_dir> <src>
    let status = std::process::Command::new(&soffice)
        .args(["--headless", "--convert-to", "pdf", "--outdir"])
        .arg(&cache_dir)
        .arg(&src)
        .status()
        .map_err(|e| format!("启动 LibreOffice 失败: {e}"))?;

    if !status.success() {
        return Err(format!("LibreOffice 转换失败，退出码 {:?}", status.code()));
    }

    // LibreOffice 会用源文件名生成 PDF，需要重命名成 {md5}.pdf
    let src_stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "源文件名解析失败".to_string())?;
    let mut generated = cache_dir.clone();
    generated.push(format!("{src_stem}.pdf"));

    if !generated.exists() {
        return Err(format!("未找到转换产物: {}", generated.display()));
    }
    fs::rename(&generated, &cache_path).map_err(|e| format!("重命名失败: {e}"))?;

    let rel = pathdiff::diff_paths(&cache_path, &data_dir)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| cache_path.to_string_lossy().to_string());
    Ok(rel)
}

/// 删除文件（回收站清理时用）
#[tauri::command]
pub fn delete_file(app: AppHandle, rel_path: String) -> Result<(), String> {
    let mut base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    for seg in rel_path.split(['/', '\\']) {
        if seg == ".." || seg.is_empty() {
            continue;
        }
        base.push(seg);
    }
    if base.exists() {
        fs::remove_file(&base).map_err(|e| format!("删除失败: {e}"))?;
    }
    Ok(())
}

/// 删除项目文件已登记的外部归档副本。仅接受普通绝对文件路径；不存在的历史归档视为已清理。
#[tauri::command]
pub fn delete_project_archive_files(archive_paths: Vec<String>) -> Result<u64, String> {
    if archive_paths.len() > 10_000 {
        return Err("一次最多删除 10,000 个归档文件。".into());
    }
    let mut files = Vec::new();
    for value in archive_paths {
        if value.trim().is_empty() { continue; }
        let path = PathBuf::from(value);
        if !path.is_absolute() {
            return Err("归档文件路径必须是绝对路径。".into());
        }
        match fs::symlink_metadata(&path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(format!("归档路径不是可删除的普通文件：{}", path.display()));
                }
                files.push(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法检查归档文件 {}：{error}", path.display())),
        }
    }

    let mut deleted = 0_u64;
    for path in files {
        fs::remove_file(&path).map_err(|error| format!("删除归档文件 {} 失败：{error}", path.display()))?;
        deleted += 1;
    }
    Ok(deleted)
}

// -----------------------------------------------------------------------------
// 备份 / 恢复
// -----------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct BackupInfo {
    pub file_name: String,
    pub abs_path: String,
    pub size_bytes: u64,
    pub created_at: String,
    pub encrypted: bool,
}

/// 恢复前校验返回的信息。只读取隔离暂存区，绝不写入当前工作数据。
#[derive(serde::Serialize)]
pub struct BackupVerification {
    pub file_name: String,
    pub account_file_count: u64,
    pub uncompressed_bytes: u64,
}

/// 用户支持页所需的只读本机健康信息，不包含任何业务内容或密钥。
#[derive(serde::Serialize)]
pub struct AppDiagnostics {
    pub platform: String,
    pub data_directory: String,
    pub database_status: String,
    pub database_size_bytes: u64,
    pub backup_count: u64,
    pub backup_size_bytes: u64,
}

#[tauri::command]
pub fn get_app_diagnostics(app: AppHandle) -> Result<AppDiagnostics, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let database = data_dir.join("data.db");
    let (database_status, database_size_bytes) = if database.exists() {
        let size = fs::metadata(&database).map_err(|e| format!("读取数据库大小失败: {e}"))?.len();
        let status = match verify_sqlite_database(&database) {
            Ok(()) => "数据库完整性正常".to_string(),
            Err(error) => format!("数据库需要检查：{error}"),
        };
        (status, size)
    } else {
        ("数据库尚未创建（首次登录后自动建立）".to_string(), 0)
    };
    let backups = list_backup_directory(&data_dir.join("backups"))?;
    let backup_count = backups.len() as u64;
    let backup_size_bytes = backups.iter().map(|backup| backup.size_bytes).sum();
    Ok(AppDiagnostics {
        platform: std::env::consts::OS.to_string(),
        data_directory: data_dir.to_string_lossy().to_string(),
        database_status,
        database_size_bytes,
        backup_count,
        backup_size_bytes,
    })
}

/// 创建一份普通 ZIP 备份：数据库已包含当前 API 密钥；同时兼容打包旧版的加密密钥存储。
#[tauri::command]
pub async fn create_backup(app: AppHandle) -> Result<BackupInfo, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let mut backup_dir = data_dir.clone();
    backup_dir.push("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {e}"))?;

    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f").to_string();
    let file_name = format!("backup_{ts}.zip");
    let mut zip_path = backup_dir.clone();
    zip_path.push(&file_name);

    let file = fs::File::create(&zip_path).map_err(|e| format!("创建 zip 失败: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // 打包 data.db
    let db_path = data_dir.join("data.db");
    if db_path.exists() {
        add_file_to_zip(&mut zip, &db_path, "data.db", opts)?;
    }
    // 打包 accounts 目录
    let accounts_dir = data_dir.join("accounts");
    if accounts_dir.exists() {
        add_dir_to_zip(&mut zip, &accounts_dir, "accounts", opts)?;
    }
    // 兼容旧版 DPAPI 密文；新版本 API 密钥已直接存入 data.db。
    let ai_secrets_path = data_dir.join("ai-secrets.json");
    if ai_secrets_path.exists() {
        add_file_to_zip(&mut zip, &ai_secrets_path, "ai-secrets.json", opts)?;
    }

    zip.finish().map_err(|e| format!("完成 zip 失败: {e}"))?;

    let size = fs::metadata(&zip_path)
        .map_err(|e| format!("读元数据失败: {e}"))?
        .len();

    Ok(BackupInfo {
        file_name,
        abs_path: zip_path.to_string_lossy().to_string(),
        size_bytes: size,
        created_at: chrono::Local::now().to_rfc3339(),
        encrypted: false,
    })
}

/// 按全局设置执行自动备份。应用启动与运行期间可安全重复调用；未到周期时不写入文件。
#[tauri::command]
pub async fn run_auto_backup(app: AppHandle) -> Result<bool, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let db_path = data_dir.join("data.db");
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let enabled: String = conn.query_row("SELECT COALESCE(value,'0') FROM setting_kv WHERE scope='app' AND key='backup.auto.enabled'", [], |r| r.get(0)).unwrap_or_else(|_| "0".into());
    if enabled != "1" { return Ok(false); }
    let interval: i64 = conn.query_row("SELECT COALESCE(value,'7') FROM setting_kv WHERE scope='app' AND key='backup.auto.interval_days'", [], |r| r.get::<_, String>(0)).ok().and_then(|v| v.parse().ok()).unwrap_or(7).clamp(1, 30);
    let keep_count: usize = conn.query_row("SELECT COALESCE(value,'20') FROM setting_kv WHERE scope='app' AND key='backup.auto.keep_count'", [], |r| r.get::<_, String>(0)).ok().and_then(|v| v.parse().ok()).unwrap_or(20).clamp(3, 100) as usize;
    let last: Option<String> = conn.query_row("SELECT value FROM setting_kv WHERE scope='app' AND key='backup.auto.last_at'", [], |r| r.get(0)).ok();
    if let Some(last) = last.and_then(|value| chrono::DateTime::parse_from_rfc3339(&value).ok()) {
        if chrono::Local::now().signed_duration_since(last.with_timezone(&chrono::Local)).num_days() < interval { return Ok(false); }
    }
    create_backup(app.clone()).await?;
    prune_backup_directory(&data_dir.join("backups"), keep_count)?;
    let now = chrono::Local::now().to_rfc3339();
    conn.execute("INSERT INTO setting_kv(scope,key,value,updated_at) VALUES('app','backup.auto.last_at',?1,?1) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", rusqlite::params![now]).map_err(|e| e.to_string())?;
    Ok(true)
}

/// 列出所有备份
#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let backup_dir = data_dir.join("backups");
    list_backup_directory(&backup_dir)
}

/// 导入用户主动选择的外部 ZIP 备份。先在隔离目录完整校验，再复制到工作站备份目录。
#[tauri::command]
pub fn import_backup(
    app: AppHandle,
    source_path: String,
    password: Option<String>,
) -> Result<BackupInfo, String> {
    let source = PathBuf::from(source_path.trim());
    if !source.is_absolute() || !source.is_file() || source.extension().and_then(|ext| ext.to_str()) != Some("zip") {
        return Err("请选择有效的 ZIP 备份文件。".into());
    }
    let data_dir = app.path().app_data_dir().map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let staging = data_dir.join(format!(".backup-import-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&staging).map_err(|e| format!("创建导入校验目录失败: {e}"))?;
    let source_name = source.file_name().and_then(|name| name.to_str()).unwrap_or("外部备份.zip");
    let verification = verify_backup_archive(&source, &staging, source_name, password.as_deref());
    let _ = fs::remove_dir_all(&staging);
    verification?;

    let backup_dir = data_dir.join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {e}"))?;
    let file_name = format!("imported_{}.zip", chrono::Local::now().format("%Y%m%d_%H%M%S_%3f"));
    let destination = backup_dir.join(&file_name);
    fs::copy(&source, &destination).map_err(|e| format!("导入备份失败: {e}"))?;
    let size_bytes = fs::metadata(&destination).map_err(|e| format!("读取导入备份失败: {e}"))?.len();
    Ok(BackupInfo {
        file_name,
        abs_path: destination.to_string_lossy().to_string(),
        size_bytes,
        created_at: chrono::Local::now().to_rfc3339(),
        encrypted: is_backup_encrypted(&destination).unwrap_or(false),
    })
}

/// 立即执行备份保留策略。始终保留最新的至少 3 份，避免误操作后没有回退点。
#[tauri::command]
pub fn prune_backups(app: AppHandle, keep_count: i64) -> Result<u64, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    prune_backup_directory(&data_dir.join("backups"), keep_count.clamp(3, 100) as usize)
}

/// 校验备份压缩包的路径白名单、解压大小与 SQLite 完整性。
/// 用于让用户在恢复前发现损坏或不兼容的备份，整个过程不会触及当前数据库。
#[tauri::command]
pub fn verify_backup(app: AppHandle, file_name: String, password: Option<String>) -> Result<BackupVerification, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    validate_backup_name(&file_name)?;
    let zip_path = data_dir.join("backups").join(&file_name);
    if !zip_path.exists() {
        return Err(format!("备份文件不存在: {file_name}"));
    }

    let staging = data_dir.join(format!(".backup-verify-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&staging).map_err(|e| format!("创建校验暂存目录失败: {e}"))?;
    let result = verify_backup_archive(&zip_path, &staging, &file_name, password.as_deref());
    let _ = fs::remove_dir_all(&staging);
    result
}

fn verify_backup_archive(zip_path: &Path, staging: &Path, file_name: &str, password: Option<&str>) -> Result<BackupVerification, String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("打开 zip 失败: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读 zip 失败: {e}"))?;
    let mut total_size = 0_u64;
    let mut account_file_count = 0_u64;
    let mut has_database = false;

    for i in 0..archive.len() {
        let encrypted = archive.by_index_raw(i).map_err(|e| e.to_string())?.encrypted();
        let mut entry = if encrypted {
            archive.by_index_decrypt(i, password.ok_or("此备份已加密，请输入备份密码。")?.as_bytes())
        } else { archive.by_index(i) }.map_err(|_| "备份密码错误或备份已损坏。")?;
        let enclosed = entry.enclosed_name().ok_or_else(|| "备份包含不安全的文件路径，校验已停止".to_string())?;
        if !is_allowed_backup_entry(&enclosed) {
            return Err(format!("备份包含非工作站数据文件：{}", enclosed.display()));
        }
        if entry.is_dir() { continue; }
        total_size = total_size.saturating_add(entry.size());
        if total_size > 2 * 1024 * 1024 * 1024 {
            return Err("备份解压后的数据超过 2 GB，已拒绝校验".into());
        }
        if enclosed.starts_with("accounts") { account_file_count += 1; }
        if enclosed == Path::new("data.db") {
            let mut output = fs::File::create(staging.join("data.db")).map_err(|e| format!("写入校验数据库失败: {e}"))?;
            std::io::copy(&mut entry, &mut output).map_err(|e| format!("读取备份数据库失败: {e}"))?;
            has_database = true;
        } else {
            // 读取到 EOF 才会触发 zip 的 CRC/截断校验；不能只看压缩目录中的 size 元数据。
            std::io::copy(&mut entry, &mut std::io::sink())
                .map_err(|e| format!("校验备份附件失败: {e}"))?;
        }
    }
    if !has_database { return Err("备份中缺少 data.db，不能恢复".into()); }
    verify_sqlite_database(&staging.join("data.db"))?;
    Ok(BackupVerification { file_name: file_name.to_string(), account_file_count, uncompressed_bytes: total_size })
}

fn list_backup_directory(backup_dir: &Path) -> Result<Vec<BackupInfo>, String> {
    if !backup_dir.exists() { return Ok(vec![]); }
    let mut out = vec![];
    for entry in fs::read_dir(&backup_dir).map_err(|e| format!("读取失败: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("zip") {
            let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
            let created = meta
                .modified()
                .map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339())
                .unwrap_or_default();
            let encrypted = is_backup_encrypted(&path).unwrap_or(false);
            out.push(BackupInfo {
                file_name: path.file_name().unwrap().to_string_lossy().to_string(),
                abs_path: path.to_string_lossy().to_string(),
                size_bytes: meta.len(),
                created_at: created,
                encrypted,
            });
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// 只读取 ZIP 中央目录来标识 AES 加密状态，不触碰业务文件内容。
fn is_backup_encrypted(path: &Path) -> Result<bool, String> {
    let file = fs::File::open(path).map_err(|e| format!("打开 zip 失败: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读 zip 失败: {e}"))?;
    if archive.len() == 0 { return Ok(false); }
    let encrypted = archive.by_index_raw(0).map_err(|e| e.to_string())?.encrypted();
    Ok(encrypted)
}

fn prune_backup_directory(backup_dir: &Path, keep_count: usize) -> Result<u64, String> {
    let backups = list_backup_directory(backup_dir)?;
    let mut removed = 0;
    for backup in backups.into_iter().skip(keep_count) {
        fs::remove_file(&backup.abs_path).map_err(|e| format!("清理过期备份失败：{e}"))?;
        removed += 1;
    }
    Ok(removed)
}

/// 从指定备份恢复：先在隔离目录验证压缩包和数据库，再切换文件。
/// 任一步切换失败都会回滚，绝不采用“先删旧数据、再解压”的恢复方式。
#[tauri::command]
pub async fn restore_backup(app: AppHandle, file_name: String, password: Option<String>) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    validate_backup_name(&file_name)?;
    let zip_path = data_dir.join("backups").join(&file_name);
    if !zip_path.exists() {
        return Err(format!("备份文件不存在: {file_name}"));
    }

    // 一旦当前数据可读，必须先创建预恢复备份，失败则不允许继续覆盖。
    create_backup(app.clone()).await.map_err(|e| format!("创建恢复前备份失败，已取消恢复：{e}"))?;

    let staging = data_dir.join(format!(".restore-staging-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&staging).map_err(|e| format!("创建恢复暂存目录失败: {e}"))?;

    let result = (|| -> Result<(), String> {
        let file = fs::File::open(&zip_path).map_err(|e| format!("打开 zip 失败: {e}"))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读 zip 失败: {e}"))?;
        let mut total_size = 0_u64;
        let mut has_database = false;
        for i in 0..archive.len() {
            let encrypted = archive.by_index_raw(i).map_err(|e| e.to_string())?.encrypted();
            let mut entry = if encrypted {
                archive.by_index_decrypt(i, password.as_deref().ok_or("此备份已加密，请输入备份密码。")?.as_bytes())
            } else { archive.by_index(i) }.map_err(|_| "备份密码错误或备份已损坏。")?;
            let enclosed = entry.enclosed_name().ok_or_else(|| "备份包含不安全的文件路径，已拒绝恢复".to_string())?;
            if !is_allowed_backup_entry(&enclosed) {
                return Err(format!("备份包含非工作站数据文件：{}", enclosed.display()));
            }
            if entry.is_dir() { continue; }
            total_size = total_size.saturating_add(entry.size());
            if total_size > 2 * 1024 * 1024 * 1024 {
                return Err("备份解压后的数据超过 2 GB，已拒绝恢复".into());
            }
            let out_path = staging.join(&enclosed);
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| format!("解压备份文件失败: {e}"))?;
            if enclosed == Path::new("data.db") { has_database = true; }
        }
        if !has_database { return Err("备份中缺少 data.db，不能恢复".into()); }
        verify_sqlite_database(&staging.join("data.db"))?;

        let db_path = data_dir.join("data.db");
        let accounts_dir = data_dir.join("accounts");
        let ai_secrets_path = data_dir.join("ai-secrets.json");
        let staged_secrets = staging.join("ai-secrets.json");
        let recovery = data_dir.join(format!(".restore-recovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&recovery).map_err(|e| format!("创建恢复回滚目录失败: {e}"))?;

        let install = (|| -> Result<(), String> {
            if db_path.exists() { fs::rename(&db_path, recovery.join("data.db")).map_err(|e| format!("准备替换数据库失败（请关闭占用数据的窗口后重试）：{e}"))?; }
            if accounts_dir.exists() { fs::rename(&accounts_dir, recovery.join("accounts")).map_err(|e| format!("准备替换附件目录失败：{e}"))?; }
            // 旧版备份不包含密钥存储；此时保留当前密钥，避免恢复旧数据后无故丢失本机连接凭据。
            if staged_secrets.exists() && ai_secrets_path.exists() { fs::rename(&ai_secrets_path, recovery.join("ai-secrets.json")).map_err(|e| format!("准备替换 AI 密钥存储失败：{e}"))?; }
            fs::rename(staging.join("data.db"), &db_path).map_err(|e| format!("写入恢复数据库失败：{e}"))?;
            let staged_accounts = staging.join("accounts");
            if staged_accounts.exists() { fs::rename(staged_accounts, &accounts_dir).map_err(|e| format!("写入恢复附件失败：{e}"))?; }
            if staged_secrets.exists() { fs::rename(&staged_secrets, &ai_secrets_path).map_err(|e| format!("写入恢复 AI 密钥存储失败：{e}"))?; }
            Ok(())
        })();
        if let Err(error) = install {
            // 尽最大可能回滚；回滚失败时保留 recovery 目录，保证数据仍在磁盘上。
            if db_path.exists() { let _ = fs::remove_file(&db_path); }
            if accounts_dir.exists() { let _ = fs::remove_dir_all(&accounts_dir); }
            if staged_secrets.exists() && ai_secrets_path.exists() { let _ = fs::remove_file(&ai_secrets_path); }
            if recovery.join("data.db").exists() { let _ = fs::rename(recovery.join("data.db"), &db_path); }
            if recovery.join("accounts").exists() { let _ = fs::rename(recovery.join("accounts"), &accounts_dir); }
            if recovery.join("ai-secrets.json").exists() { let _ = fs::rename(recovery.join("ai-secrets.json"), &ai_secrets_path); }
            return Err(format!("恢复未完成，已尝试回滚当前数据：{error}"));
        }
        let _ = fs::remove_dir_all(&recovery);
        Ok(())
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

/// 删除指定备份
#[tauri::command]
pub fn delete_backup(app: AppHandle, file_name: String) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    validate_backup_name(&file_name)?;
    let zip_path = data_dir.join("backups").join(&file_name);
    if zip_path.exists() {
        fs::remove_file(&zip_path).map_err(|e| format!("删除失败: {e}"))?;
    }
    Ok(())
}

/// 用户主动选择外部目录后复制一份备份。拒绝覆盖目标文件，源备份始终保留在工作站内。
#[tauri::command]
pub fn copy_backup_to_directory(app: AppHandle, file_name: String, destination_dir: String) -> Result<String, String> {
    validate_backup_name(&file_name)?;
    let destination = PathBuf::from(&destination_dir);
    if !destination.is_absolute() || !destination.is_dir() {
        return Err("请选择存在的外部备份目录。".into());
    }
    let data_dir = app.path().app_data_dir().map_err(|e| format!("获取 app_data_dir 失败: {e}"))?;
    let source = data_dir.join("backups").join(&file_name);
    if !source.is_file() { return Err("备份文件不存在。".into()); }
    let target = destination.join(&file_name);
    if target.exists() { return Err("目标目录已有同名备份；为保护文件不会覆盖。".into()); }
    fs::copy(&source, &target).map_err(|e| format!("复制外部备份失败: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

fn safe_folder_name(value: &str, fallback: &str) -> String {
    let cleaned = sanitize(value).trim().trim_matches('.').to_string();
    if cleaned.is_empty() { fallback.to_string() } else { cleaned }
}

fn validate_archive_root(value: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(value.trim());
    if !root.is_absolute() {
        return Err("归档地址必须是本机绝对文件夹路径。".into());
    }
    if !root.is_dir() {
        return Err("归档地址不可访问或不是文件夹，请重新选择。".into());
    }
    Ok(root)
}

fn copy_to_project_archive(
    src_path: &str,
    archive_root: &str,
    project_name: &str,
    category: &str,
    original_name: &str,
) -> Result<PathBuf, String> {
    let root = validate_archive_root(archive_root)?;
    let destination_dir = root
        .join(safe_folder_name(project_name, "未命名项目"))
        .join(safe_folder_name(category, "未分类"));
    fs::create_dir_all(&destination_dir).map_err(|e| format!("创建文件类型归档目录失败: {e}"))?;

    let destination = unique_archive_path(&destination_dir, original_name);
    fs::copy(src_path, &destination).map_err(|e| format!("复制到项目归档目录失败: {e}"))?;
    Ok(destination)
}

fn unique_archive_path(directory: &Path, original_name: &str) -> PathBuf {
    let safe_name = sanitize(original_name);
    let first = directory.join(&safe_name);
    if !first.exists() { return first; }

    let source = Path::new(&safe_name);
    let stem = source.file_stem().and_then(|part| part.to_str()).unwrap_or("文件");
    let ext = source.extension().and_then(|part| part.to_str());
    for index in 2..10_000 {
        let file_name = match ext {
            Some(ext) if !ext.is_empty() => format!("{stem} ({index}).{ext}"),
            _ => format!("{stem} ({index})"),
        };
        let candidate = directory.join(file_name);
        if !candidate.exists() { return candidate; }
    }
    directory.join(format!("{}_{}", uuid::Uuid::new_v4().simple(), safe_name))
}

fn validate_backup_name(file_name: &str) -> Result<(), String> {
    let path = Path::new(file_name);
    if file_name.is_empty() || path.file_name().and_then(|name| name.to_str()) != Some(file_name) || path.extension().and_then(|ext| ext.to_str()) != Some("zip") {
        return Err("无效的备份文件名".into());
    }
    Ok(())
}

fn is_allowed_backup_entry(path: &Path) -> bool {
    path == Path::new("data.db") || path == Path::new("ai-secrets.json") || path.starts_with("accounts")
}

fn verify_sqlite_database(path: &Path) -> Result<(), String> {
    let conn = rusqlite::Connection::open(path).map_err(|e| format!("备份数据库无法打开：{e}"))?;
    let check: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0)).map_err(|e| format!("校验备份数据库失败：{e}"))?;
    if check.eq_ignore_ascii_case("ok") { Ok(()) } else { Err(format!("备份数据库完整性校验失败：{check}")) }
}

fn compute_md5(path: &PathBuf) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut ctx = md5::Context::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        ctx.consume(&buf[..n]);
    }
    Some(format!("{:x}", ctx.compute()))
}

fn add_file_to_zip(
    zip: &mut zip::ZipWriter<fs::File>,
    src: &PathBuf,
    zip_path: &str,
    opts: zip::write::FileOptions<()>,
) -> Result<(), String> {
    let mut f = fs::File::open(src).map_err(|e| format!("打开 {} 失败: {e}", src.display()))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    zip.start_file(zip_path, opts).map_err(|e| e.to_string())?;
    zip.write_all(&buf).map_err(|e| e.to_string())?;
    Ok(())
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<fs::File>,
    dir: &PathBuf,
    zip_prefix: &str,
    opts: zip::write::FileOptions<()>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name();
        let child_zip_path = format!("{zip_prefix}/{}", name.to_string_lossy());
        if path.is_dir() {
            add_dir_to_zip(zip, &path, &child_zip_path, opts)?;
        } else {
            add_file_to_zip(zip, &path, &child_zip_path, opts)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod backup_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn accepts_only_plain_zip_backup_names() {
        assert!(validate_backup_name("backup_20260928.zip").is_ok());
        assert!(validate_backup_name("../data.db").is_err());
        assert!(validate_backup_name("nested/backup.zip").is_err());
        assert!(validate_backup_name("backup.tar").is_err());
    }

    #[test]
    fn accepts_only_managed_backup_entries() {
        assert!(is_allowed_backup_entry(Path::new("data.db")));
        assert!(is_allowed_backup_entry(Path::new("ai-secrets.json")));
        assert!(is_allowed_backup_entry(Path::new("accounts/user/files/a.txt")));
        assert!(!is_allowed_backup_entry(Path::new("backups/other.zip")));
        assert!(!is_allowed_backup_entry(Path::new("settings.json")));
    }

    #[test]
    fn verifies_sqlite_and_every_attached_file_in_archive() {
        let root = std::env::temp_dir().join(format!("pw-backup-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database = root.join("data.db");
        let connection = rusqlite::Connection::open(&database).unwrap();
        connection.execute("CREATE TABLE test (value TEXT)", []).unwrap();
        drop(connection);

        let archive_path = root.join("backup.zip");
        let mut archive = zip::ZipWriter::new(fs::File::create(&archive_path).unwrap());
        let options: zip::write::FileOptions<()> = zip::write::FileOptions::default();
        archive.start_file("data.db", options).unwrap();
        archive.write_all(&fs::read(&database).unwrap()).unwrap();
        archive.start_file("accounts/user/files/report.txt", options).unwrap();
        archive.write_all(b"attachment contents").unwrap();
        archive.finish().unwrap();

        let staging = root.join("staging");
        fs::create_dir_all(&staging).unwrap();
        let verification = verify_backup_archive(&archive_path, &staging, "backup.zip", None).unwrap();
        assert_eq!(verification.file_name, "backup.zip");
        assert_eq!(verification.account_file_count, 1);
        assert!(verification.uncompressed_bytes > 20);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn verifies_aes_encrypted_backup_only_with_its_password() {
        let root = std::env::temp_dir().join(format!("pw-backup-aes-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database = root.join("data.db");
        let connection = rusqlite::Connection::open(&database).unwrap();
        connection.execute("CREATE TABLE test (value TEXT)", []).unwrap();
        drop(connection);
        let archive_path = root.join("backup.zip");
        let mut archive = zip::ZipWriter::new(fs::File::create(&archive_path).unwrap());
        let options: zip::write::FileOptions<()> = zip::write::FileOptions::default()
            .with_aes_encryption(zip::AesMode::Aes256, "a-long-test-password");
        archive.start_file("data.db", options).unwrap();
        archive.write_all(&fs::read(&database).unwrap()).unwrap();
        archive.finish().unwrap();
        assert!(is_backup_encrypted(&archive_path).unwrap());
        let staging = root.join("staging");
        fs::create_dir_all(&staging).unwrap();
        assert!(verify_backup_archive(&archive_path, &staging, "backup.zip", None).is_err());
        assert!(verify_backup_archive(&archive_path, &staging, "backup.zip", Some("a-long-test-password")).is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn inspects_import_sources_before_copying() {
        let root = std::env::temp_dir().join(format!("pw-import-source-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("ready.txt");
        fs::write(&file, b"ready").unwrap();
        let result = inspect_source_files(vec![
            file.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
        ])
        .unwrap();
        assert!(result[0].ready);
        assert_eq!(result[0].size_bytes, 5);
        assert!(!result[1].ready);
        assert_eq!(result[1].reason.as_deref(), Some("该路径不是文件。"));
        let _ = fs::remove_dir_all(root);
    }
}
