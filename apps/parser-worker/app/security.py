from pathlib import Path

from fastapi import HTTPException, status


def validate_storage_path(raw_path: str, allowed_root: Path, max_bytes: int) -> Path:
    requested = Path(raw_path)
    if not requested.is_absolute() or ".." in requested.parts:
        raise _unsafe_path()

    try:
        root = allowed_root.resolve(strict=True)
        requested.relative_to(root)
        current = root
        for part in requested.relative_to(root).parts:
            current = current / part
            if current.is_symlink():
                raise _unsafe_path()
        resolved = requested.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError):
        raise _unsafe_path() from None

    if not resolved.is_file() or resolved.stat().st_size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="文件不可解析或超过大小限制",
        )
    return resolved


def _unsafe_path() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="文件引用不合法",
    )

