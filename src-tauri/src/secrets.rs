// =============================================================================
// secrets.rs · API 密钥的本机加密存储
// =============================================================================
// 密钥不会进入 SQLite。Windows 使用 DPAPI（与当前 Windows 用户绑定）加密后，
// 仅将密文写入 app_data_dir/ai-secrets.json；后续模型请求会在 Rust 侧读取。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Write, path::{Path, PathBuf}};
use tauri::{AppHandle, Manager};

#[derive(Default, Serialize, Deserialize)]
struct SecretStore {
    version: u8,
    values: BTreeMap<String, String>,
}

fn validate_ref(secret_ref: &str) -> Result<(), String> {
    let valid = !secret_ref.is_empty()
        && secret_ref.len() <= 128
        && secret_ref
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
    if valid {
        Ok(())
    } else {
        Err("无效的密钥引用。".into())
    }
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    Ok(dir.join("ai-secrets.json"))
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn parse_store(text: &str) -> Result<SecretStore, String> {
    let store: SecretStore = serde_json::from_str(text).map_err(|_| "密钥存储格式无效。".to_string())?;
    if store.version > 1 {
        return Err("密钥存储版本高于当前应用，已拒绝覆盖。".into());
    }
    Ok(store)
}

fn read_store(app: &AppHandle) -> Result<SecretStore, String> {
    let path = store_path(app)?;
    if !path.exists() {
        return Ok(SecretStore {
            version: 1,
            values: BTreeMap::new(),
        });
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取密钥存储失败: {e}"))?;
    match parse_store(&text) {
        Ok(store) => Ok(store),
        Err(primary_error) => {
            // 原子替换遇到断电等极端情况时，使用上一次完整副本恢复可用密钥；
            // 不自动写回，避免在磁盘异常时再次覆盖证据。
            let backup = backup_path(&path);
            if backup.exists() {
                let backup_text = fs::read_to_string(backup).map_err(|e| format!("读取密钥备份失败: {e}"))?;
                parse_store(&backup_text).map_err(|_| primary_error)
            } else {
                Err(primary_error)
            }
        }
    }
}

fn write_store(app: &AppHandle, store: &SecretStore) -> Result<(), String> {
    let body = serde_json::to_vec(store).map_err(|e| format!("序列化密钥存储失败: {e}"))?;
    let path = store_path(app)?;
    write_store_file(&path, &body)
}

fn write_store_file(path: &Path, body: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&temporary).map_err(|e| format!("创建密钥暂存文件失败: {e}"))?;
        file.write_all(&body).map_err(|e| format!("写入密钥暂存文件失败: {e}"))?;
        file.sync_all().map_err(|e| format!("同步密钥暂存文件失败: {e}"))?;
    }
    if path.exists() {
        // 保留最近一次有效密文，主文件意外损坏时可只读恢复。
        fs::copy(path, backup_path(path)).map_err(|e| format!("备份当前密钥存储失败: {e}"))?;
    }
    fs::rename(&temporary, path).map_err(|e| {
        let _ = fs::remove_file(&temporary);
        format!("原子更新密钥存储失败: {e}")
    })
}

pub fn load_secret(app: &AppHandle, secret_ref: &str) -> Result<String, String> {
    validate_ref(secret_ref)?;
    let encrypted = read_store(app)?
        .values
        .get(secret_ref)
        .cloned()
        .ok_or("未找到 API 密钥。")?;
    unprotect(&encrypted)
}

#[cfg(windows)]
fn protect(value: &str) -> Result<String, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    };
    let bytes = value.as_bytes();
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptProtectData(
            &mut input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("Windows 无法加密 API 密钥。".into());
    }
    let encrypted =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(BASE64.encode(encrypted))
}

#[cfg(windows)]
fn unprotect(value: &str) -> Result<String, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let bytes = BASE64.decode(value).map_err(|_| "密钥存储内容无效。")?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let mut description = std::ptr::null_mut();
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            &mut description,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("Windows 无法解密 API 密钥。请重新保存该连接的密钥。".into());
    }
    let plain =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
        if !description.is_null() {
            LocalFree(description.cast());
        }
    }
    String::from_utf8(plain).map_err(|_| "密钥内容编码无效。".into())
}

#[cfg(not(windows))]
fn protect(_: &str) -> Result<String, String> {
    Err("当前平台尚未实现本机密钥保护。".into())
}

#[cfg(not(windows))]
fn unprotect(_: &str) -> Result<String, String> {
    Err("当前平台尚未实现本机密钥保护。".into())
}

#[tauri::command]
pub fn store_secret(app: AppHandle, secret_ref: String, secret: String) -> Result<(), String> {
    validate_ref(&secret_ref)?;
    if secret.trim().is_empty() {
        return Err("API 密钥不能为空。".into());
    }
    let encrypted = protect(&secret)?;
    let mut store = read_store(&app)?;
    store.version = 1;
    store.values.insert(secret_ref, encrypted);
    write_store(&app, &store)
}

#[tauri::command]
pub fn has_secret(app: AppHandle, secret_ref: String) -> Result<bool, String> {
    validate_ref(&secret_ref)?;
    Ok(read_store(&app)?.values.contains_key(&secret_ref))
}

#[tauri::command]
pub fn delete_secret(app: AppHandle, secret_ref: String) -> Result<(), String> {
    validate_ref(&secret_ref)?;
    let mut store = read_store(&app)?;
    if store.values.remove(&secret_ref).is_some() {
        write_store(&app, &store)?;
    }
    Ok(())
}

#[cfg(test)]
mod secret_tests {
    use super::*;

    #[test]
    fn rejects_invalid_or_future_secret_store_versions() {
        assert!(parse_store(r#"{"version":1,"values":{}}"#).is_ok());
        assert!(parse_store(r#"{"version":2,"values":{}}"#).is_err());
        assert!(parse_store("not-json").is_err());
    }

    #[test]
    fn secret_references_are_restricted_to_safe_identifiers() {
        assert!(validate_ref("provider_123-A").is_ok());
        assert!(validate_ref("../escape").is_err());
        assert!(validate_ref("").is_err());
    }

    #[test]
    fn atomically_replaces_store_and_keeps_last_valid_copy() {
        let root = std::env::temp_dir().join(format!("pw-secret-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("ai-secrets.json");
        fs::write(&path, br#"{"version":1,"values":{"old":"cipher"}}"#).unwrap();
        write_store_file(&path, br#"{"version":1,"values":{"new":"cipher"}}"#).unwrap();
        assert!(fs::read_to_string(&path).unwrap().contains("new"));
        assert!(fs::read_to_string(backup_path(&path)).unwrap().contains("old"));
        let _ = fs::remove_dir_all(root);
    }
}
