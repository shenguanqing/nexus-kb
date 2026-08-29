import json
import sqlite3
from pathlib import Path
from uuid import UUID

from ezdxf.filemanagement import new
from fastapi.testclient import TestClient
from PIL import Image
from pytest import MonkeyPatch, raises

import app.cad_tiles as cad_tiles_module
import app.main as main_module
from app.cad_tiles import (
    CadPreviewResourceError,
    GeometryIndexWriter,
    _build_geometry_index,
    _build_manifest,
    _build_spatial_index,
    _default_focus_bounds,
    _eager_full_geometry_timeout_seconds,
    _effective_max_zoom,
    _initialization_timeout_seconds,
    _initialize_bundle,
    _initialize_simplified_bundle,
    _render_metatile,
    _scan_ascii_dxf_overview,
    current_overview_storage_key,
    ensure_cad_preview_tile,
    estimate_cad_render_cost,
    generate_cad_tile_preview,
    read_cad_preview_manifest,
)
from app.config import Settings
from app.main import create_app
from app.schemas import CadPreviewTileResponse

DOCUMENT_ID = UUID("6769af9a-a4d0-4dc2-a97d-942584a9c826")
TOKEN = "test-internal-token"  # noqa: S105 -- synthetic fixture credential


def test_cad_bundle_generates_only_overview_and_z0_then_renders_detail_on_demand(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    source = tmp_path / "drawing.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    abandoned = preview_root / f"{DOCUMENT_ID}.cad" / ".27e1b181-32e8-411e-80a2-f65164c24e83.tmp"
    abandoned.mkdir(parents=True)
    (abandoned / "partial.bin").write_bytes(b"partial")
    drawing = new("R2010")
    drawing.modelspace().add_line((0, 0), (1000, 500))
    drawing.modelspace().add_text("NexusKB", dxfattribs={"insert": (100, 100)})
    drawing.saveas(source)

    render_calls = 0
    render_entities = cad_tiles_module._render_entities

    def count_render(*args: object, **kwargs: object) -> None:
        nonlocal render_calls
        render_calls += 1
        render_entities(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(cad_tiles_module, "_render_entities", count_render)
    _initialize_bundle(source, DOCUMENT_ID, preview_root, 256, 3, 1_000_000)

    manifest = read_cad_preview_manifest(preview_root, DOCUMENT_ID)
    cad_root = preview_root / f"{DOCUMENT_ID}.cad"
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))["bundleId"]
    bundle = cad_root / "bundles" / bundle_id
    assert (bundle / "overview.png").is_file()
    assert (bundle / "geometry.sqlite").is_file()
    assert (bundle / "tiles" / "0" / "0" / "0.png").is_file()
    assert not abandoned.exists()
    assert render_calls == 1
    assert not (bundle / "tiles" / "3").exists()
    assert manifest.world_to_pixel[0] > 0
    assert manifest.world_to_pixel[3] < 0
    assert current_overview_storage_key(preview_root, DOCUMENT_ID).endswith("/overview.png")

    region_calls = 0
    render_region = cad_tiles_module._render_geometry_region

    def count_region(*args: object, **kwargs: object) -> None:
        nonlocal region_calls
        region_calls += 1
        render_region(*args, **kwargs)  # type: ignore[arg-type]

    def reject_source_reload(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("detail tiles must render from the geometry index")

    monkeypatch.setattr(cad_tiles_module, "_render_geometry_region", count_region)
    monkeypatch.setattr(cad_tiles_module, "_load_document", reject_source_reload)
    _render_metatile(DOCUMENT_ID, preview_root, 3, 3, 2, 1, 16_777_216)

    assert region_calls == 1
    for x in range(2, 5):
        for y in range(1, 4):
            assert (bundle / "tiles" / "3" / str(x) / f"{y}.png").is_file()


def test_legacy_cad_bundle_builds_geometry_index_once_before_rendering(
    tmp_path: Path,
) -> None:
    source = tmp_path / "legacy.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    drawing.modelspace().add_line((0, 0), (1000, 500))
    drawing.saveas(source)
    _initialize_bundle(source, DOCUMENT_ID, preview_root, 256, 2, 1_000_000)

    cad_root = preview_root / f"{DOCUMENT_ID}.cad"
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))["bundleId"]
    bundle = cad_root / "bundles" / bundle_id
    (bundle / "geometry.sqlite").unlink()

    _render_metatile(DOCUMENT_ID, preview_root, 2, 1, 0, 0, 16_777_216)

    assert (bundle / "geometry.sqlite").is_file()
    assert (bundle / "tiles" / "2" / "1" / "0.png").is_file()


