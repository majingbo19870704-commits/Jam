// =============================================================================
// lib/srs.ts · SM-2 简化算法 + 错词判定
// =============================================================================
import { localDateKey } from './local-date';

export type Rating = 'unknown' | 'vague' | 'known';

export interface SrsState {
  ease: number;         // 难度系数，初值 2.5
  interval_days: number; // 间隔天数
  repetitions: number;   // 连续认识次数
}

/**
 * 应用一次评分，返回新的状态 + 下次复习时间
 */
export function applySrs(prev: SrsState, rating: Rating): SrsState & { nextReviewDate: string } {
  const q = rating === 'unknown' ? 0 : rating === 'vague' ? 3 : 5;

  let repetitions = prev.repetitions;
  let interval_days = prev.interval_days;
  let ease = prev.ease;

  if (q < 3) {
    repetitions = 0;
    interval_days = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1)      interval_days = 1;
    else if (repetitions === 2) interval_days = 3;
    else interval_days = Math.max(1, Math.round(interval_days * ease));
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  const next = new Date();
  next.setDate(next.getDate() + interval_days);
  const nextReviewDate = localDateKey(next);

  return { ease, interval_days, repetitions, nextReviewDate };
}

/** 展示三态按钮上的"下次复习间隔"预览 */
export function previewNextInterval(prev: SrsState, rating: Rating): number {
  return applySrs(prev, rating).interval_days;
}
