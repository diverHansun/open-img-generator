import styles from './page-header.module.css';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        <div className={styles.titleRow}>
          <h1>{title}</h1>
          {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        </div>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
