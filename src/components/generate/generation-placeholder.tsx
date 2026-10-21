import * as React from 'react';

import { useLocale } from '@/components/i18n/locale-provider';
import type { JobView } from '@/lib/web-client';

import styles from './generation-placeholder.module.css';
import { placeholderLight } from './placeholder-light';

/** Decorative waiting material, not a preview of the provider's diffusion steps. */
export function GenerationPlaceholder({
  job,
  lightSeed = job.id,
  compact = false,
}: {
  job: JobView;
  /** Kept stable when a provisional job is replaced by the stored one. */
  lightSeed?: string;
  compact?: boolean;
}) {
  const { t } = useLocale();
  // Stable between snapshots, but adjacent jobs should not move in lockstep.
  const light = React.useMemo(() => placeholderLight(lightSeed), [lightSeed]);
  const status = t(job.status === 'pending' ? 'generate.status.pending' : 'generate.status.running');

  return (
    <figure
      className={compact ? styles.thumbnail : styles.placeholder}
      data-generation-placeholder={job.id}
      data-status={job.status}
      style={light as React.CSSProperties}
    >
      <div className={styles.frame} aria-hidden="true">
        <div className={styles.pigmentA} />
        <div className={styles.pigmentB} />
        <div className={styles.halo} />
        <div className={styles.sheen} />
        <div className={styles.grain} />
      </div>
      <figcaption className={compact ? 'sr-only' : styles.caption}>
        <span title={`${job.provider} · ${job.model}`}>{job.provider} · {job.model}</span>
        <span>{status}</span>
      </figcaption>
    </figure>
  );
}
