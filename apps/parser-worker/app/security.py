from pathlib import Path

from fastapi import HTTPException, status

LEGACY_DOC_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


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


def validate_legacy_doc_signature(path: Path) -> None:
    try:
        with path.open("rb") as source:
            signature = source.read(len(LEGACY_DOC_SIGNATURE))
    except OSError as error:
        raise ValueError("DOC 文件签名无效") from error
    if signature != LEGACY_DOC_SIGNATURE:
        raise ValueError("DOC 文件签名无效")


def _unsafe_path() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="文件引用不合法",
    )
