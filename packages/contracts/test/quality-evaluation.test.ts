import { describe, expect, it } from 'vitest';

import {
  qualityEvaluationDatasetSchema,
  qualityEvaluationRunSchema,
} from '../src/quality-evaluation';

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function cases() {
  return Array.from({ length: 30 }, (_, index) => {
    const kind = index < 24 ? 'answerable' : index < 27 ? 'no_answer' : 'unauthorized';
    return {
      id: `case-${index.toString().padStart(2, '0')}`,
      kind,
      identityProfile: kind === 'unauthorized' ? 'restricted-user' : 'standard-user',
      question: `脱敏合成测试问题 ${index}`,
      expectedAnswer: kind === 'no_answer' ? null : `脱敏标准答案 ${index}`,
      expectedSources:
        kind === 'no_answer'
          ? []
          : [{ documentId: uuid(index + 1), page: index + 1, sheet: null, chunkIds: [] }],
      tags: ['synthetic-test'],
    };
  });
}

const decisionPolicy = {
  minFinalRecallAt5: 0.7,
  minMrr: 0.7,
  minCitationAccuracy: 0.95,
  minNoAnswerRejectionRate: 0.95,
  maxErrorRate: 0.05,
  minRecallGain: 0.02,
  minMrrGain: 0.02,
  maxCitationAccuracyRegression: 0.01,
  maxNoAnswerRejectionRegression: 0.02,
  maxP95LatencyRatio: 1.5,
  maxAverageCostRatio: 1.25,
};

describe('quality evaluation contracts', () => {
  it('requires 30-100 unique cases including all security outcomes', () => {
    const dataset = qualityEvaluationDatasetSchema.parse({
      schemaVersion: 1,
      datasetId: 'local-real-v1',
      name: 'Local real questions',
      createdAt: '2026-07-18T00:00:00.000Z',
      decisionPolicy,
      cases: cases(),
    });

    expect(dataset.cases).toHaveLength(30);
    expect(dataset.decisionPolicy.minRecallGain).toBe(0.02);
    expect(
      qualityEvaluationDatasetSchema.safeParse({
        schemaVersion: 1,
        datasetId: 'local-real-v1',
        name: 'Missing approved thresholds',
        createdAt: '2026-07-18T00:00:00.000Z',
        cases: cases(),
      }).success,
    ).toBe(false);
    expect(
      qualityEvaluationDatasetSchema.safeParse({
        ...dataset,
        cases: dataset.cases.slice(0, 29),
      }).success,
    ).toBe(false);
    expect(
      qualityEvaluationDatasetSchema.safeParse({
        ...dataset,
        cases: dataset.cases.map((item) => ({ ...item, kind: 'answerable' })),
      }).success,
    ).toBe(false);
  });

  it('binds run configuration to the declared comparison variant', () => {
    const observations = cases().map((item) => ({
      caseId: item.id,
      traceId: uuid(1000 + Number(item.id.slice(-2))),
      noAnswer: item.kind !== 'answerable',
      vectorSources: [],
      finalSources: [],
      citationSources: [],
      durationMs: 100,
      costUsd: 0.001,
      errorCode: null,
    }));
    const input = {
      schemaVersion: 1,
      datasetId: 'local-real-v1',
      variant: 'vector_top_5',
      createdAt: '2026-07-18T00:00:00.000Z',
      configuration: {
        recallTopK: 5,
        rerankEnabled: false,
        rerankTopK: null,
        embeddingProvider: 'alibaba',
        embeddingModel: 'text-embedding-v4',
        embeddingFingerprint: 'a'.repeat(64),
        collectionName: 'nexus_alibaba_v1_aaaaaaaaaaaa',
        rerankProvider: null,
        rerankModel: null,
      },
      observations,
    };

    expect(qualityEvaluationRunSchema.safeParse(input).success).toBe(true);
    expect(
      qualityEvaluationRunSchema.safeParse({
        ...input,
        configuration: { ...input.configuration, recallTopK: 20 },
      }).success,
    ).toBe(false);
  });
});
