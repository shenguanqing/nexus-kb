import type {
  QualityDecisionPolicy,
  QualityEvaluationCase,
  QualityEvaluationDataset,
  QualityEvaluationRun,
  QualitySource,
  QualityVariant,
} from '@nexus-kb/contracts';

export interface QualityVariantMetrics {
  caseCount: number;
  answerableCount: number;
  noAnswerCount: number;
  unauthorizedCount: number;
  vectorRecallAtK: number;
  vectorRecallK: 5 | 20;
  finalRecallAt5: number;
  mrr: number;
  citationAccuracy: number;
  noAnswerRejectionRate: number;
  unauthorizedLeakRate: number;
  p95LatencyMs: number;
  averageCostUsd: number | null;
  costCoverage: number;
  errorRate: number;
}

export interface QualityEvaluationReport {
  schemaVersion: 1;
  datasetId: string;
  datasetName: string;
  generatedAt: string;
  variants: Record<QualityVariant, QualityVariantMetrics>;
  comparison: {
    finalRecallAt5Delta: number;
    mrrDelta: number;
    citationAccuracyDelta: number;
    noAnswerRejectionRateDelta: number;
    p95LatencyRatio: number | null;
    averageCostRatio: number | null;
  };
  rerankRecommendation: {
    decision: 'enable' | 'keep_disabled' | 'inconclusive';
    reasons: string[];
  };
}

export class QualityEvaluator {
  constructor(private readonly now: () => Date = () => new Date()) {}

  evaluate(
    dataset: QualityEvaluationDataset,
    baseline: QualityEvaluationRun,
    rerank: QualityEvaluationRun,
  ): QualityEvaluationReport {
    this.assertRun(dataset, baseline, 'vector_top_5');
    this.assertRun(dataset, rerank, 'vector_top_20_rerank_top_5');
    this.assertComparableIndex(baseline, rerank);
    const variants = {
      vector_top_5: this.metrics(dataset.cases, baseline),
      vector_top_20_rerank_top_5: this.metrics(dataset.cases, rerank),
    } satisfies Record<QualityVariant, QualityVariantMetrics>;
    const comparison = this.comparison(variants.vector_top_5, variants.vector_top_20_rerank_top_5);
    return {
      schemaVersion: 1,
      datasetId: dataset.datasetId,
      datasetName: dataset.name,
      generatedAt: this.now().toISOString(),
      variants,
      comparison,
      rerankRecommendation: this.recommend(
        dataset.decisionPolicy,
        variants.vector_top_5,
        variants.vector_top_20_rerank_top_5,
        comparison,
      ),
    };
  }

  private assertComparableIndex(
    baseline: QualityEvaluationRun,
    rerank: QualityEvaluationRun,
  ): void {
    const baselineConfiguration = baseline.configuration;
    const rerankConfiguration = rerank.configuration;
    if (
      baselineConfiguration.embeddingProvider !== rerankConfiguration.embeddingProvider ||
      baselineConfiguration.embeddingModel !== rerankConfiguration.embeddingModel ||
      baselineConfiguration.embeddingFingerprint !== rerankConfiguration.embeddingFingerprint ||
      baselineConfiguration.collectionName !== rerankConfiguration.collectionName
    ) {
      throw new Error('Evaluation runs must use the same embedding configuration and collection');
    }
  }

