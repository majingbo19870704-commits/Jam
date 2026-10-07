import { useBrandStore } from '@/stores/brand';

export function Brand() {
  const brand = useBrandStore();
  return (
    <div className="h-14 flex items-center gap-2.5 px-5 bg-sidebar-bg">
      <div
        className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg text-lg font-medium text-white shadow-md"
        style={{ background: 'linear-gradient(135deg, rgb(var(--rgb-accent)), #6E8CFF)' }}
      >
        {brand.logoDataUrl ? (
          <img src={brand.logoDataUrl} alt="工作站图标" className="h-full w-full object-cover" />
        ) : (
          '工'
        )}
      </div>
      <div
        className="min-w-0 truncate font-semibold"
        style={{
          fontFamily:
            brand.font === 'sans'
              ? "Inter, 'PingFang SC', sans-serif"
              : brand.font === 'yahei'
                ? "'Microsoft YaHei', sans-serif"
                : "'Source Serif 4', 'Noto Serif SC', Georgia, serif",
          fontSize: `${brand.fontSize}px`,
          color: brand.color,
        }}
      >
        {brand.title || '个人工作站'}
      </div>
    </div>
  );
}
