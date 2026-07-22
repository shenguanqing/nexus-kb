import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.parsers.dxf import DxfParseResult, parse_dxf

SUPPORTED_DWG_VERSIONS = {
    "AC1009",
    "AC1012",
    "AC1014",
    "AC1015",
    "AC1018",
    "AC1021",
    "AC1024",
    "AC1027",
    "AC1032",
}


class DwgConversionError(Exception):
    pass


class DwgConversionUnavailableError(DwgConversionError):
    pass


class DwgConversionTimeoutError(DwgConversionError):
    pass


class DwgConversionInvalidError(DwgConversionError):
    pass


def converter_is_ready(executable: Path, temp_root: Path) -> bool:
    try:
        resolved_executable = executable.resolve(strict=True)
        resolved_temp_root = temp_root.resolve(strict=True)
    except OSError:
        return False
    if not executable.is_absolute() or executable.is_symlink() or not resolved_executable.is_file():
        return False
    if not os.access(resolved_executable, os.X_OK):
        return False
    return resolved_temp_root.is_dir() and os.access(resolved_temp_root, os.W_OK | os.X_OK)


def parse_dwg(
    path: Path,
    *,
    executable: Path,
    converter_release: str,
    output_version: str,
    temp_root: Path,
    timeout_seconds: int,
    max_converted_bytes: int,
    max_entities: int,
    max_elements: int,
    max_insert_depth: int,
) -> DxfParseResult:
    source_version = _validate_dwg_header(path)
    if not converter_is_ready(executable, temp_root):
        raise DwgConversionUnavailableError("DWG 转换器未就绪")

    resolved_executable = executable.resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="dwg-", dir=temp_root) as workspace:
        workspace_path = Path(workspace)
        source_directory = workspace_path / "input"
        output_directory = workspace_path / "output"
        staged_source = source_directory / path.name
        output_path = output_directory / f"{path.stem}.dxf"
        try:
            source_directory.mkdir()
            output_directory.mkdir()
            shutil.copyfile(path, staged_source)
        except OSError as error:
            raise DwgConversionUnavailableError("DWG 转换临时目录不可用") from error
        command = [
            str(resolved_executable),
            str(source_directory),
            str(output_directory),
            output_version,
            "DXF",
            "0",
            "1",
            "*.dwg",
        ]
        try:
            subprocess.run(  # noqa: S603 -- fixed absolute executable and argument schema
                command,
                check=False,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=timeout_seconds,
                cwd=workspace_path,
                env=_converter_environment(workspace_path),
            )
        except subprocess.TimeoutExpired as error:
            raise DwgConversionTimeoutError("DWG 格式转换超时") from error
        except OSError as error:
            raise DwgConversionUnavailableError("DWG 转换器不可用") from error

        if not output_path.exists() or not output_path.is_file() or output_path.is_symlink():
            raise DwgConversionInvalidError("DWG 格式转换失败")
        try:
            output_path.resolve(strict=True).relative_to(workspace_path.resolve(strict=True))
        except (OSError, ValueError) as error:
            raise DwgConversionInvalidError("DWG 转换结果不安全") from error
        output_size = output_path.stat().st_size
        if output_size == 0 or output_size > max_converted_bytes:
            raise DwgConversionInvalidError("DWG 转换结果为空或超过大小限制")
        result = parse_dxf(output_path, max_entities, max_elements, max_insert_depth)
        return DxfParseResult(
            elements=result.elements,
            warnings=[
                "DWG_CONVERTED_TO_DXF",
                f"DWG_SOURCE_VERSION:{source_version}",
                *result.warnings,
            ],
            parser_version=f"oda-{converter_release}+ezdxf-{result.parser_version}",
        )


def _validate_dwg_header(path: Path) -> str:
    with path.open("rb") as stream:
        signature = stream.read(6).decode("ascii", errors="ignore")
    if signature not in SUPPORTED_DWG_VERSIONS:
        raise DwgConversionInvalidError("DWG 版本不受支持或文件签名无效")
    return signature


def _converter_environment(workspace: Path) -> dict[str, str]:
    environment = {
        "HOME": str(workspace),
        "TMPDIR": str(workspace),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "PATH": "/usr/local/bin:/usr/bin:/bin",
    }
    for name in ("DISPLAY", "LD_LIBRARY_PATH", "XDG_RUNTIME_DIR"):
        value = os.environ.get(name)
        if value:
            environment[name] = value
    return environment
