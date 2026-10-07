// 仅供已确认的 AI 操作调用：创建新文本文件，不允许覆盖已有文件。
use std::{
    fs,
    io::{Cursor, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[tauri::command]
pub fn write_generated_text_file(path: String, content: String) -> Result<(), String> {
    if content.len() > 4_000_000 {
        return Err("生成内容超过 4 MB 限制。".into());
    }
    let target = Path::new(&path);
    if !target.is_absolute() {
        return Err("保存路径必须是绝对路径。".into());
    }
    if target
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            value.eq_ignore_ascii_case("md")
                || value.eq_ignore_ascii_case("txt")
                || value.eq_ignore_ascii_case("csv")
                || value.eq_ignore_ascii_case("ics")
        })
        .unwrap_or(false)
        == false
    {
        return Err("首版仅允许生成 .md、.txt 或 .csv 文件。".into());
    }
    if target.exists() {
        return Err("目标文件已存在；为保护原文件，系统不会覆盖。请使用新路径。".into());
    }
    let parent = target.parent().ok_or("保存路径无效。")?;
    fs::create_dir_all(parent).map_err(|e| format!("创建保存目录失败: {e}"))?;
    fs::write(target, content).map_err(|e| format!("写入文件失败: {e}"))
}

/// 仅供已经确认的结构化数据导出使用。拒绝覆盖，避免 AI 意外替换用户的工作簿。
#[tauri::command]
pub fn write_generated_xlsx_file(path: String, data: Vec<u8>) -> Result<(), String> {
    if data.len() > 8_000_000 {
        return Err("生成的工作簿超过 8 MB 限制。".into());
    }
    if data.is_empty() {
        return Err("生成的工作簿内容为空。".into());
    }
    let target = Path::new(&path);
    if !target.is_absolute() {
        return Err("保存路径必须是绝对路径。".into());
    }
    if target
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("xlsx"))
        .unwrap_or(false)
        == false
    {
        return Err("结构化数据导出仅允许 .xlsx 文件。".into());
    }
    if target.exists() {
        return Err("目标文件已存在；为保护原文件，系统不会覆盖。请使用新路径。".into());
    }
    let parent = target.parent().ok_or("保存路径无效。")?;
    fs::create_dir_all(parent).map_err(|e| format!("创建保存目录失败: {e}"))?;
    fs::write(target, data).map_err(|e| format!("写入工作簿失败: {e}"))
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// 生成一个兼容 Word 的最小 DOCX 文档。内容作为段落写入，拒绝覆盖现有文件。
#[tauri::command]
pub fn write_generated_docx_file(
    path: String,
    title: String,
    content: String,
) -> Result<(), String> {
    if content.len() > 4_000_000 {
        return Err("生成内容超过 4 MB 限制。".into());
    }
    let target = Path::new(&path);
    if !target.is_absolute() {
        return Err("保存路径必须是绝对路径。".into());
    }
    if !target
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("docx"))
        .unwrap_or(false)
    {
        return Err("Word 报告仅允许 .docx 文件。".into());
    }
    if target.exists() {
        return Err("目标文件已存在；为保护原文件，系统不会覆盖。请使用新路径。".into());
    }
    let parent = target.parent().ok_or("保存路径无效。")?;
    fs::create_dir_all(parent).map_err(|e| format!("创建保存目录失败: {e}"))?;

    let document_body = content
        .lines()
        .map(|line| {
            format!(
                "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                xml_escape(line)
            )
        })
        .collect::<String>();
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>{}</w:t></w:r></w:p>{}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#,
        xml_escape(if title.trim().is_empty() {
            "AI 生成报告"
        } else {
            &title
        }),
        document_body
    );
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    archive
        .start_file("[Content_Types].xml", options)
        .map_err(|e| format!("构建 Word 内容失败: {e}"))?;
    archive
        .write_all(br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#)
        .map_err(|e| format!("构建 Word 内容失败: {e}"))?;
    archive
        .start_file("_rels/.rels", options)
        .map_err(|e| format!("构建 Word 关系失败: {e}"))?;
    archive
        .write_all(br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#)
        .map_err(|e| format!("构建 Word 关系失败: {e}"))?;
    archive
        .start_file("word/document.xml", options)
        .map_err(|e| format!("构建 Word 文档失败: {e}"))?;
    archive
        .write_all(document.as_bytes())
        .map_err(|e| format!("构建 Word 文档失败: {e}"))?;
    let data = archive
        .finish()
        .map_err(|e| format!("封装 Word 文档失败: {e}"))?
        .into_inner();
    fs::write(target, data).map_err(|e| format!("写入 Word 报告失败: {e}"))
}

fn is_safe_file_extension(path: &Path) -> bool {
    !path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "exe"
                    | "msi"
                    | "bat"
                    | "cmd"
                    | "ps1"
                    | "vbs"
                    | "js"
                    | "jar"
                    | "com"
                    | "scr"
                    | "lnk"
            )
        })
        .unwrap_or(false)
}

/// 已经由用户在 AI 界面确认后调用：只创建此前不存在的目录，不会改写任何文件。
#[tauri::command]
pub fn create_confirmed_directory(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.is_absolute() || target.parent().is_none() {
        return Err("新建文件夹必须使用非根目录的绝对路径。".into());
    }
    if target.exists() {
        return Err("目标文件夹已存在；系统不会覆盖或合并已有目录。".into());
    }
    fs::create_dir_all(target).map_err(|e| format!("创建文件夹失败: {e}"))
}

/// 已经由用户在 AI 界面确认后调用：复制普通资料文件，拒绝脚本/可执行文件且不会覆盖目标。
#[tauri::command]
pub fn copy_confirmed_local_file(source_path: String, target_path: String) -> Result<(), String> {
    let source = Path::new(&source_path);
    let target = Path::new(&target_path);
    if !source.is_absolute() || !target.is_absolute() {
        return Err("复制文件的来源和目标都必须是绝对路径。".into());
    }
    if !source.is_file() {
        return Err("来源不是可复制的普通文件。".into());
    }
    if !is_safe_file_extension(source) || !is_safe_file_extension(target) {
        return Err("不允许通过 AI 复制可执行文件、脚本或快捷方式。".into());
    }
    if target.exists() {
        return Err("目标文件已存在；为保护原文件，系统不会覆盖。".into());
    }
    if source
        .metadata()
        .map_err(|e| format!("读取来源文件失败: {e}"))?
        .len()
        > 512 * 1024 * 1024
    {
        return Err("单次最多复制 512 MB 文件。".into());
    }
    let parent = target.parent().ok_or("目标路径无效。")?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {e}"))?;
    fs::copy(source, target).map_err(|e| format!("复制文件失败: {e}"))?;
    Ok(())
}
