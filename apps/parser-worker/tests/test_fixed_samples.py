from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "test-internal-token"  # noqa: S105 -- non-secret test fixture
FIXTURES = Path(__file__).parent / "fixtures"


def payload(path: Path, mime_type: str) -> dict[str, str]:
    return {
        "jobId": str(uuid4()),
        "documentId": str(uuid4()),
        "storagePath": str(path),
        "mimeType": mime_type,
    }


def client(parser_temp_path: Path) -> TestClient:
    return TestClient(
        create_app(
            Settings(
                PARSER_INTERNAL_TOKEN=TOKEN,
                RAW_DOCS_PATH=FIXTURES,
                PARSER_TEMP_PATH=parser_temp_path,
                TIKA_ENABLED=False,
                DWG_CONVERSION_ENABLED=False,
            )
        )
    )


def test_fixed_pdf_sample_is_parsed_with_real_unstructured(tmp_path: Path) -> None:
    path = FIXTURES / "parser-sample.pdf"
    assert path.is_file(), "Run node apps/parser-worker/tests/fixtures/generate-fixtures.mjs first"

    response = client(tmp_path / "parser").post(
        "/internal/v1/parse",
        headers={"x-internal-token": TOKEN},
        json=payload(path, "application/pdf"),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["parser"] == "unstructured-pdf"
    assert "PAYMENT 30 DAYS" in " ".join(element["text"] for element in body["elements"]).upper()


def test_fixed_png_sample_is_parsed_with_real_easyocr(tmp_path: Path) -> None:
    path = FIXTURES / "parser-sample.png"
    assert path.is_file(), "Run node apps/parser-worker/tests/fixtures/generate-fixtures.mjs first"

    response = client(tmp_path / "parser").post(
        "/internal/v1/parse",
        headers={"x-internal-token": TOKEN},
        json=payload(path, "image/png"),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["parser"] == "easyocr"
    text = " ".join(element["text"] for element in body["elements"]).upper()
    assert "PAYMENT" in text
    assert "30" in text
