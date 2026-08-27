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

const navigation: Array<{
  segment: WorkspaceSection;
  label: TranslationKey;
  icon: React.ComponentType<{ 'aria-hidden'?: boolean }>;
}> = [
  { segment: 'generate', label: 'nav.generate', icon: ImagePlus },
  { segment: 'history', label: 'nav.history', icon: History },
  { segment: 'gallery', label: 'nav.gallery', icon: GalleryVerticalEnd },
  { segment: 'models', label: 'nav.models', icon: Boxes },
  { segment: 'providers', label: 'nav.providers', icon: PlugZap },
  { segment: 'settings', label: 'nav.settings', icon: Settings },
];

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
  return (
    <nav className={styles.navigation} aria-label={t('shell.navigation')}>
      {navigation.map(({ segment, label, icon: Icon }) => {
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
      })}
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
  const projectRequest = React.useRef<AbortController | null>(null);

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
  const workspace = React.useMemo<WorkspaceContextValue | null>(
    () => (project ? { project } : null),
    [project],
  );

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#workspace-content">
        {t('common.skipMain')}
      </a>
      <aside className={styles.sidebar}>
        <Link className={styles.backLink} href={HOME_ROUTE}>
          <ArrowLeft aria-hidden="true" />
          {t('shell.back')}
        </Link>
        <div className={styles.workspaceTitle}>{title}</div>
        <WorkspaceNavigation projectId={projectId} pathname={pathname} />
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
            {children}
          </WorkspaceContext.Provider>
        ) : (
          <p className={styles.loading}>{t('workspace.loading')}</p>
        )}
      </main>
    </div>
  );
}
