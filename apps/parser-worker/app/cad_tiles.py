import fcntl
import json
import math
import os
import shutil
import sqlite3
import struct
import subprocess
import sys
from collections.abc import Iterable
from pathlib import Path
from random import Random
from typing import Any
from uuid import UUID, uuid4

from ezdxf import bbox, recover
from ezdxf.addons.drawing.backend import Backend, BkPath2d, BkPoints2d, ImageData
from ezdxf.addons.drawing.config import (
    BackgroundPolicy,
    Configuration,
    HatchPolicy,
    ImagePolicy,
    LinePolicy,
    TextPolicy,
)
from ezdxf.addons.drawing.frontend import Frontend
from ezdxf.addons.drawing.properties import BackendProperties
from ezdxf.document import Drawing
from ezdxf.entities.dxfgfx import DXFGraphic
from ezdxf.entities.insert import Insert
from ezdxf.filemanagement import readfile
from ezdxf.lldxf.const import DXFError, DXFKeyError
from ezdxf.math import OCS, Vec2, Vec3
from PIL import Image, ImageDraw

from app.cad_rendering import cad_render_context
from app.schemas import CadPreviewManifest, CadPreviewTileResponse, PreviewArtifact

_CAD_BACKGROUND = (33, 40, 48, 255)
_COST_WEIGHTS = {
    "HATCH": 24,
    "MPOLYGON": 24,
    "MTEXT": 12,
    "TEXT": 8,
    "ATTRIB": 8,
    "ATTDEF": 8,
    "DIMENSION": 12,
    "SPLINE": 10,
    "ELLIPSE": 6,
    "INSERT": 50,
    "IMAGE": 20,
    "WIPEOUT": 10,
}
_CURRENT_FILE = "current.json"
_MANIFEST_FILE = "manifest.json"
_OVERVIEW_FILE = "overview.png"
_FOCUS_OVERVIEW_FILE = "focus-overview.png"
_OVERVIEW_STATE_FILE = "overview-state.json"
_INDEX_FILE = "entities.sqlite"
_GEOMETRY_INDEX_FILE = "geometry.sqlite"
_OVERVIEW_GEOMETRY_INDEX_FILE = "overview-geometry.sqlite"
_SOURCE_FILE = "source.dxf"
_SIMPLIFIED_FILE = "simplified.json"
_GEOMETRY_FORMAT_VERSION = "2"
_SUPPORTED_GEOMETRY_FORMAT_VERSIONS = {"1", _GEOMETRY_FORMAT_VERSION}
_GEOMETRY_BATCH_SIZE = 2_048
_MAX_GEOMETRY_BLOB_BYTES = 67_108_864
_BINARY_DXF_SIGNATURE = b"AutoCAD Binary DXF\r\n\x1a\x00"
_MAX_ASCII_DXF_LINE_BYTES = 1_048_576
_SIMPLIFIED_ENTITY_LIMIT = 100_000
_SIMPLIFIED_PRIMITIVE_LIMIT = 500_000
_FULL_GEOMETRY_PRIMITIVE_LIMIT = 4_000_000
_MAX_CAD_BUNDLE_BYTES = 1_073_741_824
_SIMPLIFIED_CURVE_SEGMENTS = 32
_SIMPLIFIED_POLYLINE_POINT_LIMIT = 4_096
_SIMPLIFIED_COLOR_HEX = "#e2e8f0"
_PRIMITIVE_POINT = 1
_PRIMITIVE_LINE = 2
_PRIMITIVE_POLYGON = 3
_PRIMITIVE_POLYLINE = 4
_INITIALIZATION_TIMEOUT_MULTIPLIER = 3
_MAX_INITIALIZATION_TIMEOUT_SECONDS = 180
_MAX_COMPLEX_INITIALIZATION_TIMEOUT_SECONDS = 60
_LARGE_CAD_SOURCE_BYTES = 134_217_728
_MAX_TILE_ZOOM = 15
_DETAIL_BOUNDS_SAMPLE_SIZE = 4_096
_DETAIL_BOUNDS_MINIMUM_ENTITIES = 100
_DETAIL_BOUNDS_TRIM_FRACTION = 0.01
_DETAIL_BOUNDS_EXTRA_ZOOM_RATIO = 2.0
_DETAIL_BOUNDS_SAMPLE_SEED = 0x4E45585553


class CadPreviewError(Exception):
    pass


class CadPreviewTimeoutError(CadPreviewError):
    pass


class CadPreviewResourceError(CadPreviewError):
    pass


class GeometryIndexWriter:
    def __init__(
        self,
        target: Path,
        max_primitives: int | None = None,
        *,
        fail_on_limit: bool = False,
    ) -> None:
        if not target.parent.is_dir() or target.parent.is_symlink():
            raise CadPreviewResourceError("CAD 预览 bundle 已不可用")
        self.target = target
        self.temporary = target.parent / f".{target.name}.{os.getpid()}.tmp"
        self.temporary.unlink(missing_ok=True)
        self.database = sqlite3.connect(self.temporary)
        self.database.execute("PRAGMA journal_mode=OFF")
        self.database.execute("PRAGMA synchronous=OFF")
        self.database.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        self.database.execute(
            """
            CREATE TABLE primitives (
                id INTEGER PRIMARY KEY,
                kind INTEGER NOT NULL,
                color INTEGER NOT NULL,
                points BLOB NOT NULL
            )
            """
        )
        self.database.execute(
            "CREATE VIRTUAL TABLE primitive_index USING rtree(id, min_x, max_x, min_y, max_y)"
        )
        self.next_id = 1
        self.max_primitives = max_primitives
        self.fail_on_limit = fail_on_limit
        self.pending_primitives: list[tuple[int, int, int, bytes]] = []
        self.pending_bounds: list[tuple[int, float, float, float, float]] = []
        self.finished = False

    def add(self, kind: int, coordinates: Iterable[float], color: str) -> None:
        if self.max_primitives is not None and self.next_id > self.max_primitives:
            if self.fail_on_limit:
                raise CadPreviewResourceError("CAD 完整几何图元超过安全上限")
            return
        values = tuple(float(value) for value in coordinates)
        if kind == _PRIMITIVE_POINT and len(values) != 2:
            return
        if kind == _PRIMITIVE_LINE and len(values) != 4:
            return
        if kind == _PRIMITIVE_POLYLINE and (len(values) < 4 or len(values) % 2 != 0):
            return
        if kind == _PRIMITIVE_POLYGON and (len(values) < 6 or len(values) % 2 != 0):
            return
        if not all(math.isfinite(value) for value in values):
            return
        if len(values) * 8 > _MAX_GEOMETRY_BLOB_BYTES:
            if self.fail_on_limit:
                raise CadPreviewResourceError("CAD 完整几何图元数据超过安全上限")
            return
        xs = values[0::2]
        ys = values[1::2]
        row_id = self.next_id
        self.next_id += 1
        self.pending_primitives.append(
            (row_id, kind, _pack_color(color), struct.pack(f"<{len(values)}d", *values))
        )
        self.pending_bounds.append((row_id, min(xs), max(xs), min(ys), max(ys)))
        if len(self.pending_primitives) >= _GEOMETRY_BATCH_SIZE:
            self._flush()

    def finish(self) -> None:
        if self.finished:
            return
        try:
            self._flush()
            primitive_count = self.next_id - 1
            if primitive_count <= 0:
                raise CadPreviewResourceError("CAD 图纸没有可缓存的绘图几何")
            self.database.executemany(
                "INSERT INTO metadata(key, value) VALUES (?, ?)",
                (
                    ("formatVersion", _GEOMETRY_FORMAT_VERSION),
                    ("primitiveCount", str(primitive_count)),
                ),
            )
            self.database.commit()
            self.database.close()
            if self.temporary.stat().st_size <= 0:
                raise CadPreviewResourceError("CAD 几何索引为空")
            self.temporary.replace(self.target)
            self.finished = True
        finally:
            if not self.finished:
                self.database.close()
                self.temporary.unlink(missing_ok=True)

    def abort(self) -> None:
        if self.finished:
            return
        self.database.close()
        self.temporary.unlink(missing_ok=True)

    def _flush(self) -> None:
        if not self.pending_primitives:
            return
        self.database.executemany(
            "INSERT INTO primitives(id, kind, color, points) VALUES (?, ?, ?, ?)",
            self.pending_primitives,
        )
        self.database.executemany(
            "INSERT INTO primitive_index(id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)",
            self.pending_bounds,
        )
        self.pending_primitives.clear()
        self.pending_bounds.clear()


