'use client';

import {
  Ban,
  Check,
  CircleDot,
  Clock3,
  LoaderCircle,
  X,
} from 'lucide-react';

import { useLocale } from '@/components/i18n/locale-provider';
import type {
  GenerationStatus as GenerationStatusValue,
  JobView,
} from '@/lib/web-client';

import styles from './generation-status.module.css';

type DisplayStatus = GenerationStatusValue | 'partial';

export function deriveDisplayStatus(
  status: GenerationStatusValue,
  jobs?: ReadonlyArray<Pick<JobView, 'status'>>,
): DisplayStatus {
  if (!jobs?.length) return status;
  const allTerminal = jobs.every((job) =>
    ['completed', 'failed', 'cancelled'].includes(job.status),
  );
  const hasCompleted = jobs.some((job) => job.status === 'completed');
  const hasUnsuccessful = jobs.some(
    (job) => job.status === 'failed' || job.status === 'cancelled',
  );
  return allTerminal && hasCompleted && hasUnsuccessful ? 'partial' : status;
}

const icons = {
  pending: Clock3,
  running: LoaderCircle,
  completed: Check,
  failed: X,
  cancelled: Ban,
  partial: CircleDot,
} satisfies Record<DisplayStatus, typeof Clock3>;

export function GenerationStatus({
  status,
  jobs,
  compact = false,
}: {
  status: GenerationStatusValue;
  jobs?: ReadonlyArray<Pick<JobView, 'status'>>;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const displayStatus = deriveDisplayStatus(status, jobs);
  const Icon = icons[displayStatus];
  return (
    <span
      className={styles.status}
      data-status={displayStatus}
      data-compact={compact || undefined}
    >
      <Icon
        aria-hidden="true"
        className={displayStatus === 'running' ? styles.runningIcon : undefined}
      />
      <span>{t(`generation.status.${displayStatus}`)}</span>
    </span>
  );
}
