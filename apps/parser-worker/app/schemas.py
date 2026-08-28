from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class PreviewArtifact(ApiModel):
    storage_key: str = Field(alias="storageKey", pattern=r"^[0-9a-f-]{36}\.(?:pdf|svg|cad)$")
    kind: str = Field(pattern=r"^(?:pdf|svg|cad_tiles)$")
    mime_type: str = Field(
        alias="mimeType",
        pattern=r"^(?:application/pdf|image/svg\+xml|application/vnd\.nexuskb\.cad-tiles\+json)$",
    )
    size_bytes: int = Field(alias="sizeBytes", gt=0, le=1_073_741_824)
    renderer: str = Field(min_length=1, max_length=128)
    renderer_version: str = Field(alias="rendererVersion", min_length=1, max_length=64)


class ParseResponse(ApiModel):
    parser: str = Field(min_length=1, max_length=128)
    parser_version: str = Field(alias="parserVersion", min_length=1, max_length=64)
    elements: list[ParsedElement] = Field(min_length=1, max_length=100_000)
    warnings: list[str] = Field(default_factory=list, max_length=1_000)
    preview: PreviewArtifact | None = None


class CadPreviewBounds(ApiModel):
    min_x: float = Field(alias="minX")
    min_y: float = Field(alias="minY")
    max_x: float = Field(alias="maxX")
    max_y: float = Field(alias="maxY")

    @model_validator(mode="after")
    def validate_dimensions(self) -> "CadPreviewBounds":
        if self.max_x <= self.min_x or self.max_y <= self.min_y:
            raise ValueError("CAD preview bounds must have positive dimensions")
        return self


class CadPreviewManifest(ApiModel):
    strategy: str = Field(pattern=r"^tiles$")
    tile_size: int = Field(alias="tileSize", ge=256, le=1024)
    min_zoom: int = Field(alias="minZoom", ge=0, le=15)
    max_zoom: int = Field(alias="maxZoom", ge=0, le=15)
    base_width: int = Field(alias="baseWidth", ge=1)
    base_height: int = Field(alias="baseHeight", ge=1)
    overview_width: int = Field(alias="overviewWidth", ge=1, le=4096)
    overview_height: int = Field(alias="overviewHeight", ge=1, le=4096)
    bounds: CadPreviewBounds
    focus_bounds: CadPreviewBounds | None = Field(default=None, alias="focusBounds")
    world_to_pixel: list[float] = Field(alias="worldToPixel", min_length=6, max_length=6)
    entity_count: int = Field(alias="entityCount", ge=1, le=2_000_000)
    render_cost_score: int = Field(alias="renderCostScore", ge=1, le=100_000_000)

    @model_validator(mode="after")
    def validate_focus_bounds(self) -> "CadPreviewManifest":
        focus = self.focus_bounds
        if focus is not None and not (
            self.bounds.min_x <= focus.min_x < focus.max_x <= self.bounds.max_x
            and self.bounds.min_y <= focus.min_y < focus.max_y <= self.bounds.max_y
        ):
            raise ValueError("CAD focus bounds must be contained by full bounds")
        return self


class CadPreviewTileRequest(ApiModel):
    document_id: UUID = Field(alias="documentId")
    zoom: int = Field(ge=0, le=15)
    tile_x: int = Field(alias="tileX", ge=0, le=65_535)
    tile_y: int = Field(alias="tileY", ge=0, le=65_535)


class CadPreviewTileResponse(ApiModel):
    storage_key: str = Field(
        alias="storageKey",
        pattern=(
            r"^[0-9a-f-]{36}\.cad/bundles/[0-9a-f-]{36}/tiles/"
            r"(?:[0-9]|1[0-5])/[0-9]{1,5}/[0-9]{1,5}\.png$"
        ),
    )
    mime_type: str = Field(alias="mimeType", pattern=r"^image/png$")
    size_bytes: int = Field(alias="sizeBytes", gt=0, le=16_777_216)
    cache_hit: bool = Field(alias="cacheHit")