class PillowCadBackend(Backend):
    def __init__(
        self,
        width: int,
        height: int,
        world_bounds: tuple[float, float, float, float],
        geometry_writer: GeometryIndexWriter | None = None,
    ) -> None:
        super().__init__()
        self.width = width
        self.height = height
        self.min_x, self.min_y, self.max_x, self.max_y = world_bounds
        world_width = max(self.max_x - self.min_x, 1e-9)
        world_height = max(self.max_y - self.min_y, 1e-9)
        self.scale = min(width / world_width, height / world_height)
        self.offset_x = (width - world_width * self.scale) / 2
        self.offset_y = (height - world_height * self.scale) / 2
        self.image = Image.new("RGBA", (width, height), _CAD_BACKGROUND)
        self.draw = ImageDraw.Draw(self.image, "RGBA")
        self.geometry_writer = geometry_writer

    def set_background(self, color: str) -> None:
        background = _parse_color(color, _CAD_BACKGROUND)
        self.image.paste(background, (0, 0, self.width, self.height))

    def draw_point(self, pos: Vec2, properties: BackendProperties) -> None:
        if self.geometry_writer is not None:
            self.geometry_writer.add(_PRIMITIVE_POINT, (pos.x, pos.y), properties.color)
        self.draw_cached_primitive(_PRIMITIVE_POINT, (pos.x, pos.y), properties.color)

    def draw_cached_primitive(
        self,
        kind: int,
        coordinates: tuple[float, ...],
        color: str | int,
    ) -> None:
        parsed_color = _unpack_color(color) if isinstance(color, int) else _parse_color(color)
        if kind == _PRIMITIVE_POINT:
            x, y = self._pixel(coordinates[0], coordinates[1])
            self.draw.ellipse((x - 1, y - 1, x + 1, y + 1), fill=parsed_color)
            return
        if kind == _PRIMITIVE_LINE:
            self._draw_world_line(
                coordinates[0],
                coordinates[1],
                coordinates[2],
                coordinates[3],
                parsed_color,
            )
            return
        if kind == _PRIMITIVE_POLYLINE:
            for start_x, start_y, end_x, end_y in zip(
                coordinates[0:-2:2],
                coordinates[1:-2:2],
                coordinates[2::2],
                coordinates[3::2],
                strict=True,
            ):
                self._draw_world_line(start_x, start_y, end_x, end_y, parsed_color)
            return
        if kind == _PRIMITIVE_POLYGON:
            vertices = [
                (
                    min(self.width + 1, max(-1, x)),
                    min(self.height + 1, max(-1, y)),
                )
                for world_x, world_y in zip(coordinates[0::2], coordinates[1::2], strict=True)
                for x, y in [self._pixel(world_x, world_y)]
            ]
            if len(vertices) >= 3:
                self.draw.polygon(vertices, fill=parsed_color)

    def _draw_world_line(
        self,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        color: tuple[int, int, int, int],
    ) -> None:
        clipped = _clip_line(
            start_x,
            start_y,
            end_x,
            end_y,
            self.min_x,
            self.min_y,
            self.max_x,
            self.max_y,
        )
        if clipped is None:
            return
        x1, y1, x2, y2 = clipped
        self.draw.line(
            (*self._pixel(x1, y1), *self._pixel(x2, y2)),
            fill=color,
            width=1,
        )

    def draw_line(self, start: Vec2, end: Vec2, properties: BackendProperties) -> None:
        coordinates = (start.x, start.y, end.x, end.y)
        if self.geometry_writer is not None:
            self.geometry_writer.add(_PRIMITIVE_LINE, coordinates, properties.color)
        self.draw_cached_primitive(_PRIMITIVE_LINE, coordinates, properties.color)

    def draw_path(self, path: BkPath2d, properties: BackendProperties) -> None:
        coordinates = _flattened_path_coordinates(path, self.config.max_flattening_distance)
        if len(coordinates) < 4:
            return
        if self.geometry_writer is not None:
            self.geometry_writer.add(_PRIMITIVE_POLYLINE, coordinates, properties.color)
        self.draw_cached_primitive(_PRIMITIVE_POLYLINE, coordinates, properties.color)

    def draw_solid_lines(
        self,
        lines: Iterable[tuple[Vec2, Vec2]],
        properties: BackendProperties,
    ) -> None:
        for start, end in lines:
            self.draw_line(start, end, properties)

    def draw_filled_polygon(
        self,
        points: BkPoints2d,
        properties: BackendProperties,
    ) -> None:
        coordinates = tuple(value for vertex in points.vertices() for value in (vertex.x, vertex.y))
        if self.geometry_writer is not None:
            self.geometry_writer.add(_PRIMITIVE_POLYGON, coordinates, properties.color)
        self.draw_cached_primitive(_PRIMITIVE_POLYGON, coordinates, properties.color)

    def draw_image(self, image_data: ImageData, properties: BackendProperties) -> None:
        # External/raster CAD references are intentionally ignored, matching the
        # existing sanitized SVG policy which removes image elements.
        return

    def clear(self) -> None:
        self.image.paste(_CAD_BACKGROUND, (0, 0, self.width, self.height))

    def _pixel(self, x: float, y: float) -> tuple[float, float]:
        return (
            self.offset_x + (x - self.min_x) * self.scale,
            self.offset_y + (self.max_y - y) * self.scale,
        )


class GeometryIndexBackend(Backend):
    def __init__(self, writer: GeometryIndexWriter) -> None:
        super().__init__()
        self.writer = writer

    def set_background(self, color: str) -> None:
        return

    def draw_point(self, pos: Vec2, properties: BackendProperties) -> None:
        self.writer.add(_PRIMITIVE_POINT, (pos.x, pos.y), properties.color)

    def draw_line(self, start: Vec2, end: Vec2, properties: BackendProperties) -> None:
        self.writer.add(
            _PRIMITIVE_LINE,
            (start.x, start.y, end.x, end.y),
            properties.color,
        )

    def draw_path(self, path: BkPath2d, properties: BackendProperties) -> None:
        coordinates = _flattened_path_coordinates(path, self.config.max_flattening_distance)
        if len(coordinates) >= 4:
            self.writer.add(_PRIMITIVE_POLYLINE, coordinates, properties.color)

    def draw_solid_lines(
        self,
        lines: Iterable[tuple[Vec2, Vec2]],
        properties: BackendProperties,
    ) -> None:
        for start, end in lines:
            self.draw_line(start, end, properties)

    def draw_filled_polygon(
        self,
        points: BkPoints2d,
        properties: BackendProperties,
    ) -> None:
        self.writer.add(
            _PRIMITIVE_POLYGON,
            (value for vertex in points.vertices() for value in (vertex.x, vertex.y)),
            properties.color,
        )

    def draw_image(self, image_data: ImageData, properties: BackendProperties) -> None:
        return

    def clear(self) -> None:
        return


def _flattened_path_coordinates(path: BkPath2d, distance: float) -> tuple[float, ...]:
    if not len(path):
        return ()
    return tuple(
        value for vertex in path.flattening(distance=distance) for value in (vertex.x, vertex.y)
    )


def estimate_cad_render_cost(
    source: Path,
    max_insert_depth: int = 8,
) -> tuple[int, int]:
    document = _load_document(source)
    return _estimate_entities(
        document,
        document.modelspace(),
        depth=0,
        max_insert_depth=max_insert_depth,
        active_blocks=frozenset(),
    )


def _estimate_entities(
    document: Drawing,
    entities: Iterable[DXFGraphic],
    *,
    depth: int,
    max_insert_depth: int,
    active_blocks: frozenset[str],
) -> tuple[int, int]:
    entity_count = 0
    render_cost = 0
    for entity in entities:
        entity_count += 1
        render_cost += _COST_WEIGHTS.get(entity.dxftype(), 1)
        if not isinstance(entity, Insert):
            continue

        for attribute in entity.attribs:
            entity_count += 1
            render_cost += _COST_WEIGHTS.get(attribute.dxftype(), 1)
        if depth >= max_insert_depth:
            continue

        block_name = str(entity.dxf.name)
        normalized_name = block_name.casefold()
        if normalized_name in active_blocks:
            continue
        try:
            block = document.blocks.get(block_name)
        except DXFKeyError:
            continue
        block_count, block_cost = _estimate_entities(
            document,
            block,
            depth=depth + 1,
            max_insert_depth=max_insert_depth,
            active_blocks=active_blocks | {normalized_name},
        )
        instance_count = max(1, int(entity.mcount))
        entity_count += block_count * instance_count
        render_cost += block_cost * instance_count
    return entity_count, render_cost


def generate_cad_tile_preview(
    source: Path,
    document_id: UUID,
    *,
    preview_root: Path,
    tile_size: int,
    max_zoom: int,
    max_source_bytes: int,
    render_timeout_seconds: int,
    render_memory_bytes: int,
    complex_source: bool = False,
) -> PreviewArtifact:
    resolved_root = _validated_preview_root(preview_root)
    lock_path = resolved_root / f".{document_id}.cad.lock"
    with lock_path.open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        root = resolved_root / f"{document_id}.cad"
        _cleanup_abandoned_temporary_bundles(root)
        simplified = False
        source_is_complex = complex_source or source.stat().st_size >= _LARGE_CAD_SOURCE_BYTES
        initialization_timeout = _initialization_timeout_seconds(
            render_timeout_seconds,
            complex_source=source_is_complex,
        )
        try:
            if source_is_complex:
                _run_child(
                    [
                        "initialize-simplified",
                        "--source",
                        str(source),
                        "--document-id",
                        str(document_id),
                        "--preview-root",
                        str(resolved_root),
                        "--tile-size",
                        str(tile_size),
                        "--max-zoom",
                        str(max_zoom),
                        "--max-source-bytes",
                        str(max_source_bytes),
                        "--memory-bytes",
                        str(render_memory_bytes),
                    ],
                    initialization_timeout,
                )
                simplified = True
            else:
                try:
                    _run_child(
                        [
                            "initialize",
                            "--source",
                            str(source),
                            "--document-id",
                            str(document_id),
                            "--preview-root",
                            str(resolved_root),
                            "--tile-size",
                            str(tile_size),
                            "--max-zoom",
                            str(max_zoom),
                            "--max-source-bytes",
                            str(max_source_bytes),
                            "--memory-bytes",
                            str(render_memory_bytes),
                        ],
                        initialization_timeout,
                    )
                except (CadPreviewTimeoutError, CadPreviewResourceError):
                    _run_child(
                        [
                            "initialize-simplified",
                            "--source",
                            str(source),
                            "--document-id",
                            str(document_id),
                            "--preview-root",
                            str(resolved_root),
                            "--tile-size",
                            str(tile_size),
                            "--max-zoom",
                            str(max_zoom),
                            "--max-source-bytes",
                            str(max_source_bytes),
                            "--memory-bytes",
                            str(render_memory_bytes),
                        ],
                        _MAX_COMPLEX_INITIALIZATION_TIMEOUT_SECONDS,
                    )
                    simplified = True
        finally:
            # A subprocess killed by a timeout or memory limit cannot execute
            # its own Python finally block, so the parent removes abandoned
            # server-generated staging bundles while still holding the lock.
            _cleanup_abandoned_temporary_bundles(root)
    manifest, bundle = _read_current_bundle(resolved_root, document_id)
    size_bytes = sum(
        path.stat().st_size
        for path in bundle.rglob("*")
        if path.is_file() and not path.is_symlink()
    )
    if size_bytes <= 0 or size_bytes > _MAX_CAD_BUNDLE_BYTES:
        raise CadPreviewResourceError("CAD 瓦片预览产物超过资源限制")
    return PreviewArtifact(
        storage_key=f"{document_id}.cad",
        kind="cad_tiles",
        mime_type="application/vnd.nexuskb.cad-tiles+json",
        size_bytes=size_bytes,
        renderer=("ezdxf-cad-tiles-progressive" if simplified else "ezdxf-cad-tiles"),
        renderer_version=("2" if simplified else "1"),
    )