def test_progressive_cad_bundle_builds_complete_geometry_on_first_detail_tile(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    source = tmp_path / "simplified.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    for offset in range(200):
        drawing.modelspace().add_line((0, offset), (1_000, offset + 100))
    drawing.saveas(source)

    _initialize_simplified_bundle(
        source,
        DOCUMENT_ID,
        preview_root,
        256,
        2,
        1_000_000,
    )

    def reject_overview_upscale(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("simplified detail tiles must render from world geometry")

    monkeypatch.setattr(cad_tiles_module, "_render_simplified_tile", reject_overview_upscale)
    abandoned_geometry = (
        preview_root
        / f"{DOCUMENT_ID}.cad"
        / "bundles"
        / json.loads(
            (preview_root / f"{DOCUMENT_ID}.cad" / "current.json").read_text(encoding="utf-8")
        )["bundleId"]
        / ".geometry.sqlite.999999.tmp"
    )
    abandoned_geometry.write_bytes(b"partial")
    _render_metatile(DOCUMENT_ID, preview_root, 2, 0, 0, 0, 16_777_216)

    cad_root = preview_root / f"{DOCUMENT_ID}.cad"
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))["bundleId"]
    bundle = cad_root / "bundles" / bundle_id
    assert json.loads((bundle / "simplified.json").read_text(encoding="utf-8")) == {
        "detailMode": "progressive_geometry",
        "formatVersion": "3",
    }
    assert (bundle / "source.dxf").read_bytes() == source.read_bytes()
    assert (bundle / "overview-geometry.sqlite").is_file()
    assert (bundle / "geometry.sqlite").is_file()
    assert not abandoned_geometry.exists()
    assert json.loads((bundle / "overview-state.json").read_text(encoding="utf-8")) == {
        "detailMode": "full_geometry",
        "formatVersion": "1",
    }
    assert (bundle / "tiles" / "2" / "0" / "0.png").is_file()


def test_cached_progressive_tile_refreshes_a_stale_overview_before_returning(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    source = tmp_path / "cached-progressive.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    drawing.modelspace().add_line((0, 0), (100, 100))
    drawing.saveas(source)
    _initialize_simplified_bundle(source, DOCUMENT_ID, preview_root, 256, 2, 1_000_000)
    _render_metatile(DOCUMENT_ID, preview_root, 2, 0, 0, 0, 16_777_216)

    cad_root = preview_root / f"{DOCUMENT_ID}.cad"
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))["bundleId"]
    bundle = cad_root / "bundles" / bundle_id
    (bundle / "overview-state.json").unlink()
    child_calls: list[int] = []

    def refresh_overview(_arguments: list[str], timeout_seconds: int) -> None:
        child_calls.append(timeout_seconds)
        cad_tiles_module._write_json(
            bundle / "overview-state.json",
            {"formatVersion": "1", "detailMode": "full_geometry"},
        )

    monkeypatch.setattr(cad_tiles_module, "_run_child", refresh_overview)
    response = ensure_cad_preview_tile(
        DOCUMENT_ID,
        2,
        0,
        0,
        preview_root=preview_root,
        metatile_radius=0,
        max_cache_bytes=16_777_216,
        render_timeout_seconds=30,
        render_memory_bytes=2_147_483_648,
    )

    assert response.cache_hit is True
    assert child_calls == [90]


