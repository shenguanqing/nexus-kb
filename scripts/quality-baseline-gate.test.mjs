import assert from 'node:assert/strict';
import test from 'node:test';

import { assertQualityBaselineGate } from './quality-baseline-gate.mjs';

const dataset = {
  decisionPolicy: {
    minFinalRecallAt5: 0.7,
    minMrr: 0.7,
    minCitationAccuracy: 0.9,
    minNoAnswerRejectionRate: 0.95,
    maxErrorRate: 0.05,
  },
};
const report = {
  variants: {
    vector_top_5: {
      finalRecallAt5: 0.8,
      mrr: 0.75,
      citationAccuracy: 0.95,
      noAnswerRejectionRate: 1,
      unauthorizedLeakRate: 0,
      errorRate: 0,
      costCoverage: 1,
      averageCostUsd: 0.001,
    },
    vector_top_20_rerank_top_5: {
      finalRecallAt5: 0.8,
      mrr: 0.75,
      citationAccuracy: 0.95,
      noAnswerRejectionRate: 1,
      unauthorizedLeakRate: 0,
      errorRate: 0,
      costCoverage: 1,
      averageCostUsd: 0.001,
    },
  },
  rerankRecommendation: { decision: 'keep_disabled', reasons: ['QUALITY_GAIN_BELOW_POLICY'] },
};

test('accepts a complete baseline that meets the approved dataset policy', () => {
  assert.doesNotThrow(() => assertQualityBaselineGate(dataset, report));
});

test('fails closed on citation regression, leakage or incomplete cost', () => {
  assert.throws(() =>
    assertQualityBaselineGate(dataset, {
      ...report,
      variants: {
        vector_top_5: {
          ...report.variants.vector_top_5,
          citationAccuracy: 0.89,
          unauthorizedLeakRate: 0.01,
          costCoverage: 0.9,
        },
      },
    }),
  );
});

test('fails closed when the rerank candidate leaks an unauthorized source', () => {
  assert.throws(
    () =>
      assertQualityBaselineGate(dataset, {
        ...report,
        variants: {
          ...report.variants,
          vector_top_20_rerank_top_5: {
            ...report.variants.vector_top_20_rerank_top_5,
            unauthorizedLeakRate: 0.01,
          },
        },
        rerankRecommendation: {
          decision: 'keep_disabled',
          reasons: ['RERANK_UNAUTHORIZED_LEAK_RATE_NONZERO'],
        },
      }),
    /RERANK_UNAUTHORIZED_LEAK_RATE/,
  );
});
