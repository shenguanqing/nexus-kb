from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class ParseRequest(ApiModel):
    job_id: UUID = Field(alias="jobId")
    document_id: UUID = Field(alias="documentId")
    storage_path: str = Field(alias="storagePath", min_length=1, max_length=4096)
    mime_type: str = Field(alias="mimeType", min_length=1, max_length=255)


class ParsedElement(ApiModel):
    text: str = Field(min_length=1)
    element_type: str = Field(alias="elementType", min_length=1, max_length=64)
    page: int | None = Field(default=None, ge=1)
    sheet: str | None = Field(default=None, max_length=255)
    section_path: list[str] = Field(default_factory=list, alias="sectionPath")
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ParseResponse(ApiModel):
    parser: str = Field(min_length=1, max_length=128)
    parser_version: str = Field(alias="parserVersion", min_length=1, max_length=64)
    elements: list[ParsedElement] = Field(min_length=1, max_length=100_000)
    warnings: list[str] = Field(default_factory=list, max_length=1_000)

