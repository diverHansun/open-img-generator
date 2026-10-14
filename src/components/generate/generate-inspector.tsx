'use client';

import * as React from 'react';
import Link from 'next/link';

import { useLocale } from '@/components/i18n/locale-provider';
import { Input } from '@/components/ui/input';
import { workspaceRoute } from '@/lib/routes';
import type { GenerationControls, GenerationTarget } from '@/lib/web-client';

import {
  parseGenerateCountInput,
  type AvailableModelTarget,
} from './generate-state';
import styles from './generate-screen.module.css';

function targetKey(target: GenerationTarget): string {
  return target.provider + ':' + target.model;
}

function providerCode(provider: string): string {
  return provider.slice(0, 2).toUpperCase();
}

export type GenerateInspectorProps = {
  projectId: string;
  hasConfiguredProviders: boolean;
  models: AvailableModelTarget[];
  selectedKeys: ReadonlySet<string>;
  controls: GenerationControls;
  aspectRatio: string;
  count: number;
  countInput: string;
  seed: string;
  negativePrompt: string;
  onToggleModel: (key: string) => void;
  onAspectRatioChange: (value: string) => void;
  onCountChange: (value: string) => void;
  onSeedChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
};

export function GenerateInspector({
  projectId,
  hasConfiguredProviders,
  models,
  selectedKeys,
  controls,
  aspectRatio,
  countInput,
  seed,
  negativePrompt,
  onToggleModel,
  onAspectRatioChange,
  onCountChange,
  onSeedChange,
  onNegativePromptChange,
}: GenerateInspectorProps) {
  const { t } = useLocale();
  const countInputId = 'generation-count';
  const countHintId = countInputId + '-hint';
  const validCount = parseGenerateCountInput(countInput, controls.maxCount);
  const hasCountError = controls.maxCount > 0 && validCount === null;

  return (
    <div className={styles.inspectorStack}>
      <section className={styles.paramCard} aria-label={t('generate.inspectorTitle')}>
        <div className={styles.paramRow}>
          <span className={styles.paramLabel}>{t('generate.aspectRatio')}</span>
          <div className={styles.segs} role="group" aria-label={t('generate.aspectRatio')}>
            {controls.aspectRatios.map((ratio) => (
              <button
                key={ratio}
                type="button"
                className={ratio === aspectRatio ? styles.segOn : styles.segOpt}
                aria-pressed={ratio === aspectRatio}
                onClick={() => onAspectRatioChange(ratio)}
              >
                {ratio}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.paramRow}>
          <label className={styles.paramLabel} htmlFor={countInputId}>
            <span>{t('generate.count')}</span>
            {controls.maxCount > 0 ? (
              <small
                id={countHintId}
                className={styles.countHint}
                data-invalid={hasCountError || undefined}
                role={hasCountError ? 'alert' : undefined}
              >
                {hasCountError
                  ? t('generate.countRangeError', { max: controls.maxCount })
                  : `1–${controls.maxCount}`}
              </small>
            ) : null}
          </label>
          <div className={styles.countControls}>
            <Input
              id={countInputId}
              className={styles.countNumberInput}
              type="number"
              min={1}
              max={Math.max(1, controls.maxCount)}
              step={1}
              inputMode="numeric"
              value={countInput}
              disabled={controls.maxCount === 0}
              aria-invalid={hasCountError || undefined}
              aria-describedby={controls.maxCount > 0 ? countHintId : undefined}
              onChange={(event) => onCountChange(event.target.value)}
            />
          </div>
        </div>

        {controls.canSetSeed || controls.canSetNegativePrompt ? (
          <details className={styles.advanced}>
            <summary>{t('generate.advanced')}</summary>
            <div className={styles.advancedFields}>
              {controls.canSetSeed ? (
                <label className={styles.advRow}>
                  <span>{t('generate.seed')}</span>
                  <Input
                    inputMode="numeric"
                    value={seed}
                    placeholder={t('generate.randomSeed')}
                    onChange={(event) => onSeedChange(event.target.value)}
                  />
                </label>
              ) : null}
              {controls.canSetNegativePrompt ? (
                <label className={styles.advStack}>
                  <span>{t('generate.negativePrompt')}</span>
                  <textarea
                    rows={2}
                    value={negativePrompt}
                    placeholder={t('generate.negativePlaceholder')}
                    onChange={(event) => onNegativePromptChange(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          </details>
        ) : null}
      </section>

      <section className={styles.modelsSection}>
        <div className={styles.sectionHead}>
          <h2>{t('generate.modelsTitle')}</h2>
          <span>
            {t('generate.modelsSelected', {
              selected: selectedKeys.size,
              total: models.length,
            })}
          </span>
        </div>

        {models.length > 0 ? (
          <div className={styles.modelList}>
            {models.map((model) => {
              const key = targetKey(model.target);
              const checked = selectedKeys.has(key);
              return (
                <label
                  className={checked ? styles.modelRowSelected : styles.modelRow}
                  key={key}
                >
                  <span className={styles.providerGlyph} aria-hidden="true">
                    {providerCode(model.target.provider)}
                  </span>
                  <span className={styles.modelCopy}>
                    <strong>{model.displayName}</strong>
                    <small>{model.providerName}</small>
                  </span>
                  <span className={styles.protoBadge}>
                    {t(
                      model.protocol === 'sync'
                        ? 'generate.protocol.sync'
                        : 'generate.protocol.async',
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleModel(key)}
                  />
                </label>
              );
            })}
          </div>
        ) : (
          <div className={styles.inspectorEmpty}>
            <p>
              {t(
                hasConfiguredProviders
                  ? 'generate.noModels'
                  : 'generate.noProviders',
              )}
            </p>
            <div className={styles.textLinks}>
              <Link href={workspaceRoute(projectId, 'providers')}>
                {t('generate.configureProviders')}
              </Link>
              <Link href={workspaceRoute(projectId, 'models')}>
                {t('generate.manageModels')}
              </Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
