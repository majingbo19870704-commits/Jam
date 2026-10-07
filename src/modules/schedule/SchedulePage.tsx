import {
  Bell,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { save as saveFile } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

import {
  createScheduleEvent,
  deleteScheduleOccurrence,
  deleteScheduleEvent,
  findScheduleConflicts,
  importScheduleEvents,
  listScheduleEvents,
  listScheduleOccurrences,
  updateScheduleEvent,
} from '@/db/schedule-event-dao';
import { listScheduleTypes, type ScheduleType } from '@/db/schedule-type-dao';
import { exportIcs, parseIcs } from '@/lib/schedule-ics';
import { cn } from '@/lib/utils';
import type { ScheduleEvent, ScheduleEventRepeat } from '@/types';

type View = 'list' | 'week' | 'month';
type ScheduleListFilters = {
  start: string;
  end: string;
  type: string;
  progress: 'all' | 'open' | 'done';
  keyword: string;
};

const HOUR_HEIGHT = 76;
const START_HOUR = 8;
const END_HOUR = 22;
const SLOT_HOURS = 2;

const DEFAULT_EVENT_COLOR = '#4D7CFE';

function dateKey(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateTimeValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseDate(value: string) {
  return new Date(value.replace(' ', 'T'));
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function mondayOf(date: Date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function formatRange(start: Date, end: Date) {
  const left = `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日`;
  const right =
    end.getFullYear() === start.getFullYear() && end.getMonth() === start.getMonth()
      ? `${end.getDate()}日`
      : `${end.getMonth() + 1}月${end.getDate()}日`;
  return `${left} – ${right}`;
}

function dayLabel(date: Date) {
  return `周${'一二三四五六日'[(date.getDay() + 6) % 7]}`;
}

function timeLabel(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function nextHalfHour() {
  const value = new Date();
  value.setSeconds(0, 0);
  value.setMinutes(Math.ceil(value.getMinutes() / 30) * 30);
  return value;
}

function eventType(event: ScheduleEvent, types: ScheduleType[]) {
  return (
    types.find((item) => item.id === event.type_id) ??
    types.find((item) => item.color === event.color) ??
    types[0] ?? { id: 'default', name: '日程', color: event.color || DEFAULT_EVENT_COLOR }
  );
}

function eventDurationMinutes(event: ScheduleEvent) {
  if (!event.ends_at) return 30;
  return Math.max(
    30,
    (parseDate(event.ends_at).getTime() - parseDate(event.starts_at).getTime()) / 60_000,
  );
}

function initialEvent(start = nextHalfHour(), title = ''): Partial<ScheduleEvent> {
  const end = new Date(start.getTime() + 60 * 60_000);
  return {
    title,
    starts_at: dateTimeValue(start),
    ends_at: dateTimeValue(end),
    all_day: 0,
    reminder_repeat: 'none',
    color: DEFAULT_EVENT_COLOR,
  };
}

function defaultListFilters(): ScheduleListFilters {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, 7);
  end.setHours(23, 59, 0, 0);
  return {
    start: dateTimeValue(start),
    end: dateTimeValue(end),
    type: 'all',
    progress: 'open',
    keyword: '',
  };
}

function emptyListFilters(): ScheduleListFilters {
  return { start: '', end: '', type: 'all', progress: 'all', keyword: '' };
}

export function SchedulePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<View>(() => {
    const requested = searchParams.get('view');
    return requested === 'list' || requested === 'month' ? requested : 'week';
  });
  const [cursor, setCursor] = useState(() => {
    const value = searchParams.get('date');
    return value ? new Date(`${value}T12:00:00`) : new Date();
  });
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [types, setTypes] = useState<ScheduleType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Partial<ScheduleEvent> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleEvent | null>(null);
  const [quickAdd, setQuickAdd] = useState('');
  const [listStart, setListStart] = useState(() => defaultListFilters().start);
  const [listEnd, setListEnd] = useState(() => defaultListFilters().end);
  const [listType, setListType] = useState('all');
  const [listProgress, setListProgress] = useState<'all' | 'open' | 'done'>('open');
  const [listKeyword, setListKeyword] = useState('');
  const [appliedListFilters, setAppliedListFilters] = useState<ScheduleListFilters>(() =>
    defaultListFilters(),
  );
  const [enabledCalendars, setEnabledCalendars] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(new Date());
  const fileRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const loadVersionRef = useRef(0);
  const scheduleDragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    active: boolean;
    cleanUp: () => void;
  } | null>(null);
  const [draggingScheduleId, setDraggingScheduleId] = useState<string | null>(null);

  const range = useMemo(() => {
    if (view === 'month') {
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      return { start, end: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) };
    }
    if (view === 'list') {
      const start = new Date(appliedListFilters.start || '2000-01-01T00:00:00');
      const end = new Date(appliedListFilters.end || '2100-01-01T00:00:00');
      return { start, end: addDays(end, 1) };
    }
    const start = mondayOf(cursor);
    return { start, end: addDays(start, 7) };
  }, [appliedListFilters.end, appliedListFilters.start, cursor, view]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(mondayOf(cursor), index)),
    [cursor],
  );
  const selected = events.find((event) => event.id === selectedId) ?? null;
  const visibleEvents = useMemo(
    () => events.filter((event) => enabledCalendars.has(eventType(event, types).id)),
    [enabledCalendars, events, types],
  );

  const load = useCallback(async () => {
    const version = ++loadVersionRef.current;
    const unboundedList = view === 'list' && !appliedListFilters.start && !appliedListFilters.end;
    const [nextEvents, nextTypes] = await Promise.all([
      unboundedList
        ? listScheduleEvents()
        : listScheduleOccurrences({ from: dateKey(range.start), to: dateKey(range.end) }),
      listScheduleTypes(),
    ]);
    // 搜索与重置连续点击时，旧查询可能更晚完成；仅采纳最后一次请求的结果。
    if (version !== loadVersionRef.current) return;
    setEvents(nextEvents);
    setTypes(nextTypes);
    setEnabledCalendars((current) =>
      current.size ? current : new Set(nextTypes.map((item) => item.id)),
    );
  }, [appliedListFilters.end, appliedListFilters.start, range.end, range.start, view]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSearchParams({ view, date: dateKey(cursor) }, { replace: true });
  }, [cursor, setSearchParams, view]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const save = async (input: Partial<ScheduleEvent>) => {
    if (!input.title?.trim() || !input.starts_at) return;
    const payload = {
      title: input.title.trim(),
      starts_at: input.starts_at,
      ends_at: input.ends_at || null,
      all_day: input.all_day ? 1 : 0,
      reminder_at: input.reminder_at || null,
      reminder_repeat: (input.reminder_repeat ?? 'none') as ScheduleEventRepeat,
      type_id: input.type_id || types.find((item) => item.color === input.color)?.id || null,
      color: input.color || DEFAULT_EVENT_COLOR,
      repeat_until: input.repeat_until || null,
      repeat_exdates: input.repeat_exdates || '[]',
      notes: input.notes?.trim() || null,
      completed_at: input.completed_at || null,
    };
    const conflicts = await findScheduleConflicts(payload, input.id);
    if (
      conflicts.length &&
      !window.confirm(
        `此日程与 ${conflicts.length} 项已有日程时间重叠：\n${conflicts
          .slice(0, 3)
          .map((item) => `• ${item.title}`)
          .join('\n')}\n\n仍要保存吗？`,
      )
    )
      return;
    if (input.id) await updateScheduleEvent(input.id, payload);
    const saved = input.id ? { id: input.id } : await createScheduleEvent(payload);
    setEditor(null);
    setSelectedId(saved.id);
    setNotice(input.id ? '日程已更新' : '日程已创建');
    await load();
  };

  const prepareMoveEvent = (id: string, date: Date, minuteOfDay?: number) => {
    const event = events.find((item) => item.id === id);
    if (!event) return;
    const previous = parseDate(event.starts_at);
    const start = new Date(date);
    if (minuteOfDay === undefined) start.setHours(previous.getHours(), previous.getMinutes(), 0, 0);
    else start.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
    const end = event.ends_at
      ? new Date(start.getTime() + (parseDate(event.ends_at).getTime() - previous.getTime()))
      : null;
    // 重复项是为视图展开的实例；编辑源日程时明确以“整个系列”为单位处理。
    setSelectedId(event.id);
    setEditor({
      ...event,
      id: event.recurrence_source_id || event.id,
      starts_at: dateTimeValue(start),
      ends_at: end ? dateTimeValue(end) : null,
    });
    if (event.recurrence_source_id) setNotice('已载入重复日程系列，请确认新的日期和时间后保存');
  };

  const startScheduleDrag = (id: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    scheduleDragRef.current?.cleanUp();
    const drag = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      cleanUp: () => undefined,
    };
    const finish = (pointer: PointerEvent) => {
      if (scheduleDragRef.current !== drag) return;
      scheduleDragRef.current = null;
      setDraggingScheduleId(null);
      drag.cleanUp();
      if (!drag.active) return;
      const target = document
        .elementFromPoint(pointer.clientX, pointer.clientY)
        ?.closest<HTMLElement>('[data-schedule-drop]');
      const targetDate = target?.dataset.scheduleDate;
      if (!targetDate) return;
      const date = new Date(`${targetDate}T12:00:00`);
      const minutes = target?.dataset.scheduleMinutes;
      prepareMoveEvent(
        id,
        date,
        minutes === undefined || minutes === '' ? undefined : Number(minutes),
      );
    };
    const move = (pointer: PointerEvent) => {
      if (
        !drag.active &&
        Math.hypot(pointer.clientX - drag.startX, pointer.clientY - drag.startY) < 6
      )
        return;
      drag.active = true;
      pointer.preventDefault();
      setDraggingScheduleId(id);
    };
    drag.cleanUp = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', finish, true);
    };
    scheduleDragRef.current = drag;
    setSelectedId(id);
    document.addEventListener('pointermove', move, { capture: true, passive: false });
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', finish, true);
  };

  const openListForRange = (start: Date, end: Date) => {
    const startValue = dateTimeValue(start);
    const endValue = dateTimeValue(end);
    setCursor(start);
    setListStart(startValue);
    setListEnd(endValue);
    setAppliedListFilters({
      start: startValue,
      end: endValue,
      type: 'all',
      progress: 'open',
      keyword: '',
    });
    setView('list');
  };

  const toggleCompleted = async (event: ScheduleEvent) => {
    await updateScheduleEvent(event.recurrence_source_id || event.id, {
      completed_at: event.completed_at ? null : new Date().toISOString(),
    });
    setNotice(event.completed_at ? '日程已恢复为未完成' : '日程已完成');
    await load();
  };

  const remove = async (scope: 'once' | 'series' = 'series') => {
    if (!deleteTarget) return;
    try {
      // 周/月视图里的重复项是展示用实例（sourceId@日期），数据库中实际保存的是源日程。
      // 删除时必须定位源记录，否则 SQL 不会命中任何行，表面上就会像“无法删除”。
      const targetId = deleteTarget.recurrence_source_id || deleteTarget.id;
      if (scope === 'once' && deleteTarget.recurrence_source_id) {
        await deleteScheduleOccurrence(targetId, deleteTarget.starts_at);
      } else {
        const removed = await deleteScheduleEvent(targetId);
        if (!removed) throw new Error('没有找到可删除的日程记录。');
      }
      setSelectedId(null);
      setDeleteTarget(null);
      setNotice(
        scope === 'once' && deleteTarget.recurrence_source_id
          ? '已删除本次重复日程'
          : deleteTarget.recurrence_source_id
            ? '重复日程系列已删除'
            : '日程已删除',
      );
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setNotice(`删除失败：${message}`);
    }
  };

  const handleQuickAdd = () => {
    const text = quickAdd.trim();
    if (!text) return;
    const lowered = text.replace(/[，。]/g, ' ');
    const offset = /后天/.test(lowered) ? 2 : /明天/.test(lowered) ? 1 : 0;
    const start = new Date();
    start.setDate(start.getDate() + offset);
    const time = lowered.match(/(?:上午|下午|晚上)?\s*(\d{1,2})(?:[:：](\d{2}))?\s*(?:点|时)/);
    if (time) {
      let hour = Number(time[1]);
      if (/(下午|晚上)/.test(time[0]) && hour < 12) hour += 12;
      start.setHours(hour, Number(time[2] ?? 0), 0, 0);
    } else {
      const suggested = nextHalfHour();
      start.setHours(suggested.getHours(), suggested.getMinutes(), 0, 0);
    }
    const duration = Number(lowered.match(/(\d+)\s*分钟/)?.[1] ?? 60);
    const title =
      lowered
        .replace(/明天|后天|今天|上午|下午|晚上/g, '')
        .replace(/\d{1,2}(?:[:：]\d{2})?\s*(?:点|时)?/g, '')
        .replace(/\d+\s*分钟/g, '')
        .trim() || '新日程';
    const event = initialEvent(start, title);
    event.ends_at = dateTimeValue(new Date(start.getTime() + duration * 60_000));
    setQuickAdd('');
    setEditor(event);
  };

  const downloadIcs = async () => {
    const content = exportIcs(events);
    const defaultPath = `日程-${dateKey(new Date())}.ics`;
    try {
      const path = await saveFile({
        defaultPath,
        filters: [{ name: 'iCalendar 日程', extensions: ['ics'] }],
      });
      if (!path) return;
      await writeTextFile(path, content);
      setNotice('ICS 日程文件已导出');
    } catch {
      // 浏览器预览中没有原生文件对话框时，仍提供可用下载。
      const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = defaultPath;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice('已开始下载 ICS 日程文件');
    }
  };

  const importIcs = async (file: File | undefined) => {
    if (!file) return;
    const result = parseIcs(await file.text());
    if (!result.length) {
      setNotice('没有识别到可导入的日程');
      return;
    }
    await importScheduleEvents(result);
    setNotice(`已导入 ${result.length} 条日程`);
    await load();
  };

  const toggleCalendar = (calendar: string) => {
    setEnabledCalendars((current) => {
      const next = new Set(current);
      if (next.has(calendar)) next.delete(calendar);
      else next.add(calendar);
      return next;
    });
  };

  const shift = (amount: number) => {
    setCursor((current) =>
      view === 'month'
        ? new Date(current.getFullYear(), current.getMonth() + amount, 1)
        : addDays(current, amount * 7),
    );
  };

  const todaySchedules = visibleEvents
    .filter((event) => dateKey(parseDate(event.starts_at)) === dateKey(new Date()))
    .slice(0, 8);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-h-12 flex-wrap items-center justify-start gap-x-4 gap-y-2 border-b border-line px-[2em] pb-2">
        <div className="flex flex-wrap items-center justify-start gap-2">
          <h1 className="mr-2 text-xl font-semibold tracking-tight text-text">
            {view === 'month'
              ? `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
              : formatRange(range.start, addDays(range.end, -1))}
          </h1>
          <button
            type="button"
            className="icon-btn"
            aria-label="上一段时间"
            onClick={() => shift(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="下一段时间"
            onClick={() => shift(1)}
          >
            <ChevronRight size={18} />
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setCursor(new Date())}>
            今天
          </button>
          <div
            className="ml-1 flex flex-wrap items-center gap-1.5 border-l border-line pl-3"
            aria-label="日程类型筛选"
          >
            {types.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleCalendar(item.id)}
                className={cn(
                  'flex items-center gap-1 rounded-full px-1.5 py-1 text-xs transition',
                  enabledCalendars.has(item.id)
                    ? 'text-text hover:bg-bg'
                    : 'opacity-40 hover:opacity-70',
                )}
                aria-pressed={enabledCalendars.has(item.id)}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                {item.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          className="flex w-full max-w-[645px] items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            handleQuickAdd();
          }}
        >
          <input
            value={quickAdd}
            onChange={(event) => setQuickAdd(event.target.value)}
            className="input-lite min-w-0 flex-1"
            placeholder="明天下午3点 英语口语课 30分钟"
            aria-label="快速添加日程"
          />
          <button type="submit" className="btn btn-secondary whitespace-nowrap">
            快速创建
          </button>
        </form>
        <div className="flex items-center gap-2">
          <div
            className="flex rounded-lg border border-line p-0.5"
            role="group"
            aria-label="日程视图"
          >
            {(
              [
                ['list', '日程列表'],
                ['week', '周'],
                ['month', '月'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium',
                  view === value ? 'bg-accent text-white' : 'text-muted hover:text-text',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEditor(initialEvent())}
          >
            <Plus size={16} />
            新建日程
          </button>
          <button
            type="button"
            className="icon-btn"
            title="导入 ICS"
            aria-label="导入 ICS"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={17} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="导出 ICS"
            aria-label="导出 ICS"
            onClick={() => void downloadIcs()}
          >
            <Download size={17} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".ics,text/calendar"
            className="hidden"
            onChange={(event) => void importIcs(event.target.files?.[0])}
          />
        </div>
      </div>

      <div className="grid min-h-0 w-full flex-1 gap-3 overflow-x-hidden xl:grid-cols-[minmax(0,1fr)_minmax(0,260px)]">
        <section className="min-w-0">
          {view === 'week' ? (
            <WeekCalendar
              days={days}
              events={visibleEvents}
              now={now}
              selectedId={selectedId}
              gridRef={gridRef}
              onSelect={setSelectedId}
              onCreate={(date) => setEditor(initialEvent(date))}
              onStartDrag={startScheduleDrag}
              draggingId={draggingScheduleId}
              onOpenSlot={(date, startMinutes, endMinutes) => {
                const start = new Date(date);
                start.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
                const end = new Date(date);
                // 列表筛选的结束值为包含边界，减一分钟以免把下一时间格的日程带入。
                const inclusiveEnd = endMinutes - 1;
                end.setHours(Math.floor(inclusiveEnd / 60), inclusiveEnd % 60, 0, 0);
                openListForRange(start, end);
              }}
              types={types}
            />
          ) : view === 'month' ? (
            <MonthCalendar
              cursor={cursor}
              events={visibleEvents}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCreate={(date) => setEditor(initialEvent(date))}
              types={types}
              onStartDrag={startScheduleDrag}
              draggingId={draggingScheduleId}
            />
          ) : (
            <ScheduleList
              events={visibleEvents}
              types={types}
              selectedId={selectedId}
              start={listStart}
              end={listEnd}
              type={listType}
              progress={listProgress}
              keyword={listKeyword}
              applied={appliedListFilters}
              onStart={setListStart}
              onEnd={setListEnd}
              onType={setListType}
              onProgress={setListProgress}
              onKeyword={setListKeyword}
              onSearch={() => {
                setAppliedListFilters({
                  start: listStart,
                  end: listEnd,
                  type: listType,
                  progress: listProgress,
                  keyword: listKeyword,
                });
                setNotice('已按筛选条件查询');
              }}
              onReset={() => {
                const filters = emptyListFilters();
                const needsReload =
                  Boolean(
                    appliedListFilters.start ||
                    appliedListFilters.end ||
                    appliedListFilters.keyword,
                  ) ||
                  appliedListFilters.type !== 'all' ||
                  appliedListFilters.progress !== 'all';
                // 只有当前查询确实带筛选时才取消旧请求并重新加载。
                // 已经是“全部日程”时重复点击保持现有数据和在途请求，确保重置幂等。
                if (needsReload) {
                  loadVersionRef.current += 1;
                  setEvents([]);
                }
                setListStart(filters.start);
                setListEnd(filters.end);
                setListType(filters.type);
                setListProgress(filters.progress);
                setListKeyword(filters.keyword);
                setAppliedListFilters(filters);
                setNotice('已清除筛选条件，显示全部日程');
              }}
              onSelect={setSelectedId}
              onToggle={(event) => void toggleCompleted(event)}
            />
          )}
        </section>

        <aside className="min-w-0 w-full space-y-3">
          <ScheduleDetail
            event={selected}
            types={types}
            onEdit={() =>
              selected &&
              setEditor({ ...selected, id: selected.recurrence_source_id || selected.id })
            }
            onDelete={() => selected && setDeleteTarget(selected)}
          />
          <TodoPanel
            items={todaySchedules}
            types={types}
            onToggle={(event) => void toggleCompleted(event)}
          />
        </aside>
      </div>

      {notice && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-line bg-surface px-4 py-2 text-sm shadow-lg">
          {notice}
          <button
            type="button"
            className="ml-3 text-muted hover:text-text"
            onClick={() => setNotice('')}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <EventModal
        initial={editor}
        types={types}
        onClose={() => setEditor(null)}
        onSave={(event) => void save(event)}
      />
      {deleteTarget?.recurrence_source_id ? (
        <RepeatDeleteDialog
          event={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleteOnce={() => void remove('once')}
          onDeleteSeries={() => void remove('series')}
        />
      ) : (
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title="删除日程"
          description={`确认删除“${deleteTarget?.title ?? ''}”？此操作可在数据库备份中恢复。`}
          confirmLabel="删除"
          danger
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}

function WeekCalendar({
  days,
  events,
  now,
  selectedId,
  gridRef,
  onSelect,
  onCreate,
  onStartDrag,
  draggingId,
  onOpenSlot,
  types,
}: {
  days: Date[];
  events: ScheduleEvent[];
  now: Date;
  selectedId: string | null;
  gridRef: { current: HTMLDivElement | null };
  onSelect: (id: string) => void;
  onCreate: (date: Date) => void;
  onStartDrag: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  draggingId: string | null;
  onOpenSlot: (date: Date, startMinutes: number, endMinutes: number) => void;
  types: ScheduleType[];
}) {
  const dayEvents = (day: Date) =>
    events.filter((event) => dateKey(parseDate(event.starts_at)) === dateKey(day));
  const timedEvents = (day: Date) => dayEvents(day).filter((event) => !event.all_day);
  const allDayEvents = (day: Date) => dayEvents(day).filter((event) => event.all_day);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div className="min-w-[800px] overflow-x-auto">
        <div
          className="grid border-b border-line"
          style={{ gridTemplateColumns: '62px repeat(7, minmax(102px, 1fr))' }}
        >
          <div />
          {days.map((day) => {
            const isToday = dateKey(day) === dateKey(now);
            return (
              <div
                key={dateKey(day)}
                className={cn(
                  'flex h-9 items-center justify-center gap-1.5 border-l border-line text-sm text-muted',
                  isToday && 'bg-accent/5 text-accent',
                )}
              >
                <span>{dayLabel(day)}</span>
                <strong
                  className={cn(
                    'text-base text-text',
                    isToday && 'grid h-6 w-6 place-items-center rounded-full bg-accent text-white',
                  )}
                >
                  {day.getDate()}
                </strong>
              </div>
            );
          })}
        </div>
        <div
          className="grid border-b border-line"
          style={{ gridTemplateColumns: '62px repeat(7, minmax(102px, 1fr))' }}
        >
          <div className="grid place-items-center text-xs text-muted">全天</div>
          {days.map((day) => (
            <AllDayColumn
              key={dateKey(day)}
              date={day}
              events={allDayEvents(day)}
              selectedId={selectedId}
              onSelect={onSelect}
              onStartDrag={onStartDrag}
              draggingId={draggingId}
              types={types}
            />
          ))}
        </div>
        <div ref={gridRef}>
          <div
            className="grid"
            style={{ gridTemplateColumns: '62px repeat(7, minmax(102px, 1fr))' }}
          >
            <TimeAxis />
            {days.map((day) => (
              <TimeColumn
                key={dateKey(day)}
                date={day}
                events={timedEvents(day)}
                selectedId={selectedId}
                onSelect={onSelect}
                onCreate={onCreate}
                onStartDrag={onStartDrag}
                draggingId={draggingId}
                onOpenSlot={onOpenSlot}
                types={types}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimeAxis() {
  const slots = (END_HOUR - START_HOUR) / SLOT_HOURS;
  return (
    <div className="relative" style={{ height: slots * HOUR_HEIGHT }}>
      {Array.from({ length: slots }, (_, index) => (
        <div
          key={index}
          className="grid place-items-center border-b border-line text-xs text-muted"
          style={{ height: HOUR_HEIGHT }}
        >
          {String(START_HOUR + index * SLOT_HOURS).padStart(2, '0')}:00
        </div>
      ))}
    </div>
  );
}

function AllDayColumn({
  date,
  events,
  selectedId,
  onSelect,
  onStartDrag,
  draggingId,
  types,
}: {
  date: Date;
  events: ScheduleEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStartDrag: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  draggingId: string | null;
  types: ScheduleType[];
}) {
  return (
    <div
      data-schedule-drop="all-day"
      data-schedule-date={dateKey(date)}
      className="flex flex-col justify-center border-l border-line p-1"
      style={{ minHeight: HOUR_HEIGHT }}
    >
      {events.map((event) => (
        <EventChip
          key={event.id}
          event={event}
          types={types}
          selected={event.id === selectedId}
          dragging={event.id === draggingId}
          onSelect={onSelect}
          onStartDrag={onStartDrag}
        />
      ))}
    </div>
  );
}

function TimeColumn({
  date,
  events,
  selectedId,
  onSelect,
  onCreate,
  onStartDrag,
  draggingId,
  onOpenSlot,
  types,
}: {
  date: Date;
  events: ScheduleEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (date: Date) => void;
  onStartDrag: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  draggingId: string | null;
  onOpenSlot: (date: Date, startMinutes: number, endMinutes: number) => void;
  types: ScheduleType[];
}) {
  const totalHeight = ((END_HOUR - START_HOUR) / SLOT_HOURS) * HOUR_HEIGHT;
  const slots = (END_HOUR - START_HOUR) / SLOT_HOURS;
  const eventsForSlot = (index: number) =>
    events
      .filter((event) => {
        const start = parseDate(event.starts_at);
        const minutes = start.getHours() * 60 + start.getMinutes();
        return (
          Math.max(
            0,
            Math.min(slots - 1, Math.floor((minutes - START_HOUR * 60) / (SLOT_HOURS * 60))),
          ) === index
        );
      })
      .sort((left, right) => left.starts_at.localeCompare(right.starts_at));
  return (
    <div className="relative border-l border-line" style={{ height: totalHeight }}>
      {Array.from({ length: slots }, (_, index) => {
        const slotEvents = eventsForSlot(index);
        const startMinutes = START_HOUR * 60 + index * SLOT_HOURS * 60;
        const endMinutes = startMinutes + SLOT_HOURS * 60;
        return (
          <div
            key={index}
            data-schedule-drop="time"
            data-schedule-date={dateKey(date)}
            data-schedule-minutes={startMinutes}
            className="relative border-b border-line p-1"
            style={{ height: HOUR_HEIGHT }}
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              const value = new Date(date);
              value.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
              onCreate(value);
            }}
          >
            {slotEvents.slice(0, 2).map((event) => (
              <TimedEvent
                key={event.id}
                event={event}
                types={types}
                selected={event.id === selectedId}
                dragging={event.id === draggingId}
                onSelect={onSelect}
                onStartDrag={onStartDrag}
              />
            ))}
            {slotEvents.length > 2 && (
              <button
                type="button"
                className="mt-0.5 block max-w-full truncate px-1 text-left text-[11px] font-medium text-accent hover:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenSlot(date, startMinutes, endMinutes);
                }}
              >
                还有 {slotEvents.length - 2} 项
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TimedEvent({
  event,
  types,
  selected,
  dragging,
  onSelect,
  onStartDrag,
}: {
  event: ScheduleEvent;
  types: ScheduleType[];
  selected: boolean;
  dragging: boolean;
  onSelect: (id: string) => void;
  onStartDrag: (id: string, event: React.PointerEvent<HTMLElement>) => void;
}) {
  const start = parseDate(event.starts_at);
  const type = eventType(event, types);
  return (
    <div
      className={cn(
        'mb-0.5 h-6 w-full touch-none cursor-grab overflow-hidden active:cursor-grabbing',
        selected && 'bg-accent/10 ring-1 ring-accent',
        dragging && 'opacity-45',
      )}
      title={`${type.name} · ${event.title} ${timeLabel(start)}`}
      onPointerDown={(pointer) => onStartDrag(event.id, pointer)}
    >
      <button
        type="button"
        className="flex h-full w-full items-center gap-1 overflow-hidden px-1 text-left text-xs"
        onClick={(click) => {
          click.stopPropagation();
          onSelect(event.id);
        }}
      >
        <span className="shrink-0 text-[10px] text-muted">{timeLabel(start)}</span>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: type.color }} />
        <span
          className={cn(
            'truncate font-medium text-text',
            event.completed_at && 'text-muted line-through',
          )}
        >
          {event.title}
        </span>
      </button>
    </div>
  );
}

function EventChip({
  event,
  types,
  selected,
  dragging,
  onSelect,
  onStartDrag,
}: {
  event: ScheduleEvent;
  types: ScheduleType[];
  selected: boolean;
  dragging: boolean;
  onSelect: (id: string) => void;
  onStartDrag: (id: string, event: React.PointerEvent<HTMLElement>) => void;
}) {
  const type = eventType(event, types);
  return (
    <div
      className={cn(
        'mb-1 w-full touch-none cursor-grab overflow-hidden active:cursor-grabbing',
        selected && 'rounded bg-accent/10 ring-1 ring-accent',
        dragging && 'opacity-45',
      )}
      title={`${type.name} · ${event.title}`}
      onPointerDown={(pointer) => onStartDrag(event.id, pointer)}
    >
      <button
        type="button"
        onClick={(click) => {
          click.stopPropagation();
          onSelect(event.id);
        }}
        className="flex w-full items-center gap-1 overflow-hidden px-1 py-0.5 text-left text-xs"
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: type.color }} />
        <span className={cn('truncate text-text', event.completed_at && 'text-muted line-through')}>
          {event.title}
        </span>
      </button>
    </div>
  );
}

function MonthCalendar({
  cursor,
  events,
  selectedId,
  onSelect,
  onCreate,
  onStartDrag,
  draggingId,
  types,
}: {
  cursor: Date;
  events: ScheduleEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (date: Date) => void;
  onStartDrag: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  draggingId: string | null;
  types: ScheduleType[];
}) {
  const first = mondayOf(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const cells = Array.from({ length: 42 }, (_, index) => addDays(first, index));
  const today = dateKey(new Date());
  const clickTimer = useRef<number | null>(null);
  const createAfterClick = (date: Date) => {
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => onCreate(date), 220);
  };
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div className="grid grid-cols-7 border-b border-line">
        {'一二三四五六日'.split('').map((label) => (
          <div key={label} className="py-2 text-center text-sm font-medium text-muted">
            周{label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date) => {
          const inMonth = date.getMonth() === cursor.getMonth();
          const list = events.filter(
            (event) => dateKey(parseDate(event.starts_at)) === dateKey(date),
          );
          return (
            <div
              key={dateKey(date)}
              data-schedule-drop="month"
              data-schedule-date={dateKey(date)}
              className={cn(
                'min-h-[104px] border-b border-r border-line p-1.5',
                !inMonth && 'bg-bg text-muted',
              )}
              onClick={() => createAfterClick(date)}
            >
              <div
                className={cn(
                  'mb-1 grid h-6 w-6 place-items-center rounded-full text-xs',
                  dateKey(date) === today && 'bg-accent font-semibold text-white',
                )}
              >
                {date.getDate()}
              </div>
              {list.slice(0, 3).map((event) => (
                <EventChip
                  key={event.id}
                  event={event}
                  types={types}
                  selected={event.id === selectedId}
                  dragging={event.id === draggingId}
                  onSelect={onSelect}
                  onStartDrag={onStartDrag}
                />
              ))}
              {list.length > 3 && (
                <p className="px-1 text-xs text-muted">还有 {list.length - 3} 项</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleList({
  events,
  types,
  selectedId,
  start,
  end,
  type,
  progress,
  keyword,
  applied,
  onStart,
  onEnd,
  onType,
  onProgress,
  onKeyword,
  onSearch,
  onReset,
  onSelect,
  onToggle,
}: {
  events: ScheduleEvent[];
  types: ScheduleType[];
  selectedId: string | null;
  start: string;
  end: string;
  type: string;
  progress: 'all' | 'open' | 'done';
  keyword: string;
  applied: ScheduleListFilters;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  onType: (value: string) => void;
  onProgress: (value: 'all' | 'open' | 'done') => void;
  onKeyword: (value: string) => void;
  onSearch: () => void;
  onReset: () => void;
  onSelect: (id: string) => void;
  onToggle: (event: ScheduleEvent) => void;
}) {
  const [widths, setWidths] = useState({
    date: 110,
    time: 112,
    title: 230,
    note: 180,
    type: 108,
    progress: 56,
  });
  const startResize = (key: keyof typeof widths, event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const initialX = event.clientX;
    const initialWidth = widths[key];
    const move = (pointer: PointerEvent) =>
      setWidths((current) => ({
        ...current,
        [key]: Math.max(key === 'progress' ? 56 : 88, initialWidth + pointer.clientX - initialX),
      }));
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
  };
  const columns = `${widths.date}px ${widths.time}px minmax(${widths.title}px, 1fr) ${widths.note}px ${widths.type}px ${widths.progress}px`;
  const filtered = events.filter((event) => {
    const eventStart = parseDate(event.starts_at);
    const matchedProgress =
      applied.progress === 'all' ||
      (applied.progress === 'done' ? Boolean(event.completed_at) : !event.completed_at);
    const startsAt = dateTimeValue(eventStart);
    const query = applied.keyword.trim().toLowerCase();
    return (
      (!applied.start || startsAt >= applied.start) &&
      (!applied.end || startsAt <= applied.end) &&
      (applied.type === 'all' || eventType(event, types).id === applied.type) &&
      matchedProgress &&
      (!query || `${event.title}\n${event.notes ?? ''}`.toLowerCase().includes(query))
    );
  });
  const header = (key: keyof typeof widths, label: string, center = false) => (
    <span className={cn('relative min-w-0 pr-2', center && 'text-center')}>
      {label}
      <span
        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-accent/30"
        onPointerDown={(event) => startResize(key, event)}
      />
    </span>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
      <div className="flex min-w-[720px] flex-wrap items-center gap-2 border-b border-line bg-bg p-2">
        <input
          type="datetime-local"
          value={start}
          onChange={(event) => onStart(event.target.value)}
          className="input-lite w-[172px] py-1.5 text-xs"
          aria-label="起始日期和时间"
        />
        <span className="text-xs text-muted">至</span>
        <input
          type="datetime-local"
          value={end}
          onChange={(event) => onEnd(event.target.value)}
          className="input-lite w-[172px] py-1.5 text-xs"
          aria-label="终止日期和时间"
        />
        <select
          value={type}
          onChange={(event) => onType(event.target.value)}
          className="input-lite w-28 py-1.5 text-xs"
          aria-label="按类型筛选"
        >
          <option value="all">全部类型</option>
          {types.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          value={progress}
          onChange={(event) => onProgress(event.target.value as typeof progress)}
          className="input-lite w-28 py-1.5 text-xs"
          aria-label="按进度筛选"
        >
          <option value="all">全部进度</option>
          <option value="open">未完成</option>
          <option value="done">已完成</option>
        </select>
        <input
          value={keyword}
          onChange={(event) => onKeyword(event.target.value)}
          className="input-lite w-32 py-1.5 text-xs"
          placeholder="搜索日程和备注"
          aria-label="搜索日程内容"
        />
        <button type="button" className="btn btn-primary py-1.5 text-xs" onClick={onSearch}>
          搜索
        </button>
        <button type="button" className="btn btn-secondary py-1.5 text-xs" onClick={onReset}>
          重置
        </button>
      </div>
      <div className="min-w-[720px]">
        <div
          className="grid border-b border-line bg-bg px-4 py-2 text-xs font-medium text-muted"
          style={{ gridTemplateColumns: columns }}
        >
          {header('date', '日期')}
          {header('time', '时间段')}
          {header('title', '日程')}
          {header('note', '备注')}
          {header('type', '类型')}
          {header('progress', '进度', true)}
        </div>
        {filtered.length ? (
          <ul className="divide-y divide-line">
            {filtered.map((event) => {
              const eventStart = parseDate(event.starts_at);
              const itemType = eventType(event, types);
              const eventEnd = new Date(
                eventStart.getTime() + eventDurationMinutes(event) * 60_000,
              );
              return (
                <li
                  key={event.id}
                  className={cn(
                    'grid items-center px-4 py-3 hover:bg-bg',
                    event.id === selectedId && 'bg-accent/5',
                  )}
                  style={{ gridTemplateColumns: columns }}
                >
                  <button
                    type="button"
                    className="truncate text-left text-sm text-muted"
                    onClick={() => onSelect(event.id)}
                  >{`${eventStart.getMonth() + 1}月${eventStart.getDate()}日`}</button>
                  <button
                    type="button"
                    className="truncate text-left text-sm text-muted"
                    onClick={() => onSelect(event.id)}
                  >
                    {event.all_day ? '全天' : `${timeLabel(eventStart)}–${timeLabel(eventEnd)}`}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'truncate text-left text-sm font-medium text-text',
                      event.completed_at && 'text-muted line-through',
                    )}
                    onClick={() => onSelect(event.id)}
                  >
                    {event.title}
                  </button>
                  <button
                    type="button"
                    title={event.notes ?? ''}
                    className="truncate text-left text-sm text-muted"
                    onClick={() => onSelect(event.id)}
                  >
                    {event.notes || '—'}
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 truncate text-left text-sm text-muted"
                    onClick={() => onSelect(event.id)}
                  >
                    <i
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: itemType.color }}
                    />
                    {itemType.name}
                  </button>
                  <label className="grid cursor-pointer place-items-center">
                    <input
                      type="checkbox"
                      checked={Boolean(event.completed_at)}
                      onChange={() => onToggle(event)}
                      aria-label={`标记${event.title}完成`}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="p-12 text-center text-sm text-muted">没有符合筛选条件的日程</p>
        )}
      </div>
    </div>
  );
}

function ScheduleDetail({
  event,
  types,
  onEdit,
  onDelete,
}: {
  event: ScheduleEvent | null;
  types: ScheduleType[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!event)
    return (
      <EmptyState
        icon={<CalendarClock size={22} />}
        title="选择一个日程"
        description="点击日历中的日程，可在这里查看详情、编辑或删除。"
        className="min-h-64 rounded-xl border border-line bg-surface"
      />
    );
  const start = parseDate(event.starts_at);
  const type = eventType(event, types);
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-sm" style={{ color: type.color }}>
        <span className="h-3 w-3 rounded-full" style={{ background: type.color }} />
        {type.name}
      </div>
      <h2
        className={cn(
          'mb-4 text-lg font-semibold text-text',
          event.completed_at && 'text-muted line-through',
        )}
      >
        {event.title}
      </h2>
      <dl className="space-y-2.5 text-sm">
        <DetailRow
          label="日期"
          value={`${start.getMonth() + 1}月${start.getDate()}日 ${dayLabel(start)}`}
        />
        <DetailRow
          label="时间"
          value={
            event.all_day
              ? '全天'
              : `${timeLabel(start)} – ${timeLabel(new Date(start.getTime() + eventDurationMinutes(event) * 60_000))}`
          }
        />
        {event.reminder_at && (
          <DetailRow
            label="提醒"
            value={`${timeLabel(parseDate(event.reminder_at))} · ${event.reminder_repeat === 'none' ? '一次' : event.reminder_repeat}`}
          />
        )}
        <DetailRow label="备注" value={event.notes || '—'} />
      </dl>
      <div className="mt-5 flex gap-2">
        <button type="button" className="btn btn-secondary" onClick={onEdit}>
          <Pencil size={15} />
          编辑
        </button>
        <button type="button" className="btn btn-danger" onClick={onDelete}>
          <Trash2 size={15} />
          删除
        </button>
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[48px_1fr] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap text-text">{value}</dd>
    </div>
  );
}

function TodoPanel({
  items,
  types,
  onToggle,
}: {
  items: ScheduleEvent[];
  types: ScheduleType[];
  onToggle: (item: ScheduleEvent) => void;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <h2 className="mb-3 font-semibold text-text">今日待办</h2>
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const type = eventType(item, types);
            return (
              <li
                key={item.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-2"
              >
                <span className="flex items-center gap-1 text-xs text-muted">
                  <i className="h-2.5 w-2.5 rounded-full" style={{ background: type.color }} />
                  {type.name}
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      'truncate text-sm text-text',
                      item.completed_at && 'text-muted line-through',
                    )}
                  >
                    {item.title}
                  </p>
                  {item.notes && <p className="truncate text-xs text-muted">{item.notes}</p>}
                </div>
                <label className="grid cursor-pointer place-items-center">
                  <input
                    type="checkbox"
                    checked={Boolean(item.completed_at)}
                    onChange={() => onToggle(item)}
                    aria-label={`标记${item.title}完成`}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-4 text-center text-sm text-muted">今天没有日程</p>
      )}
    </section>
  );
}

function EventModal({
  initial,
  types,
  onClose,
  onSave,
}: {
  initial: Partial<ScheduleEvent> | null;
  types: ScheduleType[];
  onClose: () => void;
  onSave: (event: Partial<ScheduleEvent>) => void;
}) {
  const [draft, setDraft] = useState<Partial<ScheduleEvent> | null>(initial);
  useEffect(() => setDraft(initial), [initial]);
  useEffect(() => {
    if (!draft) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [draft, onClose]);
  if (!draft) return null;
  const set = <K extends keyof ScheduleEvent>(key: K, value: ScheduleEvent[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const reminderOffset =
    draft.reminder_at && draft.starts_at
      ? Math.round(
          (parseDate(draft.starts_at).getTime() - parseDate(draft.reminder_at).getTime()) / 60_000,
        )
      : 0;
  const setReminderOffset = (minutes: number) => {
    if (!minutes) {
      set('reminder_at', null);
      return;
    }
    const start = parseDate(draft.starts_at ?? '');
    if (Number.isNaN(start.getTime())) return;
    set('reminder_at', dateTimeValue(new Date(start.getTime() - minutes * 60_000)));
  };
  const selectedType = eventType(
    { ...draft, color: draft.color || DEFAULT_EVENT_COLOR } as ScheduleEvent,
    types,
  );
  return (
    <Modal title={draft.id ? '编辑日程' : '新建日程'} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">标题</span>
          <input
            autoFocus
            required
            value={draft.title ?? ''}
            onChange={(event) => set('title', event.target.value)}
            className="input-lite w-full"
            placeholder="例如：日程模块 UI 设计"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-sm text-muted">开始时间</span>
            <input
              required
              type="datetime-local"
              value={draft.starts_at ?? ''}
              onChange={(event) => set('starts_at', event.target.value)}
              className="input-lite w-full"
            />
          </label>
          <label>
            <span className="mb-1.5 block text-sm text-muted">结束时间</span>
            <input
              type="datetime-local"
              value={draft.ends_at ?? ''}
              onChange={(event) => set('ends_at', event.target.value)}
              className="input-lite w-full"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={Boolean(draft.all_day)}
              onChange={(event) => set('all_day', event.target.checked ? 1 : 0)}
            />
            全天日程
          </label>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={Boolean(draft.completed_at)}
              onChange={(event) =>
                set('completed_at', event.target.checked ? new Date().toISOString() : null)
              }
            />
            已完成
          </label>
        </div>
        <div>
          <span className="mb-1.5 block text-sm text-muted">日程类型</span>
          <div className="flex flex-wrap gap-2">
            {types.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'chip border',
                  selectedType.id === item.id ? 'border-accent ring-1 ring-accent' : 'border-line',
                )}
                onClick={() =>
                  setDraft((current) =>
                    current ? { ...current, type_id: item.id, color: item.color } : current,
                  )
                }
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                {item.name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-sm text-muted">提醒时间</span>
            <select
              value={[5, 15, 30, 60].includes(reminderOffset) ? String(reminderOffset) : '0'}
              onChange={(event) => setReminderOffset(Number(event.target.value))}
              className="input-lite w-full"
            >
              <option value="0">不提醒</option>
              <option value="5">提前 5 分钟</option>
              <option value="15">提前 15 分钟</option>
              <option value="30">提前 30 分钟</option>
              <option value="60">提前 60 分钟</option>
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-sm text-muted">重复</span>
            <select
              value={draft.reminder_repeat ?? 'none'}
              onChange={(event) =>
                set('reminder_repeat', event.target.value as ScheduleEventRepeat)
              }
              className="input-lite w-full"
            >
              <option value="none">不重复</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">备注</span>
          <textarea
            value={draft.notes ?? ''}
            onChange={(event) => set('notes', event.target.value)}
            className="input-lite min-h-20 w-full resize-y"
            placeholder="补充说明、会议链接或关联信息"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary">
            <Bell size={16} />
            保存日程
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/55 px-4"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[90vh] w-[560px] max-w-full overflow-y-auto rounded-xl bg-canvas opacity-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <section className={cn('grid place-items-center p-6 text-center', className)}>
      <div>
        <div className="mx-auto mb-3 text-muted">{icon}</div>
        <h2 className="font-semibold text-text">{title}</h2>
        <p className="mt-1 max-w-56 text-sm text-muted">{description}</p>
      </div>
    </section>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-muted">{description}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className={danger ? 'btn btn-danger' : 'btn btn-primary'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function RepeatDeleteDialog({
  event,
  onClose,
  onDeleteOnce,
  onDeleteSeries,
}: {
  event: ScheduleEvent;
  onClose: () => void;
  onDeleteOnce: () => void;
  onDeleteSeries: () => void;
}) {
  return (
    <Modal title="删除重复日程" onClose={onClose}>
      <p className="text-sm text-muted">“{event.title}”是重复日程。请选择删除范围。</p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          取消
        </button>
        <button type="button" className="btn btn-danger" onClick={onDeleteOnce}>
          仅删除本次
        </button>
        <button type="button" className="btn btn-danger" onClick={onDeleteSeries}>
          删除全部系列
        </button>
      </div>
    </Modal>
  );
}
