UPDATE "CloudPolicyEvent" AS policy
SET "embeddingModel" = CASE
  WHEN policy."providerId" = 'google'
    AND POSITION('_google_gemini-embedding-001_' IN job."vectorCollection") > 0
    THEN 'gemini-embedding-001'
  WHEN policy."providerId" = 'ollama'
    AND POSITION('_ollama_bge-m3-latest_' IN job."vectorCollection") > 0
    THEN 'bge-m3:latest'
  WHEN policy."providerId" = 'alibaba'
    AND POSITION('_alibaba_text-embedding-v4_' IN job."vectorCollection") > 0
    THEN 'text-embedding-v4'
  ELSE policy."embeddingModel"
END
FROM "IngestionJob" AS job
WHERE policy."ingestionJobId" = job."id"
  AND policy."embeddingModel" IS NULL
  AND job."vectorCollection" IS NOT NULL;
