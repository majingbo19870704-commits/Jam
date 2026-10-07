// AI 的业务只读上下文：仅提供必要字段和当前账号可见的数据，禁止模型直接执行 SQL。
import { query } from './client';
import { useAccountStore } from '@/stores/account';

function accountId() {
  const id = useAccountStore.getState().currentAccountId;
  if (!id) throw new Error('未登录');
  return id;
}

async function scheduleContext(account: string) {
  const schedules = await query<{
    id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
    reminder_repeat: string;
    notes: string | null;
    completed_at: string | null;
  }>(
    `SELECT id,title,starts_at,ends_at,reminder_repeat,notes,completed_at FROM schedule_event
     WHERE account_id=$1 AND is_deleted=0 ORDER BY starts_at ASC LIMIT 50`,
    [account],
  );
  return `日程只读摘要（修改或删除时必须使用 id）：\n${schedules.map((item) => `- id=${item.id}; 开始=${item.starts_at}; 结束=${item.ends_at ?? '无'}; 标题=${item.title}; 重复=${item.reminder_repeat}; 状态=${item.completed_at ? '已完成' : '未完成'}; 备注=${item.notes ?? '无'}`).join('\n') || '无'}`;
}

export async function getAssistantWorkstationContext(avatarKey: string) {
  const account = accountId();
  const schedules = await scheduleContext(account);
  if (avatarKey === 'work' || avatarKey === 'spark') {
    const items = await query<{
      id: string;
      date: string;
      description: string;
      status: string;
      priority: string;
      progress_note: string | null;
    }>(
      `SELECT id,date,description,status,priority,progress_note FROM work_item WHERE account_id = $1 AND is_deleted = 0 ORDER BY date DESC,seq_no DESC LIMIT 30`,
      [account],
    );
    return `工作事项只读摘要（更新时必须使用 id）：\n${items.map((item) => `- id=${item.id}; 日期=${item.date}; 状态=${item.status}; 优先级=${item.priority}; 内容=${item.description}; 进展=${item.progress_note ?? '无'}`).join('\n')}\n\n${schedules}`;
  }
  if (avatarKey === 'project') {
    const projects = await query<{
      id: string;
      date: string;
      name: string;
      status: string;
      progress_note: string | null;
    }>(
      `SELECT id,date,name,status,progress_note FROM project WHERE account_id = $1 AND is_deleted = 0 ORDER BY date DESC,seq_no DESC LIMIT 30`,
      [account],
    );
    const tasks = await query<{
      id: string;
      project_name: string;
      item: string;
      status: string;
      progress_note: string | null;
    }>(
      `SELECT w.id,p.name AS project_name,w.item,w.status,w.progress_note
       FROM project_wbs w INNER JOIN project p ON p.id = w.project_id
       WHERE w.account_id = $1 AND w.is_deleted = 0 AND p.is_deleted = 0
       ORDER BY w.updated_at DESC LIMIT 20`,
      [account],
    );
    const risks = await query<{
      id: string;
      project_name: string;
      risk: string;
      level: string;
      status: string;
    }>(
      `SELECT r.id,p.name AS project_name,r.risk,r.level,r.status
       FROM project_risk r INNER JOIN project p ON p.id = r.project_id
       WHERE r.account_id = $1 AND r.is_deleted = 0 AND p.is_deleted = 0
       ORDER BY r.updated_at DESC LIMIT 20`,
      [account],
    );
    const members = await query<{
      id: string;
      project_name: string;
      company: string | null;
      department: string | null;
      name: string;
      role: string | null;
    }>(
      `SELECT m.id,p.name AS project_name,m.company,m.department,m.name,m.role
       FROM project_member m INNER JOIN project p ON p.id = m.project_id
       WHERE m.account_id = $1 AND m.is_deleted = 0 AND p.is_deleted = 0
       ORDER BY m.updated_at DESC LIMIT 20`,
      [account],
    );
    return [
      `项目只读摘要（更新时必须使用 id）：\n${projects.map((project) => `- id=${project.id}; 日期=${project.date}; 状态=${project.status}; 名称=${project.name}; 进展=${project.progress_note ?? '无'}`).join('\n')}`,
      `近期项目任务（更新时必须使用 id）：\n${tasks.map((task) => `- id=${task.id}; 项目=${task.project_name}; 状态=${task.status}; 任务=${task.item}; 进展=${task.progress_note ?? '无'}`).join('\n') || '无'}`,
      `近期项目风险（更新时必须使用 id）：\n${risks.map((risk) => `- id=${risk.id}; 项目=${risk.project_name}; 等级=${risk.level}; 状态=${risk.status}; 风险=${risk.risk}`).join('\n') || '无'}`,
      `近期项目成员（更新时必须使用 id；不含电话）：\n${members.map((member) => `- id=${member.id}; 项目=${member.project_name}; 姓名=${member.name}; 公司=${member.company ?? '无'}; 部门=${member.department ?? '无'}; 角色=${member.role ?? '无'}`).join('\n') || '无'}`,
      schedules,
    ].join('\n\n');
  }
  if (avatarKey === 'language') {
    const words = await query<{
      id: string;
      word: string;
      meaning: string | null;
      item_kind: string;
      status: string;
    }>(
      `SELECT id,word,meaning,item_kind,status FROM word_card WHERE account_id = $1 AND is_deleted = 0 ORDER BY updated_at DESC LIMIT 30`,
      [account],
    );
    return `英语词库只读摘要：\n${words.map((word) => `- id=${word.id}; 类型=${word.item_kind}; 词条=${word.word}; 含义=${word.meaning ?? '无'}; 状态=${word.status}`).join('\n')}\n\n${schedules}`;
  }
  if (avatarKey === 'research') {
    const notes = await query<{
      id: string;
      title: string;
      tags: string | null;
      content: string | null;
    }>(
      `SELECT id,title,tags,content FROM note WHERE account_id = $1 AND is_deleted = 0 ORDER BY updated_at DESC LIMIT 20`,
      [account],
    );
    return `知识库笔记只读摘要（更新时必须使用 id；摘要可能不完整）：\n${notes
      .map(
        (note) =>
          `- id=${note.id}; 标题=${note.title}; 标签=${note.tags ?? '无'}; 摘要=${(note.content ?? '').replace(/\s+/g, ' ').slice(0, 360) || '无内容'}`,
      )
      .join('\n')}\n\n${schedules}`;
  }
  return schedules;
}
