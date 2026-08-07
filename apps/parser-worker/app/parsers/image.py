from importlib import import_module
from numbers import Real
from pathlib import Path
from typing import Any

from app.schemas import ParsedElement


def parse_image(
    path: Path,
    model_storage_path: Path,
    user_network_directory: Path,
    languages: list[str],
    max_pixels: int,
    max_elements: int,
    confidence_warning_threshold: float,
) -> tuple[list[ParsedElement], list[str], str]:
    image_module = import_module("PIL.Image")
    with image_module.open(path) as image:
        width, height = image.size
        if width <= 0 or height <= 0 or width * height > max_pixels:
            raise ValueError("图片像素数量超过限制")
        image.verify()

    easyocr = import_module("easyocr")
    reader = easyocr.Reader(
        languages,
        gpu=False,
        model_storage_directory=str(model_storage_path),
        user_network_directory=str(user_network_directory),
        download_enabled=False,
        verbose=False,
    )
    raw_results = reader.readtext(str(path), detail=1, paragraph=False, workers=0)
    elements: list[ParsedElement] = []
    low_confidence = 0
    for raw in raw_results:
        bbox, raw_text, raw_confidence = _validate_result(raw)
        text = raw_text.strip()
        if not text:
            continue
        confidence = max(0.0, min(1.0, float(raw_confidence)))
        if confidence < confidence_warning_threshold:
            low_confidence += 1
        elements.append(
            ParsedElement(
                text=text,
                elementType="ocr_text",
                page=1,
                bbox=_flatten_bbox(bbox),
                metadata={"confidence": round(confidence, 6)},
            )
        )
        if len(elements) > max_elements:
            raise ValueError("解析结果元素数量超过限制")

    warnings = [f"OCR_LOW_CONFIDENCE_ELEMENTS:{low_confidence}"] if low_confidence else []
    return elements, warnings, str(getattr(easyocr, "__version__", "unknown"))


def _validate_result(raw: object) -> tuple[list[Any], str, float]:
    if not isinstance(raw, list | tuple) or len(raw) != 3:
        raise ValueError("OCR 返回格式无效")
    bbox, text, confidence = raw
    if not isinstance(bbox, list) or not isinstance(text, str) or not isinstance(
        confidence, Real
    ):
        raise ValueError("OCR 返回格式无效")
    return bbox, text, float(confidence)


def _flatten_bbox(points: list[Any]) -> list[float]:
    coordinates: list[tuple[float, float]] = []
    for point in points:
        if not isinstance(point, list | tuple) or len(point) != 2:
            raise ValueError("OCR 返回格式无效")
        x, y = point
        if not isinstance(x, Real) or not isinstance(y, Real):
            raise ValueError("OCR 返回格式无效")
        coordinates.append((float(x), float(y)))
    if len(coordinates) != 4:
        raise ValueError("OCR 返回格式无效")
    xs = [point[0] for point in coordinates]
    ys = [point[1] for point in coordinates]
    return [min(xs), min(ys), max(xs), max(ys)]
