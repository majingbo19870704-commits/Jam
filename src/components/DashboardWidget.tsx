import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';

export type DashboardLayout = { x: number; y: number; w: number; h: number };

type Props = {
  id: string;
  layout: DashboardLayout;
  onChange: (id: string, layout: DashboardLayout) => void;
  minW?: number;
  minH?: number;
  children: ReactNode;
};

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Interaction = {
  kind: 'drag' | 'resize';
  edge?: ResizeEdge;
  startX: number;
  startY: number;
  start: DashboardLayout;
};

const ROW_HEIGHT = 28;

/** A grid-snapped dashboard widget. Dragging deliberately requires a short hold
 * so ordinary clicks inside tables and cards remain immediate. */
export function DashboardWidget({ id, layout, onChange, minW = 2, minH = 4, children }: Props) {
  const node = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<number>();
  const pointerStart = useRef<{ x: number; y: number }>();
  const [active, setActive] = useState(false);

  useEffect(
    () => () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
    },
    [],
  );

  function gridWidth() {
    return Math.max(1, (node.current?.parentElement?.clientWidth ?? 1) / 12);
  }

  function begin(interaction: Interaction) {
    setActive(true);
    const move = (event: PointerEvent) => {
      const dx = Math.round((event.clientX - interaction.startX) / gridWidth());
      const dy = Math.round((event.clientY - interaction.startY) / ROW_HEIGHT);
      const next = resizeLayout(interaction, dx, dy, minW, minH);
      onChange(id, next);
    };
    const end = () => {
      setActive(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function onCardPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('a,button,input,select,textarea,[data-no-dashboard-drag]')) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
    holdTimer.current = window.setTimeout(() => {
      begin({ kind: 'drag', startX: event.clientX, startY: event.clientY, start: layout });
    }, 380);
  }

  function onCardPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current;
    if (!start || !holdTimer.current) return;
    if (Math.abs(event.clientX - start.x) > 5 || Math.abs(event.clientY - start.y) > 5) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = undefined;
    }
  }

  function cancelHold() {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
    pointerStart.current = undefined;
  }

  const style = {
    '--widget-x': layout.x,
    '--widget-y': layout.y,
    '--widget-w': layout.w,
    '--widget-h': layout.h,
  } as CSSProperties;

  return (
    <div
      ref={node}
      className={`dashboard-widget${active ? ' is-adjusting' : ''}`}
      style={style}
      onPointerDown={onCardPointerDown}
      onPointerMove={onCardPointerMove}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
    >
      {children}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map((edge) => (
        <div
          key={edge}
          className={`dashboard-resize dashboard-resize-${edge}`}
          aria-label="调整卡片尺寸"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            begin({
              kind: 'resize',
              edge,
              startX: event.clientX,
              startY: event.clientY,
              start: layout,
            });
          }}
        />
      ))}
    </div>
  );
}

function resizeLayout(
  interaction: Interaction,
  dx: number,
  dy: number,
  minW: number,
  minH: number,
): DashboardLayout {
  const { start } = interaction;
  if (interaction.kind === 'drag') {
    return { ...start, x: clamp(start.x + dx, 0, 12 - start.w), y: Math.max(0, start.y + dy) };
  }

  const edge = interaction.edge!;
  let { x, y, w, h } = start;
  if (edge.includes('e')) w = clamp(start.w + dx, minW, 12 - x);
  if (edge.includes('s')) h = Math.max(minH, start.h + dy);
  if (edge.includes('w')) {
    x = clamp(start.x + dx, 0, start.x + start.w - minW);
    w = start.w + start.x - x;
  }
  if (edge.includes('n')) {
    y = Math.max(0, start.y + dy);
    h = start.h + start.y - y;
    if (h < minH) {
      y = start.y + start.h - minH;
      h = minH;
    }
  }
  return { x, y, w, h };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export const DASHBOARD_ROW_HEIGHT = ROW_HEIGHT;
