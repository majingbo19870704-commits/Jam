import { useEffect, useState } from 'react';
import { getSetting, setSetting } from '@/db/english-dao';
import { DictionarySettings } from './settings/DictionarySettings';
import { EngineSettings } from './settings/EngineSettings';
import { AISettings } from './settings/AISettings';

/**
 * 英语学习 · 设置页（三分区）
 *   1. 离线翻译（词典管理）
 *   2. 引擎翻译（多引擎实例）
 *   3. AI 翻译（多 AI 实例）
 *   + 底部：英语等级（用于生词判定）
 */
export function EnglishSettingsPage() {
  const [level, setLevel] = useState('cet6');
  const [dailyGoal, setDailyGoal] = useState('20');
  const [masterReps, setMasterReps] = useState('3');
  const [masterInterval, setMasterInterval] = useState('21');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [lv, dg, mr, mi] = await Promise.all([
        getSetting('app', 'english.level'),
        getSetting('app', 'english.daily_goal'),
        getSetting('app', 'english.master_min_reps'),
        getSetting('app', 'english.master_min_interval'),
      ]);
      if (lv) setLevel(lv);
      if (dg) setDailyGoal(dg);
      if (mr) setMasterReps(mr);
      if (mi) setMasterInterval(mi);
    })();
  }, []);

  async function save(key: string, v: string) {
    setSaving(true);
    try { await setSetting('app', key, v); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 max-w-[1000px] mx-auto grid gap-4">
      <DictionarySettings />
      <EngineSettings />
      <AISettings />

      <div className="card">
        <div className="card-title"><h3>学习偏好</h3></div>
        <div className="card-body grid gap-4">

          {/* 等级 */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">我的英语等级</div>
              <div className="text-ink-3 text-xs mt-1">用于生词判定和阅读高亮</div>
            </div>
            <select className="input-lite" value={level}
              onChange={(e) => { setLevel(e.target.value); save('english.level', e.target.value); }}
              disabled={saving}>
              <option value="cet4">CET-4</option>
              <option value="cet6">CET-6</option>
              <option value="ielts">雅思 6.5</option>
              <option value="toefl">托福 90</option>
              <option value="advanced">高级</option>
            </select>
          </div>

          {/* 每日目标 */}
          <div className="flex items-center justify-between border-t border-line pt-4">
            <div>
              <div className="text-sm font-medium">每日学习目标</div>
              <div className="text-ink-3 text-xs mt-1">今日页进度环的分母；范围 5-200</div>
            </div>
            <input type="number" min={5} max={200}
              className="input-lite num w-24 text-right"
              value={dailyGoal}
              onChange={(e) => setDailyGoal(e.target.value)}
              onBlur={() => {
                const v = Math.min(200, Math.max(5, parseInt(dailyGoal || '20', 10) || 20));
                setDailyGoal(String(v));
                save('english.daily_goal', String(v));
              }} />
          </div>

          {/* SRS 自动 mastered 阈值 */}
          <div className="border-t border-line pt-4">
            <div className="text-sm font-medium mb-1">SRS 自动"已掌握"条件</div>
            <div className="text-ink-3 text-xs mb-3">
              连续评"认识"、且累计重复次数 ≥ N、且下次复习间隔 ≥ M 天时，自动标记为已掌握
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-ink-3">重复次数 ≥</span>
                <input type="number" min={1} max={20}
                  className="input-lite num w-16 text-right"
                  value={masterReps}
                  onChange={(e) => setMasterReps(e.target.value)}
                  onBlur={() => {
                    const v = Math.min(20, Math.max(1, parseInt(masterReps || '3', 10) || 3));
                    setMasterReps(String(v));
                    save('english.master_min_reps', String(v));
                  }} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-ink-3">间隔 ≥</span>
                <input type="number" min={1} max={365}
                  className="input-lite num w-20 text-right"
                  value={masterInterval}
                  onChange={(e) => setMasterInterval(e.target.value)}
                  onBlur={() => {
                    const v = Math.min(365, Math.max(1, parseInt(masterInterval || '21', 10) || 21));
                    setMasterInterval(String(v));
                    save('english.master_min_interval', String(v));
                  }} />
                <span className="text-ink-3">天</span>
              </label>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
