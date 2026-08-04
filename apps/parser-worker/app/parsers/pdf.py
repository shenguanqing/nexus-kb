from importlib import import_module
from importlib.metadata import version
from pathlib import Path
from typing import Any

from app.schemas import ParsedElement


def parse_pdf(
    path: Path, languages: list[str], max_pages: int, max_elements: int
) -> tuple[list[ParsedElement], list[str], str]:
    pdf_module = import_module("pypdf")
    reader = pdf_module.PdfReader(str(path), strict=True)
    if reader.is_encrypted:
        raise ValueError("PDF 文件已加密")
    if len(reader.pages) > max_pages:
        raise ValueError("PDF 页数超过限制")

    partition_module = import_module("unstructured.partition.pdf")
    raw_elements = partition_module.partition_pdf(
        filename=str(path),
        strategy="auto",
        include_page_breaks=False,
        infer_table_structure=False,
        languages=[_tesseract_language(language) for language in languages],
    )
    elements: list[ParsedElement] = []
    for raw in raw_elements:
        text = str(raw).strip()
        if not text:
            continue
        metadata = getattr(raw, "metadata", None)
        page_number = _positive_int(getattr(metadata, "page_number", None))
        element_type = _element_type(getattr(raw, "category", None))
        extra: dict[str, Any] = {}
        filename = getattr(metadata, "filename", None)
        if filename:
            extra["sourceType"] = "pdf"
        elements.append(
            ParsedElement(
                text=text,
                element_type=element_type,
                page=page_number,
                section_path=[],
                metadata=extra,
            )
        )
        if len(elements) > max_elements:
            raise ValueError("解析结果元素数量超过限制")

    return elements, [], version("unstructured")


def _element_type(category: object) -> str:
    normalized = str(category or "").strip().lower()
    return {
        "title": "heading",
        "header": "heading",
        "narrativetext": "paragraph",
        "listitem": "list_item",
        "table": "table",
    }.get(normalized, "paragraph")


def _positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and value >= 1 else None


def _tesseract_language(language: str) -> str:
    return {"ch_sim": "chi_sim", "en": "eng"}.get(language, language)
