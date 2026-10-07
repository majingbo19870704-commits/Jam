import { v4 as uuid } from 'uuid';
import { localDateKey } from '@/lib/local-date';
import { invoke } from '@tauri-apps/api/core';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { exec, query } from './client';
import { useAccountStore } from '@/stores/account';
import { createWorkItem, getWorkItem, updateWorkItem } from './work-item-dao';
import { createProject, getProject, updateProject } from './project-dao';
import { createWbs, getWbs, updateWbs } from './project-wbs-dao';
import { createRisk, getRisk, updateRisk } from './project-risk-dao';
import { createOrAppendWord, getWord, updateWord, type LearnStatus } from './english-dao';
import { createNote, getNote, updateNote } from './knowledge-dao';
import { attachFile } from './project-file-dao';
import { createMember, getMember, updateMember } from './project-member-dao';
import {
  createScheduleEvent,
  deleteScheduleEvent,
  getScheduleEvent,
  updateScheduleEvent,
} from './schedule-event-dao';
import type { Priority, ScheduleEventRepeat } from '@/types';

export type AssistantActionKind =
  | 'create_work_item'
  | 'update_work_item'
  | 'create_schedule_event'
  | 'update_schedule_event'
  | 'delete_schedule_event'
  | 'create_project'
  | 'update_project'
  | 'create_project_task'
  | 'update_project_task'
  | 'create_project_risk'
  | 'update_project_risk'
  | 'attach_project_file'
  | 'create_project_member'
  | 'update_project_member'
  | 'open_local_path'
  | 'create_word'
  | 'update_word'
  | 'create_note'
  | 'update_note'
  | 'update_setting'
  | 'generate_text_file'
  | 'generate_xlsx_file'
  | 'generate_docx_file'
  | 'create_local_directory'
  | 'copy_local_file'
  | 'run_terminal_command'
  | 'run_desktop_automation';
export interface AssistantActionRequest {
  id: string;
  account_id: string;
  profile_id: string;
  conversation_id: string | null;
  action_kind: AssistantActionKind;
  summary: string;
  payload_json: string;
  status: 'pending' | 'executed' | 'cancelled' | 'failed';
  created_at: string;
  resolved_at: string | null;
  error_message: string | null;
  result_summary: string | null;
}
export interface ActionProposal {
  kind: AssistantActionKind;
  summary: string;
  payload: Record<string, unknown>;
  displayContent: string;
}

function accountId() {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}
const allowed = new Set<AssistantActionKind>([
  'create_work_item',
  'update_work_item',
  'create_schedule_event',
  'update_schedule_event',
  'delete_schedule_event',
  'create_project',
  'update_project',
  'create_project_task',
  'update_project_task',
  'create_project_risk',
  'update_project_risk',
  'attach_project_file',
  'create_project_member',
  'update_project_member',
  'open_local_path',
  'create_word',
  'update_word',
  'create_note',
  'update_note',
  'update_setting',
  'generate_text_file',
  'generate_xlsx_file',
  'generate_docx_file',
  'create_local_directory',
  'copy_local_file',
  'run_terminal_command',
  'run_desktop_automation',
]);