def ensure_cad_preview_tile(
    document_id: UUID,
    zoom: int,
    tile_x: int,
    tile_y: int,
    *,
    preview_root: Path,
    metatile_radius: int,
    max_cache_bytes: int,
    render_timeout_seconds: int,
    render_memory_bytes: int,
) -> CadPreviewTileResponse:
    resolved_root = _validated_preview_root(preview_root)
    cached = _cached_tile_response(resolved_root, document_id, zoom, tile_x, tile_y)
    if cached is not None and not _current_progressive_overview_needs_refresh(
        resolved_root, document_id
    ):
        return cached
    lock_path = resolved_root / f".{document_id}.cad.lock"
    with lock_path.open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        manifest, bundle = _read_current_bundle(resolved_root, document_id)
        _validate_tile_coordinates(manifest, zoom, tile_x, tile_y)
        tile_path = bundle / "tiles" / str(zoom) / str(tile_x) / f"{tile_y}.png"
        cache_hit = _is_safe_nonempty_file(tile_path, bundle)
        overview_needs_refresh = _progressive_overview_needs_refresh(bundle)
        if cache_hit and not overview_needs_refresh:
            os.utime(tile_path, None)
        else:
            if _is_geometry_index_ready(bundle) and not overview_needs_refresh:
                timeout_seconds = render_timeout_seconds
            else:
                timeout_seconds = _initialization_timeout_seconds(render_timeout_seconds)
            _run_child(
                [
                    "render",
                    "--document-id",
                    str(document_id),
                    "--preview-root",
                    str(resolved_root),
                    "--zoom",
                    str(zoom),
                    "--tile-x",
                    str(tile_x),
                    "--tile-y",
                    str(tile_y),
                    "--metatile-radius",
                    str(metatile_radius),
                    "--max-cache-bytes",
                    str(max_cache_bytes),
                    "--memory-bytes",
                    str(render_memory_bytes),
                ],
                timeout_seconds,
            )
            manifest, bundle = _read_current_bundle(resolved_root, document_id)
            tile_path = bundle / "tiles" / str(zoom) / str(tile_x) / f"{tile_y}.png"
            if not _is_safe_nonempty_file(tile_path, bundle):
                raise CadPreviewResourceError("CAD 预览瓦片生成失败")
        storage_key = str(tile_path.relative_to(resolved_root))
        return CadPreviewTileResponse(
            storage_key=storage_key,
            mime_type="image/png",
            size_bytes=tile_path.stat().st_size,
            cache_hit=cache_hit,
        )


def read_cad_preview_manifest(preview_root: Path, document_id: UUID) -> CadPreviewManifest:
    manifest, _bundle = _read_current_bundle(_validated_preview_root(preview_root), document_id)
    return manifest


def current_overview_storage_key(preview_root: Path, document_id: UUID) -> str:
    resolved_root = _validated_preview_root(preview_root)
    _manifest, bundle = _read_current_bundle(resolved_root, document_id)
    overview = bundle / _OVERVIEW_FILE
    if not _is_safe_nonempty_file(overview, bundle):
        raise CadPreviewResourceError("CAD 总览图不存在")
    return str(overview.relative_to(resolved_root))


def _run_child(arguments: list[str], timeout_seconds: int) -> None:
    try:
        completed = subprocess.run(  # noqa: S603 -- fixed interpreter/module and validated args
            [sys.executable, "-m", "app.cad_preview_cli", *arguments],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout_seconds,
            env={
                "PATH": "/usr/local/bin:/usr/bin:/bin",
                "LANG": os.environ.get("LANG", "C.UTF-8"),
                "XDG_CACHE_HOME": os.environ.get("XDG_CACHE_HOME", "/tmp"),  # noqa: S108
                "MPLCONFIGDIR": os.environ.get("MPLCONFIGDIR", "/tmp"),  # noqa: S108
                "PYTHONPATH": os.environ.get("PYTHONPATH", "/app"),
            },
        )
    except subprocess.TimeoutExpired as error:
        raise CadPreviewTimeoutError("CAD 预览渲染超时") from error
    if completed.returncode != 0:
        raise CadPreviewResourceError("CAD 预览渲染超过资源限制或生成失败")


def _initialization_timeout_seconds(
    render_timeout_seconds: int,
    *,
    complex_source: bool = False,
) -> int:
    timeout = min(
        render_timeout_seconds * _INITIALIZATION_TIMEOUT_MULTIPLIER,
        _MAX_INITIALIZATION_TIMEOUT_SECONDS,
    )
    if complex_source:
        return min(timeout, _MAX_COMPLEX_INITIALIZATION_TIMEOUT_SECONDS)
    return timeout


def _initialize_bundle(
    source: Path,
    document_id: UUID,
    preview_root: Path,
    tile_size: int,
    max_zoom: int,
    max_source_bytes: int,
) -> None:
    resolved_root = _validated_preview_root(preview_root)
    source_size = source.stat().st_size
    if source_size <= 0 or source_size > max_source_bytes:
        raise CadPreviewResourceError("CAD 预览几何源超过大小限制")
    root = resolved_root / f"{document_id}.cad"
    root.mkdir(mode=0o750, exist_ok=True)
    if root.is_symlink():
        raise CadPreviewResourceError("CAD 预览目录不安全")
    _cleanup_abandoned_temporary_bundles(root)
    bundles = root / "bundles"
    bundles.mkdir(mode=0o750, exist_ok=True)
    bundle_id = str(uuid4())
    temporary = root / f".{bundle_id}.tmp"
    bundle = bundles / bundle_id
    temporary.mkdir(mode=0o750)
    try:
        copied_source = temporary / _SOURCE_FILE
        shutil.copyfile(source, copied_source)
        document = _load_document(copied_source)
        entity_count, render_cost, bounds, detail_bounds = _build_spatial_index(
            document, temporary / _INDEX_FILE
        )
        effective_max_zoom = _effective_max_zoom(max_zoom, bounds, detail_bounds)
        manifest = _build_manifest(
            bounds,
            tile_size,
            effective_max_zoom,
            entity_count,
            render_cost,
            focus_bounds=_default_focus_bounds(bounds, detail_bounds),
        )
        _write_json(
            temporary / _MANIFEST_FILE,
            manifest.model_dump(by_alias=True, exclude_none=True),
        )
        overview_width, overview_height = (
            manifest.overview_width,
            manifest.overview_height,
        )
        _render_entities(
            document,
            document.modelspace(),
            bounds,
            overview_width,
            overview_height,
            temporary / _OVERVIEW_FILE,
            geometry_index_path=temporary / _GEOMETRY_INDEX_FILE,
            flattening_scale=manifest.world_to_pixel[0] * (1 << manifest.max_zoom),
            text_policy=(
                TextPolicy.REPLACE_RECT
                if source_size >= _LARGE_CAD_SOURCE_BYTES
                else TextPolicy.FILLING
            ),
        )
        if manifest.focus_bounds is not None:
            _render_geometry_overview(
                temporary / _GEOMETRY_INDEX_FILE,
                (
                    manifest.focus_bounds.min_x,
                    manifest.focus_bounds.min_y,
                    manifest.focus_bounds.max_x,
                    manifest.focus_bounds.max_y,
                ),
                temporary / _FOCUS_OVERVIEW_FILE,
            )
        z0 = temporary / "tiles" / "0" / "0" / "0.png"
        z0.parent.mkdir(mode=0o750, parents=True)
        _create_z0_from_overview(temporary / _OVERVIEW_FILE, z0, tile_size)
        temporary.replace(bundle)
        _write_json(root / _CURRENT_FILE, {"bundleId": bundle_id})
        _cleanup_old_bundles(bundles, bundle_id)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def _initialize_simplified_bundle(
    source: Path,
    document_id: UUID,
    preview_root: Path,
    tile_size: int,
    max_zoom: int,
    max_source_bytes: int,
) -> None:
    resolved_root = _validated_preview_root(preview_root)
    source_size = source.stat().st_size
    if source_size <= 0 or source_size > max_source_bytes:
        raise CadPreviewResourceError("CAD 预览几何源超过大小限制")
    root = resolved_root / f"{document_id}.cad"
    root.mkdir(mode=0o750, exist_ok=True)
    if root.is_symlink():
        raise CadPreviewResourceError("CAD 预览目录不安全")
    _cleanup_abandoned_temporary_bundles(root)
    bundles = root / "bundles"
    bundles.mkdir(mode=0o750, exist_ok=True)
    bundle_id = str(uuid4())
    temporary = root / f".{bundle_id}.tmp"
    bundle = bundles / bundle_id
    temporary.mkdir(mode=0o750)
    try:
        if _is_binary_dxf(source):
            document = _load_document(source)
            entities = document.modelspace()
            entity_count = len(entities)
            render_cost = sum(_COST_WEIGHTS.get(entity.dxftype(), 1) for entity in entities)
            bounds, detail_bounds = _simplified_cad_bounds(document, entities)
        else:
            document = None
            entities = None
            bounds, detail_bounds, entity_count, render_cost = _scan_ascii_dxf_overview(source)
        effective_max_zoom = _effective_max_zoom(max_zoom, bounds, detail_bounds)
        manifest = _build_manifest(
            bounds,
            tile_size,
            effective_max_zoom,
            entity_count,
            render_cost,
            focus_bounds=_default_focus_bounds(bounds, detail_bounds),
        )
        _write_json(
            temporary / _MANIFEST_FILE,
            manifest.model_dump(by_alias=True, exclude_none=True),
        )
        copied_source = temporary / _SOURCE_FILE
        shutil.copyfile(source, copied_source)
        overview_geometry = temporary / _OVERVIEW_GEOMETRY_INDEX_FILE
        if document is None or entities is None:
            _render_ascii_dxf_overview(
                source,
                bounds,
                manifest.overview_width,
                manifest.overview_height,
                temporary / _OVERVIEW_FILE,
                entity_count,
                overview_geometry,
            )
        else:
            _render_simplified_overview(
                entities,
                bounds,
                manifest.overview_width,
                manifest.overview_height,
                temporary / _OVERVIEW_FILE,
                overview_geometry,
            )
        if manifest.focus_bounds is not None:
            _render_geometry_overview(
                overview_geometry,
                (
                    manifest.focus_bounds.min_x,
                    manifest.focus_bounds.min_y,
                    manifest.focus_bounds.max_x,
                    manifest.focus_bounds.max_y,
                ),
                temporary / _FOCUS_OVERVIEW_FILE,
            )
        _write_json(
            temporary / _SIMPLIFIED_FILE,
            {"formatVersion": "3", "detailMode": "progressive_geometry"},
        )
        z0 = temporary / "tiles" / "0" / "0" / "0.png"
        z0.parent.mkdir(mode=0o750, parents=True)
        _create_z0_from_overview(temporary / _OVERVIEW_FILE, z0, tile_size)
        temporary.replace(bundle)
        _write_json(root / _CURRENT_FILE, {"bundleId": bundle_id})
        _cleanup_old_bundles(bundles, bundle_id)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def _render_metatile(
    document_id: UUID,
    preview_root: Path,
    zoom: int,
    tile_x: int,
    tile_y: int,
    metatile_radius: int,
    max_cache_bytes: int,
) -> None:
    resolved_root = _validated_preview_root(preview_root)
    manifest, bundle = _read_current_bundle(resolved_root, document_id)
    _validate_tile_coordinates(manifest, zoom, tile_x, tile_y)
    if _is_legacy_overview_bundle(bundle):
        grid_width, grid_height = _grid_size(manifest, zoom)
        simplified_protected: set[Path] = set()
        for x in range(
            max(0, tile_x - metatile_radius), min(grid_width - 1, tile_x + metatile_radius) + 1
        ):
            for y in range(
                max(0, tile_y - metatile_radius),
                min(grid_height - 1, tile_y + metatile_radius) + 1,
            ):
                target = bundle / "tiles" / str(zoom) / str(x) / f"{y}.png"
                simplified_protected.add(target)
                if _is_safe_nonempty_file(target, bundle):
                    os.utime(target, None)
                    continue
                _create_live_tile_directory(bundle, zoom, x)
                _render_simplified_tile(manifest, bundle, zoom, x, y, target)
        _cleanup_tile_cache(bundle, max_cache_bytes, simplified_protected)
        return
    geometry_index = bundle / _GEOMETRY_INDEX_FILE
    if not _is_geometry_index_ready(bundle):
        _cleanup_abandoned_geometry_index_temporaries(bundle)
        source = bundle / _SOURCE_FILE
        if not _is_safe_nonempty_file(source, bundle):
            raise CadPreviewResourceError("CAD 预览几何源不存在")
        document = _load_document(source)
        progressive = _is_progressive_bundle(bundle)
        try:
            _build_geometry_index(
                document,
                document.modelspace(),
                geometry_index,
                manifest.world_to_pixel[0] * (1 << manifest.max_zoom),
                text_policy=(
                    TextPolicy.OUTLINE
                    if progressive
                    else (
                        TextPolicy.REPLACE_RECT
                        if source.stat().st_size >= _LARGE_CAD_SOURCE_BYTES
                        else TextPolicy.FILLING
                    )
                ),
                max_primitives=(_FULL_GEOMETRY_PRIMITIVE_LIMIT if progressive else None),
            )
            if _bundle_size_bytes(bundle) > _MAX_CAD_BUNDLE_BYTES:
                geometry_index.unlink(missing_ok=True)
                raise CadPreviewResourceError("CAD 完整几何索引超过 bundle 安全上限")
        except Exception:
            geometry_index.unlink(missing_ok=True)
            raise
    if _progressive_overview_needs_refresh(bundle):
        _refresh_progressive_overviews(manifest, bundle, geometry_index)
    grid_width, grid_height = _grid_size(manifest, zoom)
    protected: set[Path] = set()
    min_tile_x = max(0, tile_x - metatile_radius)
    max_tile_x = min(grid_width - 1, tile_x + metatile_radius)
    min_tile_y = max(0, tile_y - metatile_radius)
    max_tile_y = min(grid_height - 1, tile_y + metatile_radius)
    missing: list[tuple[int, int, Path]] = []
    for x in range(min_tile_x, max_tile_x + 1):
        for y in range(min_tile_y, max_tile_y + 1):
            target = bundle / "tiles" / str(zoom) / str(x) / f"{y}.png"
            protected.add(target)
            if _is_safe_nonempty_file(target, bundle):
                os.utime(target, None)
                continue
            _create_live_tile_directory(bundle, zoom, x)
            missing.append((x, y, target))
    if missing:
        _render_geometry_region(
            geometry_index,
            manifest,
            zoom,
            min_tile_x,
            max_tile_x,
            min_tile_y,
            max_tile_y,
            missing,
        )
    _cleanup_tile_cache(bundle, max_cache_bytes, protected)


