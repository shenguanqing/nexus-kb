import gzip
import os
import re
import shutil
import subprocess
import tempfile
from importlib.metadata import version
from pathlib import Path
from uuid import UUID
from xml.etree import ElementTree

from ezdxf import recover
from ezdxf.addons.drawing import layout, svg
from ezdxf.addons.drawing.frontend import Frontend
from ezdxf.filemanagement import readfile
from ezdxf.lldxf.const import DXFError

from app.cad_rendering import cad_render_context
from app.cad_tiles import (
    CadPreviewResourceError,
    CadPreviewTimeoutError,
    estimate_cad_render_cost,
    generate_cad_tile_preview,
)
from app.schemas import PreviewArtifact

_MAX_COMPRESSIBLE_SVG_BYTES = 1_073_741_824
_ZERO_STROKE_WIDTH = re.compile(r"stroke-width:\s*0(?:\.0+)?;")


def cad_preview_failure_warning(error: Exception) -> str:
    if isinstance(error, CadPreviewTimeoutError):
        return "CAD_PREVIEW_INITIALIZATION_TIMEOUT"
    if isinstance(error, CadPreviewResourceError | MemoryError):
        return "CAD_PREVIEW_RESOURCE_LIMIT_EXCEEDED"
    return "PREVIEW_GENERATION_FAILED"


def generate_office_pdf(
    source: Path,
    document_id: UUID,
    *,
    executable: Path,
    preview_root: Path,
    temp_root: Path,
    timeout_seconds: int,
    max_bytes: int,
) -> PreviewArtifact:
    resolved_executable = _validated_executable(executable)
    resolved_preview_root = _validated_preview_root(preview_root)
    with tempfile.TemporaryDirectory(prefix="office-preview-", dir=temp_root) as workspace:
        workspace_path = Path(workspace)
        output_directory = workspace_path / "output"
        profile_directory = workspace_path / "profile"
        output_directory.mkdir()
        profile_directory.mkdir()
        command = [
            str(resolved_executable),
            "--headless",
            "--nologo",
            "--nodefault",
            "--nolockcheck",
            "--norestore",
            f"-env:UserInstallation={profile_directory.as_uri()}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(output_directory),
            str(source),
        ]
        subprocess.run(  # noqa: S603 -- absolute executable and fixed argument schema
            command,
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout_seconds,
            cwd=workspace_path,
            env=_conversion_environment(workspace_path),
        )
        converted = output_directory / f"{source.stem}.pdf"
        _validate_generated_file(converted, output_directory, max_bytes)
        storage_key = f"{document_id}.pdf"
        target = resolved_preview_root / storage_key
        _atomic_copy(converted, target)
        return PreviewArtifact(
            storage_key=storage_key,
            kind="pdf",
            mime_type="application/pdf",
            size_bytes=target.stat().st_size,
            renderer="libreoffice",
            renderer_version=_libreoffice_version(resolved_executable),
        )


def generate_cad_svg(
    source: Path,
    document_id: UUID,
    *,
    preview_root: Path,
    max_bytes: int,
) -> PreviewArtifact:
    resolved_preview_root = _validated_preview_root(preview_root)
    try:
        document = readfile(source)
    except (DXFError, UnicodeDecodeError):
        document, _auditor = recover.readfile(source, errors="strict")
    backend = svg.SVGBackend()
    Frontend(cad_render_context(document), backend).draw_layout(document.modelspace())
    content = _sanitize_svg(backend.get_string(layout.Page(0, 0))).encode("utf-8")
    payload, compressed = _bounded_svg_payload(content, max_bytes)
    storage_key = f"{document_id}.svg"
    target = resolved_preview_root / storage_key
    temporary = resolved_preview_root / f".{storage_key}.tmp"
    try:
        with temporary.open("xb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return PreviewArtifact(
        storage_key=storage_key,
        kind="svg",
        mime_type="image/svg+xml",
        size_bytes=len(payload),
        renderer="ezdxf-svg-gzip" if compressed else "ezdxf-svg",
        renderer_version=version("ezdxf"),
    )


