from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=True)

    parser_internal_token: str = Field(min_length=16, validation_alias="PARSER_INTERNAL_TOKEN")
    raw_docs_path: Path = Field(validation_alias="RAW_DOCS_PATH")
    preview_artifacts_path: Path = Field(
        default=Path("/data/previews"), validation_alias="PREVIEW_ARTIFACTS_PATH"
    )
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
    max_pdf_pages: int = Field(default=500, ge=1, le=5_000, validation_alias="MAX_PDF_PAGES")
    max_image_pixels: int = Field(
        default=40_000_000, ge=1, le=250_000_000, validation_alias="MAX_IMAGE_PIXELS"
    )
    ocr_model_storage_path: Path = Field(
        default=Path("/opt/easyocr-models"), validation_alias="OCR_MODEL_STORAGE_PATH"
    )
    ocr_languages: str = Field(
        default="ch_sim,en",
        pattern=r"^[a-z_]{2,16}(,[a-z_]{2,16}){0,7}$",
        validation_alias="OCR_LANGUAGES",
    )
    ocr_confidence_warning_threshold: float = Field(
        default=0.5,
        ge=0,
        le=1,
        validation_alias="OCR_CONFIDENCE_WARNING_THRESHOLD",
    )
    tika_enabled: bool = Field(default=False, validation_alias="TIKA_ENABLED")
    tika_base_url: str = Field(
        default="http://tika:9998",
        pattern=r"^https?://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$",
        validation_alias="TIKA_BASE_URL",
    )
    tika_request_timeout_seconds: float = Field(
        default=120,
        ge=1,
        le=600,
        validation_alias="TIKA_REQUEST_TIMEOUT_SECONDS",
    )
    max_tika_response_bytes: int = Field(
        default=52_428_800,
        ge=1,
        le=268_435_456,
        validation_alias="MAX_TIKA_RESPONSE_BYTES",
    )
    tika_version: str = Field(
        default="3.2.3.0",
        pattern=r"^[0-9]+(?:\.[0-9]+){2,3}$",
        validation_alias="TIKA_VERSION",
    )
    max_cad_entities: int = Field(
        default=1_000_000, ge=1, le=2_000_000, validation_alias="MAX_CAD_ENTITIES"
    )
    max_cad_insert_depth: int = Field(
        default=8, ge=1, le=32, validation_alias="MAX_CAD_INSERT_DEPTH"
    )
    dwg_conversion_enabled: bool = Field(default=True, validation_alias="DWG_CONVERSION_ENABLED")
    dwg_converter_executable: Path = Field(
        default=Path("/usr/local/bin/nexus-oda-file-converter"),
        validation_alias="DWG_CONVERTER_EXECUTABLE",
    )
    dwg_converter_release: str = Field(
        default="not-installed",
        pattern=r"^[A-Za-z0-9._-]{1,24}$",
        validation_alias="DWG_CONVERTER_RELEASE",
    )
    dwg_output_version: str = Field(
        default="ACAD2018",
        pattern=r"^ACAD(12|13|14|2000|2004|2007|2010|2013|2018)$",
        validation_alias="DWG_OUTPUT_VERSION",
    )
    dwg_conversion_timeout_seconds: int = Field(
        default=180,
        ge=1,
        le=900,
        validation_alias="DWG_CONVERSION_TIMEOUT_SECONDS",
    )
    parser_temp_path: Path = Field(
        default=Path("/tmp/parser"),  # noqa: S108 -- dedicated, permissioned Worker tmpfs
        validation_alias="PARSER_TEMP_PATH",
    )
    max_dwg_converted_bytes: int = Field(
        default=209_715_200,
        ge=1,
        le=1_073_741_824,
        validation_alias="MAX_DWG_CONVERTED_BYTES",
    )
    max_archive_entries: int = Field(
        default=10_000, ge=1, le=100_000, validation_alias="MAX_ARCHIVE_ENTRIES"
    )
    max_archive_uncompressed_bytes: int = Field(
        default=524_288_000, ge=1, validation_alias="MAX_ARCHIVE_UNCOMPRESSED_BYTES"
    )
    libreoffice_executable: Path = Field(
        default=Path("/usr/lib/libreoffice/program/soffice"),
        validation_alias="LIBREOFFICE_EXECUTABLE",
    )
    preview_conversion_timeout_seconds: int = Field(
        default=120,
        ge=1,
        le=900,
        validation_alias="PREVIEW_CONVERSION_TIMEOUT_SECONDS",
    )
    max_preview_bytes: int = Field(
        default=209_715_200,
        ge=1,
        le=1_073_741_824,
        validation_alias="MAX_PREVIEW_BYTES",
    )
