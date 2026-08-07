import re
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
    elements: list[ParsedElement] = []
    section_path: list[str] = []
    paragraphs: list[str] = []

    def flush() -> None:
        content = "\n".join(paragraphs).strip()
        if content:
            elements.append(
                ParsedElement(
                    text=content,
                    element_type="paragraph",
                    section_path=section_path.copy(),
                )
            )
        paragraphs.clear()

    for line in text.splitlines():
        heading = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if heading:
            flush()
            level = len(heading.group(1))
            title = heading.group(2).strip()
            section_path = section_path[: level - 1] + [title]
            elements.append(
                ParsedElement(
                    text=title,
                    element_type="heading",
                    section_path=section_path.copy(),
                )
            )
        elif line.strip():
            paragraphs.append(line.strip())
        else:
            flush()
    flush()
    return elements
