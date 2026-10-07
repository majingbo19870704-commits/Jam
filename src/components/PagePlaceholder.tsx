import { Construction } from 'lucide-react';

/** 空模块占位组件（M1+ 逐步替换为真实页面） */
export function PagePlaceholder({
  title,
  hint,
  eta,
}: {
  title: string;
  hint: string;
  eta: string;
}) {
  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="card">
        <div className="card-body py-16 grid place-items-center gap-3 text-center">
          <div
            className="w-16 h-16 rounded-2xl grid place-items-center text-white"
            style={{ background: 'linear-gradient(135deg, rgb(var(--rgb-accent)), #6E8CFF)' }}
          >
            <Construction size={30} />
          </div>
          <div className="serif text-2xl font-semibold">{title}</div>
          <div className="text-ink-3 max-w-[520px]">{hint}</div>
          <div className="text-[12.5px] text-ink-4 mt-2">预计交付：{eta}</div>
        </div>
      </div>
    </div>
  );
}
