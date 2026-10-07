import type { ReactNode } from 'react';

interface Props {
  color: 'blue' | 'green' | 'amber' | 'purple' | 'pink' | 'cyan' | 'red';
  icon: ReactNode;
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: 'up' | 'down' | 'muted' | 'danger';
}

const GRAD: Record<Props['color'], string> = {
  blue: 'linear-gradient(135deg,#2E5BFF,#6E8CFF)',
  green: 'linear-gradient(135deg,#10B981,#34D9A5)',
  amber: 'linear-gradient(135deg,#F59E0B,#FBBF24)',
  purple: 'linear-gradient(135deg,#8B5CF6,#A78BFA)',
  pink: 'linear-gradient(135deg,#EC4899,#F472B6)',
  cyan: 'linear-gradient(135deg,#06B6D4,#22D3EE)',
  red: 'linear-gradient(135deg,#EF4444,#F87171)',
};

const BG: Record<Props['color'], string> = {
  blue: 'linear-gradient(135deg,#FFFFFF 0%,#EEF3FF 100%)',
  green: 'linear-gradient(135deg,#FFFFFF 0%,#E7F7F0 100%)',
  amber: 'linear-gradient(135deg,#FFFFFF 0%,#FFF3DC 100%)',
  purple: 'linear-gradient(135deg,#FFFFFF 0%,#F1EBFE 100%)',
  pink: 'linear-gradient(135deg,#FFFFFF 0%,#FDECF3 100%)',
  cyan: 'linear-gradient(135deg,#FFFFFF 0%,#E0F6FA 100%)',
  red: 'linear-gradient(135deg,#FFFFFF 0%,#FEECEC 100%)',
};

export function MetricCard({ color, icon, label, value, delta, deltaTone = 'muted' }: Props) {
  const toneCls = {
    up: 'text-ok',
    down: 'text-danger',
    danger: 'text-danger',
    muted: 'text-ink-3',
  }[deltaTone];

  return (
    <div
      className="metric metric-compact"
      data-metric-color={color}
      style={{ background: BG[color] }}
    >
      <div className="metric-icon" style={{ background: GRAD[color] }}>
        {icon}
      </div>
      <div className="label">{label}</div>
      <div className="metric-value-group">
        <div className="value">{value}</div>
        {delta !== undefined && <div className={`delta ${toneCls}`}>{delta}</div>}
      </div>
    </div>
  );
}
