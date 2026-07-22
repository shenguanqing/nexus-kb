import sys
from pathlib import Path
from uuid import uuid4

import ezdxf
from docx import Document
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.config import Settings
from app.main import create_app

TOKEN = "test-internal-token"  # noqa: S105 -- non-secret test fixture


def make_fake_dwg_converter(path: Path) -> None:
    path.write_text(
        f"""#!{sys.executable}
import sys
from pathlib import Path

import ezdxf

output_dir = Path(sys.argv[2])
source_dir = Path(sys.argv[1])
if sys.argv[3:] != ["ACAD2018", "DXF", "0", "1", "*.dwg"]:
    raise SystemExit("unexpected ODA command schema")
source_name = next(source_dir.glob("*.dwg"))
drawing = ezdxf.new("R2010")
drawing.modelspace().add_mtext("Converted DWG annotation")
drawing.saveas(output_dir / source_name.with_suffix(".dxf").name)
""",
        encoding="utf-8",
    )
    path.chmod(0o700)


def make_client(root: Path, max_parse_bytes: int = 1_048_576) -> TestClient:
    return TestClient(
        create_app(
            Settings(
                PARSER_INTERNAL_TOKEN=TOKEN,
                RAW_DOCS_PATH=root,
                MAX_PARSE_BYTES=max_parse_bytes,
            )
        )
    )


def payload(path: Path) -> dict[str, str]:
    return {
        "jobId": str(uuid4()),
        "documentId": str(uuid4()),
        "storagePath": str(path),
        "mimeType": "text/plain",
    }


def test_parse_requires_internal_token_and_returns_contract(tmp_path: Path) -> None:
    document = tmp_path / "document.txt"
    document.write_text("付款周期为 30 天", encoding="utf-8")
    client = make_client(tmp_path)

    assert client.post("/internal/v1/parse", json=payload(document)).status_code == 401
    response = client.post(
        "/internal/v1/parse",
        headers={"x-internal-token": TOKEN},
        json=payload(document),
    )

    assert response.status_code == 200, response.text
    assert response.json()["elements"][0]["text"] == "付款周期为 30 天"
    assert response.json()["parserVersion"] == "1.1.0"


