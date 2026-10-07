// =============================================================================
// db/assistant-workflow-dao.ts · 从用户已确认操作保存的手动自动化流程
// =============================================================================

import { v4 as uuid } from 'uuid';
import { exec, query } from './client';
import { useAccountStore } from '@/stores/account';
import {
  createAssistantActionRequest,
  executeAssistantAction,
  type AssistantActionKind,
  type AssistantActionRequest,
} from './assistant-action-dao';

export interface AssistantWorkflow {
  id: string;
  account_id: string;
  profile_id: string;
  name: string;
  action_kind: AssistantActionKind;
  payload_json: string;
  is_enabled: number;
  last_run_at: string | null;
  last_run_status: string | null;
  schedule_minutes: number | null;
  last_scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

const SAVABLE_KINDS = new Set<AssistantActionKind>([
  'run_terminal_command',
  'run_desktop_automation',
]);

function accountId() {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

export function canSaveAssistantWorkflow(action: AssistantActionRequest) {
  return action.status === 'executed' && SAVABLE_KINDS.has(action.action_kind);
}

export async function listAssistantWorkflows(profileId: string) {
  return query<AssistantWorkflow>(
    `SELECT * FROM assistant_workflow
     WHERE account_id = $1 AND profile_id = $2 AND is_deleted = 0
     ORDER BY is_enabled DESC, updated_at DESC`,
    [accountId(), profileId],
  );
}

export async function saveAssistantWorkflow(action: AssistantActionRequest, name: string) {
  if (!canSaveAssistantWorkflow(action)) throw new Error('此操作暂不能保存为自动化流程。');
  const normalized = name.trim();
  if (!normalized || normalized.length > 80)
    throw new Error('流程名称不能为空，且不能超过 80 个字符。');
  const now = new Date().toISOString();
  const row: AssistantWorkflow = {
    id: uuid(),
    account_id: accountId(),
    profile_id: action.profile_id,
    name: normalized,
    action_kind: action.action_kind,
    payload_json: action.payload_json,
    is_enabled: 1,
    last_run_at: null,
    last_run_status: null,
    schedule_minutes: null,
    last_scheduled_at: null,
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  };
  await exec(
    `INSERT INTO assistant_workflow
     (id,account_id,profile_id,name,action_kind,payload_json,is_enabled,last_run_at,last_run_status,schedule_minutes,last_scheduled_at,created_at,updated_at,is_deleted)
     VALUES ($1,$2,$3,$4,$5,$6,1,NULL,NULL,NULL,NULL,$7,$7,0)`,
    [row.id, row.account_id, row.profile_id, row.name, row.action_kind, row.payload_json, now],
  );
  return row;
}

export async function setAssistantWorkflowEnabled(id: string, enabled: boolean) {
  await exec(
    `UPDATE assistant_workflow SET is_enabled = $1, updated_at = $2
     WHERE id = $3 AND account_id = $4 AND is_deleted = 0`,
    [enabled ? 1 : 0, new Date().toISOString(), id, accountId()],
  );
}

const SCHEDULE_MINUTES = new Set([5, 15, 30, 60, 240, 1440]);

/**
 * 配置流程的定时触发。启用定时后从此刻重新计时，避免用户刚保存就被意外执行。
 * 定时器只由正在运行的桌面端前台进程驱动，关闭应用后不会补跑。
 */
export async function setAssistantWorkflowSchedule(id: string, minutes: number | null) {
  if (minutes !== null && !SCHEDULE_MINUTES.has(minutes)) {
    throw new Error('定时执行间隔无效。');
  }
  const now = new Date().toISOString();
  await exec(
    `UPDATE assistant_workflow
     SET schedule_minutes = $1, last_scheduled_at = $2, updated_at = $3
     WHERE id = $4 AND account_id = $5 AND is_deleted = 0`,
    [minutes, minutes === null ? null : now, now, id, accountId()],
  );
}

export async function deleteAssistantWorkflow(id: string) {
  await exec(
    `UPDATE assistant_workflow SET is_deleted = 1, updated_at = $1
     WHERE id = $2 AND account_id = $3`,
    [new Date().toISOString(), id, accountId()],
  );
}

/**
 * 标记并返回本轮到期流程，避免同一前端的一分钟轮询重复发起同一流程。
 * 调用方必须在应用运行期间执行；这里不会实现开机补跑或后台常驻。
 */
export async function claimDueAssistantWorkflows() {
  const currentAccountId = accountId();
  const candidates = await query<AssistantWorkflow>(
    `SELECT workflow.* FROM assistant_workflow workflow
     INNER JOIN assistant_profile profile ON profile.id = workflow.profile_id
     WHERE workflow.account_id = $1 AND workflow.is_deleted = 0 AND workflow.is_enabled = 1
       AND workflow.schedule_minutes IS NOT NULL AND workflow.schedule_minutes >= 5
       AND profile.account_id = $1 AND profile.is_deleted = 0 AND profile.is_enabled = 1
     ORDER BY workflow.updated_at ASC`,
    [currentAccountId],
  );
  const now = new Date();
  const claimed: AssistantWorkflow[] = [];
  for (const workflow of candidates) {
    const last = Date.parse(workflow.last_scheduled_at ?? workflow.created_at);
    const due = Number.isNaN(last) || now.getTime() - last >= workflow.schedule_minutes! * 60_000;
    if (!due) continue;
    const stamp = now.toISOString();
    // 将读取到的上次触发时间一并作为认领条件。这样即使用户打开多个窗口，
    // 只有最先更新成功的轮询可以取得该流程，避免重复执行同一条桌面/终端指令。
    const result = await exec(
      `UPDATE assistant_workflow SET last_scheduled_at = $1, updated_at = $1
       WHERE id = $2 AND account_id = $3 AND is_deleted = 0 AND is_enabled = 1
         AND schedule_minutes = $4
         AND COALESCE(last_scheduled_at, '') = $5`,
      [
        stamp,
        workflow.id,
        currentAccountId,
        workflow.schedule_minutes,
        workflow.last_scheduled_at ?? '',
      ],
    );
    if (result.rowsAffected === 1) {
      claimed.push({ ...workflow, last_scheduled_at: stamp, updated_at: stamp });
    }
  }
  return claimed;
}

/** 手动点击运行本身就是本次运行的明确授权；执行记录仍沿用 AI 操作审计链。 */
export async function runAssistantWorkflow(workflow: AssistantWorkflow) {
  if (!workflow.is_enabled) throw new Error('该流程已停用。');
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(workflow.payload_json) as Record<string, unknown>;
  } catch {
    throw new Error('流程内容无效。');
  }
  const action = await createAssistantActionRequest(workflow.profile_id, '', {
    kind: workflow.action_kind,
    summary: `运行自动流程：${workflow.name}`,
    payload,
    displayContent: '',
  });
  try {
    await executeAssistantAction(action);
    await exec(
      `UPDATE assistant_workflow SET last_run_at = $1, last_run_status = 'success', updated_at = $1
       WHERE id = $2 AND account_id = $3`,
      [new Date().toISOString(), workflow.id, accountId()],
    );
  } catch (error) {
    await exec(
      `UPDATE assistant_workflow SET last_run_at = $1, last_run_status = 'failed', updated_at = $1
       WHERE id = $2 AND account_id = $3`,
      [new Date().toISOString(), workflow.id, accountId()],
    );
    throw error;
  }
}
