from pathlib import Path

import httpx

from app.schemas import ParsedElement


class TikaUnavailableError(RuntimeError):
    pass


def tika_is_ready(base_url: str, timeout_seconds: float) -> bool:
    try:
        response = httpx.get(f"{base_url.rstrip('/')}/version", timeout=timeout_seconds)
        return response.status_code == 200
    except httpx.HTTPError:
        return False


def parse_with_tika(
    path: Path,
    mime_type: str,
    base_url: str,
    timeout_seconds: float,
    max_response_bytes: int,
    max_elements: int,
    parser_version: str,
) -> tuple[list[ParsedElement], list[str], str]:
    try:
        with path.open("rb") as source, httpx.Client(timeout=timeout_seconds) as client:
            with client.stream(
                "PUT",
                f"{base_url.rstrip('/')}/tika",
                headers={
                    "Accept": "text/plain; charset=utf-8",
                    "Content-Type": mime_type,
                    "X-Tika-OCRskipOcr": "true",
                },
                content=source,
            ) as response:
                response.raise_for_status()
                declared_length = _content_length(response.headers.get("content-length"))
                if declared_length is not None and declared_length > max_response_bytes:
                    raise ValueError("Tika 返回内容超过限制")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > max_response_bytes:
                        raise ValueError("Tika 返回内容超过限制")
    except ValueError:
        raise
    except (OSError, httpx.HTTPError) as error:
        raise TikaUnavailableError("Tika 兜底解析不可用") from error

    text = bytes(body).decode("utf-8", errors="replace")
    blocks = [block.strip() for block in text.split("\n\n") if block.strip()]
    if len(blocks) > max_elements:
        raise ValueError("解析结果元素数量超过限制")
    elements = [
        ParsedElement(
            text=block,
            elementType="paragraph",
            metadata={"fallbackUsed": True, "sourceType": "pdf"},
        )
        for block in blocks
    ]
    return elements, ["TIKA_FALLBACK_USED"], parser_version


def _content_length(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except ValueError:
        return None
    return parsed if parsed >= 0 else None
