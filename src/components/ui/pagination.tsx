import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';

type PaginationItem = number | 'ellipsis-start' | 'ellipsis-end';

export function getPaginationItems(
  currentPage: number,
  totalPages: number,
): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages]);
  for (
    let page = Math.max(2, currentPage - 1);
    page <= Math.min(totalPages - 1, currentPage + 1);
    page += 1
  ) {
    pages.add(page);
  }
  const ordered = [...pages].sort((left, right) => left - right);
  const items: PaginationItem[] = [];
  ordered.forEach((page, index) => {
    const previous = ordered[index - 1];
    if (previous !== undefined && page - previous > 1) {
      items.push(previous === 1 ? 'ellipsis-start' : 'ellipsis-end');
    }
    items.push(page);
  });
  return items;
}

export function Pagination({
  currentPage,
  totalPages,
  previousLabel,
  nextLabel,
  pageLabel,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  previousLabel: string;
  nextLabel: string;
  pageLabel: (page: number) => string;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label={pageLabel(currentPage)} className="flex flex-wrap items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        <ChevronLeft aria-hidden="true" />
        {previousLabel}
      </Button>

      {getPaginationItems(currentPage, totalPages).map((item) =>
        typeof item === 'number' ? (
          <Button
            key={item}
            type="button"
            variant={item === currentPage ? 'secondary' : 'ghost'}
            size="sm"
            aria-current={item === currentPage ? 'page' : undefined}
            aria-label={pageLabel(item)}
            onClick={() => onPageChange(item)}
            className="min-w-9 px-2"
          >
            {item}
          </Button>
        ) : (
          <span key={item} className="grid size-9 place-items-center text-muted-foreground">
            <MoreHorizontal aria-hidden="true" className="size-4" />
            <span className="sr-only">…</span>
          </span>
        ),
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        {nextLabel}
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}
