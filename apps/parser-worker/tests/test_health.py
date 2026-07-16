from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_liveness_does_not_depend_on_external_services(tmp_path: Path) -> None:
    app = create_app(Settings(PARSER_INTERNAL_TOKEN="x" * 16, RAW_DOCS_PATH=tmp_path))
    response = TestClient(app).get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

