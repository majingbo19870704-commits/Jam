import { useCallback, useEffect, useState } from 'react';

const MIN = 0.6;
const MAX = 1.8;
const STEP = 0.05;

/**
 * 表格缩放 hook：
 * - Ctrl + 鼠标滚轮 →  0.6 - 1.8 缩放
 * - 缩放系数保存到 localStorage，按 key 隔离
 * - 返回 zoom 值 + 用于 <table> 的 style
 *
 * 用法：
 *   const { zoom, style, bind } = useTableZoom('work_item');
 *   <div {...bind}> <table style={style}>…</table> </div>
 */
export function useTableZoom(key: string) {
  const storageKey = `pw:zoom:${key}`;
  const [zoom, setZoom] = useState<number>(() => {
    const raw = localStorage.getItem(storageKey);
    const n = raw ? Number(raw) : 1;
    return Number.isFinite(n) && n >= MIN && n <= MAX ? n : 1;
  });

  useEffect(() => {
    localStorage.setItem(storageKey, String(zoom));
  }, [storageKey, zoom]);

  const onWheel = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom((z) => {
      const delta = e.deltaY > 0 ? -STEP : STEP;
      const next = Math.round((z + delta) * 100) / 100;
      return Math.min(MAX, Math.max(MIN, next));
    });
  }, []);

  return {
    zoom,
    setZoom,
    reset: () => setZoom(1),
    /** 绑定到滚动容器的 props：使用 native listener 才能 preventDefault */
    bindRef: (el: HTMLElement | null) => {
      if (!el) return;
      // 避免重复绑定
      // @ts-expect-error - 扩展滚动容器以标记已绑定状态
      if (el.__pw_zoom_bound) return;
      // @ts-expect-error - 同上
      el.__pw_zoom_bound = true;
      el.addEventListener('wheel', onWheel, { passive: false });
    },
  };
}