def test_progressive_ascii_overview_preserves_resolved_colors_before_detail(
    tmp_path: Path,
) -> None:
    source = tmp_path / "colored-progressive.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    drawing.layers.new("RED", dxfattribs={"color": 1})
    drawing.layers.new("BLUE", dxfattribs={"color": 5})
    drawing.layers.new("HIDDEN", dxfattribs={"color": 3})
    drawing.layers.get("HIDDEN").off()
    modelspace = drawing.modelspace()
    modelspace.add_line((0, 0), (100, 0), dxfattribs={"layer": "RED"})
    modelspace.add_line((0, 10), (100, 10), dxfattribs={"layer": "BLUE"})
    modelspace.add_line((0, 20), (100, 20), dxfattribs={"color": 2})
    modelspace.add_line((0, 30), (100, 30), dxfattribs={"layer": "HIDDEN"})
    drawing.saveas(source)

    _initialize_simplified_bundle(source, DOCUMENT_ID, preview_root, 256, 2, 1_000_000)

    cad_root = preview_root / f"{DOCUMENT_ID}.cad"
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))["bundleId"]
    bundle = cad_root / "bundles" / bundle_id
    with sqlite3.connect(bundle / "overview-geometry.sqlite") as database:
        colors = {
            cad_tiles_module._unpack_color(row[0])[:3]
            for row in database.execute("SELECT DISTINCT color FROM primitives")
        }
    with Image.open(bundle / "overview.png") as overview:
        overview_colors = set(overview.convert("RGB").get_flattened_data())

    assert (255, 0, 0) in colors
    assert (0, 0, 255) in colors
    assert (255, 255, 0) in colors
    assert (0, 255, 0) not in colors
    assert {(255, 0, 0), (0, 0, 255), (255, 255, 0)} <= overview_colors
    assert not (bundle / "geometry.sqlite").exists()
    assert not (bundle / "overview-state.json").exists()


def test_progressive_overview_expands_bounded_blocks_before_first_detail(
    tmp_path: Path,
) -> None:
    source = tmp_path / "block-borders.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    border = drawing.blocks.new(name="BORDER")
    border.add_lwpolyline(
        [(0, 0), (100, 0), (100, 60), (0, 60)],
        close=True,
        dxfattribs={"color": 1},
    )
    drawing.modelspace().add_blockref("BORDER", (1_000, 2_000))
    drawing.modelspace().add_line((0, 0), (10, 10), dxfattribs={"color": 5})
    drawing.saveas(source)

    _initialize_simplified_bundle(source, DOCUMENT_ID, preview_root, 256, 2, 1_000_000)

    cad_root = preview_root / f"{DOCUMENT_ID}.cad"
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))["bundleId"]
    bundle = cad_root / "bundles" / bundle_id
    manifest = read_cad_preview_manifest(preview_root, DOCUMENT_ID)
    with sqlite3.connect(bundle / "overview-geometry.sqlite") as database:
        red = cad_tiles_module._pack_color("#ff0000")
        red_bounds = database.execute(
            """
            SELECT MIN(i.min_x), MIN(i.min_y), MAX(i.max_x), MAX(i.max_y), COUNT(*)
            FROM primitive_index i
            JOIN primitives p ON p.id = i.id
            WHERE p.color = ?
            """,
            (red,),
        ).fetchone()

    assert red_bounds[0] <= 1_000
    assert red_bounds[1] <= 2_000
    assert red_bounds[2] >= 1_100
    assert red_bounds[3] >= 2_060
    assert red_bounds[4] >= 1
    assert manifest.bounds.min_x < 1_000
    assert manifest.bounds.max_x > 1_100
    assert manifest.bounds.min_y < 2_000
    assert manifest.bounds.max_y > 2_060
    assert not (bundle / "geometry.sqlite").exists()
    assert not (bundle / "overview-state.json").exists()


