from pathlib import Path

from fastapi import HTTPException, status

from app.schemas import ParsedElement


def parse_text(path: Path) -> list[ParsedElement]:
    try:
        text = path.read_text(encoding="utf-8").strip()
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="文本文件必须使用 UTF-8 编码",
        ) from exc
    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="解析结果为空",
        )
    return [ParsedElement(text=text, element_type="paragraph")]
