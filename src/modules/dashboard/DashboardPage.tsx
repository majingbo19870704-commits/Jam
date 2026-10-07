import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FolderKanban,
  TrendingUp,
} from 'lucide-react';
import { MetricCard } from '@/components/MetricCard';
import { ResizableTh } from '@/components/ResizableTh';
import {
  DASHBOARD_ROW_HEIGHT,
  DashboardWidget,
  type DashboardLayout,
} from '@/components/DashboardWidget';
import { listWorkItems, statsThisYear as workStats, autoAdvanceStatus } from '@/db/work-item-dao';
import { listProjects, statsThisYear as projStats } from '@/db/project-dao';
import { listByGroup } from '@/db/param-dao';
import { listScheduleEvents } from '@/db/schedule-event-dao';
import { StatusChip, PriorityChip } from '@/components/inline';
import { DashboardHeroBanner } from '@/components/ThemeDecorations';
import { loadWidths, saveWidths } from '@/lib/column-widths';
import type { WorkItem, Project, ParamOption } from '@/types';

const LAYOUT_STORAGE_KEY = 'personal-workstation.dashboard-layout.v1';
const DEFAULT_LAYOUTS: Record<string, DashboardLayout> = {
  clock: { x: 0, y: 0, w: 5, h: 8 },
  calendar: { x: 5, y: 0, w: 7, h: 8 },
  workTotal: { x: 0, y: 10, w: 3, h: 6 },
  workClosed: { x: 3, y: 10, w: 3, h: 6 },
  workOpen: { x: 6, y: 10, w: 3, h: 6 },
  workRate: { x: 9, y: 10, w: 3, h: 6 },
  projectTotal: { x: 0, y: 18, w: 3, h: 6 },
  projectClosed: { x: 3, y: 18, w: 3, h: 6 },
  projectOpen: { x: 6, y: 18, w: 3, h: 6 },
  projectRate: { x: 9, y: 18, w: 3, h: 6 },
  openWork: { x: 0, y: 26, w: 7, h: 15 },
  openProject: { x: 7, y: 26, w: 5, h: 15 },
  focus: { x: 0, y: 43, w: 4, h: 9 },
  overdue: { x: 4, y: 43, w: 8, h: 9 },
};

const OPEN_WORK_COLUMNS: ReportColumn[] = [
  { key: 'seq', label: '序号', width: 70, minWidth: 56 },
  { key: 'type', label: '类型', width: 100, minWidth: 72 },
  { key: 'description', label: '事项', width: 270, minWidth: 140, align: 'left' },
  { key: 'owner', label: '负责人', width: 120, minWidth: 80 },
  { key: 'priority', label: '优先', width: 82, minWidth: 64 },
];
const OPEN_PROJECT_COLUMNS: ReportColumn[] = [
  { key: 'seq', label: '序号', width: 70, minWidth: 56 },
  { key: 'project', label: '项目名称', width: 220, minWidth: 130, align: 'left' },
  { key: 'type', label: '项目类型', width: 112, minWidth: 80 },
  { key: 'status', label: '状态', width: 100, minWidth: 74 },
];
const OVERDUE_COLUMNS: ReportColumn[] = [
  { key: 'seq', label: '序号', width: 70, minWidth: 56 },
  { key: 'description', label: '事项', width: 270, minWidth: 140, align: 'left' },
  { key: 'planned', label: '计划', width: 116, minWidth: 96 },
  { key: 'overdue', label: '逾期', width: 110, minWidth: 88 },
];

