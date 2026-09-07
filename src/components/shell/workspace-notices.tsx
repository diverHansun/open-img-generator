'use client';

import * as React from 'react';

import { InlineNotice } from '@/components/ui/inline-notice';

import styles from './workspace-shell.module.css';

export const WORKSPACE_NOTICE_DURATION_MS = 3_000;

export type WorkspaceNotice = Readonly<{
  id: string;
  variant: 'info' | 'warning' | 'error' | 'success';
  title: string;
  detail?: string;
}>;

export function prependWorkspaceNotice(
  notices: readonly WorkspaceNotice[],
  notice: WorkspaceNotice,
): WorkspaceNotice[] {
  return [notice, ...notices];
}

export function dismissWorkspaceNotice(
  notices: readonly WorkspaceNotice[],
  id: string,
): WorkspaceNotice[] {
  return notices.filter((notice) => notice.id !== id);
}

export type WorkspaceNoticeInput = Omit<WorkspaceNotice, 'id'>;

export type WorkspaceNoticeContextValue = Readonly<{
  showWorkspaceNotice: (notice: WorkspaceNoticeInput) => void;
}>;

const WorkspaceNoticeContext = React.createContext<WorkspaceNoticeContextValue | null>(null);

export function useWorkspaceNotices(): WorkspaceNoticeContextValue {
  const context = React.useContext(WorkspaceNoticeContext);
  if (!context) {
    throw new Error('useWorkspaceNotices must be used inside WorkspaceShell');
  }
  return context;
}

export function WorkspaceNoticeProvider({ children }: { children: React.ReactNode }) {
  const [notices, setNotices] = React.useState<WorkspaceNotice[]>([]);
  const timers = React.useRef(new Map<string, number>());

  const dismiss = React.useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setNotices((current) => dismissWorkspaceNotice(current, id));
  }, []);

  const showWorkspaceNotice = React.useCallback((input: WorkspaceNoticeInput) => {
    const id = crypto.randomUUID();
    setNotices((current) => prependWorkspaceNotice(current, { ...input, id }));
    timers.current.set(id, window.setTimeout(() => dismiss(id), WORKSPACE_NOTICE_DURATION_MS));
  }, [dismiss]);

  React.useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  const value = React.useMemo<WorkspaceNoticeContextValue>(
    () => ({ showWorkspaceNotice }),
    [showWorkspaceNotice],
  );

  return (
    <WorkspaceNoticeContext.Provider value={value}>
      {children}
      <div className={styles.noticeStack} aria-live="polite" aria-relevant="additions">
        {notices.map((notice) => (
          <InlineNotice
            key={notice.id}
            className={styles.noticeCard}
            variant={notice.variant}
            title={notice.title}
          >
            {notice.detail ? <p>{notice.detail}</p> : null}
          </InlineNotice>
        ))}
      </div>
    </WorkspaceNoticeContext.Provider>
  );
}
