import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Account } from '@/types';

interface AccountState {
  /** 当前登录账号；null = 未登录 */
  current: Pick<Account, 'id' | 'username' | 'display_name' | 'avatar_path' | 'role'> | null;
  currentAccountId: string | null;
  setCurrent: (a: AccountState['current']) => void;
  logout: () => void;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set) => ({
      current: null,
      currentAccountId: null,
      setCurrent: (current) =>
        set({ current, currentAccountId: current?.id ?? null }),
      logout: () => set({ current: null, currentAccountId: null }),
    }),
    {
      name: 'pw:account',
      partialize: (s) => ({ current: s.current, currentAccountId: s.currentAccountId }),
    },
  ),
);
