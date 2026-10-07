import { describe, expect, it } from 'vitest';
import { chineseLunarDate } from './chinese-lunar';

describe('Chinese lunar calendar', () => {
  it('formats Lunar New Year with the first lunar day', () => {
    const lunar = chineseLunarDate(new Date('2026-02-17T12:00:00'));
    expect(lunar?.shortLabel).toBe('正月初一');
    expect(lunar?.fullLabel).toContain('丙午年');
  });

  it('formats Mid-Autumn Festival as lunar August fifteenth', () => {
    expect(chineseLunarDate(new Date('2026-09-25T12:00:00'))?.shortLabel).toBe('八月十五');
  });
});
