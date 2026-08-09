import gzip
import sys
from pathlib import Path
from uuid import UUID
from xml.etree import ElementTree

from ezdxf.filemanagement import new
from ezdxf.fonts import fonts
from ezdxf.fonts.font_face import FontFace
from pytest import MonkeyPatch, raises

import app.cad_rendering as cad_rendering_module
import app.preview as preview_module
from app.cad_tiles import CadPreviewResourceError, CadPreviewTimeoutError
from app.preview import (
    _bounded_svg_payload,
    _cad_render_context,
    cad_preview_failure_warning,
    generate_cad_preview,
    generate_cad_svg,
    generate_office_pdf,
)
from app.schemas import PreviewArtifact

DOCUMENT_ID = UUID("6769af9a-a4d0-4dc2-a97d-942584a9c826")


def test_generate_cad_svg_writes_sanitized_bounded_artifact(tmp_path: Path) -> None:
    source = tmp_path / "drawing.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    drawing.modelspace().add_line((0, 0), (10, 10))
    drawing.modelspace().add_text("NexusKB")
    drawing.saveas(source)

    artifact = generate_cad_svg(
        source,
        DOCUMENT_ID,
        preview_root=preview_root,
        max_bytes=1_000_000,
    )

    content = (preview_root / artifact.storage_key).read_text(encoding="utf-8")
    assert artifact.kind == "svg"
    assert artifact.size_bytes == len(content.encode("utf-8"))
    assert ElementTree.fromstring(content).tag.rsplit("}", 1)[-1] == "svg"  # noqa: S314
    assert "<script" not in content
    assert "foreignObject" not in content
    assert 'vector-effect="non-scaling-stroke"' in content
    assert "stroke-width: 0;" not in content


def test_bounded_svg_payload_compresses_repetitive_oversized_svg() -> None:
    content = ("<svg>" + '<path d="M 0 0 L 1 1"/>' * 1_000 + "</svg>").encode()

    payload, compressed = _bounded_svg_payload(content, max_bytes=1_000)

    assert compressed is True
    assert len(payload) <= 1_000
    assert gzip.decompress(payload) == content


def test_generate_cad_svg_stores_compressed_svg_when_raw_output_exceeds_limit(
    tmp_path: Path,
) -> None:
    source = tmp_path / "compressed.dxf"
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    drawing = new("R2010")
    for offset in range(100):
        drawing.modelspace().add_line((0, offset), (100, offset))
    drawing.saveas(source)

    raw_artifact = generate_cad_svg(
        source,
        DOCUMENT_ID,
        preview_root=preview_root,
        max_bytes=1_000_000,
    )
    raw_content = (preview_root / raw_artifact.storage_key).read_bytes()
    compressed_limit = len(gzip.compress(raw_content, compresslevel=6, mtime=0))

    artifact = generate_cad_svg(
        source,
        DOCUMENT_ID,
        preview_root=preview_root,
        max_bytes=compressed_limit,
    )

    stored_content = (preview_root / artifact.storage_key).read_bytes()
    assert artifact.renderer == "ezdxf-svg-gzip"
    assert artifact.size_bytes == len(stored_content)
    assert gzip.decompress(stored_content) == raw_content


def test_bounded_svg_payload_rejects_oversized_compressed_svg() -> None:
    content = bytes(range(256)) * 20

    with raises(ValueError, match="预览产物为空或超过大小限制"):
        _bounded_svg_payload(content, max_bytes=10)


def test_generate_cad_preview_uses_weighted_render_cost_for_tile_routing(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    source = tmp_path / "drawing.dxf"
    source.write_bytes(b"small source")
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    tiled = PreviewArtifact(
        storageKey=f"{DOCUMENT_ID}.cad",
        kind="cad_tiles",
        mimeType="application/vnd.nexuskb.cad-tiles+json",
        sizeBytes=4096,
        renderer="ezdxf-cad-tiles",
        rendererVersion="1",
    )

    def generate_tiles(*_args: object, **_kwargs: object) -> PreviewArtifact:
        return tiled

    monkeypatch.setattr(
        preview_module,
        "estimate_cad_render_cost",
        lambda _source, _max_depth: (100, 100_001),
    )
    monkeypatch.setattr(preview_module, "generate_cad_tile_preview", generate_tiles)

    artifact = generate_cad_preview(
        source,
        DOCUMENT_ID,
        preview_root=preview_root,
        max_bytes=1_000_000,
        tiled_enabled=True,
        tile_cost_threshold=100_000,
        tile_source_bytes_threshold=20_971_520,
        tile_size=512,
        max_zoom=8,
        render_timeout_seconds=60,
        render_memory_bytes=2_147_483_648,
    )

    assert artifact.kind == "cad_tiles"


def test_cad_preview_failures_report_stable_specific_warning_codes() -> None:
    assert (
        cad_preview_failure_warning(CadPreviewTimeoutError("timeout"))
        == "CAD_PREVIEW_INITIALIZATION_TIMEOUT"
    )
    assert (
        cad_preview_failure_warning(CadPreviewResourceError("resource"))
        == "CAD_PREVIEW_RESOURCE_LIMIT_EXCEEDED"
    )
    assert (
        cad_preview_failure_warning(MemoryError("memory"))
        == "CAD_PREVIEW_RESOURCE_LIMIT_EXCEEDED"
    )
    assert cad_preview_failure_warning(RuntimeError("unexpected")) == "PREVIEW_GENERATION_FAILED"


def test_cad_render_context_replaces_missing_cjk_fallback_font(
    monkeypatch: MonkeyPatch,
) -> None:
    drawing = new("R2010")
    drawing.modelspace().add_text("中文 NexusKB")
    context = cad_rendering_module.RenderContext(drawing)
    context.fonts["standard"] = FontFace(
        filename="DejaVuSansCondensed.ttf",
        family="DejaVu Sans Condensed",
    )
    cjk_face = FontFace(filename="NotoSansCJK-Regular.ttc", family="Noto Sans CJK SC")
    monkeypatch.setattr(cad_rendering_module, "RenderContext", lambda _: context)
    monkeypatch.setattr(fonts, "find_best_match", lambda **_: cjk_face)

    rendered_context = _cad_render_context(drawing)

    assert rendered_context.fonts["standard"] == cjk_face


def test_generate_office_pdf_uses_fixed_converter_and_atomic_output(tmp_path: Path) -> None:
    source = tmp_path / "policy.docx"
    source.write_bytes(b"fixture")
    preview_root = tmp_path / "previews"
    preview_root.mkdir()
    converter = tmp_path / "fake-libreoffice"
    converter.write_text(
        f"""#!{sys.executable}
import pathlib
import sys

if "--version" in sys.argv:
    print("LibreOffice 25.2.4")
    raise SystemExit(0)
output = pathlib.Path(sys.argv[sys.argv.index("--outdir") + 1])
source = pathlib.Path(sys.argv[-1])
(output / f"{{source.stem}}.pdf").write_bytes(b"%PDF-1.4\\nfixture\\n%%EOF\\n")
""",
        encoding="utf-8",
    )
    converter.chmod(0o700)

    artifact = generate_office_pdf(
        source,
        DOCUMENT_ID,
        executable=converter,
        preview_root=preview_root,
        temp_root=tmp_path,
        timeout_seconds=5,
        max_bytes=1_000_000,
    )

    target = preview_root / artifact.storage_key
    assert artifact.kind == "pdf"
    assert artifact.renderer_version == "25.2.4"
    assert target.read_bytes().startswith(b"%PDF-")
    assert not list(preview_root.glob(".*.tmp"))
