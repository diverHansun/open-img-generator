'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { CapabilityList } from '@/components/capabilities/capability-list';
import { useLocale } from '@/components/i18n/locale-provider';
import { Switch } from '@/components/ui/switch';

import type { ModelViewRow } from './model-view';
import styles from './models.module.css';

export type ModelRowState = {
  confirmedEnabled: boolean;
  displayedEnabled: boolean;
  saving: boolean;
  error: boolean;
};

export function ModelRow({
  row,
  state,
  expanded,
  onExpandedChange,
  onEnabledChange,
}: {
  row: ModelViewRow;
  state: ModelRowState;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const { t } = useLocale();
  const detailsId = React.useId();
  const modes = row.capability.modes
    .map((mode) =>
      t(mode === 'text-to-image' ? 'capabilities.textToImage' : 'capabilities.imageToImage'),
    )
    .join(' · ');
  const protocol = t(
    row.capability.protocol === 'sync' ? 'capabilities.sync' : 'capabilities.async',
  );

  return (
    <li className={styles.modelItem}>
      <div className={styles.modelRow}>
        <button
          className={styles.disclosureTrigger}
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={t(expanded ? 'models.collapseAria' : 'models.expandAria', {
            model: row.capability.displayName,
          })}
          onClick={() => onExpandedChange(!expanded)}
        >
          <ChevronDown aria-hidden="true" data-expanded={expanded ? 'true' : 'false'} />
          <span className={styles.modelIdentity}>
            <strong>{row.capability.displayName}</strong>
            <code>{row.capability.model}</code>
          </span>
        </button>

        <span className={styles.modelMeta}>{modes}</span>
        <span className={styles.modelMeta}>{protocol}</span>
        <span className={styles.switchCell}>
          {state.saving ? <span className={styles.savingDot} aria-hidden="true" /> : null}
          <span className="sr-only" aria-live="polite">
            {state.saving
              ? t('models.savingAria', { model: row.capability.displayName })
              : ''}
          </span>
          <Switch
            checked={state.displayedEnabled}
            disabled={state.saving}
            aria-label={t('models.switchAria', { model: row.capability.displayName })}
            onCheckedChange={onEnabledChange}
          />
        </span>
      </div>

      {state.error ? (
        <p className={styles.rowError} role="alert">
          {t('models.saveError')}
        </p>
      ) : null}

      {expanded ? (
        <section
          className={styles.modelDetails}
          id={detailsId}
          aria-label={t('models.capabilities', { model: row.capability.displayName })}
        >
          <CapabilityList capability={row.capability} />
        </section>
      ) : null}
    </li>
  );
}
