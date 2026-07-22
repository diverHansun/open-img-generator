'use client';

import * as React from 'react';
import { ArrowRight, Edit3, Plus, Sparkles } from 'lucide-react';

import { useLocale } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  GenerationControls,
  GenerationView,
  Session,
} from '@/lib/web-client';

import { GenerateInspector } from './generate-inspector';
import {
  getGenerateErrorActionLabelKey,
  type GenerateErrorAction,
  type GenerateErrorPresentation,
} from './generate-error';
import type { AvailableModelTarget } from './generate-state';
import styles from './generate-screen.module.css';

export type GenerateComposeProps = {
  projectId: string;
  sessions: Session[];
  activeSessionId: string;
  sessionBusy: boolean;
  sessionError: string | null;
  hasConfiguredProviders: boolean;
  models: AvailableModelTarget[];
  selectedKeys: ReadonlySet<string>;
  controls: GenerationControls;
  prompt: string;
  aspectRatio: string;
  count: number;
  countInput: string;
  seed: string;
  negativePrompt: string;
  formError: string | null;
  submissionError: GenerateErrorPresentation | null;
  submitting: boolean;
  currentGenerationId: string | null;
  currentSnapshot: GenerationView | null;
  onSessionChange: (id: string) => void;
  onCreateSession: () => Promise<Session | null>;
  onRenameSession: (id: string, title: string) => Promise<boolean>;
  onPromptChange: (value: string) => void;
  onToggleModel: (key: string) => void;
  onAspectRatioChange: (value: string) => void;
  onCountChange: (value: string) => void;
  onSeedChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  onSubmissionAction: (action: GenerateErrorAction) => void;
  onOpenCurrentTask: () => void;
};

function sessionTitle(session: Session, fallback: string): string {
  return session.title?.trim() || fallback;
}

