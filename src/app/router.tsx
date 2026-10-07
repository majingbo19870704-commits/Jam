import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './AppShell';
import { AccountGate } from './AccountGate';
import { RouteErrorPage } from './RouteErrorPage';
import { EnglishShell } from '@/modules/english/EnglishShell';

export const router = createBrowserRouter([
  {
    path: '/setup-owner',
    errorElement: <RouteErrorPage />,
    lazy: async () => ({ Component: (await import('@/modules/settings/OwnerSetupPage')).OwnerSetupPage }),
  },
  {
    element: <AccountGate />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <Navigate to="/dashboard" replace /> },
          {
            path: '/dashboard',
            lazy: async () => ({ Component: (await import('@/modules/dashboard/DashboardPage')).DashboardPage }),
          },
          {
            path: '/work',
            lazy: async () => ({ Component: (await import('@/modules/work/WorkPage')).WorkPage }),
          },
          {
            path: '/schedule',
            lazy: async () => ({ Component: (await import('@/modules/schedule/SchedulePage')).SchedulePage }),
          },
          {
            path: '/project',
            lazy: async () => ({ Component: (await import('@/modules/project/ProjectListPage')).ProjectListPage }),
          },
          {
            path: '/project/:id',
            lazy: async () => ({ Component: (await import('@/modules/project/ProjectDetailPage')).ProjectDetailPage }),
          },
          {
            path: '/knowledge',
            lazy: async () => ({ Component: (await import('@/modules/knowledge/KnowledgePage')).KnowledgePage }),
          },
          {
            path: '/materials',
            lazy: async () => ({ Component: (await import('@/modules/materials/MaterialsPage')).MaterialsPage }),
          },
          {
            path: '/english',
            element: <EnglishShell />,
            children: [
              { index: true, lazy: async () => ({ Component: (await import('@/modules/english/EnglishTodayPage')).EnglishTodayPage }) },
              { path: 'translate', lazy: async () => ({ Component: (await import('@/modules/english/TranslatePage')).TranslatePage }) },
              { path: 'wordbook', lazy: async () => ({ Component: (await import('@/modules/english/WordbookPage')).WordbookPage }) },
              { path: 'word/:id', lazy: async () => ({ Component: (await import('@/modules/english/WordDetailPage')).WordDetailPage }) },
              { path: 'practice', lazy: async () => ({ Component: (await import('@/modules/english/PracticePage')).PracticePage }) },
              { path: 'practice/srs', lazy: async () => ({ Component: (await import('@/modules/english/SrsReviewPage')).SrsReviewPage }) },
              { path: 'practice/dictation', lazy: async () => ({ Component: (await import('@/modules/english/DictationPage')).DictationPage }) },
              { path: 'practice/mistakes', lazy: async () => ({ Component: (await import('@/modules/english/MistakesPage')).MistakesPage }) },
              { path: 'reading', lazy: async () => ({ Component: (await import('@/modules/english/EnglishReadingPage')).EnglishReadingPage }) },
              { path: 'reading/:id', lazy: async () => ({ Component: (await import('@/modules/english/ReadingDocumentPage')).ReadingDocumentPage }) },
              { path: 'records', lazy: async () => ({ Component: (await import('@/modules/english/EnglishRecordsPage')).EnglishRecordsPage }) },
              { path: 'settings', lazy: async () => ({ Component: (await import('@/modules/english/EnglishSettingsPage')).EnglishSettingsPage }) },
            ],
          },
          { path: '/ai-tools', lazy: async () => ({ Component: (await import('@/modules/ai-tools/AiToolsPage')).AiWorkbenchPage }) },
          { path: '/ai-assistant', lazy: async () => ({ Component: (await import('@/modules/ai-assistant/AiAssistantPage')).AiAssistantPage }) },
          { path: '/quick-links', lazy: async () => ({ Component: (await import('@/modules/quick-links/QuickLinksPage')).QuickLinksPage }) },
          { path: '/notifications', lazy: async () => ({ Component: (await import('@/modules/global/GlobalPages')).NotificationsPage }) },
          { path: '/help', lazy: async () => ({ Component: (await import('@/modules/global/GlobalPages')).HelpPage }) },
          { path: '/settings', lazy: async () => ({ Component: (await import('@/modules/settings/SettingsPage')).SettingsPage }) },
          { path: '/settings/recycle', lazy: async () => ({ Component: (await import('@/modules/settings/RecycleBinPage')).RecycleBinPage }) },
          { path: '/settings/backup', lazy: async () => ({ Component: (await import('@/modules/settings/BackupPage')).BackupPage }) },
          { path: '/settings/diagnostics', lazy: async () => ({ Component: (await import('@/modules/settings/DiagnosticsPage')).DiagnosticsPage }) },
        ],
      },
    ],
  },
]);
