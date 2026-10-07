-- =============================================================================
-- seed.sql  ·  为新建账号灌入默认参数选项
-- 使用时把 :account_id 参数绑定为目标账号 UUID
-- =============================================================================

-- 事务类型（work_type）
INSERT INTO param_option (id, account_id, group_code, name, seq_no, is_system_default, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), :account_id, 'work_type', '工作', 1, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'work_type', '生活', 2, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'work_type', '学习', 3, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'work_type', '其他', 4, 1, datetime('now'), datetime('now'));

-- 项目类型（project_type）
INSERT INTO param_option (id, account_id, group_code, name, seq_no, is_system_default, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), :account_id, 'project_type', '工艺', 1, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'project_type', '工装', 2, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'project_type', '设备', 3, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'project_type', '新品', 4, 1, datetime('now'), datetime('now'));

-- 风险类型（risk_type）
INSERT INTO param_option (id, account_id, group_code, name, seq_no, is_system_default, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), :account_id, 'risk_type', '技术', 1, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'risk_type', '进度', 2, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'risk_type', '供应', 3, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'risk_type', '质量', 4, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'risk_type', '成本', 5, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'risk_type', '其他', 6, 1, datetime('now'), datetime('now'));

-- 文件类型（file_type）
INSERT INTO param_option (id, account_id, group_code, name, seq_no, is_system_default, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), :account_id, 'file_type', '需求', 1, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'file_type', '方案', 2, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'file_type', '图纸', 3, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'file_type', '报告', 4, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'file_type', '记录', 5, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), :account_id, 'file_type', '其他', 6, 1, datetime('now'), datetime('now'));
