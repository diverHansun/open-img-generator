'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  Boxes,
  GalleryVerticalEnd,
  History,
  ImagePlus,
  Menu,
  PlugZap,
  Settings,
} from 'lucide-react';

import { LocaleSwitcher } from '@/components/i18n/locale-switcher';
import { useLocale } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { TranslationKey } from '@/lib/i18n';
import { HOME_ROUTE, workspaceRoute, type WorkspaceSection } from '@/lib/routes';
import {
  getBrowserWebClientRuntime,
  type Project,
} from '@/lib/web-client';

import styles from './workspace-shell.module.css';
import { WorkspaceNoticeProvider } from './workspace-notices';

type NavItem = {
  segment: WorkspaceSection;
  label: TranslationKey;
  group: 'work' | 'config';
  icon: React.ComponentType<{ 'aria-hidden'?: boolean }>;
};

const navigation: NavItem[] = [
  { segment: 'generate', label: 'nav.generate', group: 'work', icon: ImagePlus },
  { segment: 'gallery', label: 'nav.gallery', group: 'work', icon: GalleryVerticalEnd },
  { segment: 'history', label: 'nav.history', group: 'work', icon: History },
  { segment: 'models', label: 'nav.models', group: 'config', icon: Boxes },
  { segment: 'providers', label: 'nav.providers', group: 'config', icon: PlugZap },
  { segment: 'settings', label: 'nav.settings', group: 'config', icon: Settings },
];

const SIDEBAR_STORAGE_KEY = 'oig:sidebar-collapsed';

export type WorkspaceContextValue = Readonly<{
  project: Readonly<Project>;
}>;

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const context = React.useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used inside WorkspaceShell');
  }
  return context;
}

function toError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  return new Error(
    typeof cause === 'string' ? cause : 'Unknown workspace request error',
  );
}

function SidebarToggleIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect
        className={open ? styles.paneFillOpen : styles.paneFillClosed}
        x="2.5"
        y="3.5"
        width="4"
        height="9"
        rx="1"
      />
      <g fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
        <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" />
        <path d="M6.75 2.75v10.5" />
      </g>
    </svg>
  );
}

function WorkspaceNavigation({
  projectId,
  pathname,
  onNavigate,
}: {
  projectId: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const { t } = useLocale();
  const workItems = navigation.filter((item) => item.group === 'work');
  const configItems = navigation.filter((item) => item.group === 'config');

  const renderLink = ({ segment, label, icon: Icon }: NavItem) => {
    const href = workspaceRoute(projectId, segment);
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        key={segment}
        href={href}
        className={active ? styles.activeLink : styles.navLink}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
      >
        <Icon aria-hidden={true} />
        <span>{t(label)}</span>
      </Link>
    );
  };

  return (
    <nav className={styles.navigation} aria-label={t('shell.navigation')}>
      <span className={styles.navGroupLabel}>
        {t('shell.studio')}
      </span>
      {workItems.map(renderLink)}
      <span className={styles.navGroupLabel}>
        {t('shell.configure')}
      </span>
      {configItems.map(renderLink)}
    </nav>
  );
}

