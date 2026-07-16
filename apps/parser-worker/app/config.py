from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=True)

    parser_internal_token: str = Field(min_length=16, validation_alias="PARSER_INTERNAL_TOKEN")
    raw_docs_path: Path = Field(validation_alias="RAW_DOCS_PATH")
    max_parse_bytes: int = Field(
        default=52_428_800,
        ge=1,
        le=1_073_741_824,
        validation_alias="MAX_PARSE_BYTES",
    )

