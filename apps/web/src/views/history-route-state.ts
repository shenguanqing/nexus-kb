import type { LocationQuery, LocationQueryRaw } from 'vue-router';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface HistoryRouteState {
  query: string;
  conversationId: string | null;
}

function stringValue(value: LocationQuery[string] | undefined): string {
  return typeof value === 'string' ? value : '';
}

export function readHistoryRouteState(routeQuery: LocationQuery): HistoryRouteState {
  const conversationId = stringValue(routeQuery.conversationId);
  return {
    query: stringValue(routeQuery.query),
    conversationId: UUID_V4_PATTERN.test(conversationId) ? conversationId : null,
  };
}

export function buildHistoryRouteQuery(state: HistoryRouteState): LocationQueryRaw {
  return {
    query: state.query.trim() || undefined,
    conversationId: state.conversationId ?? undefined,
  };
}