def test_progressive_cad_detail_expands_blocks_and_preserves_resolved_colors(
    tmp_path: Path,
) -> None:
    source = tmp_path / "blocks-and-colors.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    drawing.layers.new("RED", dxfattribs={"color": 1})
    drawing.layers.new("BLUE", dxfattribs={"color": 5})
    detail = drawing.blocks.new(name="DETAIL")
    detail.add_line((0, 0), (50, 0), dxfattribs={"color": 0})
    detail.add_line((0, 0), (0, 25), dxfattribs={"color": 0})
    drawing.modelspace().add_blockref("DETAIL", (100, 100), dxfattribs={"layer": "RED"})
    drawing.modelspace().add_line((0, 0), (25, 25), dxfattribs={"layer": "BLUE"})
    drawing.modelspace().add_line((0, 25), (25, 0), dxfattribs={"layer": "RED"})
    drawing.modelspace().add_circle((12.5, 12.5), 5, dxfattribs={"layer": "RED"})
    drawing.saveas(source)

    _initialize_simplified_bundle(source, DOCUMENT_ID, preview_root, 256, 2, 1_000_000)
    _render_metatile(DOCUMENT_ID, preview_root, 2, 0, 0, 0, 16_777_216)

    cad_root = preview_root / f"{DOCUMENT_ID}.cad"
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))["bundleId"]
    bundle = cad_root / "bundles" / bundle_id
    with sqlite3.connect(bundle / "geometry.sqlite") as database:
        primitive_count = database.execute("SELECT COUNT(*) FROM primitives").fetchone()[0]
        color_count = database.execute("SELECT COUNT(DISTINCT color) FROM primitives").fetchone()[0]
        path_count = database.execute(
            "SELECT COUNT(*) FROM primitives WHERE kind = ?",
            (cad_tiles_module._PRIMITIVE_POLYLINE,),
        ).fetchone()[0]
        bounds = database.execute(
            "SELECT MIN(min_x), MIN(min_y), MAX(max_x), MAX(max_y) FROM primitive_index"
        ).fetchone()
    with Image.open(bundle / "overview.png") as overview:
        overview_colors = set(overview.convert("RGB").get_flattened_data())

    assert primitive_count >= 3
    assert color_count >= 2
    assert path_count >= 1
    assert len(overview_colors - {cad_tiles_module._CAD_BACKGROUND[:3]}) >= 2
    assert bounds[0] <= 0
    assert bounds[2] >= 150
    assert bounds[3] >= 125


def test_complete_geometry_limit_fails_without_publishing_a_truncated_index(
    tmp_path: Path,
) -> None:
    target = tmp_path / "geometry.sqlite"
    writer = GeometryIndexWriter(target, max_primitives=1, fail_on_limit=True)
    try:
        writer.add(2, (0, 0, 1, 1), "#ffffff")
        with raises(CadPreviewResourceError, match="完整几何图元超过安全上限"):
            writer.add(2, (1, 1, 2, 2), "#ffffff")
    finally:
        writer.abort()

    assert not target.exists()
    assert not list(tmp_path.glob(".*.tmp"))


def test_complete_geometry_groups_a_flattened_curve_as_one_bounded_primitive(
    tmp_path: Path,
) -> None:
    drawing = new("R2010")
    drawing.modelspace().add_circle((0, 0), 100)
    target = tmp_path / "geometry.sqlite"

    _build_geometry_index(
        drawing,
        drawing.modelspace(),
        target,
        flattening_scale=4096,
        max_primitives=1,
    )

    with sqlite3.connect(target) as database:
        row = database.execute("SELECT kind, LENGTH(points) FROM primitives").fetchone()
        format_version = database.execute(
            "SELECT value FROM metadata WHERE key = 'formatVersion'"
        ).fetchone()
    assert row[0] == cad_tiles_module._PRIMITIVE_POLYLINE
    assert row[1] > 32
    assert format_version == ("2",)

    with sqlite3.connect(target) as database:
        database.execute("UPDATE metadata SET value = '1' WHERE key = 'formatVersion'")
        database.commit()
    assert cad_tiles_module._is_geometry_index_ready(tmp_path) is True


def test_cad_bundle_initialization_gets_a_larger_bounded_timeout() -> None:
    assert _initialization_timeout_seconds(5) == 15
    assert _initialization_timeout_seconds(60) == 180
    assert _initialization_timeout_seconds(600) == 180
    assert _initialization_timeout_seconds(5, complex_source=True) == 15
    assert _initialization_timeout_seconds(60, complex_source=True) == 60
    assert _eager_full_geometry_timeout_seconds(5) == 15
    assert _eager_full_geometry_timeout_seconds(60) == 150
    assert _eager_full_geometry_timeout_seconds(600) == 150