def _build_spatial_index(
    document: Drawing,
    index_path: Path,
) -> tuple[
    int,
    int,
    tuple[float, float, float, float],
    tuple[float, float, float, float] | None,
]:
    min_x = math.inf
    min_y = math.inf
    max_x = -math.inf
    max_y = -math.inf
    entity_count = 0
    visible_indexed_entity_count = 0
    render_cost = 0
    detail_bounds_sample: list[tuple[float, float, float, float]] = []
    detail_bounds_random = Random(  # noqa: S311 -- deterministic sampling, not security
        _DETAIL_BOUNDS_SAMPLE_SEED
    )
    cache = bbox.Cache()
    render_context = cad_render_context(document)
    with sqlite3.connect(index_path) as database:
        database.execute("PRAGMA journal_mode=OFF")
        database.execute("PRAGMA synchronous=OFF")
        database.execute("CREATE TABLE entities (id INTEGER PRIMARY KEY, handle TEXT NOT NULL)")
        database.execute(
            "CREATE VIRTUAL TABLE spatial_index USING rtree(id, min_x, max_x, min_y, max_y)"
        )
        for entity in document.modelspace():
            entity_count += 1
            render_cost += _COST_WEIGHTS.get(entity.dxftype(), 1)
            handle = str(entity.dxf.get("handle", ""))
            if not handle:
                continue
            box = bbox.extents([entity], fast=True, cache=cache)
            if not box.has_data:
                continue
            current = (box.extmin.x, box.extmin.y, box.extmax.x, box.extmax.y)
            if not all(math.isfinite(value) for value in current):
                continue
            if render_context.resolve_visible(entity):
                visible_indexed_entity_count += 1
                if len(detail_bounds_sample) < _DETAIL_BOUNDS_SAMPLE_SIZE:
                    detail_bounds_sample.append(current)
                else:
                    replacement_index = detail_bounds_random.randrange(
                        visible_indexed_entity_count
                    )
                    if replacement_index < _DETAIL_BOUNDS_SAMPLE_SIZE:
                        detail_bounds_sample[replacement_index] = current
            row_id = entity_count
            database.execute("INSERT INTO entities(id, handle) VALUES (?, ?)", (row_id, handle))
            database.execute(
                "INSERT INTO spatial_index(id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)",
                (row_id, current[0], current[2], current[1], current[3]),
            )
            min_x = min(min_x, current[0])
            min_y = min(min_y, current[1])
            max_x = max(max_x, current[2])
            max_y = max(max_y, current[3])
        database.commit()
    if not all(math.isfinite(value) for value in (min_x, min_y, max_x, max_y)):
        raise CadPreviewResourceError("CAD 图纸没有可预览的几何边界")
    width = max(max_x - min_x, 1e-6)
    height = max(max_y - min_y, 1e-6)
    padding = max(width, height) * 0.01
    return (
        entity_count,
        render_cost,
        (
            min_x - padding,
            min_y - padding,
            max_x + padding,
            max_y + padding,
        ),
        _robust_detail_bounds(detail_bounds_sample),
    )


def _robust_detail_bounds(
    bounds_sample: list[tuple[float, float, float, float]],
) -> tuple[float, float, float, float] | None:
    if len(bounds_sample) < _DETAIL_BOUNDS_MINIMUM_ENTITIES:
        return None
    trim_count = max(1, math.floor(len(bounds_sample) * _DETAIL_BOUNDS_TRIM_FRACTION))
    if trim_count * 2 >= len(bounds_sample):
        return None
    min_x = sorted(bounds[0] for bounds in bounds_sample)[trim_count]
    min_y = sorted(bounds[1] for bounds in bounds_sample)[trim_count]
    max_x = sorted(bounds[2] for bounds in bounds_sample)[-trim_count - 1]
    max_y = sorted(bounds[3] for bounds in bounds_sample)[-trim_count - 1]
    detail_bounds = (min_x, min_y, max_x, max_y)
    return detail_bounds if _valid_simplified_bounds(detail_bounds) else None


def _effective_max_zoom(
    configured_max_zoom: int,
    bounds: tuple[float, float, float, float],
    detail_bounds: tuple[float, float, float, float] | None,
) -> int:
    if detail_bounds is None or configured_max_zoom >= _MAX_TILE_ZOOM:
        return configured_max_zoom
    full_span = max(bounds[2] - bounds[0], bounds[3] - bounds[1])
    detail_span = max(
        detail_bounds[2] - detail_bounds[0],
        detail_bounds[3] - detail_bounds[1],
    )
    if not math.isfinite(full_span) or not math.isfinite(detail_span) or detail_span <= 0:
        return configured_max_zoom
    span_ratio = full_span / detail_span
    if span_ratio < _DETAIL_BOUNDS_EXTRA_ZOOM_RATIO:
        return configured_max_zoom
    extra_zoom = math.ceil(math.log2(span_ratio))
    return min(_MAX_TILE_ZOOM, configured_max_zoom + extra_zoom)


def _default_focus_bounds(
    bounds: tuple[float, float, float, float],
    detail_bounds: tuple[float, float, float, float] | None,
) -> tuple[float, float, float, float] | None:
    if detail_bounds is None:
        return None
    full_span = max(bounds[2] - bounds[0], bounds[3] - bounds[1])
    detail_span = max(
        detail_bounds[2] - detail_bounds[0],
        detail_bounds[3] - detail_bounds[1],
    )
    if (
        not math.isfinite(full_span)
        or not math.isfinite(detail_span)
        or detail_span <= 0
        or full_span / detail_span < _DETAIL_BOUNDS_EXTRA_ZOOM_RATIO
    ):
        return None
    padding = detail_span * 0.05
    candidate = (
        max(bounds[0], detail_bounds[0] - padding),
        max(bounds[1], detail_bounds[1] - padding),
        min(bounds[2], detail_bounds[2] + padding),
        min(bounds[3], detail_bounds[3] + padding),
    )
    return candidate if _valid_simplified_bounds(candidate) else None


def _build_manifest(
    bounds: tuple[float, float, float, float],
    tile_size: int,
    max_zoom: int,
    entity_count: int,
    render_cost: int,
    *,
    focus_bounds: tuple[float, float, float, float] | None = None,
) -> CadPreviewManifest:
    min_x, min_y, max_x, max_y = bounds
    width = max_x - min_x
    height = max_y - min_y
    base_scale = tile_size / max(width, height)
    base_width = max(1, math.ceil(width * base_scale))
    base_height = max(1, math.ceil(height * base_scale))
    overview_scale = min(1600 / width, 1600 / height)
    overview_width = max(1, math.ceil(width * overview_scale))
    overview_height = max(1, math.ceil(height * overview_scale))
    manifest: dict[str, Any] = {
        "strategy": "tiles",
        "tileSize": tile_size,
        "minZoom": 0,
        "maxZoom": max_zoom,
        "baseWidth": base_width,
        "baseHeight": base_height,
        "overviewWidth": overview_width,
        "overviewHeight": overview_height,
        "bounds": {"minX": min_x, "minY": min_y, "maxX": max_x, "maxY": max_y},
        "worldToPixel": [
            base_scale,
            0,
            0,
            -base_scale,
            -min_x * base_scale,
            max_y * base_scale,
        ],
        "entityCount": entity_count,
        "renderCostScore": render_cost,
    }
    if focus_bounds is not None:
        manifest["focusBounds"] = {
            "minX": focus_bounds[0],
            "minY": focus_bounds[1],
            "maxX": focus_bounds[2],
            "maxY": focus_bounds[3],
        }
    return CadPreviewManifest.model_validate(manifest)


