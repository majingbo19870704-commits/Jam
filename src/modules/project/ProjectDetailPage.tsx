import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ListTree, AlertTriangle, FileText, Users, Pencil,
} from 'lucide-react';
import { getProject } from '@/db/project-dao';
import { listByGroup } from '@/db/param-dao';
import type { ParamOption, Project, StatusFull } from '@/types';
import { ProjectEditModal } from './ProjectEditModal';
import { ProgressPanel } from './panels/ProgressPanel';
import { RiskPanel } from './panels/RiskPanel';
import { MaterialsPage } from '@/modules/materials/MaterialsPage';
import { MemberPanel } from './panels/MemberPanel';

type TabKey = 'progress' | 'risk' | 'file' | 'member';

const TABS: { key: TabKey; label: string; icon: typeof ListTree }[] = [
  { key: 'progress', label: '项目进度', icon: ListTree },
  { key: 'risk',     label: '项目风险', icon: AlertTriangle },
  { key: 'file',     label: '项目资料', icon: FileText },
  { key: 'member',   label: '项目成员', icon: Users },
];

export function ProjectDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [types, setTypes] = useState<ParamOption[]>([]);
  const requestedTab = params.get('tab');
  const tab: TabKey = TABS.some((item) => item.key === requestedTab) ? requestedTab as TabKey : 'progress';
  const focusedItemId = params.get('focus');
  const [editing, setEditing] = useState(false);

  async function load() {
    if (!id) return;
    const [p, t] = await Promise.all([getProject(id), listByGroup('project_type')]);
    setProject(p);
    setTypes(t);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  if (!project) {
    return <div className="p-6 text-ink-3">项目不存在或已删除。</div>;
  }

  const typeName = types.find((t) => t.id === project.type_id)?.name;

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-ink-3 mb-3">
        <button className="hover:text-accent flex items-center gap-1"
          onClick={() => nav('/project')}>
          <ArrowLeft size={14} /> 项目管理
        </button>
        <span className="text-ink-4">/</span>
        <span className="text-ink font-medium">{project.name}</span>
      </div>

      {/* 信息条 */}
      <div className="card mb-4 relative overflow-hidden">
        <div
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ background: 'linear-gradient(180deg, rgb(var(--rgb-accent)), #6E8CFF)' }}
        />
        <div className="p-5 flex items-center gap-8 flex-wrap">
          <InfoItem label="类型" value={typeName ? <span className="chip">{typeName}</span> : '—'} />
          <div>
            <div className="text-[11px] text-ink-3 tracking-wide mb-1">项目名称</div>
            <div className="serif text-xl font-semibold">{project.name}</div>
          </div>
          <InfoItem label="状态" value={<StatusChip s={project.status} />} />
          <InfoItem label="内部 PIC" value={project.internal_pic || '—'} />
          <InfoItem label="外部 PIC" value={project.external_pic || '—'} />
          <div className="flex-1" />
          <button className="btn" onClick={() => setEditing(true)}>
            <Pencil size={14} /> 编辑项目
          </button>
        </div>
      </div>

      {/* 二级 Tab */}
      <div className="flex gap-1 mb-4 border-b border-line">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setParams(key === 'progress' ? {} : { tab: key })}
            className={`px-4 py-2.5 -mb-px border-b-2 text-sm flex items-center gap-2 transition ${
              tab === key
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* 面板 */}
      {tab === 'progress' && <ProgressPanel projectId={project.id} focusedItemId={focusedItemId} />}
      {tab === 'risk'     && <RiskPanel     projectId={project.id} focusedItemId={focusedItemId} />}
      {tab === 'file'     && <MaterialsPage embedded />}
      {tab === 'member'   && <MemberPanel   projectId={project.id} focusedItemId={focusedItemId} />}

      {editing && (
        <ProjectEditModal item={project} types={types}
          onClose={() => setEditing(false)} onSaved={load} />
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-ink-3 tracking-wide mb-1">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function StatusChip({ s }: { s: StatusFull }) {
  const map = { new: ['status-new', '新建'], following: ['status-follow', '跟进'], closed: ['status-closed', '闭环'] } as const;
  const [cls, label] = map[s];
  return <span className={`chip ${cls}`}>{label}</span>;
}