def test_cad_bundle_adds_bounded_detail_zoom_for_sparse_outlier_extents(
    tmp_path: Path,
) -> None:
    drawing = new("R2010")
    modelspace = drawing.modelspace()
    for index in range(500):
        x = 11_500_000 + index * 4_000
        y = -900_000 + (index % 50) * 20_000
        modelspace.add_line((x, y), (x + 2_000, y + 1_000))
    for index in range(3):
        modelspace.add_line((index * 10, 0), (index * 10 + 5, 5))
    for index in range(2):
        x = 24_500_000 + index * 50_000
        modelspace.add_line((x, -500_000), (x + 5_000, -495_000))

    _, _, bounds, detail_bounds = _build_spatial_index(drawing, tmp_path / "entities.sqlite")

    assert detail_bounds is not None
    assert bounds[0] < 0
    assert bounds[2] > 24_500_000
    assert detail_bounds[0] >= 11_500_000
    assert detail_bounds[2] < 14_000_000
    assert _effective_max_zoom(8, bounds, detail_bounds) == 12
    focus_bounds = _default_focus_bounds(bounds, detail_bounds)
    assert focus_bounds is not None
    assert bounds[0] <= focus_bounds[0] < focus_bounds[2] <= bounds[2]
    assert focus_bounds[2] < 15_000_000
    manifest = _build_manifest(
        bounds,
        512,
        12,
        505,
        505,
        focus_bounds=focus_bounds,
    )
    assert manifest.focus_bounds is not None
    assert manifest.focus_bounds.max_x < 15_000_000


def test_cad_bundle_focus_bounds_ignore_geometry_hidden_from_rendering(
    tmp_path: Path,
) -> None:
    drawing = new("R2010")
    drawing.layers.new("DOTE")
    drawing.layers.get("DOTE").off()
    modelspace = drawing.modelspace()
    for index in range(500):
        x = index % 25
        y = index // 25
        modelspace.add_line((x, y), (x + 1, y + 1))
    for index in range(250):
        modelspace.add_line(
            (1_000_000 + index, -1_000_000),
            (1_000_001 + index, -999_999),
            dxfattribs={"layer": "DOTE"},
        )
    for index in range(250):
        modelspace.add_line(
            (2_000_000 + index, -2_000_000),
            (2_000_001 + index, -1_999_999),
            dxfattribs={"invisible": 1},
        )

    _, _, bounds, detail_bounds = _build_spatial_index(drawing, tmp_path / "entities.sqlite")

    assert bounds[0] < 0
    assert bounds[2] > 2_000_000
    assert bounds[1] < -2_000_000
    assert detail_bounds is not None
    assert detail_bounds[0] >= 0
    assert detail_bounds[1] >= 0
    assert detail_bounds[2] < 30
    assert detail_bounds[3] < 25
    assert _default_focus_bounds(bounds, detail_bounds) is not None


def test_cad_bundle_keeps_configured_zoom_for_normal_extents() -> None:
    bounds = (-100.0, -100.0, 10_100.0, 5_100.0)
    detail_bounds = (0.0, 0.0, 10_000.0, 5_000.0)

    assert _effective_max_zoom(8, bounds, detail_bounds) == 8
    assert _effective_max_zoom(12, bounds, detail_bounds) == 12
    assert _default_focus_bounds(bounds, detail_bounds) is None


def test_cad_bundle_can_raise_sparse_focus_detail_to_zoom_15() -> None:
    bounds = (0.0, 0.0, 830_000.0, 100_000.0)
    detail_bounds = (10.0, 10.0, 110.0, 110.0)

    assert _effective_max_zoom(12, bounds, detail_bounds) == 15


def test_cad_bundle_generates_a_focused_overview_without_dropping_full_bounds(
    tmp_path: Path,
) -> None:
    source = tmp_path / "focused-overview.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    modelspace = drawing.modelspace()
    for index in range(300):
        modelspace.add_line((index % 30, index // 30), (index % 30 + 1, index // 30 + 1))
    modelspace.add_arc((100_000, 100_000), radius=10, start_angle=0, end_angle=180)
    drawing.saveas(source)

    _initialize_bundle(source, DOCUMENT_ID, preview_root, 256, 12, 1_000_000)

    cad_root = preview_root / f"{DOCUMENT_ID}.cad"
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))["bundleId"]
    bundle = cad_root / "bundles" / bundle_id
    manifest = read_cad_preview_manifest(preview_root, DOCUMENT_ID)
    assert manifest.max_zoom == 15
    assert manifest.focus_bounds is not None
    assert manifest.bounds.max_x > 100_000
    assert manifest.focus_bounds.max_x < 100
    assert (bundle / "focus-overview.png").stat().st_size > 0


