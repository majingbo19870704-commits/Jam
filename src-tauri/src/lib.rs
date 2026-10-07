// =============================================================================
// personal-workstation · Tauri 壳入口
// =============================================================================
//
// 职责：
//   1. 注册 tauri-plugin-sql，声明数据库文件路径
//   2. 声明数据库迁移（首次启动自动执行 schema.sql）
//   3. 暴露 auth::* 相关 Rust 命令（密码哈希 / 恢复码校验）
//
// SQLite 文件位于用户 AppData 目录：
//   Windows: %APPDATA%\com.majin.personal-workstation\data.db
//   macOS  : ~/Library/Application Support/com.majin.personal-workstation/data.db
// =============================================================================

use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

mod ai_chat;
mod auth;
mod desktop_agent;
mod ecdict;
mod files;
mod generated_files;
mod http_proxy;
mod knowledge_context;
mod secrets;
mod vault;
mod web_login;
mod web_search;
mod wordnet;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 迁移：把 schema.sql 内容内嵌到二进制里，首次启动自动执行
    let migrations = vec![Migration {
        version: 1,
        description: "initial schema v1.0",
        sql: include_str!("../../schema/schema.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:data.db", migrations)
                .build(),
        )
        .manage(ecdict::DictProgressStore::default())
        .invoke_handler(tauri::generate_handler![
            auth::hash_password,
            auth::verify_password,
            auth::generate_recovery_code,
            auth::hash_recovery_code,
            desktop_agent::run_confirmed_terminal_command,
            desktop_agent::run_confirmed_desktop_automation,
            desktop_agent::get_desktop_context,
            desktop_agent::capture_desktop_screenshot,
            files::copy_file_to_data,
            files::prepare_project_archive,
            files::prepare_material_archive,
            files::remove_empty_material_archive_folder,
            files::copy_material_file,
            files::move_material_file,
            files::move_material_file_to_recycle,
            files::inspect_source_files,
            files::resolve_data_path,
            files::read_file_base64,
            files::read_file_text,
            files::read_file_text_preview,
            files::read_material_file_base64,
            files::read_material_file_text_preview,
            files::delete_file,
            files::delete_project_archive_files,
            files::delete_material_files,
            files::get_app_diagnostics,
            files::create_backup,
            files::run_auto_backup,
            files::list_backups,
            files::import_backup,
            files::prune_backups,
            files::verify_backup,
            files::restore_backup,
            files::delete_backup,
            files::copy_backup_to_directory,
            files::find_libreoffice,
            files::convert_to_pdf,
            generated_files::write_generated_text_file,
            generated_files::write_generated_xlsx_file,
            generated_files::write_generated_docx_file,
            generated_files::create_confirmed_directory,
            generated_files::copy_confirmed_local_file,
            ecdict::ecdict_progress,
            ecdict::ecdict_status,
            ecdict::ecdict_lookup,
            ecdict::ecdict_prefix,
            ecdict::ecdict_lemmatize,
            ecdict::ecdict_import_csv,
            ecdict::ecdict_update_online,
            ecdict::custom_dict_import_csv,
            ecdict::custom_dict_remove,
            ecdict::ecdict_reverse_lookup,
            wordnet::wordnet_status,
            wordnet::wordnet_lookup,
            wordnet::wordnet_import_dir,
            wordnet::wordnet_update_online,
            http_proxy::http_proxy,
            secrets::store_secret,
            secrets::has_secret,
            secrets::delete_secret,
            web_login::fill_configured_web_login,
            ai_chat::ai_chat,
            ai_chat::ai_chat_stream,
            ai_chat::ai_cancel_chat_stream,
            ai_chat::ai_list_models,
            ai_chat::ai_test_connection,
            ai_chat::migrate_provider_secrets_to_database,
            knowledge_context::build_knowledge_context,
            knowledge_context::read_temporary_attachment,
            knowledge_context::read_temporary_image,
            vault::validate_vault,
            vault::list_vault_tree,
            vault::read_vault_file,
            vault::convert_vault_office_to_pdf,
            vault::open_obsidian_file,
            vault::scan_vault_documents,
            vault::build_vault_ai_context,
            web_search::web_search,
            web_search::web_fetch_pages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running personal-workstation");
}
