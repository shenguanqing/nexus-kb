export function assertQualityBaselineGate(dataset, report) {
  if (
    !dataset?.decisionPolicy ||
    !report?.variants?.vector_top_5 ||
    !report?.variants?.vector_top_20_rerank_top_5
  ) {
    throw new Error('QUALITY_REPORT_INVALID');
  }
  const policy = dataset.decisionPolicy;
  const baseline = report.variants.vector_top_5;
  const rerank = report.variants.vector_top_20_rerank_top_5;
  const failures = [];
  if (baseline.finalRecallAt5 < policy.minFinalRecallAt5) failures.push('FINAL_RECALL_AT_5');
  if (baseline.mrr < policy.minMrr) failures.push('MRR');
  if (baseline.citationAccuracy < policy.minCitationAccuracy) failures.push('CITATION_ACCURACY');
  if (baseline.noAnswerRejectionRate < policy.minNoAnswerRejectionRate) {
    failures.push('NO_ANSWER_REJECTION_RATE');
  }
  if (baseline.unauthorizedLeakRate !== 0) failures.push('UNAUTHORIZED_LEAK_RATE');
  if (rerank.unauthorizedLeakRate !== 0) failures.push('RERANK_UNAUTHORIZED_LEAK_RATE');
  if (baseline.errorRate > policy.maxErrorRate) failures.push('ERROR_RATE');
  if (baseline.costCoverage !== 1 || baseline.averageCostUsd === null)
    failures.push('COST_COVERAGE');
  if (!['enable', 'keep_disabled'].includes(report.rerankRecommendation?.decision)) {
    failures.push('RERANK_DECISION');
  }
  if (failures.length > 0) throw new Error(`QUALITY_BASELINE_GATE_FAILED:${failures.join(',')}`);
  return {
    baseline,
    rerank,
    rerankRecommendation: report.rerankRecommendation,
  };
}
