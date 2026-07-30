from pydantic import BaseModel, ConfigDict, Field, model_validator


class RerankRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    query: str = Field(min_length=1, max_length=4_000)
    documents: list[str] = Field(min_length=1, max_length=100)
    top_k: int = Field(alias="topK", ge=1, le=100)

    @model_validator(mode="after")
    def validate_documents(self) -> "RerankRequest":
        if self.top_k > len(self.documents):
            raise ValueError("topK must not exceed the number of documents")
        if any(not document or len(document) > 120_000 for document in self.documents):
            raise ValueError("documents must contain non-empty values up to 120000 characters")
        return self


class RerankResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: int = Field(ge=0)
    relevance_score: float = Field(alias="relevanceScore")


class RerankResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str
    results: list[RerankResult]
