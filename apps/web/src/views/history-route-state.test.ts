import { describe, expect, it } from 'vitest';
import { buildHistoryRouteQuery, readHistoryRouteState } from './history-route-state';

const conversationId = '5b9fd225-a565-42cd-8d63-1fc3f19b745d';

describe('history route state', () => {
  it('round-trips the selected conversation, page, and filters', () => {
    const state = readHistoryRouteState({
      query: '付款',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-11T00:00:00.000Z',
      page: '2',
      conversationId,
    });

    expect(state).toMatchObject({ query: '付款', page: 2, conversationId });
    expect(buildHistoryRouteQuery(state)).toEqual({
      query: '付款',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-11T00:00:00.000Z',
      page: '2',
      conversationId,
    });
  });

  it('rejects invalid conversation, date, and page parameters', () => {
    expect(
      readHistoryRouteState({
        conversationId: '../other-user',
        from: 'invalid',
        page: '-1',
      }),
    ).toMatchObject({ conversationId: null, from: null, page: 1 });
  });
});
