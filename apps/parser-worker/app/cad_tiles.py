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
from typing import Any
from uuid import UUID, uuid4

from ezdxf import bbox, recover
from ezdxf.addons.drawing.backend import Backend, BkPoints2d, ImageData
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
from ezdxf.math import Vec2
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
_INDEX_FILE = "entities.sqlite"
_GEOMETRY_INDEX_FILE = "geometry.sqlite"
_SOURCE_FILE = "source.dxf"
_GEOMETRY_FORMAT_VERSION = "1"
_GEOMETRY_BATCH_SIZE = 2_048
_MAX_GEOMETRY_BLOB_BYTES = 67_108_864
_PRIMITIVE_POINT = 1
_PRIMITIVE_LINE = 2
_PRIMITIVE_POLYGON = 3
_INITIALIZATION_TIMEOUT_MULTIPLIER = 3
_MAX_INITIALIZATION_TIMEOUT_SECONDS = 180


class CadPreviewError(Exception):
    pass


class CadPreviewTimeoutError(CadPreviewError):
    pass


class CadPreviewResourceError(CadPreviewError):
    pass


class GeometryIndexWriter:
    def __init__(self, target: Path) -> None:
        if not target.parent.is_dir() or target.parent.is_symlink():
            raise CadPreviewResourceError("CAD 预览 bundle 已不可用")
        self.target = target
        self.temporary = target.parent / f".{target.name}.{os.getpid()}.tmp"
        self.temporary.unlink(missing_ok=True)
        self.database = sqlite3.connect(self.temporary)
        self.database.execute("PRAGMA journal_mode=OFF")
        self.database.execute("PRAGMA synchronous=OFF")
        self.database.execute(
            "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
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
        self.pending_primitives: list[tuple[int, int, int, bytes]] = []
        self.pending_bounds: list[tuple[int, float, float, float, float]] = []
        self.finished = False

    def add(self, kind: int, coordinates: Iterable[float], color: str) -> None:
        values = tuple(float(value) for value in coordinates)
        if kind == _PRIMITIVE_POINT and len(values) != 2:
            return
        if kind == _PRIMITIVE_LINE and len(values) != 4:
            return
        if kind == _PRIMITIVE_POLYGON and (len(values) < 6 or len(values) % 2 != 0):
            return
        if not all(math.isfinite(value) for value in values):
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
            "INSERT INTO primitive_index(id, min_x, max_x, min_y, max_y) "
            "VALUES (?, ?, ?, ?, ?)",
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
        parsed_color = (
            _unpack_color(color) if isinstance(color, int) else _parse_color(color)
        )
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
        if kind == _PRIMITIVE_POLYGON:
            vertices = [
                (
                    min(self.width + 1, max(-1, x)),
                    min(self.height + 1, max(-1, y)),
                )
                for world_x, world_y in zip(
                    coordinates[0::2], coordinates[1::2], strict=True
                )
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
        coordinates = tuple(
            value for vertex in points.vertices() for value in (vertex.x, vertex.y)
        )
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
) -> PreviewArtifact:
    resolved_root = _validated_preview_root(preview_root)
    lock_path = resolved_root / f".{document_id}.cad.lock"
    with lock_path.open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        root = resolved_root / f"{document_id}.cad"
        _cleanup_abandoned_temporary_bundles(root)
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
                _initialization_timeout_seconds(render_timeout_seconds),
            )
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
    if size_bytes <= 0 or size_bytes > 1_073_741_824:
        raise CadPreviewResourceError("CAD 瓦片预览产物超过资源限制")
    return PreviewArtifact(
        storage_key=f"{document_id}.cad",
        kind="cad_tiles",
        mime_type="application/vnd.nexuskb.cad-tiles+json",
        size_bytes=size_bytes,
        renderer="ezdxf-cad-tiles",
        renderer_version="1",
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
    if cached is not None:
        return cached
    lock_path = resolved_root / f".{document_id}.cad.lock"
    with lock_path.open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        manifest, bundle = _read_current_bundle(resolved_root, document_id)
        _validate_tile_coordinates(manifest, zoom, tile_x, tile_y)
        tile_path = bundle / "tiles" / str(zoom) / str(tile_x) / f"{tile_y}.png"
        cache_hit = _is_safe_nonempty_file(tile_path, bundle)
        if cache_hit:
            os.utime(tile_path, None)
        else:
            timeout_seconds = (
                render_timeout_seconds
                if _is_geometry_index_ready(bundle)
                else _initialization_timeout_seconds(render_timeout_seconds)
            )
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


def read_cad_preview_manifest(
    preview_root: Path, document_id: UUID
) -> CadPreviewManifest:
    manifest, _bundle = _read_current_bundle(
        _validated_preview_root(preview_root), document_id
    )
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


def _initialization_timeout_seconds(render_timeout_seconds: int) -> int:
    return min(
        render_timeout_seconds * _INITIALIZATION_TIMEOUT_MULTIPLIER,
        _MAX_INITIALIZATION_TIMEOUT_SECONDS,
    )


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
        entity_count, render_cost, bounds = _build_spatial_index(
            document, temporary / _INDEX_FILE
        )
        manifest = _build_manifest(
            bounds, tile_size, max_zoom, entity_count, render_cost
        )
        _write_json(temporary / _MANIFEST_FILE, manifest.model_dump(by_alias=True))
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
    geometry_index = bundle / _GEOMETRY_INDEX_FILE
    if not _is_geometry_index_ready(bundle):
        source = bundle / _SOURCE_FILE
        if not _is_safe_nonempty_file(source, bundle):
            raise CadPreviewResourceError("CAD 预览几何源不存在")
        document = _load_document(source)
        _build_geometry_index(
            document,
            document.modelspace(),
            geometry_index,
            manifest.world_to_pixel[0] * (1 << manifest.max_zoom),
        )
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
) -> tuple[int, int, tuple[float, float, float, float]]:
    min_x = math.inf
    min_y = math.inf
    max_x = -math.inf
    max_y = -math.inf
    entity_count = 0
    render_cost = 0
    cache = bbox.Cache()
    with sqlite3.connect(index_path) as database:
        database.execute("PRAGMA journal_mode=OFF")
        database.execute("PRAGMA synchronous=OFF")
        database.execute(
            "CREATE TABLE entities (id INTEGER PRIMARY KEY, handle TEXT NOT NULL)"
        )
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
            row_id = entity_count
            database.execute(
                "INSERT INTO entities(id, handle) VALUES (?, ?)", (row_id, handle)
            )
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
    )


