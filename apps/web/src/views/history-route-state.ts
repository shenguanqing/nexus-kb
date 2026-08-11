import type { LocationQuery, LocationQueryRaw } from 'vue-router';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_HISTORY_PAGE = 5_001;

export interface HistoryRouteState {
  query: string;
  from: Date | null;
  to: Date | null;
  page: number;
  conversationId: string | null;
}

function stringValue(value: LocationQuery[string] | undefined): string {
  return typeof value === 'string' ? value : '';
}

function dateValue(value: LocationQuery[string] | undefined): Date | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function readHistoryRouteState(routeQuery: LocationQuery): HistoryRouteState {
  const rawPage = Number(stringValue(routeQuery.page));
  const conversationId = stringValue(routeQuery.conversationId);
  return {
    query: stringValue(routeQuery.query),
    from: dateValue(routeQuery.from),
    to: dateValue(routeQuery.to),
    page:
      Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= MAX_HISTORY_PAGE ? rawPage : 1,
    conversationId: UUID_V4_PATTERN.test(conversationId) ? conversationId : null,
  };
}

export function buildHistoryRouteQuery(state: HistoryRouteState): LocationQueryRaw {
  return {
    query: state.query.trim() || undefined,
    from: state.from?.toISOString(),
    to: state.to?.toISOString(),
    page: state.page > 1 ? String(state.page) : undefined,
    conversationId: state.conversationId ?? undefined,
  };
}
