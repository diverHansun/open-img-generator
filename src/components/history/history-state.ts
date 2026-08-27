import type {
  GenerationSummary,
  HistoryGroup,
  HistoryPage,
  Page,
} from '@/lib/web-client';

export function parseHistoryPage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function mergeUniqueGenerations(
  leading: ReadonlyArray<GenerationSummary>,
  trailing: ReadonlyArray<GenerationSummary>,
): GenerationSummary[] {
  const seen = new Set(leading.map((item) => item.id));
  return [
    ...leading,
    ...trailing.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  ];
}

/**
 * Revalidation refreshes the server-owned first ten rows while retaining older
 * rows that the reader explicitly appended in this tab.
 */
export function mergeHistoryRefresh(
  current: HistoryPage | null,
  incoming: HistoryPage,
): HistoryPage {
  if (
    !current ||
    current.projectId !== incoming.projectId ||
    current.page !== incoming.page
  ) {
    return incoming;
  }

  const previousBySession = new Map(
    current.groups.map((group) => [group.session.id, group]),
  );
  return {
    ...incoming,
    groups: incoming.groups.map((group) => {
      const previous = previousBySession.get(group.session.id);
      if (!previous || previous.items.length <= group.items.length) return group;
      return {
        ...group,
        items: mergeUniqueGenerations(group.items, previous.items),
        nextCursor: previous.nextCursor,
      };
    }),
  };
}

export function appendHistoryGroupPage(
  group: HistoryGroup,
  page: Page<GenerationSummary>,
): HistoryGroup {
  return {
    ...group,
    items: mergeUniqueGenerations(group.items, page.items),
    nextCursor: page.nextCursor,
  };
}