def generate_cad_preview(
    source: Path,
    document_id: UUID,
    *,
    preview_root: Path,
    max_bytes: int,
    tiled_enabled: bool,
    tile_cost_threshold: int,
    tile_source_bytes_threshold: int,
    tile_size: int,
    max_zoom: int,
    render_timeout_seconds: int,
    render_memory_bytes: int,
    max_insert_depth: int = 8,
) -> PreviewArtifact:
    _entity_count, render_cost = estimate_cad_render_cost(source, max_insert_depth)
    if tiled_enabled and (
        source.stat().st_size > tile_source_bytes_threshold
        or render_cost > tile_cost_threshold
    ):
        return generate_cad_tile_preview(
            source,
            document_id,
            preview_root=preview_root,
            tile_size=tile_size,
            max_zoom=max_zoom,
            max_source_bytes=max_bytes,
            render_timeout_seconds=render_timeout_seconds,
            render_memory_bytes=render_memory_bytes,
        )
    return generate_cad_svg(
        source,
        document_id,
        preview_root=preview_root,
        max_bytes=max_bytes,
    )


# Backward-compatible test seam; production callers use cad_render_context directly.
_cad_render_context = cad_render_context


def _bounded_svg_payload(content: bytes, max_bytes: int) -> tuple[bytes, bool]:
    if not content or len(content) > _MAX_COMPRESSIBLE_SVG_BYTES:
        raise ValueError("预览产物为空或超过大小限制")
    if len(content) <= max_bytes:
        return content, False
    compressed = gzip.compress(content, compresslevel=6, mtime=0)
    if len(compressed) > max_bytes:
        raise ValueError("预览产物为空或超过大小限制")
    return compressed, True


def _validated_executable(executable: Path) -> Path:
    resolved = executable.resolve(strict=True)
    if not executable.is_absolute() or executable.is_symlink() or not resolved.is_file():
        raise ValueError("Office 预览转换器不可用")
    if not os.access(resolved, os.X_OK):
        raise ValueError("Office 预览转换器不可用")
    return resolved


def _validated_preview_root(root: Path) -> Path:
    resolved = root.resolve(strict=True)
    if (
        not root.is_absolute()
        or root.is_symlink()
        or not resolved.is_dir()
        or not os.access(resolved, os.W_OK | os.X_OK)
    ):
        raise ValueError("预览产物目录不可用")
    return resolved


def _validate_generated_file(path: Path, root: Path, max_bytes: int) -> None:
    if not path.exists() or not path.is_file() or path.is_symlink():
        raise ValueError("预览转换失败")
    try:
        path.resolve(strict=True).relative_to(root.resolve(strict=True))
    except (OSError, ValueError) as error:
        raise ValueError("预览转换结果不安全") from error
    size = path.stat().st_size
    if size <= 0 or size > max_bytes:
        raise ValueError("预览产物为空或超过大小限制")


def _atomic_copy(source: Path, target: Path) -> None:
    temporary = target.parent / f".{target.name}.tmp"
    try:
        with source.open("rb") as input_stream, temporary.open("xb") as output_stream:
            shutil.copyfileobj(input_stream, output_stream)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def _conversion_environment(workspace: Path) -> dict[str, str]:
    return {
        "HOME": str(workspace),
        "TMPDIR": str(workspace),
        "LANG": "C.UTF-8",
        "PATH": "/usr/bin:/bin",
    }


def _libreoffice_version(executable: Path) -> str:
    try:
        completed = subprocess.run(  # noqa: S603 -- validated absolute executable
            [str(executable), "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
        )
        parts = completed.stdout.strip().split()
        return parts[1][:64] if len(parts) >= 2 else "unknown"
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"


def _sanitize_svg(content: str) -> str:
    root = ElementTree.fromstring(  # noqa: S314 -- parses output from the in-process renderer
        content
    )
    blocked_tags = {"script", "foreignobject", "image", "a"}
    for parent in root.iter():
        local_tag = parent.tag.rsplit("}", 1)[-1].lower()
        if local_tag in {"path", "line", "polyline", "polygon", "circle", "ellipse"}:
            parent.set("vector-effect", "non-scaling-stroke")
        if local_tag == "style" and parent.text:
            parent.text = _ZERO_STROKE_WIDTH.sub("stroke-width: 1;", parent.text)
        for child in list(parent):
            if child.tag.rsplit("}", 1)[-1].lower() in blocked_tags:
                parent.remove(child)
        for name in list(parent.attrib):
            local_name = name.rsplit("}", 1)[-1].lower()
            if local_name == "href" or local_name.startswith("on"):
                del parent.attrib[name]
    return ElementTree.tostring(root, encoding="unicode")
