import os
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
from ezdxf.addons.drawing.properties import RenderContext
from ezdxf.document import Drawing
from ezdxf.filemanagement import readfile
from ezdxf.fonts import fonts
from ezdxf.lldxf.const import DXFError

from app.schemas import PreviewArtifact

_CJK_FONT_FAMILIES = ("Noto Sans CJK SC", "Noto Sans CJK", "WenQuanYi Zen Hei")
_CAD_FALLBACK_FONT_FAMILIES = {
    "dejavu sans",
    "liberation sans",
    "open sans",
    "sans-serif",
}


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
    Frontend(_cad_render_context(document), backend).draw_layout(document.modelspace())
    content = _sanitize_svg(backend.get_string(layout.Page(0, 0))).encode("utf-8")
    if not content or len(content) > max_bytes:
        raise ValueError("预览产物为空或超过大小限制")
    storage_key = f"{document_id}.svg"
    target = resolved_preview_root / storage_key
    temporary = resolved_preview_root / f".{storage_key}.tmp"
    try:
        with temporary.open("xb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return PreviewArtifact(
        storage_key=storage_key,
        kind="svg",
        mime_type="image/svg+xml",
        size_bytes=len(content),
        renderer="ezdxf-svg",
        renderer_version=version("ezdxf"),
    )


def _cad_render_context(document: Drawing) -> RenderContext:
    context = RenderContext(document)
    cjk_face = next(
        (
            face
            for family in _CJK_FONT_FAMILIES
            if (face := fonts.find_best_match(family=family)) is not None
        ),
        None,
    )
    if cjk_face is None:
        return context
    for style_name, face in tuple(context.fonts.items()):
        if face.family.casefold() in _CAD_FALLBACK_FONT_FAMILIES:
            context.fonts[style_name] = cjk_face
    return context


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
        for child in list(parent):
            if child.tag.rsplit("}", 1)[-1].lower() in blocked_tags:
                parent.remove(child)
        for name in list(parent.attrib):
            local_name = name.rsplit("}", 1)[-1].lower()
            if local_name == "href" or local_name.startswith("on"):
                del parent.attrib[name]
    return ElementTree.tostring(root, encoding="unicode")
