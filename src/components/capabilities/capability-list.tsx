'use client';

import { useLocale } from '@/components/i18n/locale-provider';
import type { ProviderCapabilities, ProviderMode } from '@/lib/web-client';

import styles from './capability-list.module.css';

function join(values: string[]): string {
  return values.join(' · ');
}

export function CapabilityList({ capability }: { capability: ProviderCapabilities }) {
  const { t } = useLocale();
  const modeLabel = (mode: ProviderMode) =>
    t(mode === 'text-to-image' ? 'capabilities.textToImage' : 'capabilities.imageToImage');
  const supportLabel = (supported: boolean) =>
    t(supported ? 'capabilities.supported' : 'capabilities.notSupported');

  const rows = [
    [t('capabilities.modes'), join(capability.modes.map(modeLabel))],
    [
      t('capabilities.protocol'),
      t(capability.protocol === 'sync' ? 'capabilities.sync' : 'capabilities.async'),
    ],
    [t('capabilities.maxCount'), String(capability.maxCount)],
    [t('capabilities.defaultSize'), capability.defaultSize],
    capability.supportedSizes.length > 0
      ? [t('capabilities.sizes'), join(capability.supportedSizes)]
      : null,
    capability.supportedAspectRatios.length > 0
      ? [t('capabilities.aspectRatios'), join(capability.supportedAspectRatios)]
      : null,
    [t('capabilities.negativePrompt'), supportLabel(capability.supportsNegativePrompt)],
    [t('capabilities.seed'), supportLabel(capability.supportsSeed)],
  ].filter((row): row is string[] => row !== null);

  return (
    <dl className={styles.list}>
      {rows.map(([label, value]) => (
        <div className={styles.row} key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
