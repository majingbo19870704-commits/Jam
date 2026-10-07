// =============================================================================
// 全局共享类型
// 与 schema/schema.sql 对齐，字段命名保持 snake_case 以匹配数据库
// =============================================================================

export type StatusFull = 'new' | 'following' | 'closed';
export type StatusBinary = 'following' | 'closed';
export type Priority = 'high' | 'mid' | 'low';
export type ReminderRepeat = 'none' | 'daily' | 'weekly' | 'monthly';
export type ScheduleEventRepeat = ReminderRepeat;
export type FileStatus = 'valid' | 'invalid';
export type LinkKind = 'url' | 'path';

export interface Account {
  id: string;
  username: string;
  display_name: string;
  avatar_path?: string | null;
  password_hash: string;
  recovery_code_hash: string;
  role?: 'admin' | 'user';
  status?: 'active' | 'disabled' | 'pending_delete';
  /** 内部迁移字段：个人工作台只会启用一个主人档案。 */
  is_owner?: number;
  /** 从旧版默认管理员迁移而来时，必须重新完成主人档案初始化。 */
  requires_setup?: number;
  preferences_json?: string;
  created_at: string;
  last_login_at?: string | null;
  is_deleted: number;
}

export interface ParamOption {
  id: string;
  account_id: string;
  group_code:
    'work_type' | 'project_type' | 'risk_type' | 'file_type' | 'english_type' | 'schedule_type';
  name: string;
  seq_no: number;
  is_system_default: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

export interface MaterialBrand { id: string; account_id: string; name: string; remark: string | null; seq_no: number; created_at: string; updated_at: string; is_deleted: number; }
export interface MaterialModel { id: string; account_id: string; brand: string | null; client_model: string; skyworth_model: string; remark: string | null; seq_no: number; created_at: string; updated_at: string; is_deleted: number; }
export interface MaterialFileParameter { id: string; account_id: string; material_type: string; file_type: string; remark: string | null; seq_no: number; created_at: string; updated_at: string; is_deleted: number; is_draft?: number; }
export interface MaterialFile { id: string; account_id: string; seq_no: number; material_type: string; file_parameter_id: string; original_name: string; status: FileStatus; brand_id: string | null; client_model_id: string | null; skyworth_model_id: string | null; archive_path: string; created_at: string; updated_at: string; is_deleted: number; }

export interface WorkItem {
  id: string;
  account_id: string;
  seq_no: number;
  date: string;
  type_id?: string | null;
  priority: Priority;
  description: string;
  progress_note?: string | null;
  planned_at?: string | null;
  reminder_at?: string | null;
  /** 用户在提醒弹窗中选择的临时稍后提醒时间，不影响原重复提醒规则。 */
  snooze_until?: string | null;
  reminder_repeat?: ReminderRepeat | null;
  completed_at?: string | null;
  status: StatusFull;
  internal_pic?: string | null;
  external_pic?: string | null;
  remark?: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

/** 独立日程。时间均为本地墙钟时间，避免跨时区后提醒发生偏移。 */
export interface ScheduleEvent {
  id: string;
  account_id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  all_day: number;
  reminder_at?: string | null;
  reminder_repeat: ScheduleEventRepeat;
  /** 日程类型主关联；颜色只作为类型的视觉配置与旧数据兼容字段。 */
  type_id?: string | null;
  color: string;
  repeat_until?: string | null;
  repeat_exdates?: string | null;
  /** 展开重复规则时的源日程 ID；仅用于界面显示，非数据库字段。 */
  recurrence_source_id?: string | null;
  is_virtual_occurrence?: boolean;
  notes?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

export interface Project {
  id: string;
  account_id: string;
  seq_no: number;
  date: string;
  type_id?: string | null;
  name: string;
  progress_note?: string | null;
  status: StatusFull;
  internal_pic?: string | null;
  external_pic?: string | null;
  archive_root?: string | null;
  remark?: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

export interface ProjectWbs {
  id: string;
  account_id: string;
  project_id: string;
  parent_id?: string | null;
  seq_no: number;
  level: number;
  type?: string | null;
  item: string;
  progress_note?: string | null;
  depends_on?: string | null;
  assignee_member_ids?: string | null;
  status: StatusBinary;
  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}
