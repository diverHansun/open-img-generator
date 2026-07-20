import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';

import styles from './inline-notice.module.css';

const icons = {
  info: Info,
  warning: TriangleAlert,
  error: AlertCircle,
  success: CheckCircle2,
} as const;

export function InlineNotice({
  variant = 'info',
  title,
  children,
  action,
}: {
  variant?: keyof typeof icons;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Icon = icons[variant];
  return (
    <section
      className={styles.notice}
      data-variant={variant}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      <Icon aria-hidden="true" />
      <div className={styles.copy}>
        <strong>{title}</strong>
        {children ? <div className={styles.detail}>{children}</div> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </section>
  );
}
