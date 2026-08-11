from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=True, populate_by_name=True)

    local_rerank_enabled: bool = Field(default=False, validation_alias="LOCAL_RERANK_ENABLED")
    rerank_internal_token: str = Field(default="", validation_alias="RERANK_INTERNAL_TOKEN")
    parser_internal_token: str = Field(default="", validation_alias="PARSER_INTERNAL_TOKEN")
    rerank_model: str = Field(
        default="BAAI/bge-reranker-v2-m3", validation_alias="RERANK_MODEL"
    )
    local_rerank_model_revision: str = Field(
        default="main", min_length=1, max_length=128, validation_alias="LOCAL_RERANK_MODEL_REVISION"
    )
    local_rerank_batch_size: int = Field(
        default=8, ge=1, le=32, validation_alias="LOCAL_RERANK_BATCH_SIZE"
    )
    local_rerank_max_length: int = Field(
        default=512, ge=128, le=8192, validation_alias="LOCAL_RERANK_MAX_LENGTH"
    )

    @model_validator(mode="after")
    def validate_enabled_configuration(self) -> "Settings":
        if not self.local_rerank_enabled:
            return self
        if len(self.internal_token) < 16:
            raise ValueError(
                "RERANK_INTERNAL_TOKEN or PARSER_INTERNAL_TOKEN must be at least 16 characters"
            )
        if self.rerank_model != "BAAI/bge-reranker-v2-m3":
            raise ValueError("RERANK_MODEL must be BAAI/bge-reranker-v2-m3")
        return self

    @property
    def internal_token(self) -> str:
        return self.rerank_internal_token or self.parser_internal_token