  private assertRun(
    dataset: QualityEvaluationDataset,
    run: QualityEvaluationRun,
    expectedVariant: QualityVariant,
  ): void {
    if (run.datasetId !== dataset.datasetId) {
      throw new Error(`Evaluation run datasetId does not match ${dataset.datasetId}`);
    }
    if (run.variant !== expectedVariant) {
      throw new Error(`Expected ${expectedVariant} run, received ${run.variant}`);
    }
    const datasetIds = new Set(dataset.cases.map((item) => item.id));
    const observationIds = new Set(run.observations.map((item) => item.caseId));
    const missing = [...datasetIds].filter((id) => !observationIds.has(id));
    const unexpected = [...observationIds].filter((id) => !datasetIds.has(id));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `Evaluation observations do not match dataset cases (missing=${missing.length}, unexpected=${unexpected.length})`,
      );
    }
  }

  private metrics(
    cases: QualityEvaluationCase[],
    run: QualityEvaluationRun,
  ): QualityVariantMetrics {
    const observations = new Map(run.observations.map((item) => [item.caseId, item]));
    const answerable = cases.filter((item) => item.kind === 'answerable');
    const noAnswer = cases.filter((item) => item.kind === 'no_answer');
    const unauthorized = cases.filter((item) => item.kind === 'unauthorized');
    const vectorHits = answerable.filter((item) =>
      this.hasExpectedSource(
        observations.get(item.id)!.vectorSources.slice(0, run.configuration.recallTopK),
        item.expectedSources,
      ),
    ).length;
    const finalHits = answerable.filter((item) =>
      this.hasExpectedSource(
        observations.get(item.id)!.finalSources.slice(0, 5),
        item.expectedSources,
      ),
    ).length;
    const reciprocalRankTotal = answerable.reduce((sum, item) => {
      const rank = this.firstExpectedRank(
        observations.get(item.id)!.finalSources.slice(0, 5),
        item.expectedSources,
      );
      return sum + (rank === null ? 0 : 1 / rank);
    }, 0);
    const citations = answerable.flatMap((item) =>
      observations
        .get(item.id)!
        .citationSources.map((source) => ({ source, expected: item.expectedSources })),
    );
    const correctCitations = citations.filter(({ source, expected }) =>
      expected.some((target) => this.sourceMatches(source, target)),
    ).length;
    const rejectedNoAnswer = noAnswer.filter((item) => observations.get(item.id)!.noAnswer).length;
    const unauthorizedLeaks = unauthorized.filter((item) => {
      const observation = observations.get(item.id)!;
      const allRetrieved = [
        ...observation.vectorSources,
        ...observation.finalSources,
        ...observation.citationSources,
      ];
      return this.hasExpectedSource(allRetrieved, item.expectedSources);
    }).length;
    const durations = run.observations.map((item) => item.durationMs);
    const costs = run.observations.flatMap((item) => (item.costUsd === null ? [] : [item.costUsd]));
    return {
      caseCount: cases.length,
      answerableCount: answerable.length,
      noAnswerCount: noAnswer.length,
      unauthorizedCount: unauthorized.length,
      vectorRecallAtK: this.ratio(vectorHits, answerable.length),
      vectorRecallK: run.configuration.recallTopK,
      finalRecallAt5: this.ratio(finalHits, answerable.length),
      mrr: this.round(reciprocalRankTotal / answerable.length),
      citationAccuracy: this.ratio(correctCitations, citations.length),
      noAnswerRejectionRate: this.ratio(rejectedNoAnswer, noAnswer.length),
      unauthorizedLeakRate: this.ratio(unauthorizedLeaks, unauthorized.length),
      p95LatencyMs: this.percentile(durations, 0.95),
      averageCostUsd:
        costs.length === 0
          ? null
          : this.round(costs.reduce((sum, value) => sum + value, 0) / costs.length),
      costCoverage: this.ratio(costs.length, run.observations.length),
      errorRate: this.ratio(
        run.observations.filter((item) => item.errorCode !== null).length,
        run.observations.length,
      ),
    };
  }

  private comparison(
    baseline: QualityVariantMetrics,
    rerank: QualityVariantMetrics,
  ): QualityEvaluationReport['comparison'] {
    return {
      finalRecallAt5Delta: this.round(rerank.finalRecallAt5 - baseline.finalRecallAt5),
      mrrDelta: this.round(rerank.mrr - baseline.mrr),
      citationAccuracyDelta: this.round(rerank.citationAccuracy - baseline.citationAccuracy),
      noAnswerRejectionRateDelta: this.round(
        rerank.noAnswerRejectionRate - baseline.noAnswerRejectionRate,
      ),
      p95LatencyRatio: this.ratioValue(rerank.p95LatencyMs, baseline.p95LatencyMs),
      averageCostRatio:
        baseline.averageCostUsd === null || rerank.averageCostUsd === null
          ? null
          : this.ratioValue(rerank.averageCostUsd, baseline.averageCostUsd),
    };
  }

  private recommend(
    policy: QualityDecisionPolicy,
    baseline: QualityVariantMetrics,
    rerank: QualityVariantMetrics,
    comparison: QualityEvaluationReport['comparison'],
  ): QualityEvaluationReport['rerankRecommendation'] {
    const reasons: string[] = [];
    if (baseline.unauthorizedLeakRate > 0) {
      return {
        decision: 'inconclusive',
        reasons: ['BASELINE_UNAUTHORIZED_LEAK_REQUIRES_SECURITY_REMEDIATION'],
      };
    }
    if (rerank.unauthorizedLeakRate > 0) {
      return { decision: 'keep_disabled', reasons: ['RERANK_UNAUTHORIZED_LEAK_RATE_NONZERO'] };
    }
    if (rerank.finalRecallAt5 < policy.minFinalRecallAt5) {
      reasons.push('FINAL_RECALL_AT_5_BELOW_MINIMUM');
    }
    if (rerank.mrr < policy.minMrr) {
      reasons.push('MRR_BELOW_MINIMUM');
    }
    if (rerank.citationAccuracy < policy.minCitationAccuracy) {
      reasons.push('CITATION_ACCURACY_BELOW_MINIMUM');
    }
    if (rerank.noAnswerRejectionRate < policy.minNoAnswerRejectionRate) {
      reasons.push('NO_ANSWER_REJECTION_RATE_BELOW_MINIMUM');
    }
    if (rerank.errorRate > policy.maxErrorRate) {
      reasons.push('ERROR_RATE_EXCEEDS_LIMIT');
    }
    if (comparison.citationAccuracyDelta < -policy.maxCitationAccuracyRegression) {
      reasons.push('CITATION_ACCURACY_REGRESSION_EXCEEDS_LIMIT');
    }
    if (comparison.noAnswerRejectionRateDelta < -policy.maxNoAnswerRejectionRegression) {
      reasons.push('NO_ANSWER_REJECTION_REGRESSION_EXCEEDS_LIMIT');
    }
    if (
      comparison.p95LatencyRatio !== null &&
      comparison.p95LatencyRatio > policy.maxP95LatencyRatio
    ) {
      reasons.push('P95_LATENCY_RATIO_EXCEEDS_LIMIT');
    }
    if (
      comparison.averageCostRatio !== null &&
      comparison.averageCostRatio > policy.maxAverageCostRatio
    ) {
      reasons.push('AVERAGE_COST_RATIO_EXCEEDS_LIMIT');
    }
    if (reasons.length > 0) return { decision: 'keep_disabled', reasons };
    if (
      baseline.costCoverage < 1 ||
      rerank.costCoverage < 1 ||
      comparison.averageCostRatio === null ||
      comparison.p95LatencyRatio === null
    ) {
      return { decision: 'inconclusive', reasons: ['COST_OR_LATENCY_OBSERVATIONS_INCOMPLETE'] };
    }
    const qualityImproved =
      comparison.finalRecallAt5Delta >= policy.minRecallGain ||
      comparison.mrrDelta >= policy.minMrrGain;
    return qualityImproved
      ? { decision: 'enable', reasons: ['QUALITY_GAIN_MEETS_POLICY'] }
      : { decision: 'keep_disabled', reasons: ['QUALITY_GAIN_BELOW_POLICY'] };
  }

  private hasExpectedSource(actual: QualitySource[], expected: QualitySource[]): boolean {
    return actual.some((source) => expected.some((target) => this.sourceMatches(source, target)));
  }

  private firstExpectedRank(actual: QualitySource[], expected: QualitySource[]): number | null {
    const index = actual.findIndex((source) =>
      expected.some((target) => this.sourceMatches(source, target)),
    );
    return index === -1 ? null : index + 1;
  }

  private sourceMatches(actual: QualitySource, expected: QualitySource): boolean {
    if (actual.documentId !== expected.documentId) return false;
    if (expected.chunkIds.length > 0) {
      return actual.chunkIds.some((chunkId) => expected.chunkIds.includes(chunkId));
    }
    if (expected.page !== null && actual.page !== expected.page) return false;
    if (expected.sheet !== null && actual.sheet !== expected.sheet) return false;
    return true;
  }

  private ratio(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : this.round(numerator / denominator);
  }

  private ratioValue(numerator: number, denominator: number): number | null {
    if (denominator === 0) return numerator === 0 ? 1 : null;
    return this.round(numerator / denominator);
  }

  private percentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.max(0, Math.ceil(percentile * ordered.length) - 1)]!;
  }

  private round(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
  }
}
