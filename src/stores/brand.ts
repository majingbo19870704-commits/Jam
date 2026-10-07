import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BrandFont = 'serif' | 'sans' | 'yahei';

export type BrandState = {
  title: string;
  logoDataUrl: string | null;
  font: BrandFont;
  fontSize: number;
  color: string;
  setTitle: (title: string) => void;
  setLogoDataUrl: (logoDataUrl: string | null) => void;
  setFont: (font: BrandFont) => void;
  setFontSize: (fontSize: number) => void;
  setColor: (color: string) => void;
  reset: () => void;
};

const DEFAULTS = {
  title: '个人工作站',
  logoDataUrl: null,
  font: 'serif' as BrandFont,
  fontSize: 16,
  color: '#1F2937',
};

/** 工作站名称与标识只保存在本机外观偏好，不会上传到任何模型服务。 */
export const useBrandStore = create<BrandState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setTitle: (title) => set({ title: title.slice(0, 32) }),
      setLogoDataUrl: (logoDataUrl) => set({ logoDataUrl }),
      setFont: (font) => set({ font }),
      setFontSize: (fontSize) =>
        set({ fontSize: Math.max(13, Math.min(28, Math.round(fontSize))) }),
      setColor: (color) => set({ color }),
      reset: () => set(DEFAULTS),
    }),
    { name: 'pw:brand' },
  ),
);
