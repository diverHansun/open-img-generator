'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { useLocale } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { MAX_GENERATION_TARGETS } from '@/lib/generation-constraints';
import type { TranslationKey } from '@/lib/i18n';
import { workspaceRoute } from '@/lib/routes';
import {
  buildSubmitGenerationRequest,
  clearSubmissionIntent,
  deriveGenerationControls,
  getBrowserWebClientRuntime,
  resolveSubmissionIntent,
  type GenerationView,
  type GenerationTarget,
  type ModelPreference,
  type ProviderInfo,
  type Session,
  type SubmitGenerationPayload,
} from '@/lib/web-client';

import { GenerateCompose } from './generate-compose';
import {
  dispatchGenerateErrorAction,
  getGenerateErrorActionLabelKey,
  mapGenerateError,
  type GenerateErrorAction,
  type GenerateErrorPresentation,
} from './generate-error';
import { GenerateStage } from './generate-stage';
import {
  buildAvailableModelTargets,
  createInitialGenerateTaskState,
  generateTaskReducer,
} from './generate-state';
import styles from './generate-screen.module.css';

type ReadyData = {
  sessions: Session[];
  providers: ProviderInfo[];
  preferences: ModelPreference[];
};

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: GenerateErrorPresentation }
  | { status: 'ready'; data: ReadyData };

function modelKey(target: GenerationTarget): string {
  return target.provider + ':' + target.model;
}

function lastSessionStorageKey(projectId: string): string {
  return 'lastSession:' + projectId;
}

function readLastSession(projectId: string, sessions: Session[]): string {
  try {
    const stored = window.localStorage.getItem(lastSessionStorageKey(projectId));
    if (stored && sessions.some((session) => session.id === stored)) return stored;
    if (stored) window.localStorage.removeItem(lastSessionStorageKey(projectId));
  } catch {
    // A blocked localStorage must not make Generate unusable.
  }
  return sessions[0]?.id ?? '';
}

function rememberLastSession(projectId: string, sessionId: string): void {
  try {
    window.localStorage.setItem(lastSessionStorageKey(projectId), sessionId);
  } catch {
    // The URL still owns the workspace; this value is only a convenience hint.
  }
}

