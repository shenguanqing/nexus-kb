from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "test-internal-token"  # noqa: S105 -- non-secret test fixture


def make_client(root: Path) -> TestClient:
    return TestClient(
        create_app(Settings(PARSER_INTERNAL_TOKEN=TOKEN, RAW_DOCS_PATH=root, MAX_PARSE_BYTES=1024))
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
    assert response.json()["parserVersion"] == "1.0.0"


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
    client = make_client(tmp_path)
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