def _build_manifest(
    bounds: tuple[float, float, float, float],
    tile_size: int,
    max_zoom: int,
    entity_count: int,
    render_cost: int,
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
    return CadPreviewManifest.model_validate(
        {
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
    )


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
) -> None:
    if not target.parent.is_dir() or target.parent.is_symlink():
        raise CadPreviewResourceError("CAD 预览 bundle 已不可用")
    temporary = target.parent / f".{target.name}.{os.getpid()}.tmp"
    writer = (
        GeometryIndexWriter(geometry_index_path)
        if geometry_index_path is not None
        else None
    )
    backend = PillowCadBackend(width, height, world_bounds, writer)
    scale = min(
        width / max(world_bounds[2] - world_bounds[0], 1e-9),
        height / max(world_bounds[3] - world_bounds[1], 1e-9),
    )
    config = _render_configuration(flattening_scale or scale)
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


def _render_configuration(scale: float) -> Configuration:
    return Configuration(
        line_policy=LinePolicy.SOLID,
        hatch_policy=HatchPolicy.SHOW_SOLID,
        text_policy=TextPolicy.FILLING,
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
) -> None:
    writer = GeometryIndexWriter(target)
    try:
        backend = GeometryIndexBackend(writer)
        frontend = Frontend(
            cad_render_context(document),
            backend,
            config=_render_configuration(flattening_scale),
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
    if kind not in {_PRIMITIVE_POINT, _PRIMITIVE_LINE, _PRIMITIVE_POLYGON}:
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
        return version == (_GEOMETRY_FORMAT_VERSION,) and primitive is not None
    except (OSError, sqlite3.DatabaseError):
        return False


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
            if path.is_dir()
            and not path.is_symlink()
            and path.name != current_bundle_id
        ),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
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
