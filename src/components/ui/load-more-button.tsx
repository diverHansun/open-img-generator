import { LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function LoadMoreButton({
  label,
  loadingLabel,
  loading,
  disabled = false,
  onClick,
  className,
}: {
  label: string;
  loadingLabel: string;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={loading || disabled}
      aria-busy={loading}
      onClick={onClick}
      className={cn('min-w-32', className)}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
      {loading ? loadingLabel : label}
    </Button>
  );
}
