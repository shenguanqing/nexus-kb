import sys
from pathlib import Path
from uuid import UUID
from xml.etree import ElementTree

from ezdxf.filemanagement import new
from ezdxf.fonts import fonts
from ezdxf.fonts.font_face import FontFace
from pytest import MonkeyPatch

from app.preview import _cad_render_context, generate_cad_svg, generate_office_pdf

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


def test_cad_render_context_replaces_missing_cjk_fallback_font(
    monkeypatch: MonkeyPatch,
) -> None:
    drawing = new("R2010")
    drawing.modelspace().add_text("中文 NexusKB")
    cjk_face = FontFace(filename="NotoSansCJK-Regular.ttc", family="Noto Sans CJK SC")
    monkeypatch.setattr(fonts, "find_best_match", lambda **_: cjk_face)

    context = _cad_render_context(drawing)

    assert context.fonts["standard"] == cjk_face


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
