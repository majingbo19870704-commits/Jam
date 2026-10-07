import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeName = 'soft-light' | 'tech-dark' | 'neumorphic';
export type ColorMode = 'light' | 'dark' | 'system';

export type ThemeSlot = {
  enabled: boolean;
  imageDataUrl: string | null;
  cardOpacity: number;
  title: string;
  description: string;
  layout?: {
    left: number;
    top: number | null;
    width: number;
    height: number;
  };
};

export type ThemeDecorations = Record<ThemeName, { hero: ThemeSlot; sidebar: ThemeSlot }>;

const DEFAULT_DECORATIONS: ThemeDecorations = {
  'soft-light': {
    hero: {
      enabled: true,
      imageDataUrl: null,
      cardOpacity: 1,
      title: '今天，稳步推进每一件重要的事',
      description: '专注眼前，工作自然有条不紊。',
    },
    sidebar: {
      enabled: true,
      imageDataUrl: null,
      cardOpacity: 1,
      title: 'AI 助手',
      description: '把琐事交给智能协作。',
      layout: { left: 12, top: null, width: 192, height: 164 },
    },
  },
  'tech-dark': {
    hero: {
      enabled: true,
      imageDataUrl: null,
      cardOpacity: 1,
      title: '让重要的工作，在此刻形成清晰轨迹',
      description: '深度专注，持续推进。',
    },
    sidebar: {
      enabled: true,
      imageDataUrl: null,
      cardOpacity: 1,
      title: '智能协作',
      description: '让 AI 协助你完成下一步。',
      layout: { left: 12, top: null, width: 192, height: 164 },
    },
  },
  neumorphic: {
    hero: {
      enabled: true,
      imageDataUrl: null,
      cardOpacity: 1,
      title: '让计划，在从容的节奏中成形',
      description: '清晰安排，稳步完成每一件事。',
    },
    sidebar: {
      enabled: true,
      imageDataUrl: null,
      cardOpacity: 1,
      title: 'AI 助手',
      description: '把下一步整理得恰到好处。',
      layout: { left: 12, top: null, width: 192, height: 164 },
    },
  },
};

interface ThemeState {
  theme: ThemeName;
  mode: ColorMode;
  density: 'comfortable' | 'compact';
  fontScale: 0.9 | 1 | 1.1;
  decorations: ThemeDecorations;
  setTheme: (t: ThemeName) => void;
  setMode: (m: ColorMode) => void;
  setDensity: (d: 'comfortable' | 'compact') => void;
  setFontScale: (s: 0.9 | 1 | 1.1) => void;
  updateDecoration: (theme: ThemeName, slot: 'hero' | 'sidebar', patch: Partial<ThemeSlot>) => void;
  resetDecoration: (theme: ThemeName, slot: 'hero' | 'sidebar') => void;
}

/**
 * 主题偏好持久化到 localStorage（对应设计说明书 11.3.1）
 * 变化时立刻同步到 <body data-theme>，让 CSS 变量生效
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'soft-light',
      mode: 'system',
      density: 'comfortable',
      fontScale: 1,
      decorations: DEFAULT_DECORATIONS,
      setTheme: (theme) => {
        set({ theme });
        document.body.setAttribute('data-theme', theme);
      },
      setMode: (mode) => {
        set({ mode });
        document.documentElement.dataset.mode = mode;
      },
      setDensity: (density) => {
        set({ density });
        document.body.dataset.density = density;
      },
      setFontScale: (fontScale) => {
        set({ fontScale });
        document.documentElement.style.fontSize = `${fontScale * 14}px`;
      },
      updateDecoration: (theme, slot, patch) =>
        set((state) => ({
          decorations: {
            ...state.decorations,
            [theme]: {
              ...state.decorations[theme],
              [slot]: { ...state.decorations[theme][slot], ...patch },
            },
          },
        })),
      resetDecoration: (theme, slot) =>
        set((state) => ({
          decorations: {
            ...state.decorations,
            [theme]: {
              ...state.decorations[theme],
              [slot]: { ...DEFAULT_DECORATIONS[theme][slot] },
            },
          },
        })),
    }),
    {
      name: 'pw:theme',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 兼容旧版主题和缺失的主题装饰配置。
        const themeNames: ThemeName[] = ['soft-light', 'tech-dark', 'neumorphic'];
        if (!themeNames.includes(state.theme)) state.theme = 'soft-light';
        state.decorations ??= {} as ThemeDecorations;
        themeNames.forEach((name) => {
          const current = state.decorations[name] ?? DEFAULT_DECORATIONS[name];
          current.hero = { ...DEFAULT_DECORATIONS[name].hero, ...current.hero };
          current.sidebar = { ...DEFAULT_DECORATIONS[name].sidebar, ...current.sidebar };
          state.decorations[name] = current;
        });
        // 应用初次挂载时把 store 状态同步到 DOM
        document.body.setAttribute('data-theme', state.theme);
        document.documentElement.dataset.mode = state.mode;
        document.body.dataset.density = state.density;
        document.documentElement.style.fontSize = `${state.fontScale * 14}px`;
      },
    },
  ),
);
