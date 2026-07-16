from pathlib import Path
from zipfile import BadZipFile, ZipFile

from fastapi import HTTPException, status


def validate_office_archive(
    path: Path, max_entries: int, max_uncompressed_bytes: int
) -> None:
    try:
        with ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > max_entries:
                raise ValueError("压缩包条目数量超过限制")
            total = 0
            for entry in entries:
                if entry.filename.startswith("/") or ".." in Path(entry.filename).parts:
                    raise ValueError("压缩包包含非法路径")
                total += entry.file_size
                if total > max_uncompressed_bytes:
                    raise ValueError("压缩包解压大小超过限制")
    except (BadZipFile, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error