export function GenerateScreen({
  projectId,
  initialGenerationId,
}: {
  projectId: string;
  initialGenerationId: string | null;
}) {
  const runtime = React.useMemo(() => getBrowserWebClientRuntime(), []);
  const router = useRouter();
  const { t } = useLocale();
  const [loadState, setLoadState] = React.useState<LoadState>({ status: 'loading' });
  const [activeSessionId, setActiveSessionId] = React.useState('');
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [prompt, setPrompt] = React.useState('');
  const [aspectRatio, setAspectRatio] = React.useState('');
  const [count, setCount] = React.useState(1);
  const [seed, setSeed] = React.useState('');
  const [negativePrompt, setNegativePrompt] = React.useState('');
  const [formError, setFormError] = React.useState<TranslationKey | null>(null);
  const [submissionError, setSubmissionError] =
    React.useState<GenerateErrorPresentation | null>(null);
  const [sessionBusy, setSessionBusy] = React.useState(false);
  const [sessionError, setSessionError] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [task, dispatchTask] = React.useReducer(
    generateTaskReducer,
    initialGenerationId,
    createInitialGenerateTaskState,
  );
  const submissionSequence = React.useRef(0);
  const submissionInFlight = React.useRef(false);
  const previousRouteGeneration = React.useRef(initialGenerationId);
  const loadController = React.useRef<AbortController | null>(null);
  const mounted = React.useRef(false);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      submissionSequence.current += 1;
      submissionInFlight.current = false;
    };
  }, []);

  const load = React.useCallback(() => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoadState({ status: 'loading' });
    setSessionError(false);

    void Promise.all([
      runtime.client.listSessions(projectId, { signal: controller.signal }),
      runtime.client.listProviders({ signal: controller.signal }),
      runtime.client.listModelPreferences({ signal: controller.signal }),
    ])
      .then(async ([listedSessions, providers, preferenceResult]) => {
        if (controller.signal.aborted) return;
        const sessions =
          listedSessions.length > 0
            ? listedSessions
            : [await runtime.client.ensureInitialSession(projectId)];
        if (controller.signal.aborted) return;
        const active = readLastSession(projectId, sessions);
        const models = buildAvailableModelTargets(
          providers,
          preferenceResult.items,
        );
        setActiveSessionId(active);
        setSelectedKeys(
          new Set(
            models
              .slice(0, 1)
              .map((model) => modelKey(model.target)),
          ),
        );
        setLoadState({
          status: 'ready',
          data: {
            sessions,
            providers,
            preferences: preferenceResult.items,
          },
        });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setLoadState({
            status: 'error',
            error: mapGenerateError(cause, 'bootstrap'),
          });
        }
      })
      .finally(() => {
        if (loadController.current === controller) {
          loadController.current = null;
        }
      });

  }, [projectId, runtime]);

  React.useEffect(() => {
    if (initialGenerationId) return;
    load();
    return () => {
      loadController.current?.abort();
      loadController.current = null;
    };
  }, [initialGenerationId, load]);

  React.useEffect(() => {
    if (previousRouteGeneration.current === initialGenerationId) return;
    previousRouteGeneration.current = initialGenerationId;
    if (submissionInFlight.current) {
      submissionSequence.current += 1;
      submissionInFlight.current = false;
      setSubmitting(false);
    }
    if (initialGenerationId) {
      dispatchTask({ type: 'open-stage', generationId: initialGenerationId });
    } else {
      dispatchTask({ type: 'back-to-compose' });
    }
  }, [initialGenerationId]);

  const readyData = loadState.status === 'ready' ? loadState.data : null;
  const models = React.useMemo(
    () =>
      readyData
        ? buildAvailableModelTargets(readyData.providers, readyData.preferences)
        : [],
    [readyData],
  );
  const targets = React.useMemo(
    () =>
      models
        .filter((model) => selectedKeys.has(modelKey(model.target)))
        .map((model) => model.target),
    [models, selectedKeys],
  );
  const controls = React.useMemo(
    () => deriveGenerationControls(readyData?.providers ?? [], targets),
    [readyData, targets],
  );

  React.useEffect(() => {
    setAspectRatio((current) => {
      if (controls.aspectRatios.includes(current)) return current;
      return controls.aspectRatios.includes('1:1')
        ? '1:1'
        : controls.aspectRatios[0] ?? '';
    });
    setCount((current) =>
      controls.maxCount > 0
        ? Math.max(1, Math.min(current, controls.maxCount))
        : 1,
    );
  }, [controls.aspectRatios, controls.maxCount]);

  const changeSession = React.useCallback(
    (id: string) => {
      setActiveSessionId(id);
      rememberLastSession(projectId, id);
      setSessionError(false);
      setSubmissionError(null);
    },
    [projectId],
  );

  const createSession = React.useCallback(async (): Promise<Session | null> => {
    if (!readyData || sessionBusy) return null;
    setSessionBusy(true);
    setSessionError(false);
    try {
      const created = await runtime.client.createSession(projectId);
      if (!mounted.current) return null;
      setLoadState((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              data: {
                ...current.data,
                sessions: [created, ...current.data.sessions],
              },
            }
          : current,
      );
      changeSession(created.id);
      return created;
    } catch {
      if (mounted.current) setSessionError(true);
      return null;
    } finally {
      if (mounted.current) setSessionBusy(false);
    }
  }, [changeSession, projectId, readyData, runtime, sessionBusy]);

  const renameSession = React.useCallback(
    async (id: string, title: string): Promise<boolean> => {
      if (sessionBusy) return false;
      setSessionBusy(true);
      setSessionError(false);
      try {
        const updated = await runtime.client.updateSession(id, title);
        if (!mounted.current) return false;
        setLoadState((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                data: {
                  ...current.data,
                  sessions: current.data.sessions.map((session) =>
                    session.id === id ? updated : session,
                  ),
                },
              }
            : current,
        );
        return true;
      } catch {
        if (mounted.current) setSessionError(true);
        return false;
      } finally {
        if (mounted.current) setSessionBusy(false);
      }
    },
    [runtime, sessionBusy],
  );

  const submit = React.useCallback(async () => {
    if (!readyData || submitting || submissionInFlight.current) return;
    setFormError(null);
    setSubmissionError(null);
    if (!prompt.trim()) {
      setFormError('generate.validationPrompt');
      return;
    }
    if (!activeSessionId) {
      setFormError('generate.validationSession');
      return;
    }
    if (targets.length === 0) {
      setFormError('generate.validationTargets');
      return;
    }
    if (targets.length > MAX_GENERATION_TARGETS) {
      setFormError('generate.validationTargetsLimit');
      return;
    }

    const parsedSeed = seed.trim() === '' ? null : Number(seed);
    if (parsedSeed !== null && !Number.isInteger(parsedSeed)) {
      setFormError('generate.validationParameters');
      return;
    }

    let payload: SubmitGenerationPayload;
    try {
      payload = buildSubmitGenerationRequest(
        {
          prompt: prompt.trim(),
          targets,
          sessionId: activeSessionId,
          aspectRatio: aspectRatio || null,
          count,
          seed: controls.canSetSeed ? parsedSeed : null,
          negativePrompt:
            controls.canSetNegativePrompt && negativePrompt.trim()
              ? negativePrompt.trim()
              : null,
        },
        readyData.providers,
      );
    } catch {
      setFormError('generate.validationParameters');
      return;
    }

    const sequence = ++submissionSequence.current;
    submissionInFlight.current = true;
    dispatchTask({ type: 'submit-started', sequence });
    setSubmitting(true);
    try {
      const { intent } = await resolveSubmissionIntent({
        projectId,
        sessionId: activeSessionId,
        payload,
      });
      if (!mounted.current || sequence !== submissionSequence.current) return;
      const request = {
        ...payload,
        clientRequestId: intent.clientRequestId,
      };
      const response = await runtime.client.submitGeneration(request);
      clearSubmissionIntent(intent.clientRequestId);
      if (!mounted.current || sequence !== submissionSequence.current) return;
      dispatchTask({
        type: 'submit-succeeded',
        sequence,
        generationId: response.id,
      });
      const href =
        workspaceRoute(projectId, 'generate') +
        '?generation=' +
        encodeURIComponent(response.id);
      router.replace(href, { scroll: false });
    } catch (cause) {
      if (mounted.current && sequence === submissionSequence.current) {
        setSubmissionError(mapGenerateError(cause, 'submit'));
      }
    } finally {
      if (sequence === submissionSequence.current) {
        submissionInFlight.current = false;
        if (mounted.current) setSubmitting(false);
      }
    }
  }, [
    activeSessionId,
    aspectRatio,
    controls.canSetNegativePrompt,
    controls.canSetSeed,
    count,
    negativePrompt,
    projectId,
    prompt,
    readyData,
    router,
    runtime,
    seed,
    submitting,
    targets,
  ]);

  const backToCompose = React.useCallback(() => {
    dispatchTask({ type: 'back-to-compose' });
    router.replace(workspaceRoute(projectId, 'generate'), { scroll: false });
  }, [projectId, router]);

  const openCurrentTask = React.useCallback(() => {
    if (!task.currentGenerationId || submissionInFlight.current) return;
    dispatchTask({
      type: 'open-stage',
      generationId: task.currentGenerationId,
    });
    router.replace(
      workspaceRoute(projectId, 'generate') +
        '?generation=' +
        encodeURIComponent(task.currentGenerationId),
      { scroll: false },
    );
  }, [projectId, router, task.currentGenerationId]);

  const receiveSnapshot = React.useCallback((snapshot: GenerationView) => {
    dispatchTask({
      type: 'snapshot-received',
      generationId: snapshot.id,
      snapshot,
    });
  }, []);

  const handleErrorAction = React.useCallback(
    (action: GenerateErrorAction) => {
      dispatchGenerateErrorAction(action, {
        'configure-providers': () =>
          router.push(workspaceRoute(projectId, 'providers')),
        'check-history': () =>
          router.push(workspaceRoute(projectId, 'history')),
        reload: () => window.location.reload(),
        'back-to-compose': backToCompose,
        wait: () => void submit(),
      });
    },
    [backToCompose, projectId, router, submit],
  );

  const handleBootstrapErrorAction = React.useCallback(
    (action: GenerateErrorAction) => {
      // A bootstrap retry must reload the workspace prerequisites. `submit()`
      // intentionally no-ops before they are ready, so it cannot be reused
      // for this branch.
      if (action === 'wait') {
        load();
        return;
      }
      handleErrorAction(action);
    },
    [handleErrorAction, load],
  );

  if (task.view === 'stage' && task.currentGenerationId) {
    return (
      <GenerateStage
        key={task.currentGenerationId}
        projectId={projectId}
        generationId={task.currentGenerationId}
        initialSnapshot={task.snapshot}
        onSnapshot={receiveSnapshot}
        onBack={backToCompose}
      />
    );
  }

  if (loadState.status === 'loading') {
    return (
      <div className={styles.loadingState} aria-live="polite">
        <span className={styles.loadingMark} />
        <p>{t('generate.loading')}</p>
      </div>
    );
  }

  if (loadState.status === 'error') {
    const actionLabelKey = getGenerateErrorActionLabelKey(
      loadState.error.action,
    );
    return (
      <div className={styles.errorState} role="alert">
        <strong>{t(loadState.error.messageKey)}</strong>
        {loadState.error.requestId ? (
          <small>
            {t('generate.error.requestId', {
              requestId: loadState.error.requestId,
            })}
          </small>
        ) : null}
        {actionLabelKey ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleBootstrapErrorAction(loadState.error.action)}
          >
            {t(actionLabelKey)}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <GenerateCompose
      projectId={projectId}
      sessions={loadState.data.sessions}
      activeSessionId={activeSessionId}
      sessionBusy={sessionBusy}
      sessionError={sessionError ? t('generate.sessionError') : null}
      hasConfiguredProviders={loadState.data.providers.length > 0}
      maxTargets={MAX_GENERATION_TARGETS}
      models={models}
      selectedKeys={selectedKeys}
      controls={controls}
      prompt={prompt}
      aspectRatio={aspectRatio}
      count={count}
      seed={seed}
      negativePrompt={negativePrompt}
      formError={
        formError
          ? t(
              formError,
              formError === 'generate.validationTargetsLimit'
                ? { count: MAX_GENERATION_TARGETS }
                : undefined,
            )
          : null
      }
      submissionError={submissionError}
      submitting={submitting}
      currentGenerationId={task.currentGenerationId}
      currentSnapshot={task.snapshot}
      onSessionChange={changeSession}
      onCreateSession={createSession}
      onRenameSession={renameSession}
      onPromptChange={(value) => {
        setPrompt(value);
        setFormError(null);
        setSubmissionError(null);
      }}
      onToggleModel={(key) => {
        setSelectedKeys((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else if (next.size < MAX_GENERATION_TARGETS) next.add(key);
          return next;
        });
        setFormError(
          selectedKeys.has(key) || selectedKeys.size < MAX_GENERATION_TARGETS
            ? null
            : 'generate.validationTargetsLimit',
        );
        setSubmissionError(null);
      }}
      onAspectRatioChange={(value) => {
        setAspectRatio(value);
        setSubmissionError(null);
      }}
      onCountChange={(value) => {
        setCount(value);
        setSubmissionError(null);
      }}
      onSeedChange={(value) => {
        setSeed(value);
        setSubmissionError(null);
      }}
      onNegativePromptChange={(value) => {
        setNegativePrompt(value);
        setSubmissionError(null);
      }}
      onClear={() => {
        setPrompt('');
        setFormError(null);
        setSubmissionError(null);
      }}
      onSubmit={() => void submit()}
      onSubmissionAction={handleErrorAction}
      onOpenCurrentTask={openCurrentTask}
    />
  );
}
