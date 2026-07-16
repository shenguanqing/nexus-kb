from pathlib import Path
from uuid import uuid4

from docx import Document
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.config import Settings
from app.main import create_app

TOKEN = "test-internal-token"  # noqa: S105 -- non-secret test fixture


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

    assert response.status_code == 200
    assert response.json()["elements"][0]["text"] == "付款周期为 30 天"
    assert response.json()["parserVersion"] == "1.1.0"


def test_markdown_preserves_heading_path(tmp_path: Path) -> None:
    document = tmp_path / "guide.md"
    document.write_text("# 财务制度\n\n## 付款流程\n\n验收后 30 天付款", encoding="utf-8")
    client = make_client(tmp_path)
    body = payload(document)
    body["mimeType"] = "text/markdown"

    response = client.post(
        "/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body
    )

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

    response = client.post(
        "/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body
    )

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

    response = client.post(
        "/internal/v1/parse", headers={"x-internal-token": TOKEN}, json=body
    )

    assert response.status_code == 200
    assert response.json()["parser"] == "openpyxl"
    assert response.json()["elements"][1]["sheet"] == "付款"
    assert response.json()["elements"][1]["metadata"]["headers"] == ["项目", "周期"]


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