def _render_entities(
    document: Drawing,
    entities: Iterable[DXFGraphic],
    world_bounds: tuple[float, float, float, float],
    width: int,
    height: int,
    target: Path,
    *,
    geometry_index_path: Path | None = None,
    flattening_scale: float | None = None,
    text_policy: TextPolicy = TextPolicy.FILLING,
) -> None:
    if not target.parent.is_dir() or target.parent.is_symlink():
        raise CadPreviewResourceError("CAD 预览 bundle 已不可用")
    temporary = target.parent / f".{target.name}.{os.getpid()}.tmp"
    writer = GeometryIndexWriter(geometry_index_path) if geometry_index_path is not None else None
    backend = PillowCadBackend(width, height, world_bounds, writer)
    scale = min(
        width / max(world_bounds[2] - world_bounds[0], 1e-9),
        height / max(world_bounds[3] - world_bounds[1], 1e-9),
    )
    config = _render_configuration(flattening_scale or scale, text_policy=text_policy)
    frontend = Frontend(cad_render_context(document), backend, config=config)
    try:
        frontend.draw_entities(entities)
        backend.image.convert("RGB").save(temporary, format="PNG", compress_level=6)
        if temporary.stat().st_size <= 0:
            raise CadPreviewResourceError("CAD 预览瓦片为空")
        if writer is not None:
            writer.finish()
        temporary.replace(target)
    finally:
        if writer is not None:
            writer.abort()
        temporary.unlink(missing_ok=True)


def _is_binary_dxf(source: Path) -> bool:
    with source.open("rb") as stream:
        return stream.read(len(_BINARY_DXF_SIGNATURE)) == _BINARY_DXF_SIGNATURE


def _ascii_dxf_pairs(source: Path) -> Iterable[tuple[int, str]]:
    with source.open("rb") as stream:
        while True:
            code_line = stream.readline(_MAX_ASCII_DXF_LINE_BYTES + 1)
            if not code_line:
                return
            value_line = stream.readline(_MAX_ASCII_DXF_LINE_BYTES + 1)
            if not value_line:
                raise CadPreviewResourceError("ASCII DXF group code 缺少值")
            if (
                len(code_line) > _MAX_ASCII_DXF_LINE_BYTES
                or len(value_line) > _MAX_ASCII_DXF_LINE_BYTES
            ):
                raise CadPreviewResourceError("ASCII DXF 行超过预览限制")
            try:
                code = int(code_line.strip())
            except ValueError as error:
                raise CadPreviewResourceError("ASCII DXF group code 无效") from error
            yield code, value_line.rstrip(b"\r\n").decode("utf-8", errors="ignore")


def _iter_ascii_dxf_entities(
    source: Path,
) -> Iterable[tuple[str, list[tuple[int, str]]]]:
    section: str | None = None
    expecting_section_name = False
    entity_type: str | None = None
    tags: list[tuple[int, str]] = []
    for code, value in _ascii_dxf_pairs(source):
        normalized_value = value.strip()
        if code == 0 and normalized_value == "SECTION":
            expecting_section_name = True
            section = None
            continue
        if expecting_section_name and code == 2:
            section = normalized_value
            expecting_section_name = False
            continue
        if section != "ENTITIES":
            continue
        if code != 0:
            if entity_type is not None:
                tags.append((code, value))
            continue
        if entity_type is not None and _is_modelspace_ascii_entity(tags):
            yield entity_type, tags
        entity_type = None
        tags = []
        if normalized_value == "ENDSEC":
            return
        entity_type = normalized_value


def _is_modelspace_ascii_entity(tags: list[tuple[int, str]]) -> bool:
    for code, value in tags:
        if code == 67 and value.strip() == "1":
            return False
        if code == 410 and value.strip().casefold() not in {"", "model"}:
            return False
    return True


def _scan_ascii_dxf_overview(
    source: Path,
) -> tuple[
    tuple[float, float, float, float],
    tuple[float, float, float, float] | None,
    int,
    int,
]:
    header_bounds = _ascii_dxf_header_bounds(source)
    min_x = math.inf
    min_y = math.inf
    max_x = -math.inf
    max_y = -math.inf
    entity_count = 0
    bounded_entity_count = 0
    render_cost = 0
    detail_bounds_sample: list[tuple[float, float, float, float]] = []
    detail_bounds_random = Random(  # noqa: S311 -- deterministic sampling, not security
        _DETAIL_BOUNDS_SAMPLE_SEED
    )
    for entity_type, tags in _iter_ascii_dxf_entities(source):
        entity_count += 1
        render_cost += _COST_WEIGHTS.get(entity_type, 1)
        points, _closed = _ascii_entity_points(entity_type, tags)
        if entity_type == "INSERT":
            # A bare insertion point is not visible geometry. Empty or unresolved
            # block references can otherwise expand the manifest far beyond the
            # entities that ezdxf can actually render.
            continue
        finite_points = [(x, y) for x, y in points if math.isfinite(x) and math.isfinite(y)]
        if not finite_points:
            continue
        xs = [point[0] for point in finite_points]
        ys = [point[1] for point in finite_points]
        current = (min(xs), min(ys), max(xs), max(ys))
        bounded_entity_count += 1
        if len(detail_bounds_sample) < _DETAIL_BOUNDS_SAMPLE_SIZE:
            detail_bounds_sample.append(current)
        else:
            replacement_index = detail_bounds_random.randrange(bounded_entity_count)
            if replacement_index < _DETAIL_BOUNDS_SAMPLE_SIZE:
                detail_bounds_sample[replacement_index] = current
        for x, y in finite_points:
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
    if entity_count <= 0:
        raise CadPreviewResourceError("ASCII DXF 没有可预览实体")
    candidate = (min_x, min_y, max_x, max_y)
    if _valid_simplified_bounds(candidate):
        bounds = _padded_bounds(candidate)
    elif header_bounds is not None:
        bounds = header_bounds
    else:
        raise CadPreviewResourceError("ASCII DXF 没有可预览边界")
    return (
        bounds,
        _robust_detail_bounds(detail_bounds_sample),
        entity_count,
        max(1, render_cost),
    )


def _ascii_dxf_header_bounds(
    source: Path,
) -> tuple[float, float, float, float] | None:
    section: str | None = None
    expecting_section_name = False
    variable: str | None = None
    values: dict[str, dict[int, float]] = {"$EXTMIN": {}, "$EXTMAX": {}}
    for code, value in _ascii_dxf_pairs(source):
        normalized_value = value.strip()
        if code == 0 and normalized_value == "SECTION":
            expecting_section_name = True
            section = None
            continue
        if expecting_section_name and code == 2:
            section = normalized_value
            expecting_section_name = False
            continue
        if section == "HEADER" and code == 0 and normalized_value == "ENDSEC":
            break
        if section != "HEADER":
            continue
        if code == 9:
            variable = normalized_value
            continue
        if variable in values and code in {10, 20}:
            try:
                values[variable][code] = float(normalized_value)
            except ValueError:
                return None
    candidate = (
        values["$EXTMIN"].get(10, math.inf),
        values["$EXTMIN"].get(20, math.inf),
        values["$EXTMAX"].get(10, -math.inf),
        values["$EXTMAX"].get(20, -math.inf),
    )
    return _padded_bounds(candidate) if _valid_simplified_bounds(candidate) else None


def _render_ascii_dxf_overview(
    source: Path,
    world_bounds: tuple[float, float, float, float],
    width: int,
    height: int,
    target: Path,
    entity_count: int,
    geometry_index_path: Path,
) -> None:
    if not target.parent.is_dir() or target.parent.is_symlink():
        raise CadPreviewResourceError("CAD 简化预览 bundle 已不可用")
    temporary = target.parent / f".{target.name}.{os.getpid()}.tmp"
    stride = max(1, math.ceil(entity_count / _SIMPLIFIED_ENTITY_LIMIT))
    writer = GeometryIndexWriter(geometry_index_path, max_primitives=_SIMPLIFIED_PRIMITIVE_LIMIT)
    backend = PillowCadBackend(width, height, world_bounds, writer)
    try:
        for index, (entity_type, tags) in enumerate(_iter_ascii_dxf_entities(source)):
            if index % stride != 0:
                continue
            points, closed = _ascii_entity_points(entity_type, tags)
            _draw_simplified_points(backend, entity_type, points, closed)
        backend.image.convert("RGB").save(temporary, format="PNG", compress_level=6)
        if temporary.stat().st_size <= 0:
            raise CadPreviewResourceError("CAD 简化总览为空")
        writer.finish()
        temporary.replace(target)
    finally:
        writer.abort()
        temporary.unlink(missing_ok=True)