def test_simplified_ascii_bounds_convert_ocs_and_ignore_bare_insert_points(
    tmp_path: Path,
) -> None:
    source = tmp_path / "ocs-bounds.dxf"
    drawing = new("R2010")
    drawing.blocks.new(name="EMPTY")
    modelspace = drawing.modelspace()
    modelspace.add_line((0, 0), (1_000, 500))
    modelspace.add_arc(
        center=(-500, 200),
        radius=50,
        start_angle=0,
        end_angle=180,
        dxfattribs={"extrusion": (0, 0, -1)},
    )
    modelspace.add_blockref("EMPTY", (10_000_000, 10_000_000))
    drawing.saveas(source)

    bounds, _detail_bounds, entity_count, _render_cost = _scan_ascii_dxf_overview(source)

    assert entity_count == 3
    assert bounds[0] > -100
    assert bounds[2] < 2_000
    assert bounds[3] < 1_000


def test_render_cost_weights_expensive_cad_entities(tmp_path: Path) -> None:
    source = tmp_path / "weighted.dxf"
    drawing = new("R2010")
    drawing.modelspace().add_line((0, 0), (10, 10))
    drawing.modelspace().add_text("A")
    drawing.modelspace().add_text("B")
    drawing.saveas(source)

    assert estimate_cad_render_cost(source) == (3, 17)


def test_render_cost_includes_repeated_nested_block_entities(tmp_path: Path) -> None:
    source = tmp_path / "nested-blocks.dxf"
    drawing = new("R2010")
    detail = drawing.blocks.new(name="DETAIL")
    detail.add_line((0, 0), (10, 10))
    detail.add_text("A")
    detail.add_text("B")
    drawing.modelspace().add_blockref("DETAIL", (0, 0))
    drawing.saveas(source)

    assert estimate_cad_render_cost(source) == (4, 67)


def test_public_tile_generation_runs_in_a_bounded_child_and_reuses_the_cache(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    source = tmp_path / "bounded.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    drawing.modelspace().add_line((0, 0), (1000, 500))
    drawing.saveas(source)

    artifact = generate_cad_tile_preview(
        source,
        DOCUMENT_ID,
        preview_root=preview_root,
        tile_size=256,
        max_zoom=2,
        max_source_bytes=1_000_000,
        render_timeout_seconds=30,
        render_memory_bytes=2_147_483_648,
    )
    first = ensure_cad_preview_tile(
        DOCUMENT_ID,
        2,
        0,
        0,
        preview_root=preview_root,
        metatile_radius=0,
        max_cache_bytes=16_777_216,
        render_timeout_seconds=30,
        render_memory_bytes=2_147_483_648,
    )
    second = ensure_cad_preview_tile(
        DOCUMENT_ID,
        2,
        0,
        0,
        preview_root=preview_root,
        metatile_radius=0,
        max_cache_bytes=16_777_216,
        render_timeout_seconds=30,
        render_memory_bytes=2_147_483_648,
    )

    assert artifact.kind == "cad_tiles"
    assert first.cache_hit is False
    assert second.cache_hit is True
    assert first.storage_key == second.storage_key

    def reject_lock(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("cached tiles must not wait for the render lock")

    monkeypatch.setattr(cad_tiles_module.fcntl, "flock", reject_lock)
    lock_free_hit = ensure_cad_preview_tile(
        DOCUMENT_ID,
        2,
        0,
        0,
        preview_root=preview_root,
        metatile_radius=0,
        max_cache_bytes=16_777_216,
        render_timeout_seconds=30,
        render_memory_bytes=2_147_483_648,
    )
    assert lock_free_hit.cache_hit is True


def test_progressive_preview_eagerly_publishes_one_final_overview_when_bounded(
    tmp_path: Path,
) -> None:
    source = tmp_path / "bounded-progressive.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    detail = drawing.blocks.new(name="DETAIL")
    detail.add_lwpolyline(
        [(0, 0), (100, 0), (100, 60), (0, 60)],
        close=True,
        dxfattribs={"color": 1},
    )
    drawing.modelspace().add_blockref("DETAIL", (1_000, 2_000))
    drawing.modelspace().add_line((0, 0), (10, 10), dxfattribs={"color": 5})
    hatch = drawing.modelspace().add_hatch(color=3)
    hatch.paths.add_polyline_path(
        [(0, 0), (50, 0), (50, 50), (0, 50)],
        is_closed=True,
    )
    drawing.saveas(source)

    artifact = generate_cad_tile_preview(
        source,
        DOCUMENT_ID,
        preview_root=preview_root,
        tile_size=256,
        max_zoom=2,
        max_source_bytes=1_000_000,
        render_timeout_seconds=30,
        render_memory_bytes=2_147_483_648,
        complex_source=True,
    )

    cad_root = preview_root / f"{DOCUMENT_ID}.cad"
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))["bundleId"]
    bundle = cad_root / "bundles" / bundle_id
    initial_overview = (bundle / "overview.png").read_bytes()
    initial_z0 = (bundle / "tiles" / "0" / "0" / "0.png").read_bytes()

    assert artifact.renderer == "ezdxf-cad-tiles-progressive"
    assert (bundle / "geometry.sqlite").is_file()
    assert json.loads((bundle / "overview-state.json").read_text(encoding="utf-8")) == {
        "detailMode": "full_geometry",
        "formatVersion": "1",
    }

    ensure_cad_preview_tile(
        DOCUMENT_ID,
        0,
        0,
        0,
        preview_root=preview_root,
        metatile_radius=0,
        max_cache_bytes=16_777_216,
        render_timeout_seconds=30,
        render_memory_bytes=2_147_483_648,
    )

    assert (bundle / "overview.png").read_bytes() == initial_overview
    assert (bundle / "tiles" / "0" / "0" / "0.png").read_bytes() == initial_z0


