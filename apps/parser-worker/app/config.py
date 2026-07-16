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
    max_elements: int = Field(default=100_000, ge=1, le=100_000, validation_alias="MAX_ELEMENTS")
    max_spreadsheet_rows: int = Field(
        default=100_000, ge=1, le=1_000_000, validation_alias="MAX_SPREADSHEET_ROWS"
    )
    max_cad_entities: int = Field(
        default=200_000, ge=1, le=2_000_000, validation_alias="MAX_CAD_ENTITIES"
    )
    max_cad_insert_depth: int = Field(
        default=8, ge=1, le=32, validation_alias="MAX_CAD_INSERT_DEPTH"
    )
    max_archive_entries: int = Field(
        default=10_000, ge=1, le=100_000, validation_alias="MAX_ARCHIVE_ENTRIES"
    )
    max_archive_uncompressed_bytes: int = Field(
        default=524_288_000, ge=1, validation_alias="MAX_ARCHIVE_UNCOMPRESSED_BYTES"
    )