export function extractActionProposal(content: string): ActionProposal | null {
  const match = content.match(/```workstation-action\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as {
      kind?: string;
      summary?: string;
      payload?: Record<string, unknown>;
    };
    if (
      !value.kind ||
      !allowed.has(value.kind as AssistantActionKind) ||
      !value.payload ||
      typeof value.summary !== 'string'
    )
      return null;
    return {
      kind: value.kind as AssistantActionKind,
      summary: value.summary.slice(0, 180),
      payload: value.payload,
      displayContent: content.replace(match[0], '').trim(),
    };
  } catch {
    return null;
  }
}

export async function createAssistantActionRequest(
  profileId: string,
  conversationId: string,
  proposal: ActionProposal,
) {
  const now = new Date().toISOString();
  const row: AssistantActionRequest = {
    id: uuid(),
    account_id: accountId(),
    profile_id: profileId,
    conversation_id: conversationId,
    action_kind: proposal.kind,
    summary: proposal.summary,
    payload_json: JSON.stringify(proposal.payload),
    status: 'pending',
    created_at: now,
    resolved_at: null,
    error_message: null,
    result_summary: null,
  };
  await exec(
    `INSERT INTO assistant_action_request (id,account_id,profile_id,conversation_id,action_kind,summary,payload_json,status,created_at,resolved_at,error_message,result_summary)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,NULL,NULL,NULL)`,
    [
      row.id,
      row.account_id,
      row.profile_id,
      row.conversation_id,
      row.action_kind,
      row.summary,
      row.payload_json,
      now,
    ],
  );
  return row;
}

export async function listPendingAssistantActions(profileId: string) {
  return query<AssistantActionRequest>(
    `SELECT * FROM assistant_action_request WHERE account_id = $1 AND profile_id = $2 AND status = 'pending' ORDER BY created_at DESC`,
    [accountId(), profileId],
  );
}

/** 用户明确授权后，同一专业助理的同类后续操作可以直接执行；每次仍记入审计。 */
export async function isAssistantActionAutoAuthorized(
  profileId: string,
  actionKind: AssistantActionKind,
): Promise<boolean> {
  const rows = await query<{ is_enabled: number }>(
    `SELECT is_enabled FROM assistant_action_authorization
     WHERE account_id = $1 AND profile_id = $2 AND action_kind = $3 LIMIT 1`,
    [accountId(), profileId, actionKind],
  );
  return rows[0]?.is_enabled === 1;
}

export async function setAssistantActionAutoAuthorization(
  profileId: string,
  actionKind: AssistantActionKind,
  enabled: boolean,
) {
  const now = new Date().toISOString();
  await exec(
    `INSERT INTO assistant_action_authorization
     (id,account_id,profile_id,action_kind,is_enabled,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT(account_id,profile_id,action_kind)
     DO UPDATE SET is_enabled=excluded.is_enabled, updated_at=excluded.updated_at`,
    [uuid(), accountId(), profileId, actionKind, enabled ? 1 : 0, now],
  );
}

export async function listAssistantActionAutoAuthorizations(profileId: string) {
  return query<{ action_kind: AssistantActionKind; is_enabled: number }>(
    `SELECT action_kind,is_enabled FROM assistant_action_authorization
     WHERE account_id = $1 AND profile_id = $2 ORDER BY action_kind ASC`,
    [accountId(), profileId],
  );
}

/** 最近已处理的操作，用于在助理界面中回溯确认、取消和失败结果。 */
export async function listAssistantActionHistory(profileId: string, limit = 12) {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
  return query<AssistantActionRequest>(
    `SELECT * FROM assistant_action_request
     WHERE account_id = $1 AND profile_id = $2 AND status <> 'pending'
     ORDER BY COALESCE(resolved_at, created_at) DESC LIMIT ${safeLimit}`,
    [accountId(), profileId],
  );
}

export async function cancelAssistantAction(id: string) {
  const actions = await query<AssistantActionRequest>(
    `SELECT * FROM assistant_action_request WHERE id = $1 AND account_id = $2 AND status = 'pending' LIMIT 1`,
    [id, accountId()],
  );
  const action = actions[0];
  if (!action) return;
  const now = new Date().toISOString();
  await exec(
    `UPDATE assistant_action_request SET status = 'cancelled', resolved_at = $1 WHERE id = $2 AND account_id = $3 AND status = 'pending'`,
    [now, id, accountId()],
  );
  await exec(
    `INSERT INTO audit_log (id,account_id,action,detail,ip_or_host,created_at) VALUES ($1,$2,$3,$4,'local-ai',$5)`,
    [
      uuid(),
      accountId(),
      `assistant.${action.action_kind}.cancelled`,
      JSON.stringify({
        actionId: action.id,
        summary: action.summary,
        payload: JSON.parse(action.payload_json),
      }),
      now,
    ],
  );
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}
function today() {
  return localDateKey();
}
function isAbsoluteFilePath(value: string) {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
}
function filenameFromPath(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? '';
}
function isSafeOpenTarget(value: string) {
  if (!isAbsoluteFilePath(value)) return false;
  const extension = filenameFromPath(value).split('.').pop()?.toLowerCase() ?? '';
  return !['exe', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'jar', 'com', 'scr', 'lnk'].includes(
    extension,
  );
}

async function captureBeforeState(
  action: AssistantActionRequest,
  payload: Record<string, unknown>,
) {
  const id = text(payload.id);
  if (action.action_kind === 'update_work_item' && id) return getWorkItem(id);
  if (action.action_kind === 'update_schedule_event' && id) return getScheduleEvent(id);
  if (action.action_kind === 'update_project' && id) return getProject(id);
  if (action.action_kind === 'update_project_task' && id) return getWbs(id);
  if (action.action_kind === 'update_project_risk' && id) return getRisk(id);
  if (action.action_kind === 'update_project_member' && id) return getMember(id);
  if (action.action_kind === 'update_word' && id) return getWord(id);
  if (action.action_kind === 'update_note' && id) return getNote(id);
  if (action.action_kind === 'update_setting') {
    const key = text(payload.key);
    if (!key) return null;
    const rows = await query<{ value: string | null }>(
      `SELECT value FROM setting_kv WHERE scope = 'app' AND key = $1 LIMIT 1`,
      [key],
    );
    return { key, value: rows[0]?.value ?? null, existed: rows.length > 0 };
  }
  return null;
}

type UndoSnapshot = {
  actionId: string;
  before: Record<string, unknown> | null;
  payload: Record<string, unknown>;
};

async function findUndoSnapshot(action: AssistantActionRequest): Promise<UndoSnapshot> {
  const logs = await query<{ action: string; detail: string | null }>(
    `SELECT action,detail FROM audit_log WHERE account_id = $1 AND action IN ($2,$3)
     ORDER BY created_at DESC LIMIT 80`,
    [accountId(), `assistant.${action.action_kind}`, `assistant.${action.action_kind}.undo`],
  );
  let snapshot: UndoSnapshot | null = null;
  for (const log of logs) {
    try {
      const detail = JSON.parse(log.detail ?? '') as UndoSnapshot;
      if (detail.actionId !== action.id) continue;
      if (log.action.endsWith('.undo')) throw new Error('此操作已恢复，不能重复恢复。');
      snapshot = detail;
      break;
    } catch (error) {
      if (error instanceof Error && error.message.includes('不能重复恢复')) throw error;
    }
  }
  if (!snapshot?.before) throw new Error('此操作没有可恢复的变更快照。');
  return snapshot;
}

/** 仅恢复 AI 完成的更新类操作；创建、文件和外部打开不支持自动撤销。 */
export async function undoAssistantAction(action: AssistantActionRequest) {
  if (action.status !== 'executed') throw new Error('只能恢复已成功执行的操作。');
  const snapshot = await findUndoSnapshot(action);
  const before = snapshot.before!;
  if (action.action_kind === 'update_work_item')
    await updateWorkItem(String(before.id), before as any);
  else if (action.action_kind === 'update_schedule_event')
    await updateScheduleEvent(String(before.id), before as any);
  else if (action.action_kind === 'update_project')
    await updateProject(String(before.id), before as any);
  else if (action.action_kind === 'update_project_task')
    await updateWbs(String(before.id), before as any);
  else if (action.action_kind === 'update_project_risk')
    await updateRisk(String(before.id), before as any);
  else if (action.action_kind === 'update_project_member')
    await updateMember(String(before.id), before as any);
  else if (action.action_kind === 'update_word') await updateWord(String(before.id), before as any);
  else if (action.action_kind === 'update_note') await updateNote(String(before.id), before as any);
  else if (action.action_kind === 'update_setting') {
    const key = text(before.key);
    if (!key) throw new Error('设置快照无效。');
    if (before.existed) {
      await exec(
        `INSERT INTO setting_kv (scope,key,value,updated_at) VALUES ('app',$1,$2,$3)
         ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
        [key, typeof before.value === 'string' ? before.value : null, new Date().toISOString()],
      );
    } else {
      await exec(`DELETE FROM setting_kv WHERE scope = 'app' AND key = $1`, [key]);
    }
  } else {
    throw new Error('此类操作不支持自动恢复。');
  }
  await exec(
    `INSERT INTO audit_log (id,account_id,action,detail,ip_or_host,created_at) VALUES ($1,$2,$3,$4,'local-ai',$5)`,
    [
      uuid(),
      accountId(),
      `assistant.${action.action_kind}.undo`,
      JSON.stringify({ actionId: action.id, summary: action.summary, restoredBefore: before }),
      new Date().toISOString(),
    ],
  );
}