def test_markdown_preserves_heading_path(tmp_path: Path) -> None:
    document = tmp_path / "guide.md"
    document.write_text("# 财务制度\n\n## 付款流程\n\n验收后 30 天付款", encoding="utf-8")
    client = make_client(tmp_path)
    body = payload(document)
    body["mimeType"] = "text/markdown"

    response = client.post("/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body)

    assert response.status_code == 200
    assert response.json()["parser"] == "markdown"
    assert response.json()["elements"][-1]["sectionPath"] == ["财务制度", "付款流程"]


def test_docx_preserves_heading_and_table(tmp_path: Path) -> None:
    path = tmp_path / "policy.docx"
    document = Document()
    document.add_heading("制度", level=1)
    document.add_paragraph("正文")
    table = document.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "项目"
    table.rows[0].cells[1].text = "周期"
    document.save(path)
    client = make_client(tmp_path)
    body = payload(path)
    body["mimeType"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    response = client.post("/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body)

    assert response.status_code == 200
    assert response.json()["parser"] == "python-docx"
    assert response.json()["elements"][1]["sectionPath"] == ["制度"]
    assert response.json()["elements"][-1]["elementType"] == "table_row"


def test_xlsx_preserves_sheet_and_header(tmp_path: Path) -> None:
    path = tmp_path / "records.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "付款"
    sheet.append(["项目", "周期"])
    sheet.append(["A", 30])
    workbook.save(path)
    client = make_client(tmp_path)
    body = payload(path)
    body["mimeType"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    response = client.post("/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body)

    assert response.status_code == 200
    assert response.json()["parser"] == "openpyxl"
    assert response.json()["elements"][1]["sheet"] == "付款"
    assert response.json()["elements"][1]["metadata"]["headers"] == ["项目", "周期"]


def test_dxf_extracts_summary_text_block_attributes_and_dimensions(tmp_path: Path) -> None:
    path = tmp_path / "drawing.dxf"
    drawing = ezdxf.new("R2010")
    drawing.layers.add("ANNOTATION")
    drawing.layers.add("DIMENSIONS")
    block = drawing.blocks.new("TITLE_BLOCK")
    block.add_attdef("PROJECT", (0, 0), text="未填写", dxfattribs={"layer": "ANNOTATION"})
    insert = drawing.modelspace().add_blockref("TITLE_BLOCK", (0, 0))
    insert.add_auto_attribs({"PROJECT": "NexusKB CAD"})
    drawing.modelspace().add_mtext("Payment term: 30 days", dxfattribs={"layer": "ANNOTATION"})
    dimension = drawing.modelspace().add_linear_dim(
        base=(0, 3),
        p1=(0, 0),
        p2=(12.5, 0),
        dxfattribs={"layer": "DIMENSIONS"},
    )
    dimension.render()
    drawing.saveas(path)
    client = make_client(tmp_path)
    body = payload(path)
    body["mimeType"] = "image/vnd.dxf"

    response = client.post("/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body)

    assert response.status_code == 200
    parsed = response.json()
    assert parsed["parser"] == "ezdxf"
    assert parsed["parserVersion"] == ezdxf.__version__
    assert parsed["elements"][0]["elementType"] == "cad_summary"
    assert "ANNOTATION" in parsed["elements"][0]["metadata"]["layers"]
    assert any(element["text"] == "NexusKB CAD" for element in parsed["elements"])
    assert any(element["text"] == "Payment term: 30 days" for element in parsed["elements"])
    assert any(element["elementType"] == "cad_dimension" for element in parsed["elements"])


def test_dxf_rejects_entity_limit(tmp_path: Path) -> None:
    path = tmp_path / "large.dxf"
    drawing = ezdxf.new("R2010")
    drawing.modelspace().add_text("one")
    drawing.modelspace().add_text("two")
    drawing.saveas(path)
    client = TestClient(
        create_app(
            Settings(
                PARSER_INTERNAL_TOKEN=TOKEN,
                RAW_DOCS_PATH=tmp_path,
                MAX_CAD_ENTITIES=1,
            )
        )
    )
    body = payload(path)
    body["mimeType"] = "application/dxf"

    response = client.post("/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body)

    assert response.status_code == 422
    assert response.json()["detail"] == "CAD 实体数量超过限制"


def test_dxf_rejects_corrupted_content_without_leaking_path(tmp_path: Path) -> None:
    path = tmp_path / "corrupted.dxf"
    path.write_bytes(b"0\nSECTION\n2\nENTITIES\nnot-valid-dxf")
    client = make_client(tmp_path)
    body = payload(path)
    body["mimeType"] = "image/vnd.dxf"

    response = client.post("/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body)

    assert response.status_code == 422
    assert response.json()["detail"] == "DXF 文件损坏或格式不受支持"
    assert str(tmp_path) not in response.text


def test_dwg_is_converted_to_dxf_and_parsed(tmp_path: Path) -> None:
    path = tmp_path / "drawing.dwg"
    path.write_bytes(b"AC1032" + b"\0" * 64)
    converter = tmp_path / "fake-oda-file-converter"
    make_fake_dwg_converter(converter)
    client = TestClient(
        create_app(
            Settings(
                PARSER_INTERNAL_TOKEN=TOKEN,
                RAW_DOCS_PATH=tmp_path,
                DWG_CONVERSION_ENABLED=True,
                DWG_CONVERTER_EXECUTABLE=converter,
                DWG_CONVERTER_RELEASE="test",
                PARSER_TEMP_PATH=tmp_path,
            )
        )
    )
    body = payload(path)
    body["mimeType"] = "image/vnd.dwg"

    response = client.post("/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body)

    assert response.status_code == 200, response.text
    parsed = response.json()
    assert parsed["parser"] == "oda-file-converter+ezdxf"
    assert parsed["parserVersion"].startswith("oda-test+ezdxf-")
    assert "DWG_CONVERTED_TO_DXF" in parsed["warnings"]
    assert "DWG_SOURCE_VERSION:AC1032" in parsed["warnings"]
    assert any(element["text"] == "Converted DWG annotation" for element in parsed["elements"])


def test_dwg_rejects_unavailable_converter_and_forged_signature(tmp_path: Path) -> None:
    path = tmp_path / "drawing.dwg"
    path.write_bytes(b"AC1032" + b"\0" * 64)
    body = payload(path)
    body["mimeType"] = "image/vnd.dwg"

    unavailable_client = TestClient(
        create_app(
            Settings(
                PARSER_INTERNAL_TOKEN=TOKEN,
                RAW_DOCS_PATH=tmp_path,
                DWG_CONVERSION_ENABLED=True,
                DWG_CONVERTER_EXECUTABLE=tmp_path / "missing-oda-file-converter",
                PARSER_TEMP_PATH=tmp_path,
            )
        )
    )
    unavailable = unavailable_client.post(
        "/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body
    )
    assert unavailable.status_code == 503
    assert unavailable.json()["detail"] == "DWG 转换器未就绪"

    converter = tmp_path / "fake-oda-file-converter"
    make_fake_dwg_converter(converter)
    path.write_bytes(b"NOTDWG")
    enabled_client = TestClient(
        create_app(
            Settings(
                PARSER_INTERNAL_TOKEN=TOKEN,
                RAW_DOCS_PATH=tmp_path,
                DWG_CONVERSION_ENABLED=True,
                DWG_CONVERTER_EXECUTABLE=converter,
                PARSER_TEMP_PATH=tmp_path,
            )
        )
    )
    invalid = enabled_client.post(
        "/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body
    )
    assert invalid.status_code == 422
    assert invalid.json()["detail"] == "DWG 版本不受支持或文件签名无效"


def test_dwg_rejects_disabled_conversion(tmp_path: Path) -> None:
    path = tmp_path / "drawing.dwg"
    path.write_bytes(b"AC1032" + b"\0" * 64)
    body = payload(path)
    body["mimeType"] = "image/vnd.dwg"
    disabled_client = TestClient(
        create_app(
            Settings(
                PARSER_INTERNAL_TOKEN=TOKEN,
                RAW_DOCS_PATH=tmp_path,
                DWG_CONVERSION_ENABLED=False,
                PARSER_TEMP_PATH=tmp_path,
            )
        )
    )

    disabled = disabled_client.post(
        "/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body
    )

    assert disabled.status_code == 503
    assert disabled.json()["detail"] == "DWG 格式转换未启用"


def test_parse_rejects_path_outside_root_and_symlink(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    client = make_client(root)

    outside_response = client.post(
        "/internal/v1/parse",
        headers={"x-internal-token": TOKEN},
        json=payload(outside),
    )
    assert outside_response.status_code == 422

    link = root / "link.txt"
    link.symlink_to(outside)
    link_response = client.post(
        "/internal/v1/parse",
        headers={"x-internal-token": TOKEN},
        json=payload(link),
    )
    assert link_response.status_code == 422


def test_parse_rejects_empty_and_oversized_files(tmp_path: Path) -> None:
    client = make_client(tmp_path, max_parse_bytes=1024)
    empty = tmp_path / "empty.txt"
    empty.write_text("", encoding="utf-8")
    assert (
        client.post(
            "/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=payload(empty)
        ).status_code
        == 422
    )

    oversized = tmp_path / "large.txt"
    oversized.write_text("x" * 1025, encoding="utf-8")
    assert (
        client.post(
            "/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=payload(oversized)
        ).status_code
        == 422
    )