export function WorkspaceShell({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const client = React.useMemo(() => getBrowserWebClientRuntime().client, []);
  const pathname = usePathname();
  const { t } = useLocale();
  const [project, setProject] = React.useState<Project | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const projectRequest = React.useRef<AbortController | null>(null);
  const sidebarToggle = React.useRef<HTMLButtonElement>(null);
  const topBarToggle = React.useRef<HTMLButtonElement>(null);
  const restoreToggleFocus = React.useRef(false);

  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1') {
        setCollapsed(true);
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  const toggleSidebar = React.useCallback(() => {
    const next = !collapsed;
    restoreToggleFocus.current = true;
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Ignore storage access errors.
    }
  }, [collapsed]);

  React.useEffect(() => {
    if (!restoreToggleFocus.current) return;
    restoreToggleFocus.current = false;
    (collapsed ? topBarToggle : sidebarToggle).current?.focus({ preventScroll: true });
  }, [collapsed]);

  const loadProject = React.useCallback(async () => {
    projectRequest.current?.abort();
    const controller = new AbortController();
    projectRequest.current = controller;
    setProject(null);
    setError(null);
    try {
      const nextProject = await client.getProject(projectId, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setProject(nextProject);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setProject(null);
      setError(toError(cause));
    } finally {
      if (projectRequest.current === controller) {
        projectRequest.current = null;
      }
    }
  }, [client, projectId]);

  React.useEffect(() => {
    void loadProject();
    return () => {
      projectRequest.current?.abort();
      projectRequest.current = null;
    };
  }, [loadProject]);

  const title = project?.title ?? t('workspace.loading');
  const activeNav = navigation.find((item) => {
    const href = workspaceRoute(projectId, item.segment);
    return pathname === href || pathname.startsWith(`${href}/`);
  });
  const activeSectionLabel = activeNav ? t(activeNav.label) : '';
  const toggleLabel = t(collapsed ? 'shell.showSidebar' : 'shell.hideSidebar');

  const workspace = React.useMemo<WorkspaceContextValue | null>(
    () => (project ? { project } : null),
    [project],
  );

  return (
    <div className={styles.shell} data-collapsed={collapsed ? 'true' : undefined}>
      <a className={styles.skipLink} href="#workspace-content">
        {t('common.skipMain')}
      </a>
      <aside
        id="workspace-sidebar"
        className={styles.sidebar}
        inert={collapsed || undefined}
        aria-hidden={collapsed || undefined}
      >
        <div className={styles.sideTop}>
          <Link className={styles.backLink} href={HOME_ROUTE}>
            <ArrowLeft aria-hidden="true" />
            <span>{t('shell.back')}</span>
          </Link>
          <button
            type="button"
            ref={sidebarToggle}
            className={styles.sideToggle}
            aria-expanded={!collapsed}
            aria-controls="workspace-sidebar"
            onClick={toggleSidebar}
            aria-label={toggleLabel}
            title={toggleLabel}
          >
            <SidebarToggleIcon open={!collapsed} />
          </button>
        </div>

        <div className={styles.workspaceTitle} title={title}>
          {title}
        </div>

        <div className={styles.sideScroll}>
          <WorkspaceNavigation projectId={projectId} pathname={pathname} />
        </div>

        <div className={styles.sidebarFooter}>
          <LocaleSwitcher />
        </div>
      </aside>

      <header className={styles.mobileHeader}>
        <strong>{title}</strong>
        <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" size="icon" aria-label={t('shell.menu')}>
              <Menu aria-hidden="true" />
            </Button>
          </DialogTrigger>
          <DialogContent className={styles.mobileMenu} closeLabel={t('common.close')}>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{t('brand.name')}</DialogDescription>
            </DialogHeader>
            <Link
              className={styles.mobileBackLink}
              href={HOME_ROUTE}
              onClick={() => setMenuOpen(false)}
            >
              <ArrowLeft aria-hidden="true" />
              {t('shell.back')}
            </Link>
            <WorkspaceNavigation
              projectId={projectId}
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
            />
            <LocaleSwitcher />
          </DialogContent>
        </Dialog>
      </header>

      <div className={styles.viewport}>
        <header className={styles.topBar}>
          {collapsed ? (
            <button
              type="button"
              ref={topBarToggle}
              className={styles.sideToggle}
              aria-expanded={false}
              aria-controls="workspace-sidebar"
              onClick={toggleSidebar}
              aria-label={toggleLabel}
              title={toggleLabel}
            >
              <SidebarToggleIcon open={false} />
            </button>
          ) : null}
          <div className={styles.crumb}>
            {collapsed ? (
              <>
                <Link href={HOME_ROUTE} className={styles.crumbHome}>
                  {t('shell.back')}
                </Link>
                <i>/</i>
              </>
            ) : null}
            <span>{title}</span>
            {activeSectionLabel ? (
              <>
                <i>/</i>
                <b>{activeSectionLabel}</b>
              </>
            ) : null}
          </div>
          {collapsed ? (
            <div className={styles.topActions}>
              <LocaleSwitcher />
            </div>
          ) : null}
        </header>

        <main id="workspace-content" className={styles.main}>
          {error ? (
            <section className={styles.errorState}>
              <p>{t('workspace.notFound')}</p>
              <small>{error.message}</small>
              <div>
                <Button type="button" variant="secondary" onClick={() => void loadProject()}>
                  {t('common.retry')}
                </Button>
                <Button asChild variant="ghost">
                  <Link href={HOME_ROUTE}>{t('workspace.backHome')}</Link>
                </Button>
              </div>
            </section>
          ) : workspace ? (
            <WorkspaceContext.Provider value={workspace}>
              <WorkspaceNoticeProvider>{children}</WorkspaceNoticeProvider>
            </WorkspaceContext.Provider>
          ) : (
            <p className={styles.loading}>{t('workspace.loading')}</p>
          )}
        </main>
      </div>
    </div>
  );
}
