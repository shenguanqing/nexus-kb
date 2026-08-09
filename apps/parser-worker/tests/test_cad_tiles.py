import json
from pathlib import Path
from uuid import UUID

from ezdxf.filemanagement import new
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

import app.cad_tiles as cad_tiles_module
import app.main as main_module
from app.cad_tiles import (
    _initialization_timeout_seconds,
    _initialize_bundle,
    _render_metatile,
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
    abandoned = (
        preview_root
        / f"{DOCUMENT_ID}.cad"
        / ".27e1b181-32e8-411e-80a2-f65164c24e83.tmp"
    )
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
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))[
        "bundleId"
    ]
    bundle = cad_root / "bundles" / bundle_id
    assert (bundle / "overview.png").is_file()
    assert (bundle / "geometry.sqlite").is_file()
    assert (bundle / "tiles" / "0" / "0" / "0.png").is_file()
    assert not abandoned.exists()
    assert render_calls == 1
    assert not (bundle / "tiles" / "3").exists()
    assert manifest.world_to_pixel[0] > 0
    assert manifest.world_to_pixel[3] < 0
    assert current_overview_storage_key(preview_root, DOCUMENT_ID).endswith(
        "/overview.png"
    )

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
    bundle_id = json.loads((cad_root / "current.json").read_text(encoding="utf-8"))[
        "bundleId"
    ]
    bundle = cad_root / "bundles" / bundle_id
    (bundle / "geometry.sqlite").unlink()

    _render_metatile(DOCUMENT_ID, preview_root, 2, 1, 0, 0, 16_777_216)

    assert (bundle / "geometry.sqlite").is_file()
    assert (bundle / "tiles" / "2" / "1" / "0.png").is_file()


def test_cad_bundle_initialization_gets_a_larger_bounded_timeout() -> None:
    assert _initialization_timeout_seconds(5) == 15
    assert _initialization_timeout_seconds(60) == 180
    assert _initialization_timeout_seconds(600) == 180


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
