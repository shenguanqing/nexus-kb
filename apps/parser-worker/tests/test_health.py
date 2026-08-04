from pathlib import Path

from fastapi.testclient import TestClient

from app import main as main_module
from app.config import Settings
from app.main import create_app


def test_liveness_does_not_depend_on_external_services(tmp_path: Path) -> None:
    app = create_app(Settings(PARSER_INTERNAL_TOKEN="x" * 16, RAW_DOCS_PATH=tmp_path))
    response = TestClient(app).get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_dwg_conversion_is_enabled_with_the_controlled_launcher_by_default(tmp_path: Path) -> None:
    settings = Settings(PARSER_INTERNAL_TOKEN="x" * 16, RAW_DOCS_PATH=tmp_path)

    assert settings.dwg_conversion_enabled is True
    assert settings.dwg_converter_executable == Path("/usr/local/bin/nexus-oda-file-converter")


def test_readiness_reports_missing_enabled_dwg_converter(tmp_path: Path) -> None:
    settings = Settings(
        PARSER_INTERNAL_TOKEN="x" * 16,
        RAW_DOCS_PATH=tmp_path,
        DWG_CONVERSION_ENABLED=True,
        DWG_CONVERTER_EXECUTABLE=tmp_path / "missing-converter",
        PARSER_TEMP_PATH=tmp_path,
    )

    response = TestClient(create_app(settings)).get("/health/ready")

    assert response.status_code == 503
    assert response.json()["checks"]["dwgConverter"] == {"status": "down"}


def test_readiness_reports_enabled_tika_status(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "tika_is_ready", lambda base_url, timeout: False)
    settings = Settings(
        PARSER_INTERNAL_TOKEN="x" * 16,
        RAW_DOCS_PATH=tmp_path,
        DWG_CONVERSION_ENABLED=False,
        TIKA_ENABLED=True,
    )

    response = TestClient(create_app(settings)).get("/health/ready")

    assert response.status_code == 503
    assert response.json()["checks"]["tika"] == {"status": "down"}
