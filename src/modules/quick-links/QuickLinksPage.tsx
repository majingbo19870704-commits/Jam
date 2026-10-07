import { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink, Folder, Link2, Pencil, Plus, Search, Trash2, X,
} from 'lucide-react';
import { open as openInShell } from '@tauri-apps/plugin-shell';
import {
  createGroup, createLink, deleteGroup, deleteLink, listGroups, listLinks,
  renameGroup, tickClick, updateLink,
  type QuickLink, type QuickLinkGroup,
} from '@/db/quick-link-dao';
import { LinkEditModal } from './LinkEditModal';

export function QuickLinksPage() {
  const [groups, setGroups] = useState<QuickLinkGroup[]>([]);
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | 'all' | 'none'>('all');
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState<QuickLink | null>(null);
  const [creating, setCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const [gs, ls] = await Promise.all([listGroups(), listLinks()]);
      setGroups(gs);
      setLinks(ls);
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    let noneCount = 0;
    links.forEach((l) => {
      if (l.group_id) m.set(l.group_id, (m.get(l.group_id) ?? 0) + 1);
      else noneCount++;
    });
    return { byGroup: m, none: noneCount };
  }, [links]);

  const filtered = useMemo(() => {
    let out = links;
    if (activeGroup === 'none') out = out.filter((l) => !l.group_id);
    else if (activeGroup !== 'all') out = out.filter((l) => l.group_id === activeGroup);
    const kw = keyword.trim().toLowerCase();
    if (kw) out = out.filter((l) =>
      l.name.toLowerCase().includes(kw) ||
      l.url_or_path.toLowerCase().includes(kw) ||
      (l.remark ?? '').toLowerCase().includes(kw),
    );
    return out;
  }, [links, activeGroup, keyword]);

  async function openLink(l: QuickLink) {
    // 打开前拒绝可执行文件
    if (l.kind === 'path') {
      const p = l.url_or_path.toLowerCase();
      if (/\.(exe|bat|cmd|ps1|msi|scr)$/.test(p)) {
        alert('出于安全考虑，不直接启动可执行文件。请在设置文件后手动打开。');
        return;
      }
    }
    try {
      await openInShell(l.url_or_path);
      await tickClick(l.id);
      await refresh();
    } catch (e) {
      alert('打开失败：' + String(e));
    }
  }

  async function handleCreate(v: {
    groupId: string | null; kind: 'url' | 'path'; name: string; url_or_path: string; remark?: string;
  }) {
    await createLink(v);
    await refresh();
  }
  async function handleUpdate(v: {
    groupId: string | null; kind: 'url' | 'path'; name: string; url_or_path: string; remark?: string;
  }) {
    if (!editing) return;
    await updateLink(editing.id, {
      group_id: v.groupId, kind: v.kind, name: v.name,
      url_or_path: v.url_or_path, remark: v.remark ?? null,
    });
    await refresh();
  }

  async function handleAddGroup() {
    if (!newGroupName.trim()) return;
    await createGroup(newGroupName.trim());
    setNewGroupName('');
    setAddingGroup(false);
    await refresh();
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">快捷链接</h1>
          <div className="text-[12.5px] text-ink-3 mt-1">
            网址在浏览器打开，本地路径在系统文件管理器打开
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={12} strokeWidth={2.5} /> 新建链接
        </button>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-4">
        {/* 左侧分组栏 */}
        <div className="card p-2">
          <GroupItem
            active={activeGroup === 'all'}
            onClick={() => setActiveGroup('all')}
            label="全部"
            count={links.length}
          />
          <GroupItem
            active={activeGroup === 'none'}
            onClick={() => setActiveGroup('none')}
            label="未分组"
            count={counts.none}
          />
          <div className="my-1 border-t border-line" />
          {groups.map((g) => (
            <GroupItem
              key={g.id}
              active={activeGroup === g.id}
              onClick={() => setActiveGroup(g.id)}
              label={g.name}
              count={counts.byGroup.get(g.id) ?? 0}
              onRename={async () => {
                const name = prompt('重命名分组', g.name);
                if (!name || name === g.name) return;
                await renameGroup(g.id, name);
                await refresh();
              }}
              onDelete={async () => {
                if (!confirm(`删除分组「${g.name}」？其下链接会移到未分组。`)) return;
                await deleteGroup(g.id);
                if (activeGroup === g.id) setActiveGroup('all');
                await refresh();
              }}
            />
          ))}

          {addingGroup ? (
            <div className="mt-1 flex items-center gap-1 px-2 py-1">
              <input
                autoFocus
                className="flex-1 px-2 py-1 border border-accent rounded text-sm outline-none"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddGroup();
                  if (e.key === 'Escape') { setAddingGroup(false); setNewGroupName(''); }
                }}
                placeholder="分组名"
              />
              <button className="icon-btn" onClick={handleAddGroup} title="保存"><Plus size={14} /></button>
              <button className="icon-btn" onClick={() => { setAddingGroup(false); setNewGroupName(''); }} title="取消"><X size={14} /></button>
            </div>
          ) : (
            <button
              className="w-full mt-1 px-3 py-2 rounded-lg text-[13px] text-ink-3 hover:bg-paper flex items-center gap-2"
              onClick={() => setAddingGroup(true)}
            >
              <Plus size={14} /> 新建分组
            </button>
          )}
        </div>

        {/* 右侧内容 */}
        <div>
          {/* 搜索栏 */}
          <div className="card mb-4">
            <div className="card-body py-3 flex items-center gap-2">
              <div className="flex items-center gap-2 flex-1 px-3 py-1.5 border border-line-strong rounded bg-canvas">
                <Search size={14} className="text-ink-3" />
                <input
                  className="flex-1 outline-none text-sm bg-transparent"
                  placeholder="搜索名称、URL / 路径、备注…"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <span className="text-xs text-ink-3">{filtered.length} / {links.length}</span>
            </div>
          </div>

          {/* 卡片网格 */}
          {loading && <div className="text-center text-ink-3 py-10">加载中…</div>}
          {!loading && filtered.length === 0 && (
            <div className="card p-10 text-center text-ink-3">
              <Link2 size={28} className="mx-auto mb-3 text-ink-4" />
              {keyword ? '没有匹配的链接' : '还没有链接，点右上「新建链接」创建第一个'}
            </div>
          )}
          {filtered.length > 0 && (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {filtered.map((l) => (
                <LinkCard key={l.id} link={l}
                  groupName={groups.find((g) => g.id === l.group_id)?.name}
                  onOpen={() => openLink(l)}
                  onEdit={() => setEditing(l)}
                  onDelete={async () => {
                    if (!confirm(`删除「${l.name}」？`)) return;
                    await deleteLink(l.id);
                    await refresh();
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <LinkEditModal
          groups={groups}
          onClose={() => setCreating(false)}
          onSave={async (v) => { await handleCreate(v); }}
        />
      )}
      {editing && (
        <LinkEditModal
          initial={editing}
          groups={groups}
          onClose={() => setEditing(null)}
          onSave={async (v) => { await handleUpdate(v); }}
        />
      )}
    </div>
  );
}

function GroupItem({
  active, onClick, label, count, onRename, onDelete,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] cursor-pointer ${
        active ? 'bg-accent-tint text-accent font-semibold' : 'text-ink-2 hover:bg-paper'
      }`}
      onClick={onClick}
    >
      <Folder size={14} />
      <span className="flex-1 truncate">{label}</span>
      <span className={`text-[11px] num ${active ? 'text-accent' : 'text-ink-4'}`}>{count}</span>
      {onRename && (
        <div className="flex opacity-0 group-hover:opacity-100 gap-0.5">
          <button className="icon-btn !w-6 !h-6" title="重命名"
            onClick={(e) => { e.stopPropagation(); onRename(); }}>
            <Pencil size={12} />
          </button>
          <button className="icon-btn !w-6 !h-6 text-danger" title="删除分组"
            onClick={(e) => { e.stopPropagation(); onDelete?.(); }}>
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function LinkCard({
  link, groupName, onOpen, onEdit, onDelete,
}: {
  link: QuickLink;
  groupName?: string;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = link.kind === 'url' ? Link2 : Folder;
  const grad = link.kind === 'url'
    ? 'linear-gradient(135deg,#2E5BFF,#6E8CFF)'
    : 'linear-gradient(135deg,#F59E0B,#FBBF24)';
  return (
    <div className="card group hover:-translate-y-0.5 transition-transform relative">
      <div className="p-4 cursor-pointer" onClick={onOpen}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg grid place-items-center text-white shrink-0"
            style={{ background: grad }}>
            <Icon size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold truncate" title={link.name}>{link.name}</div>
            <div className="text-[11.5px] text-ink-3 truncate mt-0.5" title={link.url_or_path}>
              {link.url_or_path}
            </div>
          </div>
          <ExternalLink size={12} className="text-ink-4 shrink-0 mt-1" />
        </div>
        {groupName && (
          <div className="text-[10.5px] text-ink-4 mt-2">
            分组：{groupName}
          </div>
        )}
        {link.click_count > 0 && (
          <div className="text-[10.5px] text-ink-4 mt-1">
            打开 <span className="num">{link.click_count}</span> 次
          </div>
        )}
      </div>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1 bg-canvas/80 rounded px-1">
        <button className="icon-btn !w-6 !h-6" title="编辑"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}>
          <Pencil size={12} />
        </button>
        <button className="icon-btn !w-6 !h-6 text-danger" title="删除"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