def test_progressive_preview_keeps_fast_overview_when_eager_full_times_out(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    source = tmp_path / "eager-timeout.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    drawing.modelspace().add_line((0, 0), (100, 100), dxfattribs={"color": 1})
    drawing.saveas(source)
    run_child = cad_tiles_module._run_child

    def reject_eager_render(arguments: list[str], timeout_seconds: int) -> None:
        if arguments[0] == "render":
            raise cad_tiles_module.CadPreviewTimeoutError("synthetic timeout")
        run_child(arguments, timeout_seconds)

    monkeypatch.setattr(cad_tiles_module, "_run_child", reject_eager_render)

    artifact = generate_cad_tile_preview(
        source,
        DOCUMENT_ID,
        preview_root=preview_root,
        tile_size=256,
        max_zoom=2,
        max_source_bytes=1_000_000,
        render_timeout_seconds=30,
        render_memory_bytes=2_147_483_648,
        complex_source=True,
    )

    cad_root = preview_root / f"{DOCUMENT_ID}.cad"
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))["bundleId"]
    bundle = cad_root / "bundles" / bundle_id
    assert artifact.renderer == "ezdxf-cad-tiles-progressive"
    assert (bundle / "overview.png").is_file()
    assert (bundle / "overview-geometry.sqlite").is_file()
    assert not (bundle / "geometry.sqlite").exists()
    assert not (bundle / "overview-state.json").exists()


def test_internal_tile_endpoint_requires_auth_and_returns_only_a_storage_reference(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    preview_root = tmp_path / "previews"
    preview_root.mkdir()

    def fake_tile(*_: object, **__: object) -> CadPreviewTileResponse:
        return CadPreviewTileResponse(
            storageKey=(
                f"{DOCUMENT_ID}.cad/bundles/d26720b3-1f78-40df-868d-8ca8510dca26/"
                "tiles/8/255/127.png"
            ),
            mimeType="image/png",
            sizeBytes=4096,
            cacheHit=False,
        )

    monkeypatch.setattr(main_module, "ensure_cad_preview_tile", fake_tile)
    client = TestClient(
        create_app(
            Settings(
                PARSER_INTERNAL_TOKEN=TOKEN,
                RAW_DOCS_PATH=tmp_path,
                PREVIEW_ARTIFACTS_PATH=preview_root,
            )
        )
    )
    payload = {"documentId": str(DOCUMENT_ID), "zoom": 8, "tileX": 255, "tileY": 127}

    assert client.post("/internal/v1/cad-preview/tile", json=payload).status_code == 401
    response = client.post(
        "/internal/v1/cad-preview/tile",
        headers={"x-internal-token": TOKEN},
        json=payload,
    )

    assert response.status_code == 200
    assert response.json()["storageKey"].startswith(f"{DOCUMENT_ID}.cad/bundles/")
    assert "path" not in response.json()
