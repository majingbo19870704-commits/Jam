// =============================================================================
// auth.rs · 密码 / 恢复码相关的 Rust 命令
// =============================================================================
//
// 在 Rust 侧做 Argon2id 是为了：
//   - 避免密码明文进入前端 JS heap 后被 devtool 观察
//   - 使用系统级 CSPRNG 生成 salt
// =============================================================================

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::{distributions::Alphanumeric, Rng};

/// 使用 Argon2id 哈希用户密码，返回 PHC 格式字符串（含 salt + params）
#[tauri::command]
pub fn hash_password(password: String) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("hash failed: {e}"))
}

/// 校验密码与哈希是否匹配
#[tauri::command]
pub fn verify_password(password: String, hash: String) -> Result<bool, String> {
    let parsed = PasswordHash::new(&hash).map_err(|e| format!("bad hash: {e}"))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

/// 生成 4 组、共 24 位大小写字母 + 数字的一次性恢复码（示例：`X8QK-9F2Z-A1B7-M3P4`）
#[tauri::command]
pub fn generate_recovery_code() -> String {
    let raw: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(|b| (b as char).to_ascii_uppercase())
        .collect();
    // 4-4-4-4 分段
    raw.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap().to_string())
        .collect::<Vec<_>>()
        .join("-")
}

/// 对恢复码进行同样的 Argon2 哈希（存库用）
#[tauri::command]
pub fn hash_recovery_code(code: String) -> Result<String, String> {
    hash_password(code)
}
