import { getSetting, setSetting } from './english-dao';
import { listByGroup } from './param-dao';

const PALETTE = ['#4D7CFE', '#E17A36', '#179C70', '#9761E8', '#D25772', '#0C93A6'];
const COLOR_SETTING = 'types.colors';

export interface ScheduleType {
  id: string;
  name: string;
  color: string;
}

export async function listScheduleTypes(): Promise<ScheduleType[]> {
  const [items, stored] = await Promise.all([
    listByGroup('schedule_type'),
    getSetting('schedule', COLOR_SETTING),
  ]);
  let colors: Record<string, string> = {};
  try { colors = stored ? JSON.parse(stored) as Record<string, string> : {}; } catch { /* use palette */ }
  return items.map((item, index) => ({ id: item.id, name: item.name, color: colors[item.id] || PALETTE[index % PALETTE.length] }));
}

export async function setScheduleTypeColor(id: string, color: string) {
  const raw = await getSetting('schedule', COLOR_SETTING);
  let colors: Record<string, string> = {};
  try { colors = raw ? JSON.parse(raw) as Record<string, string> : {}; } catch { /* replace invalid data */ }
  colors[id] = color;
  await setSetting('schedule', COLOR_SETTING, JSON.stringify(colors));
}