export async function executeAssistantAction(action: AssistantActionRequest) {
  const payload = JSON.parse(action.payload_json) as Record<string, unknown>;
  const before = await captureBeforeState(action, payload);
  let resultSummary = '操作已完成。';
  try {
    if (action.action_kind === 'create_work_item') {
      const description = text(payload.description);
      if (!description) throw new Error('工作事项缺少 description。');
      await createWorkItem({
        date: text(payload.date, today()),
        description,
        priority: (['high', 'mid', 'low'].includes(text(payload.priority))
          ? text(payload.priority)
          : 'mid') as Priority,
        progress_note: text(payload.progress_note) || null,
        remark: text(payload.remark) || null,
      });
    } else if (action.action_kind === 'create_schedule_event') {
      const title = text(payload.title);
      const startsAt = text(payload.starts_at);
      if (!title || !startsAt) throw new Error('新建日程需要 title 和 starts_at。');
      const repeat = text(payload.reminder_repeat, 'none');
      if (!['none', 'daily', 'weekly', 'monthly'].includes(repeat))
        throw new Error('日程重复规则无效。');
      await createScheduleEvent({
        title,
        starts_at: startsAt,
        ends_at: text(payload.ends_at) || null,
        all_day: text(payload.all_day) === 'true' || payload.all_day === 1 ? 1 : 0,
        reminder_at: text(payload.reminder_at) || null,
        reminder_repeat: repeat as ScheduleEventRepeat,
        color: text(payload.color) || '#4D7CFE',
        notes: text(payload.notes) || null,
        repeat_until: text(payload.repeat_until) || null,
        repeat_exdates: '[]',
        completed_at: null,
      });
    } else if (action.action_kind === 'update_schedule_event') {
      const id = text(payload.id);
      const existing = id ? await getScheduleEvent(id) : null;
      if (!existing) throw new Error('找不到可更新的日程。');
      const repeat = text(payload.reminder_repeat);
      if (repeat && !['none', 'daily', 'weekly', 'monthly'].includes(repeat))
        throw new Error('日程重复规则无效。');
      const patch = {
        ...(text(payload.title) ? { title: text(payload.title) } : {}),
        ...(text(payload.starts_at) ? { starts_at: text(payload.starts_at) } : {}),
        ...(text(payload.ends_at) ? { ends_at: text(payload.ends_at) } : {}),
        ...(payload.all_day === 0 ||
        payload.all_day === 1 ||
        text(payload.all_day) === 'true' ||
        text(payload.all_day) === 'false'
          ? { all_day: payload.all_day === 1 || text(payload.all_day) === 'true' ? 1 : 0 }
          : {}),
        ...(text(payload.reminder_at) ? { reminder_at: text(payload.reminder_at) } : {}),
        ...(repeat ? { reminder_repeat: repeat as ScheduleEventRepeat } : {}),
        ...(text(payload.notes) ? { notes: text(payload.notes) } : {}),
        ...(text(payload.repeat_until) ? { repeat_until: text(payload.repeat_until) } : {}),
      };
      if (!Object.keys(patch).length) throw new Error('日程更新缺少可修改字段。');
      await updateScheduleEvent(id, patch);
    } else if (action.action_kind === 'delete_schedule_event') {
      const id = text(payload.id);
      if (!id || !(await getScheduleEvent(id))) throw new Error('找不到可删除的日程。');
      await deleteScheduleEvent(id);
    } else if (action.action_kind === 'update_work_item') {
      const id = text(payload.id);
      if (!id) throw new Error('工作事项更新缺少 id。');
      if (!(await getWorkItem(id))) throw new Error('找不到可更新的工作事项。');
      await updateWorkItem(id, {
        ...(text(payload.description) ? { description: text(payload.description) } : {}),
        ...(text(payload.progress_note) ? { progress_note: text(payload.progress_note) } : {}),
        ...(text(payload.status)
          ? { status: text(payload.status) as 'new' | 'following' | 'closed' }
          : {}),
        ...(text(payload.remark) ? { remark: text(payload.remark) } : {}),
      });
    } else if (action.action_kind === 'create_project') {
      const name = text(payload.name);
      if (!name) throw new Error('项目缺少 name。');
      await createProject({
        date: text(payload.date, today()),
        name,
        progress_note: text(payload.progress_note) || null,
        remark: text(payload.remark) || null,
      });
    } else if (action.action_kind === 'update_project') {
      const id = text(payload.id);
      if (!id) throw new Error('项目更新缺少 id。');
      if (!(await getProject(id))) throw new Error('找不到可更新的项目。');
      await updateProject(id, {
        ...(text(payload.name) ? { name: text(payload.name) } : {}),
        ...(text(payload.progress_note) ? { progress_note: text(payload.progress_note) } : {}),
        ...(text(payload.status)
          ? { status: text(payload.status) as 'new' | 'following' | 'closed' }
          : {}),
        ...(text(payload.remark) ? { remark: text(payload.remark) } : {}),
      });
    } else if (action.action_kind === 'create_project_task') {
      const projectId = text(payload.project_id);
      const item = text(payload.item);
      if (!projectId || !item) throw new Error('项目任务需要 project_id 和 item。');
      if (!(await getProject(projectId))) throw new Error('找不到可写入任务的项目。');
      const status = text(payload.status, 'following');
      if (!['following', 'closed'].includes(status)) throw new Error('项目任务 status 无效。');
      const task = await createWbs(projectId);
      await updateWbs(task.id, {
        item,
        ...(text(payload.type) ? { type: text(payload.type) } : {}),
        ...(text(payload.progress_note) ? { progress_note: text(payload.progress_note) } : {}),
        status: status as 'following' | 'closed',
        ...(text(payload.planned_start) ? { planned_start: text(payload.planned_start) } : {}),
        ...(text(payload.planned_end) ? { planned_end: text(payload.planned_end) } : {}),
      });
    } else if (action.action_kind === 'create_project_risk') {
      const projectId = text(payload.project_id);
      const risk = text(payload.risk);
      if (!projectId || !risk) throw new Error('项目风险需要 project_id 和 risk。');
      if (!(await getProject(projectId))) throw new Error('找不到可写入风险的项目。');
      const level = text(payload.level, 'mid');
      if (!['high', 'mid', 'low'].includes(level)) throw new Error('项目风险 level 无效。');
      const status = text(payload.status, 'following');
      if (!['following', 'closed'].includes(status)) throw new Error('项目风险 status 无效。');
      const created = await createRisk(projectId);
      await updateRisk(created.id, {
        risk,
        level: level as 'high' | 'mid' | 'low',
        status: status as 'following' | 'closed',
        ...(text(payload.countermeasure) ? { countermeasure: text(payload.countermeasure) } : {}),
        ...(text(payload.progress_note) ? { progress_note: text(payload.progress_note) } : {}),
        ...(text(payload.remark) ? { remark: text(payload.remark) } : {}),
      });
    } else if (action.action_kind === 'update_project_task') {
      const id = text(payload.id);
      if (!id) throw new Error('项目任务更新缺少 id。');
      if (!(await getWbs(id))) throw new Error('找不到可更新的项目任务。');
      const status = text(payload.status);
      if (status && !['following', 'closed'].includes(status))
        throw new Error('项目任务 status 无效。');
      const patch = {
        ...(text(payload.item) ? { item: text(payload.item) } : {}),
        ...(text(payload.type) ? { type: text(payload.type) } : {}),
        ...(text(payload.progress_note) ? { progress_note: text(payload.progress_note) } : {}),
        ...(status ? { status: status as 'following' | 'closed' } : {}),
        ...(text(payload.planned_start) ? { planned_start: text(payload.planned_start) } : {}),
        ...(text(payload.planned_end) ? { planned_end: text(payload.planned_end) } : {}),
        ...(text(payload.actual_start) ? { actual_start: text(payload.actual_start) } : {}),
        ...(text(payload.actual_end) ? { actual_end: text(payload.actual_end) } : {}),
      };
      if (Object.keys(patch).length === 0) throw new Error('项目任务更新缺少可修改字段。');
      await updateWbs(id, patch);
    } else if (action.action_kind === 'update_project_risk') {
      const id = text(payload.id);
      if (!id) throw new Error('项目风险更新缺少 id。');
      if (!(await getRisk(id))) throw new Error('找不到可更新的项目风险。');
      const level = text(payload.level);
      if (level && !['high', 'mid', 'low'].includes(level))
        throw new Error('项目风险 level 无效。');
      const status = text(payload.status);
      if (status && !['following', 'closed'].includes(status))
        throw new Error('项目风险 status 无效。');
      const patch = {
        ...(text(payload.risk) ? { risk: text(payload.risk) } : {}),
        ...(level ? { level: level as 'high' | 'mid' | 'low' } : {}),
        ...(text(payload.countermeasure) ? { countermeasure: text(payload.countermeasure) } : {}),
        ...(text(payload.progress_note) ? { progress_note: text(payload.progress_note) } : {}),
        ...(status ? { status: status as 'following' | 'closed' } : {}),
        ...(text(payload.remark) ? { remark: text(payload.remark) } : {}),
      };
      if (Object.keys(patch).length === 0) throw new Error('项目风险更新缺少可修改字段。');
      await updateRisk(id, patch);
    } else if (action.action_kind === 'attach_project_file') {
      const projectId = text(payload.project_id);
      const sourcePath = text(payload.source_path);
      if (!projectId || !sourcePath)
        throw new Error('项目文件归档需要 project_id 和 source_path。');
      if (!isAbsoluteFilePath(sourcePath)) throw new Error('项目文件 source_path 必须是绝对路径。');
      if (!(await getProject(projectId))) throw new Error('找不到可归档文件的项目。');
      const originalName = filenameFromPath(sourcePath);
      if (!originalName || originalName === '.' || originalName === '..')
        throw new Error('无法从 source_path 识别文件名。');
      await attachFile(projectId, { sourcePath, originalName });
    } else if (action.action_kind === 'create_project_member') {
      const projectId = text(payload.project_id);
      const name = text(payload.name);
      if (!projectId || !name) throw new Error('项目成员需要 project_id 和 name。');
      if (!(await getProject(projectId))) throw new Error('找不到可写入成员的项目。');
      const member = await createMember(projectId);
      await updateMember(member.id, {
        name,
        ...(text(payload.company) ? { company: text(payload.company) } : {}),
        ...(text(payload.department) ? { department: text(payload.department) } : {}),
        ...(text(payload.role) ? { role: text(payload.role) } : {}),
        ...(text(payload.phone) ? { phone: text(payload.phone) } : {}),
        ...(text(payload.remark) ? { remark: text(payload.remark) } : {}),
      });
    } else if (action.action_kind === 'update_project_member') {
      const id = text(payload.id);
      if (!id) throw new Error('项目成员更新缺少 id。');
      if (!(await getMember(id))) throw new Error('找不到可更新的项目成员。');
      const patch = {
        ...(text(payload.company) ? { company: text(payload.company) } : {}),
        ...(text(payload.department) ? { department: text(payload.department) } : {}),
        ...(text(payload.name) ? { name: text(payload.name) } : {}),
        ...(text(payload.role) ? { role: text(payload.role) } : {}),
        ...(text(payload.phone) ? { phone: text(payload.phone) } : {}),
        ...(text(payload.remark) ? { remark: text(payload.remark) } : {}),
      };
      if (Object.keys(patch).length === 0) throw new Error('项目成员更新缺少可修改字段。');
      await updateMember(id, patch);
    } else if (action.action_kind === 'open_local_path') {
      const path = text(payload.path);
      if (!isSafeOpenTarget(path))
        throw new Error('只能打开本地绝对文件或文件夹，且不允许通过 AI 启动可执行文件或脚本。');
      await shellOpen(path);
    } else if (action.action_kind === 'create_word') {
      const word = text(payload.word);
      if (!word) throw new Error('英语词条缺少 word。');
      await createOrAppendWord({
        word,
        meaning: text(payload.meaning) || null,
        example: text(payload.example) || null,
        sentence: text(payload.sentence) || null,
        translation: text(payload.translation) || null,
        source: 'AI 助手确认写入',
      });
    } else if (action.action_kind === 'update_word') {
      const id = text(payload.id);
      if (!id) throw new Error('英语词条更新缺少 id。');
      if (!(await getWord(id))) throw new Error('找不到可更新的英语词条。');
      const status = text(payload.status);
      if (status && !['new', 'learning', 'mastered', 'paused'].includes(status))
        throw new Error('英语词条 status 无效。');
      const patch = {
        ...(text(payload.word) ? { word: text(payload.word) } : {}),
        ...(text(payload.pos) ? { pos: text(payload.pos) } : {}),
        ...(text(payload.meaning) ? { meaning: text(payload.meaning) } : {}),
        ...(text(payload.meaning_context)
          ? { meaning_context: text(payload.meaning_context) }
          : {}),
        ...(text(payload.example) ? { example: text(payload.example) } : {}),
        ...(text(payload.tags) ? { tags: text(payload.tags) } : {}),
        ...(text(payload.notes) ? { notes: text(payload.notes) } : {}),
        ...(status ? { status: status as LearnStatus } : {}),
      };
      if (Object.keys(patch).length === 0) throw new Error('英语词条更新缺少可修改字段。');
      await updateWord(id, patch);
    } else if (action.action_kind === 'create_note') {
      const note = await createNote(null);
      await updateNote(note.id, {
        ...note,
        title: text(payload.title, 'AI 助手笔记'),
        content: text(payload.content),
        tags: text(payload.tags) || null,
        folder_id: null,
      });
    } else if (action.action_kind === 'update_note') {
      const id = text(payload.id);
      if (!id) throw new Error('知识笔记更新缺少 id。');
      const note = await getNote(id);
      if (!note) throw new Error('找不到可更新的知识笔记。');
      const title = text(payload.title);
      const content = text(payload.content);
      const tags = text(payload.tags);
      if (!title && !content && !tags) throw new Error('知识笔记更新缺少可修改字段。');
      await updateNote(id, {
        title: title || note.title,
        content: content || note.content,
        tags: tags || note.tags,
        folder_id: note.folder_id,
      });
    } else if (action.action_kind === 'update_setting') {
      const key = text(payload.key);
      const value = text(payload.value);
      if (!key || /key|secret|password|token/i.test(key))
        throw new Error('不允许 AI 通过此通道修改密钥或密码设置。');
      await exec(
        `INSERT INTO setting_kv (scope,key,value,updated_at) VALUES ('app',$1,$2,$3) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
        [key, value, new Date().toISOString()],
      );
    } else if (action.action_kind === 'generate_text_file') {
      const path = text(payload.path);
      const content = text(payload.content);
      if (!path || !content) throw new Error('生成文件需要 path 和 content。');
      await invoke('write_generated_text_file', { path, content });
    } else if (action.action_kind === 'generate_xlsx_file') {
      const path = text(payload.path);
      const sheets = payload.sheets;
      if (!path || !Array.isArray(sheets) || sheets.length === 0)
        throw new Error('生成 Excel 文件需要 path 和至少一个 sheets 数据表。');
      if (sheets.length > 20) throw new Error('单次最多生成 20 个工作表。');
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const usedSheetNames = new Set<string>();
      for (let index = 0; index < sheets.length; index += 1) {
        const sheet = sheets[index];
        if (!sheet || typeof sheet !== 'object')
          throw new Error(`第 ${index + 1} 个工作表格式无效。`);
        const { name, rows } = sheet as { name?: unknown; rows?: unknown };
        if (!Array.isArray(rows) || rows.length > 10_000)
          throw new Error(`第 ${index + 1} 个工作表的 rows 必须是最多 10000 行的数组。`);
        const cells = rows.map((row, rowIndex) => {
          if (!Array.isArray(row) || row.length > 100)
            throw new Error(`第 ${index + 1} 个工作表第 ${rowIndex + 1} 行格式无效。`);
          return row.map((cell) =>
            typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean'
              ? cell
              : String(cell ?? ''),
          );
        });
        const requestedName = typeof name === 'string' ? name.trim() : '';
        const baseName =
          [...(requestedName || `数据表${index + 1}`)]
            .map((character) => ('\\/:*?[]'.includes(character) ? '_' : character))
            .join('')
            .slice(0, 31) || `数据表${index + 1}`;
        let safeName = baseName;
        let suffix = 2;
        while (usedSheetNames.has(safeName)) {
          const numberedSuffix = `_${suffix++}`;
          safeName = `${baseName.slice(0, 31 - numberedSuffix.length)}${numberedSuffix}`;
        }
        usedSheetNames.add(safeName);
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(cells), safeName);
      }
      const binary = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      await invoke('write_generated_xlsx_file', { path, data: Array.from(new Uint8Array(binary)) });
    } else if (action.action_kind === 'generate_docx_file') {
      const path = text(payload.path);
      const content = text(payload.content);
      if (!path || !content) throw new Error('生成 Word 报告需要 path 和 content。');
      await invoke('write_generated_docx_file', {
        path,
        title: text(payload.title, 'AI 生成报告'),
        content,
      });
    } else if (action.action_kind === 'create_local_directory') {
      const path = text(payload.path);
      if (!isAbsoluteFilePath(path)) throw new Error('新建文件夹需要绝对 path。');
      await invoke('create_confirmed_directory', { path });
    } else if (action.action_kind === 'copy_local_file') {
      const sourcePath = text(payload.source_path);
      const targetPath = text(payload.target_path);
      if (!isAbsoluteFilePath(sourcePath) || !isAbsoluteFilePath(targetPath))
        throw new Error('复制文件需要 source_path 和 target_path 两个绝对路径。');
      await invoke('copy_confirmed_local_file', { sourcePath, targetPath });
    } else if (action.action_kind === 'run_terminal_command') {
      const command = text(payload.command);
      if (!command) throw new Error('终端操作缺少 command。');
      const result = await invoke<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }>('run_confirmed_terminal_command', {
        command,
        workingDir: text(payload.working_dir) || null,
      });
      if (result.timedOut || result.exitCode !== 0) {
        throw new Error(
          `终端命令执行失败：${result.stderr || result.stdout || `退出代码 ${result.exitCode ?? '未知'}`}`,
        );
      }
      const output = (result.stdout || result.stderr).trim();
      resultSummary = output
        ? `终端命令执行成功。\n\n${output.slice(0, 4_000)}`
        : '终端命令执行成功，未返回文本输出。';
    } else if (action.action_kind === 'run_desktop_automation') {
      const steps = payload.steps;
      if (!Array.isArray(steps) || steps.length === 0 || steps.length > 30) {
        throw new Error('桌面自动化需要 1 至 30 个 steps。');
      }
      for (const [index, step] of steps.entries()) {
        if (!step || typeof step !== 'object') throw new Error(`第 ${index + 1} 个桌面步骤无效。`);
        const type = text((step as Record<string, unknown>).type).toLowerCase();
        if (!['focus_window', 'click', 'double_click', 'type_text', 'key', 'wait'].includes(type)) {
          throw new Error(`第 ${index + 1} 个桌面步骤 type 无效。`);
        }
      }
      const result = await invoke<{ executedSteps: number }>('run_confirmed_desktop_automation', {
        request: { steps },
      });
      resultSummary = `桌面自动化已完成，共执行 ${result.executedSteps} 个步骤。`;
    } else throw new Error('不支持的操作类型。');
    await exec(
      `UPDATE assistant_action_request
       SET status = 'executed', resolved_at = $1, error_message = NULL, result_summary = $2
       WHERE id = $3 AND account_id = $4`,
      [new Date().toISOString(), resultSummary, action.id, accountId()],
    );
    await exec(
      `INSERT INTO audit_log (id,account_id,action,detail,ip_or_host,created_at) VALUES ($1,$2,$3,$4,'local-ai',$5)`,
      [
        uuid(),
        accountId(),
        `assistant.${action.action_kind}`,
        JSON.stringify({
          actionId: action.id,
          summary: action.summary,
          payload,
          before,
          result: resultSummary,
        }),
        new Date().toISOString(),
      ],
    );
    return resultSummary;
  } catch (error) {
    await exec(
      `UPDATE assistant_action_request
       SET status = 'failed', resolved_at = $1, error_message = $2, result_summary = NULL
       WHERE id = $3 AND account_id = $4`,
      [
        new Date().toISOString(),
        error instanceof Error ? error.message : String(error),
        action.id,
        accountId(),
      ],
    );
    await exec(
      `INSERT INTO audit_log (id,account_id,action,detail,ip_or_host,created_at) VALUES ($1,$2,$3,$4,'local-ai',$5)`,
      [
        uuid(),
        accountId(),
        `assistant.${action.action_kind}.failed`,
        JSON.stringify({
          actionId: action.id,
          summary: action.summary,
          payload,
          before,
          error: error instanceof Error ? error.message : String(error),
        }),
        new Date().toISOString(),
      ],
    );
    throw error;
  }
}
