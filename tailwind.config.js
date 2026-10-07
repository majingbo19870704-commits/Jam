/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 使用 CSS 变量以支持主题切换
        paper: 'rgb(var(--rgb-paper) / <alpha-value>)',
        canvas: 'rgb(var(--rgb-canvas) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--rgb-ink) / <alpha-value>)',
          2: 'rgb(var(--rgb-ink-2) / <alpha-value>)',
          3: 'rgb(var(--rgb-ink-3) / <alpha-value>)',
          4: 'rgb(var(--rgb-ink-4) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--rgb-line) / <alpha-value>)',
          strong: 'rgb(var(--rgb-line-strong) / <alpha-value>)',
        },
        band: 'rgb(var(--rgb-band) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--rgb-accent) / <alpha-value>)',
          2: 'rgb(var(--rgb-accent-2) / <alpha-value>)',
          tint: 'rgb(var(--rgb-accent-tint) / <alpha-value>)',
        },
        sidebar: {
          bg: 'rgb(var(--rgb-sidebar-bg) / <alpha-value>)',
          hover: 'rgb(var(--rgb-sidebar-hover) / <alpha-value>)',
        },
        // 多彩色系
        'c-blue': 'rgb(var(--rgb-c-blue) / <alpha-value>)',
        'c-blue-bg': 'rgb(var(--rgb-c-blue-bg) / <alpha-value>)',
        'c-green': 'rgb(var(--rgb-c-green) / <alpha-value>)',
        'c-green-bg': 'rgb(var(--rgb-c-green-bg) / <alpha-value>)',
        'c-amber': 'rgb(var(--rgb-c-amber) / <alpha-value>)',
        'c-amber-bg': 'rgb(var(--rgb-c-amber-bg) / <alpha-value>)',
        'c-pink': 'rgb(var(--rgb-c-pink) / <alpha-value>)',
        'c-pink-bg': 'rgb(var(--rgb-c-pink-bg) / <alpha-value>)',
        'c-purple': 'rgb(var(--rgb-c-purple) / <alpha-value>)',
        'c-purple-bg': 'rgb(var(--rgb-c-purple-bg) / <alpha-value>)',
        'c-cyan': 'rgb(var(--rgb-c-cyan) / <alpha-value>)',
        'c-cyan-bg': 'rgb(var(--rgb-c-cyan-bg) / <alpha-value>)',
        'c-red': 'rgb(var(--rgb-c-red) / <alpha-value>)',
        'c-red-bg': 'rgb(var(--rgb-c-red-bg) / <alpha-value>)',
        // 状态
        ok: 'rgb(var(--rgb-ok) / <alpha-value>)',
        warn: 'rgb(var(--rgb-warn) / <alpha-value>)',
        danger: 'rgb(var(--rgb-danger) / <alpha-value>)',
        'state-new': 'rgb(var(--rgb-state-new) / <alpha-value>)',
        'state-follow': 'rgb(var(--rgb-state-follow) / <alpha-value>)',
        'state-closed': 'rgb(var(--rgb-state-closed) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        serif: ['Source Serif 4', 'Noto Serif SC', 'Georgia', 'serif'],
        num: ['Inter Tight', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
        lg: '10px',
        xl: '14px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(15, 23, 42, 0.04)',
        DEFAULT: '0 4px 14px rgba(15, 23, 42, 0.06)',
        lg: '0 8px 24px rgba(15, 23, 42, 0.10)',
      },
    },
  },
  plugins: [],
};
