import { useRef } from 'react';

interface Props {
  colKey: string;
  width: number;
  onWidthChange: (w: number) => void;
  onWidthCommit: () => void;
  minWidth?: number;
  align?: 'left' | 'right' | 'center';
  children?: React.ReactNode;
  className?: string;
}

/**
 * 可拖拽宽度的表头单元格：右侧有 5px 拖拽条
 * onWidthChange 每次移动都触发（内存态），onWidthCommit 在鼠标抬起时触发（持久化）
 */
export function ResizableTh({
  colKey,
  width,
  onWidthChange,
  onWidthCommit,
  minWidth = 12,
  align = 'left',
  children,
  className,
}: Props) {
  const startX = useRef(0);
  const startW = useRef(0);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    startW.current = width;
    const move = (ev: MouseEvent) => {
      const next = Math.max(minWidth, startW.current + (ev.clientX - startX.current));
      onWidthChange(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onWidthCommit();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  return (
    <th
      data-col={colKey}
      style={{ width, minWidth: width, textAlign: align, position: 'relative' }}
      className={className}
    >
      {children}
      <span
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={onMouseDown}
        className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize select-none hover:bg-accent/40"
      />
    </th>
  );
}
