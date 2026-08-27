'use client';

import { Eye, EyeOff } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import styles from './password-field.module.css';

export function PasswordField({
  visible,
  onVisibleChange,
  showLabel,
  hideLabel,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'> & {
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  showLabel: string;
  hideLabel: string;
}) {
  const label = visible ? hideLabel : showLabel;
  return (
    <div className={cn(styles.field, className)}>
      <Input className={styles.input} type={visible ? 'text' : 'password'} {...props} />
      <button
        className={styles.toggle}
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={visible}
        disabled={props.disabled}
        onClick={() => onVisibleChange(!visible)}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </div>
  );
}