export function GenerateCompose({
  projectId,
  sessions,
  activeSessionId,
  sessionBusy,
  sessionError,
  hasConfiguredProviders,
  models,
  selectedKeys,
  controls,
  prompt,
  aspectRatio,
  count,
  countInput,
  seed,
  negativePrompt,
  formError,
  submissionError,
  submitting,
  currentGenerationId,
  currentSnapshot,
  onSessionChange,
  onCreateSession,
  onRenameSession,
  onPromptChange,
  onToggleModel,
  onAspectRatioChange,
  onCountChange,
  onSeedChange,
  onNegativePromptChange,
  onClear,
  onSubmit,
  onSubmissionAction,
  onOpenCurrentTask,
}: GenerateComposeProps) {
  const { t } = useLocale();
  const [editingSession, setEditingSession] = React.useState(false);
  const [sessionDraft, setSessionDraft] = React.useState('');

  const activeSession = sessions.find((item) => item.id === activeSessionId);
  const submissionActionLabelKey = submissionError
    ? getGenerateErrorActionLabelKey(submissionError.action)
    : null;

  const beginRename = React.useCallback(() => {
    if (!activeSession) return;
    setSessionDraft(activeSession.title ?? '');
    setEditingSession(true);
  }, [activeSession]);

  const createSession = React.useCallback(async () => {
    const created = await onCreateSession();
    if (!created) return;
    setSessionDraft(created.title ?? '');
    setEditingSession(true);
  }, [onCreateSession]);

  const saveSession = React.useCallback(async () => {
    if (!activeSessionId) return;
    const saved = await onRenameSession(activeSessionId, sessionDraft);
    if (saved) setEditingSession(false);
  }, [activeSessionId, onRenameSession, sessionDraft]);

  return (
    <div className={styles.composeLayout}>
      <section className={styles.composeMain}>
        <header className={styles.pageToolbar}>
          <div className={styles.compactTitle}>
            <span>{t('generate.eyebrow')}</span>
            <h1>{t('generate.title')}</h1>
          </div>

          <div className={styles.sessionTools}>
            <label className={styles.sessionSelect}>
              <span className="sr-only">{t('generate.sessionLabel')}</span>
              <select
                value={activeSessionId}
                disabled={sessionBusy || sessions.length === 0}
                onChange={(event) => onSessionChange(event.target.value)}
              >
                {sessions.map((session) => (
                  <option value={session.id} key={session.id}>
                    {sessionTitle(session, t('generate.sessionUntitled'))}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={!activeSession || sessionBusy}
              aria-label={t('generate.renameSession')}
              onClick={beginRename}
            >
              <Edit3 aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={sessionBusy}
              aria-label={t('generate.newSession')}
              onClick={() => void createSession()}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </header>

        {editingSession ? (
          <div className={styles.sessionEditor}>
            <Input
              aria-label={t('generate.sessionName')}
              autoFocus
              value={sessionDraft}
              placeholder={t('generate.sessionName')}
              onChange={(event) => setSessionDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveSession();
                if (event.key === 'Escape') setEditingSession(false);
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={sessionBusy}
              onClick={() => void saveSession()}
            >
              {t('generate.saveSession')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditingSession(false)}
            >
              {t('generate.cancelSessionEdit')}
            </Button>
          </div>
        ) : null}

        {sessionError ? (
          <p className={styles.inlineError} role="alert">
            {sessionError}
          </p>
        ) : null}

        <div className={styles.promptArea}>
          <label htmlFor="generation-prompt">{t('generate.composeTitle')}</label>
          <textarea
            id="generation-prompt"
            maxLength={4000}
            rows={7}
            value={prompt}
            placeholder={t('generate.promptPlaceholder')}
            onChange={(event) => onPromptChange(event.target.value)}
          />
          <span className={styles.promptCount}>
            {t('generate.promptCount', { count: prompt.length })}
          </span>
        </div>

        {formError ? (
          <p className={styles.inlineError} role="alert">
            {formError}
          </p>
        ) : null}

        {submissionError ? (
          <div className={styles.submissionNotice} role="alert">
            <p>{t(submissionError.messageKey)}</p>
            {submissionError.retryAfterSeconds !== undefined ? (
              <small>
                {t('generate.error.retryAfter', {
                  seconds: submissionError.retryAfterSeconds,
                })}
              </small>
            ) : null}
            {submissionError.requestId ? (
              <small>
                {t('generate.error.requestId', {
                  requestId: submissionError.requestId,
                })}
              </small>
            ) : null}
            {submissionActionLabelKey ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onSubmissionAction(submissionError.action)}
              >
                {t(submissionActionLabelKey)}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className={styles.composeActions}>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting || prompt.length === 0}
            onClick={onClear}
          >
            {t('generate.clear')}
          </Button>
          <Button type="button" disabled={submitting} onClick={onSubmit}>
            <Sparkles aria-hidden="true" />
            {t(submitting ? 'generate.submitting' : 'generate.submit')}
          </Button>
        </div>

        {currentGenerationId ? (
          <button
            type="button"
            className={styles.currentTask}
            onClick={onOpenCurrentTask}
          >
            <span>
              <strong>{t('generate.currentTask')}</strong>
              <small>
                {currentSnapshot
                  ? t('generate.currentTaskImages', {
                      count: currentSnapshot.images.length,
                    })
                  : t('generate.currentTaskNoImages')}
              </small>
            </span>
            <span className={styles.currentTaskAction}>
              {t('generate.currentTaskOpen')}
              <ArrowRight aria-hidden="true" />
            </span>
          </button>
        ) : null}
      </section>

      <GenerateInspector
        projectId={projectId}
        hasConfiguredProviders={hasConfiguredProviders}
        models={models}
        selectedKeys={selectedKeys}
        controls={controls}
        aspectRatio={aspectRatio}
        count={count}
        countInput={countInput}
        seed={seed}
        negativePrompt={negativePrompt}
        onToggleModel={onToggleModel}
        onAspectRatioChange={onAspectRatioChange}
        onCountChange={onCountChange}
        onSeedChange={onSeedChange}
        onNegativePromptChange={onNegativePromptChange}
      />
    </div>
  );
}
