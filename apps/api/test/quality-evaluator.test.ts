import { describe, expect, it } from 'vitest';
import { qualityEvaluationDatasetSchema, qualityEvaluationRunSchema } from '@nexus-kb/contracts';
import type {
  QualityEvaluationDataset,
  QualityEvaluationRun,
  QualityObservation,
  QualitySource,
} from '@nexus-kb/contracts';

import { QualityEvaluator } from '../src/evaluation/quality-evaluator';

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function dataset(): QualityEvaluationDataset {
  return qualityEvaluationDatasetSchema.parse({
    schemaVersion: 1,
    datasetId: 'quality-real-v1',
    name: 'Quality fixture',
    createdAt: '2026-07-18T00:00:00.000Z',
    decisionPolicy: {
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
    },
    cases: Array.from({ length: 30 }, (_, index) => {
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
      };
    }),
  });
}

function run(
  input: QualityEvaluationDataset,
  variant: 'vector_top_5' | 'vector_top_20_rerank_top_5',
): QualityEvaluationRun {
  const hitCount = variant === 'vector_top_5' ? 12 : 18;
  const observations = input.cases.map((item, index): QualityObservation => {
    const expected = item.expectedSources[0];
    const hit = item.kind === 'answerable' && index < hitCount && expected ? [expected] : [];
    return {
      caseId: item.id,
      traceId: uuid(1000 + index),
      noAnswer: item.kind !== 'answerable' || hit.length === 0,
      vectorSources: hit,
      finalSources: hit,
      citationSources: hit,
      durationMs: (variant === 'vector_top_5' ? 100 : 120) + index,
      costUsd: variant === 'vector_top_5' ? 0.001 : 0.0011,
      errorCode: null,
    };
  });
  return qualityEvaluationRunSchema.parse({
    schemaVersion: 1,
    datasetId: input.datasetId,
    variant,
    createdAt: '2026-07-18T01:00:00.000Z',
    configuration:
      variant === 'vector_top_5'
        ? {
            recallTopK: 5,
            rerankEnabled: false,
            rerankTopK: null,
            embeddingProvider: 'alibaba',
            embeddingModel: 'text-embedding-v4',
            embeddingFingerprint: 'a'.repeat(64),
            collectionName: 'nexus_alibaba_v1_aaaaaaaaaaaa',
            rerankProvider: null,
            rerankModel: null,
          }
        : {
            recallTopK: 20,
            rerankEnabled: true,
            rerankTopK: 5,
            embeddingProvider: 'alibaba',
            embeddingModel: 'text-embedding-v4',
            embeddingFingerprint: 'a'.repeat(64),
            collectionName: 'nexus_alibaba_v1_aaaaaaaaaaaa',
            rerankProvider: 'alibaba',
            rerankModel: 'qwen3-rerank',
          },
    observations,
  });
}

function replaceObservation(
  runInput: QualityEvaluationRun,
  caseId: string,
  update: Partial<QualityObservation>,
): QualityEvaluationRun {
  return {
    ...runInput,
    observations: runInput.observations.map((item) =>
      item.caseId === caseId ? { ...item, ...update } : item,
    ),
  };
}

describe('QualityEvaluator', () => {
  const now = () => new Date('2026-07-18T02:00:00.000Z');

  it('computes quality, security, latency, and cost metrics and recommends rerank on gain', () => {
    const input = dataset();
    const report = new QualityEvaluator(now).evaluate(
      input,
      run(input, 'vector_top_5'),
      run(input, 'vector_top_20_rerank_top_5'),
    );

    expect(report.variants.vector_top_5).toMatchObject({
      vectorRecallAtK: 0.5,
      finalRecallAt5: 0.5,
      mrr: 0.5,
      citationAccuracy: 1,
      noAnswerRejectionRate: 1,
      unauthorizedLeakRate: 0,
      costCoverage: 1,
    });
    expect(report.variants.vector_top_20_rerank_top_5.finalRecallAt5).toBe(0.75);
    expect(report.comparison.finalRecallAt5Delta).toBe(0.25);
    expect(report.rerankRecommendation).toEqual({
      decision: 'enable',
      reasons: ['QUALITY_GAIN_MEETS_POLICY'],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('question');
    expect(serialized).not.toContain('expectedAnswer');
  });

  it('keeps rerank disabled when restricted sources leak', () => {
    const input = dataset();
    const candidate = run(input, 'vector_top_20_rerank_top_5');
    const restrictedCase = input.cases.find((item) => item.kind === 'unauthorized')!;
    const restrictedSource = restrictedCase.expectedSources[0] as QualitySource;
    const leaking = replaceObservation(candidate, restrictedCase.id, {
      vectorSources: [restrictedSource],
    });

    const report = new QualityEvaluator(now).evaluate(input, run(input, 'vector_top_5'), leaking);
    expect(report.variants.vector_top_20_rerank_top_5.unauthorizedLeakRate).toBeGreaterThan(0);
    expect(report.rerankRecommendation.decision).toBe('keep_disabled');
  });

  it('requires explicitly approved absolute quality thresholds in addition to relative gain', () => {
    const input = dataset();
    const stricter = {
      ...input,
      decisionPolicy: { ...input.decisionPolicy, minFinalRecallAt5: 0.9, minMrr: 0.9 },
    };

    const report = new QualityEvaluator(now).evaluate(
      stricter,
      run(input, 'vector_top_5'),
      run(input, 'vector_top_20_rerank_top_5'),
    );
    expect(report.rerankRecommendation).toEqual({
      decision: 'keep_disabled',
      reasons: ['FINAL_RECALL_AT_5_BELOW_MINIMUM', 'MRR_BELOW_MINIMUM'],
    });
  });

  it('returns inconclusive when per-query cost observations are incomplete', () => {
    const input = dataset();
    const candidate = run(input, 'vector_top_20_rerank_top_5');
    const incomplete = replaceObservation(candidate, input.cases[0]!.id, { costUsd: null });

    const report = new QualityEvaluator(now).evaluate(
      input,
      run(input, 'vector_top_5'),
      incomplete,
    );
    expect(report.variants.vector_top_20_rerank_top_5.costCoverage).toBeLessThan(1);
    expect(report.rerankRecommendation).toEqual({
      decision: 'inconclusive',
      reasons: ['COST_OR_LATENCY_OBSERVATIONS_INCOMPLETE'],
    });
  });

  it('rejects missing or unexpected case observations', () => {
    const input = dataset();
    const baseline = run(input, 'vector_top_5');
    const incomplete = { ...baseline, observations: baseline.observations.slice(1) };

    expect(() =>
      new QualityEvaluator(now).evaluate(
        input,
        incomplete,
        run(input, 'vector_top_20_rerank_top_5'),
      ),
    ).toThrow('observations do not match dataset cases');
  });

  it('rejects runs produced from different vector collections', () => {
    const input = dataset();
    const candidate = run(input, 'vector_top_20_rerank_top_5');
    const mismatched = {
      ...candidate,
      configuration: {
        ...candidate.configuration,
        embeddingFingerprint: 'b'.repeat(64),
        collectionName: 'nexus_alibaba_v1_bbbbbbbbbbbb',
      },
    };

    expect(() =>
      new QualityEvaluator(now).evaluate(input, run(input, 'vector_top_5'), mismatched),
    ).toThrow('same embedding configuration and collection');
  });
});
