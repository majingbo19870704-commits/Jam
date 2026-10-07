import { useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { useThemeStore, type ThemeSlot } from '@/stores/theme';

function imageStyle(slot: ThemeSlot) {
  return {
    ...(slot.imageDataUrl ? { backgroundImage: `url(${slot.imageDataUrl})` } : {}),
  };
}

export function DashboardHeroBanner() {
  const theme = useThemeStore((state) => state.theme);
  const slot = useThemeStore((state) => state.decorations[theme].hero);
  if (!slot.enabled) return null;
  return (
    <section className="theme-hero" style={{ opacity: slot.cardOpacity }}>
      <div className="theme-decoration-image" style={imageStyle(slot)} />
      <div className="theme-hero-content">
        <div className="theme-hero-kicker">
          <Sparkles size={14} /> 今日工作节奏
        </div>
        <h2>{slot.title || '今天，稳步推进每一件重要的事'}</h2>
        {slot.description && <p>{slot.description}</p>}
      </div>
    </section>
  );
}

export function SidebarPromoCard() {
  const theme = useThemeStore((state) => state.theme);
  const slot = useThemeStore((state) => state.decorations[theme].sidebar);
  const updateDecoration = useThemeStore((state) => state.updateDecoration);
  const dragRef = useRef<{ offsetX: number; offsetY: number; parent: HTMLElement } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    parent: HTMLElement;
    width: number;
    height: number;
  } | null>(null);
  const layout = slot.layout ?? { left: 12, top: null, width: 192, height: 164 };
  if (!slot.enabled) return null;

  function updateLayout(patch: Partial<NonNullable<ThemeSlot['layout']>>) {
    updateDecoration(theme, 'sidebar', { layout: { ...layout, ...patch } });
  }
  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('.theme-sidebar-resize')) return;
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      parent,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const bounds = drag.parent.getBoundingClientRect();
    updateLayout({
      left: Math.round(
        Math.max(0, Math.min(bounds.width - 64, event.clientX - bounds.left - drag.offsetX)),
      ),
      top: Math.round(
        Math.max(56, Math.min(bounds.height - 68, event.clientY - bounds.top - drag.offsetY)),
      ),
    });
  }
  function endDrag() {
    dragRef.current = null;
  }
  function startResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const parent = event.currentTarget.parentElement?.parentElement;
    if (!parent) return;
    resizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      parent,
      width: layout.width,
      height: layout.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveResize(event: React.PointerEvent<HTMLButtonElement>) {
    const resize = resizeRef.current;
    if (!resize) return;
    const bounds = resize.parent.getBoundingClientRect();
    updateLayout({
      width: Math.round(
        Math.max(
          140,
          Math.min(bounds.width - layout.left, resize.width + event.clientX - resize.startX),
        ),
      ),
      height: Math.round(
        Math.max(
          112,
          Math.min(
            bounds.height - 68 - (layout.top ?? 0),
            resize.height + event.clientY - resize.startY,
          ),
        ),
      ),
    });
  }
  function endResize() {
    resizeRef.current = null;
  }

  return (
    <section
      className="theme-sidebar-promo"
      style={{
        left: layout.left,
        top: layout.top ?? undefined,
        bottom: layout.top === null ? 72 : undefined,
        width: layout.width,
        height: layout.height,
        opacity: slot.cardOpacity,
      }}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      title="拖动移动卡片；右下角可调整尺寸"
    >
      <div className="theme-decoration-image" style={imageStyle(slot)} />
      <div className="theme-sidebar-promo-copy">
        <h2>{slot.title || 'AI 助手'}</h2>
        {slot.description && <p>{slot.description}</p>}
      </div>
      <button
        className="theme-sidebar-resize"
        aria-label="调整侧栏 AI 卡片尺寸"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />
    </section>
  );
}
