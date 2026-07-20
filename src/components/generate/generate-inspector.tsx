'use client';

import Link from 'next/link';

import { useLocale } from '@/components/i18n/locale-provider';
import { Input } from '@/components/ui/input';
import { workspaceRoute } from '@/lib/routes';
import type { GenerationControls, GenerationTarget } from '@/lib/web-client';

import type { AvailableModelTarget } from './generate-state';
import styles from './generate-screen.module.css';

function targetKey(target: GenerationTarget): string {
  return target.provider + ':' + target.model;
}

export type GenerateInspectorProps = {
  projectId: string;
  hasConfiguredProviders: boolean;
  maxTargets: number;
  models: AvailableModelTarget[];
  selectedKeys: ReadonlySet<string>;
  controls: GenerationControls;
  aspectRatio: string;
  count: number;
  seed: string;
  negativePrompt: string;
  onToggleModel: (key: string) => void;
  onAspectRatioChange: (value: string) => void;
  onCountChange: (value: number) => void;
  onSeedChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
};

export function GenerateInspector({
  projectId,
  hasConfiguredProviders,
  maxTargets,
  models,
  selectedKeys,
  controls,
  aspectRatio,
  count,
  seed,
  negativePrompt,
  onToggleModel,
  onAspectRatioChange,
  onCountChange,
  onSeedChange,
  onNegativePromptChange,
}: GenerateInspectorProps) {
  const { t } = useLocale();

  return (
    <details className={styles.inspector} open>
      <summary className={styles.inspectorSummary}>
        <span>{t('generate.inspectorTitle')}</span>
        <span>
          {t('generate.modelsSelected', {
            selected: selectedKeys.size,
            total: models.length,
          })}
        </span>
      </summary>

      <div className={styles.inspectorBody}>
        <div className={styles.inspectorHeading}>
          <h2>{t('generate.inspectorTitle')}</h2>
          <span>
            {t('generate.generationImpact', {
              calls: selectedKeys.size,
              images: selectedKeys.size * count,
            })}
          </span>
        </div>

        {models.length > 0 ? (
          <div className={styles.modelList}>
            {models.map((model) => {
              const key = targetKey(model.target);
              return (
                <label className={styles.modelRow} key={key}>
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(key)}
                    disabled={
                      !selectedKeys.has(key) && selectedKeys.size >= maxTargets
                    }
                    onChange={() => onToggleModel(key)}
                  />
                  <span className={styles.modelCopy}>
                    <strong>{model.displayName}</strong>
                    <small>
                      {model.providerName} ·{' '}
                      {t(
                        model.protocol === 'sync'
                          ? 'generate.protocol.sync'
                          : 'generate.protocol.async',
                      )}
                    </small>
                  </span>
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

        <div className={styles.parameterGrid}>
          <label>
            <span>{t('generate.aspectRatio')}</span>
            <select
              value={aspectRatio}
              disabled={controls.aspectRatios.length === 0}
              onChange={(event) => onAspectRatioChange(event.target.value)}
            >
              {controls.aspectRatios.map((ratio) => (
                <option value={ratio} key={ratio}>
                  {ratio}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('generate.count')}</span>
            <Input
              type="number"
              min={1}
              max={Math.max(1, controls.maxCount)}
              value={count}
              disabled={controls.maxCount === 0}
              onChange={(event) => onCountChange(Number(event.target.value))}
            />
          </label>
        </div>

        <details className={styles.advanced}>
          <summary>{t('generate.advanced')}</summary>
          <div className={styles.advancedFields}>
            {controls.canSetSeed ? (
              <label>
                <span>{t('generate.seed')}</span>
                <Input
                  inputMode="numeric"
                  value={seed}
                  onChange={(event) => onSeedChange(event.target.value)}
                />
              </label>
            ) : null}
            {controls.canSetNegativePrompt ? (
              <label>
                <span>{t('generate.negativePrompt')}</span>
                <textarea
                  rows={3}
                  value={negativePrompt}
                  placeholder={t('generate.negativePlaceholder')}
                  onChange={(event) => onNegativePromptChange(event.target.value)}
                />
              </label>
            ) : null}
          </div>
        </details>
      </div>
    </details>
  );
}