def _ascii_entity_points(
    entity_type: str,
    tags: list[tuple[int, str]],
) -> tuple[list[tuple[float, float]], bool]:
    values: dict[int, list[str]] = {}
    for code, value in tags:
        values.setdefault(code, []).append(value.strip())

    def number(code: int, index: int = 0, default: float | None = None) -> float:
        try:
            return float(values[code][index])
        except (KeyError, IndexError, ValueError):
            if default is not None:
                return default
            raise ValueError("missing numeric DXF tag") from None

    def repeated_points(x_code: int, y_code: int) -> list[tuple[float, float]]:
        xs = values.get(x_code, [])
        ys = values.get(y_code, [])
        return _bounded_points(
            [(float(x_value), float(y_value)) for x_value, y_value in zip(xs, ys, strict=False)]
        )

    def ocs_points(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
        extrusion = Vec3(
            number(210, default=0.0),
            number(220, default=0.0),
            number(230, default=1.0),
        )
        if extrusion.isclose(Vec3(0.0, 0.0, 1.0)):
            return points
        ocs = OCS(extrusion)
        return [(world.x, world.y) for x, y in points for world in (ocs.to_wcs(Vec3(x, y, 0.0)),)]

    try:
        if entity_type == "LINE":
            return [(number(10), number(20)), (number(11), number(21))], False
        if entity_type == "LWPOLYLINE":
            flags = int(number(70, default=0))
            return ocs_points(repeated_points(10, 20)), bool(flags & 1)
        if entity_type == "POLYLINE":
            flags = int(number(70, default=0))
            return repeated_points(10, 20), bool(flags & 1)
        if entity_type in {"SOLID", "TRACE", "3DFACE"}:
            points = [
                (number(code), number(code + 10))
                for code in (10, 11, 12, 13)
                if code in values and code + 10 in values
            ]
            if entity_type != "3DFACE":
                points = ocs_points(points)
            return points, True
        if entity_type in {"CIRCLE", "ARC"}:
            center_x, center_y = number(10), number(20)
            radius = number(40)
            start_angle = 0.0 if entity_type == "CIRCLE" else number(50)
            end_angle = 360.0 if entity_type == "CIRCLE" else number(51)
            if end_angle <= start_angle:
                end_angle += 360.0
            segments = max(
                4,
                math.ceil(_SIMPLIFIED_CURVE_SEGMENTS * (end_angle - start_angle) / 360.0),
            )
            points = [
                (
                    center_x + radius * math.cos(math.radians(angle)),
                    center_y + radius * math.sin(math.radians(angle)),
                )
                for angle in (
                    start_angle + (end_angle - start_angle) * index / segments
                    for index in range(segments + 1)
                )
            ]
            return ocs_points(points), entity_type == "CIRCLE"
        if entity_type == "ELLIPSE":
            center_x, center_y = number(10), number(20)
            major_x, major_y = number(11), number(21)
            ratio = number(40)
            start_param = number(41, default=0.0)
            end_param = number(42, default=math.tau)
            if end_param <= start_param:
                end_param += math.tau
            return (
                [
                    (
                        center_x
                        + major_x * math.cos(parameter)
                        - major_y * ratio * math.sin(parameter),
                        center_y
                        + major_y * math.cos(parameter)
                        + major_x * ratio * math.sin(parameter),
                    )
                    for parameter in (
                        start_param + (end_param - start_param) * index / _SIMPLIFIED_CURVE_SEGMENTS
                        for index in range(_SIMPLIFIED_CURVE_SEGMENTS + 1)
                    )
                ],
                math.isclose(end_param - start_param, math.tau, rel_tol=1e-6),
            )
        if entity_type == "SPLINE":
            points = repeated_points(10, 20) or repeated_points(11, 21)
            return points, False
        if entity_type in {"INSERT", "TEXT", "MTEXT", "ATTRIB", "ATTDEF"}:
            return ocs_points([(number(10), number(20))]), False
        if entity_type in {"POINT", "DIMENSION", "VERTEX"}:
            return [(number(10), number(20))], False
    except (TypeError, ValueError, OverflowError):
        return [], False
    return [], False


def _simplified_cad_bounds(
    document: Drawing,
    entities: Iterable[DXFGraphic],
) -> tuple[
    tuple[float, float, float, float],
    tuple[float, float, float, float] | None,
]:
    min_x = math.inf
    min_y = math.inf
    max_x = -math.inf
    max_y = -math.inf
    bounded_entity_count = 0
    detail_bounds_sample: list[tuple[float, float, float, float]] = []
    detail_bounds_random = Random(  # noqa: S311 -- deterministic sampling, not security
        _DETAIL_BOUNDS_SAMPLE_SEED
    )
    for entity in entities:
        finite_points = [
            (x, y)
            for x, y in _simplified_entity_points(entity)
            if math.isfinite(x) and math.isfinite(y)
        ]
        if not finite_points:
            continue
        xs = [point[0] for point in finite_points]
        ys = [point[1] for point in finite_points]
        current = (min(xs), min(ys), max(xs), max(ys))
        bounded_entity_count += 1
        if len(detail_bounds_sample) < _DETAIL_BOUNDS_SAMPLE_SIZE:
            detail_bounds_sample.append(current)
        else:
            replacement_index = detail_bounds_random.randrange(bounded_entity_count)
            if replacement_index < _DETAIL_BOUNDS_SAMPLE_SIZE:
                detail_bounds_sample[replacement_index] = current
        for x, y in finite_points:
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
    candidate = (min_x, min_y, max_x, max_y)
    if not _valid_simplified_bounds(candidate):
        extmin = document.header.get("$EXTMIN")
        extmax = document.header.get("$EXTMAX")
        if extmin is None or extmax is None:
            raise CadPreviewResourceError("CAD 图纸没有可预览的简化几何边界")
        min_x, min_y = _xy(extmin)
        max_x, max_y = _xy(extmax)
        candidate = (min_x, min_y, max_x, max_y)
        if not _valid_simplified_bounds(candidate):
            raise CadPreviewResourceError("CAD 图纸没有可预览的简化几何边界")
    return _padded_bounds(candidate), _robust_detail_bounds(detail_bounds_sample)


def _valid_simplified_bounds(bounds: tuple[float, float, float, float]) -> bool:
    min_x, min_y, max_x, max_y = bounds
    return (
        all(math.isfinite(value) and abs(value) < 1e15 for value in bounds)
        and max_x > min_x
        and max_y > min_y
    )


def _padded_bounds(
    bounds: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    min_x, min_y, max_x, max_y = bounds
    padding = max(max_x - min_x, max_y - min_y) * 0.01
    return min_x - padding, min_y - padding, max_x + padding, max_y + padding


def _render_simplified_overview(
    entities: Iterable[DXFGraphic],
    world_bounds: tuple[float, float, float, float],
    width: int,
    height: int,
    target: Path,
    geometry_index_path: Path,
) -> None:
    if not target.parent.is_dir() or target.parent.is_symlink():
        raise CadPreviewResourceError("CAD 简化预览 bundle 已不可用")
    temporary = target.parent / f".{target.name}.{os.getpid()}.tmp"
    entity_sequence = list(entities)
    stride = max(1, math.ceil(len(entity_sequence) / _SIMPLIFIED_ENTITY_LIMIT))
    writer = GeometryIndexWriter(geometry_index_path, max_primitives=_SIMPLIFIED_PRIMITIVE_LIMIT)
    backend = PillowCadBackend(width, height, world_bounds, writer)
    try:
        for index, entity in enumerate(entity_sequence):
            if index % stride != 0:
                continue
            _draw_simplified_entity(backend, entity)
        backend.image.convert("RGB").save(temporary, format="PNG", compress_level=6)
        if temporary.stat().st_size <= 0:
            raise CadPreviewResourceError("CAD 简化总览为空")
        writer.finish()
        temporary.replace(target)
    finally:
        writer.abort()
        temporary.unlink(missing_ok=True)


def _draw_simplified_entity(backend: PillowCadBackend, entity: DXFGraphic) -> None:
    entity_type = entity.dxftype()
    points = _simplified_entity_points(entity)
    closed = entity_type in {"CIRCLE", "LWPOLYLINE", "POLYLINE"} and bool(
        getattr(entity, "closed", False)
    )
    _draw_simplified_points(backend, entity_type, points, closed)


def _draw_simplified_points(
    backend: PillowCadBackend,
    entity_type: str,
    points: list[tuple[float, float]],
    closed: bool,
) -> None:
    finite_points = [(x, y) for x, y in points if math.isfinite(x) and math.isfinite(y)]
    if not finite_points:
        return
    if entity_type in {"INSERT", "POINT", "TEXT", "MTEXT", "ATTRIB", "ATTDEF", "DIMENSION"}:
        _draw_simplified_primitive(backend, _PRIMITIVE_POINT, finite_points[0])
        return
    if len(finite_points) == 1:
        _draw_simplified_primitive(backend, _PRIMITIVE_POINT, finite_points[0])
        return
    line_points = list(finite_points)
    if closed:
        line_points.append(line_points[0])
    for start, end in zip(line_points, line_points[1:], strict=False):
        _draw_simplified_primitive(
            backend,
            _PRIMITIVE_LINE,
            (start[0], start[1], end[0], end[1]),
        )


def _draw_simplified_primitive(
    backend: PillowCadBackend,
    kind: int,
    coordinates: tuple[float, ...],
) -> None:
    if backend.geometry_writer is not None:
        backend.geometry_writer.add(kind, coordinates, _SIMPLIFIED_COLOR_HEX)
    backend.draw_cached_primitive(kind, coordinates, _SIMPLIFIED_COLOR_HEX)


def _simplified_entity_points(entity: DXFGraphic) -> list[tuple[float, float]]:
    entity_type = entity.dxftype()
    entity_any: Any = entity
    try:
        if entity_type == "LINE":
            return [_xy(entity.dxf.start), _xy(entity.dxf.end)]
        if entity_type == "LWPOLYLINE":
            return _bounded_points([(float(x), float(y)) for x, y in entity_any.get_points("xy")])
        if entity_type == "POLYLINE":
            return _bounded_points([_xy(point) for point in entity_any.points()])
        if entity_type in {"CIRCLE", "ARC"}:
            center_x, center_y = _xy(entity.dxf.center)
            radius = float(entity.dxf.radius)
            start_angle = 0.0 if entity_type == "CIRCLE" else float(entity.dxf.start_angle)
            end_angle = 360.0 if entity_type == "CIRCLE" else float(entity.dxf.end_angle)
            if end_angle <= start_angle:
                end_angle += 360.0
            segments = max(
                4,
                math.ceil(_SIMPLIFIED_CURVE_SEGMENTS * (end_angle - start_angle) / 360.0),
            )
            return [
                (
                    center_x + radius * math.cos(math.radians(angle)),
                    center_y + radius * math.sin(math.radians(angle)),
                )
                for angle in (
                    start_angle + (end_angle - start_angle) * index / segments
                    for index in range(segments + 1)
                )
            ]
        if entity_type == "ELLIPSE":
            center_x, center_y = _xy(entity.dxf.center)
            major_x, major_y = _xy(entity.dxf.major_axis)
            ratio = float(entity.dxf.ratio)
            start_param = float(entity.dxf.start_param)
            end_param = float(entity.dxf.end_param)
            if end_param <= start_param:
                end_param += math.tau
            return [
                (
                    center_x
                    + major_x * math.cos(parameter)
                    - major_y * ratio * math.sin(parameter),
                    center_y
                    + major_y * math.cos(parameter)
                    + major_x * ratio * math.sin(parameter),
                )
                for parameter in (
                    start_param + (end_param - start_param) * index / _SIMPLIFIED_CURVE_SEGMENTS
                    for index in range(_SIMPLIFIED_CURVE_SEGMENTS + 1)
                )
            ]
        if entity_type == "SPLINE":
            control_points = list(entity_any.control_points)
            if not control_points:
                control_points = list(entity_any.fit_points)
            return _bounded_points([_xy(point) for point in control_points])
        for attribute in ("insert", "location", "defpoint", "center"):
            value = entity.dxf.get(attribute, None)
            if value is not None:
                return [_xy(value)]
    except (AttributeError, TypeError, ValueError, OverflowError):
        return []
    return []


def _bounded_points(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(points) <= _SIMPLIFIED_POLYLINE_POINT_LIMIT:
        return points
    stride = math.ceil(len(points) / _SIMPLIFIED_POLYLINE_POINT_LIMIT)
    sampled = points[::stride]
    if sampled[-1] != points[-1]:
        sampled.append(points[-1])
    return sampled


def _xy(value: Any) -> tuple[float, float]:
    if hasattr(value, "x") and hasattr(value, "y"):
        return float(value.x), float(value.y)
    if isinstance(value, tuple | list) and len(value) >= 2:
        return float(value[0]), float(value[1])
    raise TypeError("CAD point does not contain x/y coordinates")


def _render_configuration(
    scale: float,
    *,
    text_policy: TextPolicy = TextPolicy.FILLING,
) -> Configuration:
    return Configuration(
        line_policy=LinePolicy.SOLID,
        hatch_policy=HatchPolicy.SHOW_SOLID,
        text_policy=text_policy,
        image_policy=ImagePolicy.IGNORE,
        background_policy=BackgroundPolicy.MODELSPACE,
        min_lineweight=1.0,
        lineweight_scaling=0,
        max_flattening_distance=max(0.25 / max(scale, 1e-9), 1e-9),
        hatching_timeout=5.0,
    )


def _build_geometry_index(
    document: Drawing,
    entities: Iterable[DXFGraphic],
    target: Path,
    flattening_scale: float,
    text_policy: TextPolicy = TextPolicy.FILLING,
    max_primitives: int | None = None,
) -> None:
    writer = GeometryIndexWriter(
        target,
        max_primitives=max_primitives,
        fail_on_limit=max_primitives is not None,
    )
    try:
        backend = GeometryIndexBackend(writer)
        frontend = Frontend(
            cad_render_context(document),
            backend,
            config=_render_configuration(flattening_scale, text_policy=text_policy),
        )
        frontend.draw_entities(entities)
        writer.finish()
    finally:
        writer.abort()


def _render_geometry_region(
    geometry_index: Path,
    manifest: CadPreviewManifest,
    zoom: int,
    min_tile_x: int,
    max_tile_x: int,
    min_tile_y: int,
    max_tile_y: int,
    missing: list[tuple[int, int, Path]],
) -> None:
    top_left = _tile_world_bounds(manifest, zoom, min_tile_x, min_tile_y)
    bottom_right = _tile_world_bounds(manifest, zoom, max_tile_x, max_tile_y)
    world_bounds = (top_left[0], bottom_right[1], bottom_right[2], top_left[3])
    width = (max_tile_x - min_tile_x + 1) * manifest.tile_size
    height = (max_tile_y - min_tile_y + 1) * manifest.tile_size
    backend = PillowCadBackend(width, height, world_bounds)
    with _open_geometry_index(geometry_index) as database:
        rows = _query_geometry_primitives(database, world_bounds)
        for kind_value, color_value, blob_value in rows:
            kind = int(kind_value)
            color = int(color_value)
            coordinates = _decode_geometry_blob(kind, blob_value)
            backend.draw_cached_primitive(kind, coordinates, color)

    for x, y, target in missing:
        left = (x - min_tile_x) * manifest.tile_size
        top = (y - min_tile_y) * manifest.tile_size
        tile = backend.image.crop(
            (left, top, left + manifest.tile_size, top + manifest.tile_size)
        ).convert("RGB")
        _save_png_atomic(tile, target)


def _render_geometry_overview(
    geometry_index: Path,
    world_bounds: tuple[float, float, float, float],
    target: Path,
    max_dimension: int = 800,
) -> None:
    world_width = world_bounds[2] - world_bounds[0]
    world_height = world_bounds[3] - world_bounds[1]
    scale = max_dimension / max(world_width, world_height)
    width = max(1, math.ceil(world_width * scale))
    height = max(1, math.ceil(world_height * scale))
    backend = PillowCadBackend(width, height, world_bounds)
    with _open_geometry_index(geometry_index) as database:
        rows = _query_geometry_primitives(database, world_bounds)
        for kind_value, color_value, blob_value in rows:
            kind = int(kind_value)
            color = int(color_value)
            coordinates = _decode_geometry_blob(kind, blob_value)
            backend.draw_cached_primitive(kind, coordinates, color)
    _save_png_atomic(backend.image.convert("RGB"), target)


def _refresh_progressive_overviews(
    manifest: CadPreviewManifest,
    bundle: Path,
    geometry_index: Path,
) -> None:
    overview = bundle / _OVERVIEW_FILE
    z0 = bundle / "tiles" / "0" / "0" / "0.png"
    temporary_overview = bundle / f".{_OVERVIEW_FILE}.{os.getpid()}.refresh"
    temporary_z0 = z0.parent / f".{z0.name}.{os.getpid()}.refresh"
    temporary_focus = bundle / f".{_FOCUS_OVERVIEW_FILE}.{os.getpid()}.refresh"
    try:
        _render_geometry_overview(
            geometry_index,
            (
                manifest.bounds.min_x,
                manifest.bounds.min_y,
                manifest.bounds.max_x,
                manifest.bounds.max_y,
            ),
            temporary_overview,
            max(manifest.overview_width, manifest.overview_height),
        )
        _create_z0_from_overview(temporary_overview, temporary_z0, manifest.tile_size)
        if manifest.focus_bounds is not None:
            _render_geometry_overview(
                geometry_index,
                (
                    manifest.focus_bounds.min_x,
                    manifest.focus_bounds.min_y,
                    manifest.focus_bounds.max_x,
                    manifest.focus_bounds.max_y,
                ),
                temporary_focus,
            )
        temporary_overview.replace(overview)
        temporary_z0.replace(z0)
        if manifest.focus_bounds is not None:
            temporary_focus.replace(bundle / _FOCUS_OVERVIEW_FILE)
        _write_json(
            bundle / _OVERVIEW_STATE_FILE,
            {"formatVersion": "1", "detailMode": "full_geometry"},
        )
    finally:
        temporary_overview.unlink(missing_ok=True)
        temporary_z0.unlink(missing_ok=True)
        temporary_focus.unlink(missing_ok=True)


def _query_geometry_primitives(
    database: sqlite3.Connection,
    world_bounds: tuple[float, float, float, float],
) -> sqlite3.Cursor:
    min_x, min_y, max_x, max_y = world_bounds
    return database.execute(
        """
        SELECT primitives.kind, primitives.color, primitives.points
        FROM primitive_index
        JOIN primitives ON primitives.id = primitive_index.id
        WHERE primitive_index.min_x <= ? AND primitive_index.max_x >= ?
          AND primitive_index.min_y <= ? AND primitive_index.max_y >= ?
        ORDER BY primitives.id
        """,
        (max_x, min_x, max_y, min_y),
    )


def _decode_geometry_blob(kind: int, value: object) -> tuple[float, ...]:
    if kind not in {
        _PRIMITIVE_POINT,
        _PRIMITIVE_LINE,
        _PRIMITIVE_POLYGON,
        _PRIMITIVE_POLYLINE,
    }:
        raise CadPreviewResourceError("CAD 几何索引包含未知图元")
    if not isinstance(value, bytes):
        raise CadPreviewResourceError("CAD 几何索引数据无效")
    if len(value) <= 0 or len(value) > _MAX_GEOMETRY_BLOB_BYTES or len(value) % 16 != 0:
        raise CadPreviewResourceError("CAD 几何索引数据无效")
    coordinate_count = len(value) // 8
    if (kind == _PRIMITIVE_POINT and coordinate_count != 2) or (
        kind == _PRIMITIVE_LINE and coordinate_count != 4
    ):
        raise CadPreviewResourceError("CAD 几何索引数据无效")
    if kind == _PRIMITIVE_POLYLINE and coordinate_count < 4:
        raise CadPreviewResourceError("CAD 几何索引数据无效")
    if kind == _PRIMITIVE_POLYGON and coordinate_count < 6:
        raise CadPreviewResourceError("CAD 几何索引数据无效")
    coordinates = struct.unpack(f"<{coordinate_count}d", value)
    if not all(math.isfinite(coordinate) for coordinate in coordinates):
        raise CadPreviewResourceError("CAD 几何索引数据无效")
    return coordinates


def _save_png_atomic(image: Image.Image, target: Path) -> None:
    if not target.parent.is_dir() or target.parent.is_symlink():
        raise CadPreviewResourceError("CAD 预览 bundle 已不可用")
    temporary = target.parent / f".{target.name}.{os.getpid()}.tmp"
    try:
        image.save(temporary, format="PNG", compress_level=6)
        if temporary.stat().st_size <= 0:
            raise CadPreviewResourceError("CAD 预览瓦片为空")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def _is_geometry_index_ready(bundle: Path) -> bool:
    geometry_index = bundle / _GEOMETRY_INDEX_FILE
    if not _is_safe_nonempty_file(geometry_index, bundle):
        return False
    try:
        with _open_geometry_index(geometry_index) as database:
            version = database.execute(
                "SELECT value FROM metadata WHERE key = 'formatVersion'"
            ).fetchone()
            primitive = database.execute("SELECT 1 FROM primitives LIMIT 1").fetchone()
        return (
            version is not None
            and version[0] in _SUPPORTED_GEOMETRY_FORMAT_VERSIONS
            and primitive is not None
        )
    except (OSError, sqlite3.DatabaseError):
        return False


def _current_progressive_overview_needs_refresh(preview_root: Path, document_id: UUID) -> bool:
    _manifest, bundle = _read_current_bundle(preview_root, document_id)
    return _progressive_overview_needs_refresh(bundle)


def _progressive_overview_needs_refresh(bundle: Path) -> bool:
    if not _is_progressive_bundle(bundle) or not _is_geometry_index_ready(bundle):
        return False
    marker = bundle / _OVERVIEW_STATE_FILE
    if not _is_safe_nonempty_file(marker, bundle):
        return True
    try:
        value: object = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return True
    return value != {"formatVersion": "1", "detailMode": "full_geometry"}


def _read_simplified_marker(bundle: Path) -> dict[str, Any] | None:
    marker = bundle / _SIMPLIFIED_FILE
    if not _is_safe_nonempty_file(marker, bundle):
        return None
    try:
        value: Any = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _is_legacy_overview_bundle(bundle: Path) -> bool:
    value = _read_simplified_marker(bundle)
    return (
        value is not None
        and value.get("formatVersion") == "1"
        and value.get("detailMode") == "overview"
    )


def _is_progressive_bundle(bundle: Path) -> bool:
    value = _read_simplified_marker(bundle)
    return (
        value is not None
        and value.get("formatVersion") == "3"
        and value.get("detailMode") == "progressive_geometry"
    )


def _bundle_size_bytes(bundle: Path) -> int:
    return sum(
        path.stat().st_size
        for path in bundle.rglob("*")
        if path.is_file() and not path.is_symlink()
    )


def _open_geometry_index(path: Path) -> sqlite3.Connection:
    uri = f"{path.resolve(strict=True).as_uri()}?mode=ro&immutable=1"
    return sqlite3.connect(uri, uri=True)


def _create_z0_from_overview(overview: Path, target: Path, tile_size: int) -> None:
    temporary = target.parent / f".{target.name}.{os.getpid()}.tmp"
    try:
        with Image.open(overview) as source:
            resized = source.convert("RGB")
            resized.thumbnail((tile_size, tile_size), Image.Resampling.LANCZOS)
        image = Image.new("RGB", (tile_size, tile_size), _CAD_BACKGROUND[:3])
        image.paste(
            resized,
            ((tile_size - resized.width) // 2, (tile_size - resized.height) // 2),
        )
        image.save(temporary, format="PNG", compress_level=6)
        if temporary.stat().st_size <= 0:
            raise CadPreviewResourceError("CAD 基础瓦片为空")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def _render_simplified_tile(
    manifest: CadPreviewManifest,
    bundle: Path,
    zoom: int,
    tile_x: int,
    tile_y: int,
    target: Path,
) -> None:
    overview = bundle / _OVERVIEW_FILE
    if not _is_safe_nonempty_file(overview, bundle):
        raise CadPreviewResourceError("CAD 简化总览不存在")
    multiplier = 1 << zoom
    full_width = manifest.base_width * multiplier
    full_height = manifest.base_height * multiplier
    with Image.open(overview) as source:
        source_rgb = source.convert("RGB")
        source_box = (
            tile_x * manifest.tile_size * source_rgb.width / full_width,
            tile_y * manifest.tile_size * source_rgb.height / full_height,
            (tile_x + 1) * manifest.tile_size * source_rgb.width / full_width,
            (tile_y + 1) * manifest.tile_size * source_rgb.height / full_height,
        )
        tile = source_rgb.transform(
            (manifest.tile_size, manifest.tile_size),
            Image.Transform.EXTENT,
            source_box,
            resample=Image.Resampling.BILINEAR,
            fillcolor=_CAD_BACKGROUND[:3],
        )
    _save_png_atomic(tile, target)


def _cached_tile_response(
    preview_root: Path,
    document_id: UUID,
    zoom: int,
    tile_x: int,
    tile_y: int,
) -> CadPreviewTileResponse | None:
    manifest, bundle = _read_current_bundle(preview_root, document_id)
    _validate_tile_coordinates(manifest, zoom, tile_x, tile_y)
    tile_path = bundle / "tiles" / str(zoom) / str(tile_x) / f"{tile_y}.png"
    if not _is_safe_nonempty_file(tile_path, bundle):
        return None
    os.utime(tile_path, None)
    return CadPreviewTileResponse(
        storage_key=str(tile_path.relative_to(preview_root)),
        mime_type="image/png",
        size_bytes=tile_path.stat().st_size,
        cache_hit=True,
    )


def _read_current_bundle(
    preview_root: Path,
    document_id: UUID,
) -> tuple[CadPreviewManifest, Path]:
    root = preview_root / f"{document_id}.cad"
    if not root.exists() or not root.is_dir() or root.is_symlink():
        raise CadPreviewResourceError("CAD 瓦片预览尚未生成")
    try:
        current: Any = json.loads((root / _CURRENT_FILE).read_text(encoding="utf-8"))
        bundle_id = current["bundleId"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise CadPreviewResourceError("CAD 瓦片预览清单无效") from error
    if not isinstance(bundle_id, str):
        raise CadPreviewResourceError("CAD 瓦片预览清单无效")
    try:
        UUID(bundle_id)
    except ValueError as error:
        raise CadPreviewResourceError("CAD 瓦片预览清单无效") from error
    bundle = root / "bundles" / bundle_id
    try:
        bundle.resolve(strict=True).relative_to(root.resolve(strict=True))
    except (OSError, ValueError) as error:
        raise CadPreviewResourceError("CAD 瓦片预览目录不安全") from error
    if not bundle.is_dir() or bundle.is_symlink():
        raise CadPreviewResourceError("CAD 瓦片预览目录不安全")
    try:
        manifest = CadPreviewManifest.model_validate_json(
            (bundle / _MANIFEST_FILE).read_text(encoding="utf-8")
        )
    except (OSError, ValueError) as error:
        raise CadPreviewResourceError("CAD 瓦片预览清单无效") from error
    return manifest, bundle


def _validate_tile_coordinates(
    manifest: CadPreviewManifest,
    zoom: int,
    tile_x: int,
    tile_y: int,
) -> None:
    if zoom < manifest.min_zoom or zoom > manifest.max_zoom:
        raise ValueError("CAD 预览缩放层级无效")
    grid_width, grid_height = _grid_size(manifest, zoom)
    if tile_x < 0 or tile_y < 0 or tile_x >= grid_width or tile_y >= grid_height:
        raise ValueError("CAD 预览瓦片坐标无效")


def _grid_size(manifest: CadPreviewManifest, zoom: int) -> tuple[int, int]:
    multiplier = 1 << zoom
    return (
        max(1, math.ceil(manifest.base_width * multiplier / manifest.tile_size)),
        max(1, math.ceil(manifest.base_height * multiplier / manifest.tile_size)),
    )


def _tile_world_bounds(
    manifest: CadPreviewManifest,
    zoom: int,
    tile_x: int,
    tile_y: int,
) -> tuple[float, float, float, float]:
    scale = manifest.world_to_pixel[0] * (1 << zoom)
    min_x = manifest.bounds.min_x + tile_x * manifest.tile_size / scale
    max_x = manifest.bounds.min_x + (tile_x + 1) * manifest.tile_size / scale
    max_y = manifest.bounds.max_y - tile_y * manifest.tile_size / scale
    min_y = manifest.bounds.max_y - (tile_y + 1) * manifest.tile_size / scale
    return min_x, min_y, max_x, max_y


def _query_handles(
    database: sqlite3.Connection,
    world_bounds: tuple[float, float, float, float],
) -> list[str]:
    min_x, min_y, max_x, max_y = world_bounds
    rows = database.execute(
        """
        SELECT entities.handle
        FROM spatial_index
        JOIN entities ON entities.id = spatial_index.id
        WHERE spatial_index.min_x <= ? AND spatial_index.max_x >= ?
          AND spatial_index.min_y <= ? AND spatial_index.max_y >= ?
        ORDER BY entities.id
        """,
        (max_x, min_x, max_y, min_y),
    )
    return [str(row[0]) for row in rows]


def _cleanup_tile_cache(bundle: Path, max_bytes: int, protected: set[Path]) -> None:
    z0 = bundle / "tiles" / "0" / "0" / "0.png"
    files = [
        path
        for path in (bundle / "tiles").rglob("*.png")
        if path != z0 and path not in protected and _is_safe_nonempty_file(path, bundle)
    ]
    total = sum(path.stat().st_size for path in files) + sum(
        path.stat().st_size for path in protected if path.exists()
    )
    for path in sorted(files, key=lambda item: item.stat().st_mtime):
        if total <= max_bytes:
            break
        size = path.stat().st_size
        path.unlink(missing_ok=True)
        total -= size


def _create_live_tile_directory(bundle: Path, zoom: int, tile_x: int) -> None:
    # Deliberately avoid parents=True. If document deletion removes the bundle
    # while a render is in flight, the Worker must fail instead of recreating a
    # recognizable cache directory after deletion has completed.
    try:
        zoom_directory = bundle / "tiles" / str(zoom)
        zoom_directory.mkdir(mode=0o750, exist_ok=True)
        x_directory = zoom_directory / str(tile_x)
        x_directory.mkdir(mode=0o750, exist_ok=True)
    except OSError as error:
        raise CadPreviewResourceError("CAD 预览 bundle 已不可用") from error


def _cleanup_old_bundles(bundles: Path, current_bundle_id: str) -> None:
    others = sorted(
        (
            path
            for path in bundles.iterdir()
            if path.is_dir() and not path.is_symlink() and path.name != current_bundle_id
        ),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for path in others:
        _cleanup_abandoned_geometry_index_temporaries(path)
    for path in others[1:]:
        shutil.rmtree(path)


def _cleanup_abandoned_temporary_bundles(root: Path) -> None:
    if not root.exists():
        return
    if not root.is_dir() or root.is_symlink():
        raise CadPreviewResourceError("CAD 预览目录不安全")
    for path in root.iterdir():
        if not path.is_dir() or path.is_symlink():
            continue
        name = path.name
        if not name.startswith(".") or not name.endswith(".tmp"):
            continue
        try:
            UUID(name[1:-4])
        except ValueError:
            continue
        shutil.rmtree(path)


def _cleanup_abandoned_geometry_index_temporaries(bundle: Path) -> None:
    prefix = f".{_GEOMETRY_INDEX_FILE}."
    suffix = ".tmp"
    for path in bundle.iterdir():
        name = path.name
        process_id = name[len(prefix) : -len(suffix)]
        if (
            name.startswith(prefix)
            and name.endswith(suffix)
            and process_id.isdigit()
            and path.is_file()
            and not path.is_symlink()
        ):
            path.unlink(missing_ok=True)


def _write_json(path: Path, value: object) -> None:
    temporary = path.parent / f".{path.name}.{os.getpid()}.tmp"
    try:
        temporary.write_text(
            json.dumps(value, ensure_ascii=True, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _load_document(path: Path) -> Drawing:
    try:
        return readfile(path)
    except (DXFError, UnicodeDecodeError):
        document, _auditor = recover.readfile(path, errors="strict")
        return document


def _validated_preview_root(root: Path) -> Path:
    resolved = root.resolve(strict=True)
    if (
        not root.is_absolute()
        or root.is_symlink()
        or not resolved.is_dir()
        or not os.access(resolved, os.W_OK | os.X_OK)
    ):
        raise CadPreviewResourceError("预览产物目录不可用")
    return resolved


def _is_safe_nonempty_file(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=True).relative_to(root.resolve(strict=True))
        return path.is_file() and not path.is_symlink() and path.stat().st_size > 0
    except (OSError, ValueError):
        return False


def _parse_color(
    color: str,
    fallback: tuple[int, int, int, int] = (255, 255, 255, 255),
) -> tuple[int, int, int, int]:
    value = color.removeprefix("#")
    try:
        if len(value) == 6:
            return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), 255
        if len(value) == 8:
            return (
                int(value[0:2], 16),
                int(value[2:4], 16),
                int(value[4:6], 16),
                int(value[6:8], 16),
            )
    except ValueError:
        pass
    return fallback


def _pack_color(color: str) -> int:
    red, green, blue, alpha = _parse_color(color)
    return (red << 24) | (green << 16) | (blue << 8) | alpha


def _unpack_color(color: int) -> tuple[int, int, int, int]:
    if color < 0 or color > 0xFFFFFFFF:
        raise CadPreviewResourceError("CAD 几何索引颜色无效")
    return color >> 24, (color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF


def _clip_line(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    min_x: float,
    min_y: float,
    max_x: float,
    max_y: float,
) -> tuple[float, float, float, float] | None:
    dx = x2 - x1
    dy = y2 - y1
    lower = 0.0
    upper = 1.0
    for p, q in (
        (-dx, x1 - min_x),
        (dx, max_x - x1),
        (-dy, y1 - min_y),
        (dy, max_y - y1),
    ):
        if math.isclose(p, 0.0):
            if q < 0:
                return None
            continue
        ratio = q / p
        if p < 0:
            lower = max(lower, ratio)
        else:
            upper = min(upper, ratio)
        if lower > upper:
            return None
    return (
        x1 + lower * dx,
        y1 + lower * dy,
        x1 + upper * dx,
        y1 + upper * dy,
    )