/** 主页看板：卡片位置和尺寸由用户在本机自行编排。 */
export function DashboardPage() {
  const nav = useNavigate();
  const [layouts, setLayouts] = useState<Record<string, DashboardLayout>>(readLayouts);
  const [work, setWork] = useState({ total: 0, closed: 0, open: 0, rate: 0, highOpen: 0 });
  const [proj, setProj] = useState({ total: 0, closed: 0, open: 0, rate: 0 });
  const [openWorks, setOpenWorks] = useState<WorkItem[]>([]);
  const [openProjects, setOpenProjects] = useState<Project[]>([]);
  const [workTypes, setWorkTypes] = useState<ParamOption[]>([]);
  const [projTypes, setProjTypes] = useState<ParamOption[]>([]);
  const [completedWorks, setCompletedWorks] = useState<WorkItem[]>([]);
  const [overdue, setOverdue] = useState<WorkItem[]>([]);

  async function load() {
    await autoAdvanceStatus();
    const today = fmtToday();
    const [ws, ps, works, projects, closedWorks, wt, pt] = await Promise.all([
      workStats(),
      projStats(),
      listWorkItems({ statuses: ['new', 'following'] }),
      listProjects({ statuses: ['new', 'following'] }),
      listWorkItems({ statuses: ['closed'] }),
      listByGroup('work_type'),
      listByGroup('project_type'),
    ]);
    setWork(ws);
    setProj(ps);
    setOpenWorks(works.slice(0, 6));
    setOpenProjects(projects.slice(0, 5));
    setWorkTypes(wt);
    setProjTypes(pt);
    setCompletedWorks(closedWorks);
    setOverdue(works.filter((item) => item.planned_at && item.planned_at < today).slice(0, 8));
  }

  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  }, [layouts]);
  const wtMap = useMemo(() => new Map(workTypes.map((item) => [item.id, item.name])), [workTypes]);
  const ptMap = useMemo(() => new Map(projTypes.map((item) => [item.id, item.name])), [projTypes]);
  const canvasRows = Math.max(54, ...Object.values(layouts).map((item) => item.y + item.h + 2));
  const updateLayout = (id: string, layout: DashboardLayout) =>
    setLayouts((current) => ({ ...current, [id]: layout }));

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <DashboardHeroBanner />
      <div className="dashboard-canvas" style={{ minHeight: canvasRows * DASHBOARD_ROW_HEIGHT }}>
        <div className="dashboard-section-label work-label">
          工作管理 <span>Year {new Date().getFullYear()}</span>
        </div>
        <div className="dashboard-section-label project-label">
          项目管理 <span>{proj.total} 个项目</span>
        </div>
        <Widget id="clock" layouts={layouts} update={updateLayout} minW={4} minH={7}>
          <WorldClockCard />
        </Widget>
        <Widget id="calendar" layouts={layouts} update={updateLayout} minW={5} minH={7}>
          <PerpetualCalendar />
        </Widget>
        <Widget id="workTotal" layouts={layouts} update={updateLayout} minW={2} minH={5}>
          <MetricCard
            color="blue"
            icon={<CalendarRange size={20} />}
            label="年度数量"
            value={<span className="num">{work.total}</span>}
            delta={`Year ${new Date().getFullYear()}`}
          />
        </Widget>
        <Widget id="workClosed" layouts={layouts} update={updateLayout} minW={2} minH={5}>
          <MetricCard
            color="green"
            icon={<Check size={20} />}
            label="已完成"
            value={<span className="num">{work.closed}</span>}
            delta={<span className="num">占比 {work.rate}%</span>}
            deltaTone="up"
          />
        </Widget>
        <Widget id="workOpen" layouts={layouts} update={updateLayout} minW={2} minH={5}>
          <MetricCard
            color="amber"
            icon={<Clock size={20} />}
            label="未完成"
            value={<span className="num">{work.open}</span>}
            delta={`含 ${work.highOpen} 高优先`}
          />
        </Widget>
        <Widget id="workRate" layouts={layouts} update={updateLayout} minW={2} minH={5}>
          <MetricCard
            color="purple"
            icon={<TrendingUp size={20} />}
            label="完成率"
            value={<Rate value={work.rate} />}
            delta="基线 70%"
          />
        </Widget>
        <Widget id="projectTotal" layouts={layouts} update={updateLayout} minW={2} minH={5}>
          <MetricCard
            color="cyan"
            icon={<FolderKanban size={20} />}
            label="年度项目"
            value={<span className="num">{proj.total}</span>}
            delta={`Year ${new Date().getFullYear()}`}
          />
        </Widget>
        <Widget id="projectClosed" layouts={layouts} update={updateLayout} minW={2} minH={5}>
          <MetricCard
            color="green"
            icon={<CheckCircle2 size={20} />}
            label="已闭环"
            value={<span className="num">{proj.closed}</span>}
            delta={<span className="num">占比 {proj.rate}%</span>}
            deltaTone="up"
          />
        </Widget>
        <Widget id="projectOpen" layouts={layouts} update={updateLayout} minW={2} minH={5}>
          <MetricCard
            color="amber"
            icon={<Clock size={20} />}
            label="进行中"
            value={<span className="num">{proj.open}</span>}
            delta={proj.open > 0 ? '需要跟进' : '暂无进行中'}
          />
        </Widget>
        <Widget id="projectRate" layouts={layouts} update={updateLayout} minW={2} minH={5}>
          <MetricCard
            color="pink"
            icon={<TrendingUp size={20} />}
            label="完成率"
            value={<Rate value={proj.rate} />}
            delta="基线 60%"
          />
        </Widget>
        <Widget id="openWork" layouts={layouts} update={updateLayout} minW={4} minH={8}>
          <ReportCard title="待办事项" onAll={() => nav('/work')}>
            {openWorks.length === 0 ? (
              <EmptyState text="全部完成 🎉" />
            ) : (
              <ResizableReportTable tableId="dashboard-open-work" columns={OPEN_WORK_COLUMNS}>
                <tbody>
                  {openWorks.map((item) => (
                    <tr key={item.id} className="cursor-pointer" onClick={() => nav('/work')}>
                      <td className="num text-ink-3">{item.seq_no}</td>
                      <td>
                        {item.type_id ? (
                          <span className="chip">{wtMap.get(item.type_id) ?? '—'}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="!text-left">{item.description || '(空)'}</td>
                      <td>{item.internal_pic || '—'}</td>
                      <td>
                        <PriorityChip p={item.priority} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResizableReportTable>
            )}
          </ReportCard>
        </Widget>
        <Widget id="openProject" layouts={layouts} update={updateLayout} minW={4} minH={8}>
          <ReportCard title="项目清单" onAll={() => nav('/project')}>
            {openProjects.length === 0 ? (
              <EmptyState text="暂无进行中项目" />
            ) : (
              <ResizableReportTable tableId="dashboard-open-project" columns={OPEN_PROJECT_COLUMNS}>
                <tbody>
                  {openProjects.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer"
                      onClick={() => nav(`/project/${item.id}`)}
                    >
                      <td className="num text-ink-3">{item.seq_no}</td>
                      <td className="!text-left font-medium" title={item.name}>{item.name}</td>
                      <td title={item.type_id ? ptMap.get(item.type_id) ?? '—' : '—'}>{item.type_id ? <span className="chip">{ptMap.get(item.type_id) ?? '—'}</span> : '—'}</td>
                      <td>
                        <StatusChip s={item.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResizableReportTable>
            )}
          </ReportCard>
        </Widget>
        <Widget id="focus" layouts={layouts} update={updateLayout} minW={3} minH={7}>
          <CompletionHeatmap items={completedWorks} onOpen={() => nav('/work')} />
        </Widget>
        <Widget id="overdue" layouts={layouts} update={updateLayout} minW={4} minH={7}>
          <ReportCard title="逾期红灯" badge={overdue.length}>
            {overdue.length === 0 ? (
              <EmptyState text="暂无逾期项 ✨" />
            ) : (
              <ResizableReportTable tableId="dashboard-overdue" columns={OVERDUE_COLUMNS}>
                <tbody>
                  {overdue.map((item) => (
                    <tr key={item.id} className="cursor-pointer" onClick={() => nav('/work')}>
                      <td className="num text-ink-3">{item.seq_no}</td>
                      <td className="!text-left">{item.description || '(空)'}</td>
                      <td className="num">{item.planned_at}</td>
                      <td className="num text-danger">
                        逾期 {Math.max(0, daysBetween(new Date(item.planned_at!), new Date()))} 天
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResizableReportTable>
            )}
          </ReportCard>
        </Widget>
      </div>
    </div>
  );
}

function Widget({
  id,
  layouts,
  update,
  minW,
  minH,
  children,
}: {
  id: string;
  layouts: Record<string, DashboardLayout>;
  update: (id: string, layout: DashboardLayout) => void;
  minW: number;
  minH: number;
  children: ReactNode;
}) {
  return (
    <DashboardWidget id={id} layout={layouts[id]} onChange={update} minW={minW} minH={minH}>
      {children}
    </DashboardWidget>
  );
}
function Rate({ value }: { value: number }) {
  return (
    <span className="num">
      {value}
      <span className="text-lg text-ink-3 font-medium ml-0.5">%</span>
    </span>
  );
}

type ReportColumn = {
  key: string;
  label: string;
  width: number;
  minWidth: number;
  align?: 'left' | 'center';
};

/** 看板报表的列宽独立持久化，并让卡片变窄时自然出现横向滚动。 */
function ResizableReportTable({
  tableId,
  columns,
  children,
}: {
  tableId: string;
  columns: ReportColumn[];
  children: ReactNode;
}) {
  const fallback = Object.fromEntries(columns.map((column) => [column.key, column.width]));
  const [widths, setWidths] = useState(() => loadWidths(tableId, fallback));
  const latestWidths = useRef(widths);
  const setWidth = (key: string, width: number) => {
    setWidths((current) => {
      const next = { ...current, [key]: width };
      latestWidths.current = next;
      return next;
    });
  };
  const tableWidth = columns.reduce((total, column) => total + widths[column.key], 0);

  return (
    <table
      className="table dashboard-report-table"
      style={{ width: tableWidth, tableLayout: 'fixed' }}
    >
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={{ width: widths[column.key] }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((column) => (
            <ResizableTh
              key={column.key}
              colKey={column.key}
              width={widths[column.key]}
              minWidth={column.minWidth}
              align={column.align ?? 'center'}
              className={column.align === 'left' ? '!text-left' : undefined}
              onWidthChange={(width) => setWidth(column.key, width)}
              onWidthCommit={() => saveWidths(tableId, latestWidths.current)}
            >
              {column.label}
            </ResizableTh>
          ))}
        </tr>
      </thead>
      {children}
    </table>
  );
}

function ReportCard({
  title,
  onAll,
  badge,
  children,
}: {
  title: string;
  onAll?: () => void;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <div className="card h-full flex flex-col">
      <div className="card-title shrink-0">
        <h3>{title}</h3>
        {onAll ? (
          <button className="text-[12.5px] text-accent cursor-pointer" onClick={onAll}>
            查看全部 →
          </button>
        ) : (
          <span className="chip" style={{ background: 'rgb(var(--rgb-danger))', color: '#fff' }}>
            {badge}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
function EmptyState({ text }: { text: string }) {
  return <div className="p-8 text-center text-ink-3">{text}</div>;
}
function CompletionHeatmap({ items, onOpen }: { items: WorkItem[]; onOpen: () => void }) {
  const days = Array.from({ length: 84 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (83 - index));
    return date;
  });
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = (item.completed_at || item.updated_at || '').slice(0, 10);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const total = days.reduce((sum, day) => sum + (counts.get(dateKey(day)) ?? 0), 0);
  return (
    <div className="card h-full flex flex-col">
      <div className="card-title shrink-0">
        <h3>热力图</h3>
        <button className="text-[12px] text-accent" onClick={onOpen}>
          查看工作 →
        </button>
      </div>
      <div className="card-body min-h-0 flex flex-col">
        <div className="text-[12px] text-ink-3 mb-3">
          近 12 周完成 <span className="num font-semibold text-ink">{total}</span> 项
        </div>
        <div
          className="grid grid-rows-7 grid-flow-col gap-1 justify-start"
          aria-label="近十二周工作完成热力图"
        >
          {days.map((day) => {
            const count = counts.get(dateKey(day)) ?? 0;
            const color =
              count === 0
                ? 'var(--line)'
                : count === 1
                  ? '#BFE8D3'
                  : count === 2
                    ? '#65C78C'
                    : '#218552';
            return (
              <span
                key={dateKey(day)}
                title={`${dateKey(day)}：完成 ${count} 项`}
                className="w-3 h-3 rounded-[3px]"
                style={{ background: color }}
              />
            );
          })}
        </div>
        <div className="mt-auto pt-3 flex items-center justify-between text-[11px] text-ink-4">
          <span>少</span>
          <span className="flex gap-1">
            {[0, 1, 2, 3].map((level) => (
              <i
                key={level}
                className="w-3 h-3 rounded-[3px]"
                style={{
                  background:
                    level === 0
                      ? 'var(--line)'
                      : level === 1
                        ? '#BFE8D3'
                        : level === 2
                          ? '#65C78C'
                          : '#218552',
                }}
              />
            ))}
          </span>
          <span>多</span>
        </div>
      </div>
    </div>
  );
}

function WorldClockCard() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="card h-full clock-card">
      <div className="card-title">
        <div className="flex items-center gap-2">
          <Clock size={17} className="text-accent" />
          <h3>双时区</h3>
        </div>
        <span className="text-[12px] text-ink-3">实际时间</span>
      </div>
      <div className="clock-list">
        <TimezoneClock city="中国" zone="Asia/Shanghai" now={now} />
        <div className="clock-divider" />
        <TimezoneClock city="印度" zone="Asia/Kolkata" now={now} />
      </div>
    </div>
  );
}
function TimezoneClock({ city, zone, now }: { city: string; zone: string; now: Date }) {
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (name: string) => Number(parts.find((item) => item.type === name)?.value ?? 0);
  const h = part('hour') % 12,
    m = part('minute'),
    s = part('second');
  return (
    <div className="timezone-clock">
      <div className="clock-face" aria-label={`${city}时间 ${time}`}>
        <span className="clock-number twelve">12</span>
        <span className="clock-number three">3</span>
        <span className="clock-number six">6</span>
        <span className="clock-number nine">9</span>
        <i className="clock-hand hour" style={{ transform: `rotate(${h * 30 + m * 0.5}deg)` }} />
        <i className="clock-hand minute" style={{ transform: `rotate(${m * 6}deg)` }} />
        <i className="clock-hand second" style={{ transform: `rotate(${s * 6}deg)` }} />
        <b />
      </div>
      <div>
        <div className="text-[13px] font-semibold text-ink">{city}</div>
        <div className="num text-[19px] tracking-tight text-ink">{time}</div>
        <div className="text-[11px] text-ink-3">
          {zone === 'Asia/Shanghai' ? 'UTC+8' : 'UTC+5:30'}
        </div>
      </div>
    </div>
  );
}
function PerpetualCalendar() {
  const nav = useNavigate();
  const [now, setNow] = useState(new Date());
  const [cursor, setCursor] = useState(() => new Date());
  const [weekView, setWeekView] = useState<'all' | number>('all');
  const [eventCounts, setEventCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const year = cursor.getFullYear(),
    month = cursor.getMonth(),
    todayKey = dateKey(now),
    leading = new Date(year, month, 1).getDay(),
    days = new Date(year, month + 1, 0).getDate();
  useEffect(() => {
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01T00:00`;
    const nextMonth = new Date(year, month + 1, 1);
    const to = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01T00:00`;
    let mounted = true;
    void listScheduleEvents({ from, to }).then((events) => {
      if (!mounted) return;
      setEventCounts(events.reduce((counts, event) => {
        const key = event.starts_at.slice(0, 10);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()));
    }).catch(() => mounted && setEventCounts(new Map()));
    return () => { mounted = false; };
  }, [year, month]);
  const cells = Array.from(
    { length: Math.ceil((leading + days) / 7) * 7 },
    (_, index) => index - leading + 1,
  );
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) => index + 1);
  const yearWeek = isoWeekNumber(now);
  const moveMonth = (amount: number) => {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
    setWeekView('all');
  };
  return (
    <div className="card h-full calendar-card">
      <div className="card-title">
        <div className="flex items-center gap-2">
          <CalendarDays size={17} className="text-accent" />
          <h3>
            万年历 <span className="calendar-year-week">今天是今年第 {yearWeek} 周</span>
          </h3>
        </div>
        <div className="calendar-controls">
          <button onClick={() => moveMonth(-1)} aria-label="上个月">
            <ChevronLeft size={14} />
          </button>
          <input
            type="number"
            min="1"
            max="9999"
            value={year}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 1 && value <= 9999) {
                setCursor(new Date(value, month, 1));
                setWeekView('all');
              }
            }}
            aria-label="输入年份"
          />
          <select
            value={month}
            onChange={(event) => {
              setCursor(new Date(year, Number(event.target.value), 1));
              setWeekView('all');
            }}
            aria-label="选择月份"
          >
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index} value={index}>
                {index + 1} 月
              </option>
            ))}
          </select>
          <select
            value={weekView}
            onChange={(event) =>
              setWeekView(event.target.value === 'all' ? 'all' : Number(event.target.value))
            }
            aria-label="选择周"
          >
            <option value="all">整月</option>
            {weeks.map((value) => (
              <option key={value} value={value - 1}>
                第 {value} 周
              </option>
            ))}
          </select>
          <button onClick={() => moveMonth(1)} aria-label="下个月">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        <div className="calendar-weekdays">
          {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-days">
          {cells.map((date, index) => (
            (() => {
              const inMonth = date > 0 && date <= days;
              const calendarDate = new Date(year, month, date);
              const eventCount = inMonth ? eventCounts.get(dateKey(calendarDate)) ?? 0 : 0;
              return (
                <span
                  key={index}
                  title={inMonth ? `${dateKey(calendarDate)}${eventCount ? ` · ${eventCount} 个日程` : ''}` : undefined}
                  className={`${dateKey(calendarDate) === todayKey ? 'is-today' : !inMonth ? 'is-outside' : ''} ${weekView !== 'all' && Math.floor(index / 7) !== weekView ? 'is-week-hidden' : ''}`}
                  onClick={() => inMonth && eventCount > 0 && nav(`/schedule`)}
                  role={eventCount ? 'button' : undefined}
                >
                  {inMonth && (
                    <>
                      <b>{date}</b>
                      {eventCount > 0 && <i className="calendar-event-count">{eventCount}</i>}
                    </>
                  )}
                </span>
              );
            })()
          ))}
        </div>
      </div>
    </div>
  );
}

function readLayouts() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}') as Record<
      string,
      DashboardLayout
    >;
    return Object.fromEntries(
      Object.entries(DEFAULT_LAYOUTS).map(([id, fallback]) => [
        id,
        isLayout(saved[id]) ? saved[id] : fallback,
      ]),
    );
  } catch {
    return DEFAULT_LAYOUTS;
  }
}
function isLayout(value: unknown): value is DashboardLayout {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['x', 'y', 'w', 'h'].every((key) => typeof (value as Record<string, unknown>)[key] === 'number')
  );
}
function fmtToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function isoWeekNumber(date: Date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
