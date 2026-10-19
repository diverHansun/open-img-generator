'use client';

import * as React from 'react';
import { Edit3, Image as ImageIcon, Plus } from 'lucide-react';

import { useLocale } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  GenerationControls,
  GenerationView,
  Session,
} from '@/lib/web-client';

import { GenerateInspector } from './generate-inspector';
import { GenerateStage } from './generate-stage';
import { useWorkbenchResize } from './use-workbench-resize';
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
  onReceiveSnapshot: (snapshot: GenerationView) => void;
  onBackToCompose: () => void;
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
  onReceiveSnapshot,
  onBackToCompose,
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
}: GenerateComposeProps) {
  const { t } = useLocale();
  const [editingSession, setEditingSession] = React.useState(false);
  const [sessionDraft, setSessionDraft] = React.useState('');
  const workbenchId = React.useId();
  const { layoutRef, width, dragging, separatorProps } = useWorkbenchResize();

  const activeSession = sessions.find((item) => item.id === activeSessionId);
  const submissionActionLabelKey = submissionError
    ? getGenerateErrorActionLabelKey(submissionError.action)
    : null;

  const selectedModels = React.useMemo(
    () =>
      models.filter((item) =>
        selectedKeys.has(item.target.provider + ':' + item.target.model),
      ),
    [models, selectedKeys],
  );

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
    <div
      ref={layoutRef}
      className={styles.studioLayout}
      style={{ '--workbench-width': `${width}px` } as React.CSSProperties}
      data-resizing={dragging || undefined}
    >
      <aside id={workbenchId} className={styles.workbench}>
        <div className={styles.sessionBar}>
          <span className={styles.sessionTag}>{t('generate.sessionLabel')}</span>
          <label className={styles.sessionSelect}>
            <span className="sr-only">{t('generate.sessionLabel')}</span>
            <select
              value={activeSessionId}
              disabled={sessionBusy || sessions.length === 0}
              onChange={(event) => {
                setEditingSession(false);
                onSessionChange(event.target.value);
              }}
            >
              {sessions.map((session) => (
                <option value={session.id} key={session.id}>
                  {sessionTitle(session, t('generate.sessionUntitled'))}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.iconBtn}
            disabled={!activeSession || sessionBusy}
            aria-label={t('generate.renameSession')}
            title={t('generate.renameSession')}
            onClick={beginRename}
          >
            <Edit3 aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            disabled={sessionBusy}
            aria-label={t('generate.newSession')}
            title={t('generate.newSession')}
            onClick={() => void createSession()}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>

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

        <div className={styles.promptCard}>
          <div className={styles.promptHead}>
            <label htmlFor="generation-prompt">{t('generate.composeTitle')}</label>
            <span className={styles.promptCount}>
              {t('generate.promptCount', { count: prompt.length })}
            </span>
          </div>
          <textarea
            id="generation-prompt"
            rows={5}
            value={prompt}
            placeholder={t('generate.promptPlaceholder')}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          <div className={styles.promptFoot}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={submitting || prompt.length === 0}
              onClick={onClear}
            >
              {t('generate.clear')}
            </Button>
            <span className={styles.impactNote}>
              {t('generate.generationImpact', {
                calls: selectedKeys.size,
                images: selectedKeys.size * count,
              })}
            </span>
            <Button type="button" size="sm" disabled={submitting} onClick={onSubmit}>
              {t(submitting ? 'generate.submitting' : 'generate.submit')}
            </Button>
          </div>
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
                variant="secondary"
                onClick={() => onSubmissionAction(submissionError.action)}
              >
                {t(submissionActionLabelKey)}
              </Button>
            ) : null}
          </div>
        ) : null}

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
      </aside>

      <div
        {...separatorProps}
        className={styles.splitter}
        aria-controls={workbenchId}
        aria-label={t('generate.resizeWorkbench')}
        aria-valuetext={t('generate.workbenchWidth', { width })}
        aria-description={t('generate.resizeKeyboardHint')}
        title={t('generate.resizeHint')}
      />

      <section className={styles.stagePane}>
        {currentGenerationId ? (
          <GenerateStage
            key={currentGenerationId}
            projectId={projectId}
            generationId={currentGenerationId}
            initialSnapshot={currentSnapshot}
            onSnapshot={onReceiveSnapshot}
            onBack={onBackToCompose}
          />
        ) : (
          <div className={styles.standbyStage}>
            <div className={styles.standbyBar}>
              <span className={styles.standbyTitle}>{t('generate.currentTask')}</span>
              <span className={styles.standbyMeta}>
                {aspectRatio || '1:1'} ·{' '}
                {t('generate.generationImpact', {
                  calls: selectedKeys.size,
                  images: selectedKeys.size * count,
                })}
              </span>
            </div>
            <div className={styles.standbyBody}>
              <div
                className={styles.standbyFrame}
                data-ratio={aspectRatio || '1:1'}
              >
                <ImageIcon aria-hidden="true" />
                <strong>{t('generate.composeTitle')}</strong>
                <p>{t('generate.description')}</p>
                {selectedModels.length > 0 ? (
                  <div className={styles.standbyChips}>
                    {selectedModels.map((model) => (
                      <span
                        key={model.target.provider + ':' + model.target.model}
                        className={styles.standbyChip}
                      >
                        <b>{model.displayName}</b>
                        <small>{model.providerName}</small>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
