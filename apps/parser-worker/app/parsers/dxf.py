import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from ezdxf import recover
from ezdxf.document import Drawing
from ezdxf.entities.dxfentity import DXFEntity
from ezdxf.entities.insert import Insert
from ezdxf.filemanagement import readfile
from ezdxf.lldxf.const import DXFAttributeError, DXFError, DXFKeyError
from ezdxf.version import __version__ as ezdxf_version

from app.schemas import ParsedElement, PreviewArtifact

TEXT_ENTITY_TYPES = {"TEXT", "MTEXT", "ATTRIB", "ATTDEF"}
DXF_PARSER_REVISION = "nexus-4"
MAX_CAD_TITLE_FIELDS = 200
MAX_CAD_TITLE_SUMMARY_CHARACTERS = 20_000
CAD_TITLE_FIELD_LABELS = {
    "建设单位": "建设单位",
    "工程名称": "工程名称",
    "设计单位": "设计单位",
    "项目名称": "项目名称",
    "子项目名称": "子项目名称",
    "图名": "图名",
    "图号": "图号",
    "日期": "日期",
    "设计编号": "设计编号",
}
DXF_UNIT_NAMES = {
    0: "未指定",
    1: "英寸",
    2: "英尺",
    3: "英里",
    4: "毫米",
    5: "厘米",
    6: "米",
    7: "千米",
    8: "微英寸",
    9: "密耳",
    10: "码",
    11: "埃",
    12: "纳米",
    13: "微米",
    14: "分米",
    15: "十米",
    16: "百米",
    17: "吉米",
    18: "天文单位",
    19: "光年",
    20: "秒差距",
    21: "美制测量英尺",
    22: "美制测量英寸",
    23: "美制测量码",
    24: "美制测量英里",
}


@dataclass(frozen=True)
class DxfParseResult:
    elements: list[ParsedElement]
    warnings: list[str]
    parser_version: str
    visited_entity_count: int
    expanded_block_context_count: int
    reused_block_definition_count: int
    preview: PreviewArtifact | None = None


@dataclass(frozen=True)
class _PositionedCadText:
    text: str
    layout_name: str
    layer: str
    block_path: tuple[str, ...]
    insert: tuple[float, float, float]
    handle: str | None


@dataclass
class _ParseState:
    max_entities: int
    max_elements: int
    max_insert_depth: int
    visited_entities: int = 0
    elements: list[ParsedElement] | None = None
    warnings: list[str] | None = None
    entity_types: Counter[str] | None = None
    layers: Counter[str] | None = None
    seen_elements: set[tuple[str, str, str, tuple[str, ...]]] | None = None
    positioned_texts: list[_PositionedCadText] | None = None
    expanded_block_contexts: set[tuple[str, tuple[str, ...], str]] | None = None
    reused_block_definitions: int = 0

    def __post_init__(self) -> None:
        self.elements = []
        self.warnings = []
        self.entity_types = Counter()
        self.layers = Counter()
        self.seen_elements = set()
        self.positioned_texts = []
        self.expanded_block_contexts = set()


def parse_dxf(
    path: Path,
    max_entities: int,
    max_elements: int,
    max_insert_depth: int,
) -> DxfParseResult:
    document, load_warnings = _load_document(path)
    state = _ParseState(
        max_entities=max_entities,
        max_elements=max_elements,
        max_insert_depth=max_insert_depth,
    )
    assert state.warnings is not None
    state.warnings.extend(load_warnings)

    for layout in document.layouts:
        for entity in layout:
            _visit_entity(
                entity,
                document=document,
                layout_name=layout.name,
                block_path=(),
                depth=0,
                active_blocks=frozenset(),
                state=state,
            )

    assert state.elements is not None
    assert state.expanded_block_contexts is not None
    if state.reused_block_definitions > 0:
        state.warnings.append("DXF_REPEATED_BLOCK_DEFINITIONS_REUSED")
    _append_cad_title_fields(state)
    state.elements.insert(0, _drawing_summary(document, state))
    if len(state.elements) > max_elements:
        raise ValueError("解析结果元素数量超过限制")
    return DxfParseResult(
        elements=state.elements,
        warnings=_deduplicate(state.warnings),
        parser_version=f"{ezdxf_version}+{DXF_PARSER_REVISION}",
        visited_entity_count=state.visited_entities,
        expanded_block_context_count=len(state.expanded_block_contexts),
        reused_block_definition_count=state.reused_block_definitions,
    )


def _load_document(path: Path) -> tuple[Drawing, list[str]]:
    try:
        document = readfile(path)
        auditor = document.audit()
        return document, _audit_warnings(auditor)
    except (DXFError, UnicodeDecodeError):
        try:
            document, auditor = recover.readfile(path, errors="strict")
        except (OSError, DXFError, UnicodeDecodeError) as error:
            raise ValueError("DXF 文件损坏或格式不受支持") from error
        return document, ["DXF_RECOVERED", *_audit_warnings(auditor)]


def _visit_entity(
    entity: DXFEntity,
    *,
    document: Drawing,
    layout_name: str,
    block_path: tuple[str, ...],
    depth: int,
    active_blocks: frozenset[str],
    state: _ParseState,
) -> None:
    state.visited_entities += 1
    if state.visited_entities > state.max_entities:
        raise ValueError("CAD 实体数量超过限制")

    entity_type = entity.dxftype()
    layer = str(_dxf_value(entity, "layer", "0"))
    assert state.entity_types is not None
    assert state.layers is not None
    state.entity_types[entity_type] += 1
    state.layers[layer] += 1

    if entity_type in TEXT_ENTITY_TYPES:
        _append_text_entity(entity, layout_name, layer, block_path, state)
    elif entity_type == "DIMENSION":
        _append_dimension(entity, layout_name, layer, block_path, state)

    if isinstance(entity, Insert):
        for attribute in entity.attribs:
            _visit_entity(
                attribute,
                document=document,
                layout_name=layout_name,
                block_path=(*block_path, entity.dxf.name),
                depth=depth,
                active_blocks=active_blocks,
                state=state,
            )
        _visit_block(
            entity.dxf.name,
            document=document,
            layout_name=layout_name,
            block_path=block_path,
            depth=depth,
            active_blocks=active_blocks,
            state=state,
        )


def _visit_block(
    block_name: str,
    *,
    document: Drawing,
    layout_name: str,
    block_path: tuple[str, ...],
    depth: int,
    active_blocks: frozenset[str],
    state: _ParseState,
) -> None:
    assert state.warnings is not None
    assert state.expanded_block_contexts is not None
    normalized_name = block_name.casefold()
    if normalized_name in active_blocks:
        state.warnings.append("DXF_BLOCK_CYCLE_SKIPPED")
        return
    if depth >= state.max_insert_depth:
        state.warnings.append("DXF_BLOCK_DEPTH_LIMIT_REACHED")
        return
    expansion_key = (
        layout_name.casefold(),
        tuple(name.casefold() for name in block_path),
        normalized_name,
    )
    if expansion_key in state.expanded_block_contexts:
        state.reused_block_definitions += 1
        return
    state.expanded_block_contexts.add(expansion_key)
    try:
        block = document.blocks.get(block_name)
    except DXFKeyError:
        state.warnings.append("DXF_MISSING_BLOCK_SKIPPED")
        return

    next_path = (*block_path, block_name)
    next_active_blocks = active_blocks | {normalized_name}
    for child in block:
        _visit_entity(
            child,
            document=document,
            layout_name=layout_name,
            block_path=next_path,
            depth=depth + 1,
            active_blocks=next_active_blocks,
            state=state,
        )


def _append_text_entity(
    entity: DXFEntity,
    layout_name: str,
    layer: str,
    block_path: tuple[str, ...],
    state: _ParseState,
) -> None:
    plain_text = getattr(entity, "plain_text", None)
    raw_text = plain_text() if callable(plain_text) else _dxf_value(entity, "text", "")
    text = _normalize_text(str(raw_text))
    if not text:
        return
    metadata: dict[str, Any] = _entity_metadata(entity, layout_name, layer, block_path)
    tag = _dxf_value(entity, "tag", None)
    if tag:
        metadata["tag"] = str(tag)
    element = ParsedElement(
        text=text,
        element_type="cad_text",
        section_path=_section_path(layout_name, layer, block_path),
        metadata=metadata,
    )
    if _append_element(
        element,
        layout_name,
        layer,
        block_path,
        state,
    ):
        _remember_positioned_text(element, layout_name, layer, block_path, state)


def _append_dimension(
    entity: DXFEntity,
    layout_name: str,
    layer: str,
    block_path: tuple[str, ...],
    state: _ParseState,
) -> None:
    raw_override = str(_dxf_value(entity, "text", "")).strip()
    measurement_method = getattr(entity, "get_measurement", None)
    measurement: object | None = None
    if callable(measurement_method):
        try:
            measurement = measurement_method()
        except (ArithmeticError, TypeError, ValueError):
            measurement = None
    display_value = _format_measurement(measurement)
    if raw_override and raw_override not in {"<>", " "}:
        text = _normalize_text(raw_override.replace("<>", display_value or ""))
    elif display_value:
        text = f"尺寸 {display_value}"
    else:
        return
    metadata = _entity_metadata(entity, layout_name, layer, block_path)
    if display_value:
        metadata["measurement"] = display_value
    _append_element(
        ParsedElement(
            text=text,
            element_type="cad_dimension",
            section_path=_section_path(layout_name, layer, block_path),
            metadata=metadata,
        ),
        layout_name,
        layer,
        block_path,
        state,
    )


def _append_element(
    element: ParsedElement,
    layout_name: str,
    layer: str,
    block_path: tuple[str, ...],
    state: _ParseState,
) -> bool:
    assert state.elements is not None
    assert state.seen_elements is not None
    key = (element.text, layout_name, layer, block_path)
    if key in state.seen_elements:
        return False
    state.seen_elements.add(key)
    state.elements.append(element)
    if len(state.elements) >= state.max_elements:
        raise ValueError("解析结果元素数量超过限制")
    return True


def _remember_positioned_text(
    element: ParsedElement,
    layout_name: str,
    layer: str,
    block_path: tuple[str, ...],
    state: _ParseState,
) -> None:
    assert state.positioned_texts is not None
    raw_insert = element.metadata.get("insert")
    if not isinstance(raw_insert, list) or len(raw_insert) != 3:
        return
    if not all(isinstance(value, int | float) for value in raw_insert):
        return
    handle = element.metadata.get("handle")
    state.positioned_texts.append(
        _PositionedCadText(
            text=element.text,
            layout_name=layout_name,
            layer=layer,
            block_path=block_path,
            insert=(float(raw_insert[0]), float(raw_insert[1]), float(raw_insert[2])),
            handle=handle if isinstance(handle, str) else None,
        )
    )


def _append_cad_title_fields(state: _ParseState) -> None:
    assert state.positioned_texts is not None
    used_values: set[tuple[str, tuple[str, ...], str | None, tuple[float, float, float]]] = set()
    summary_lines: list[str] = []
    for label in state.positioned_texts:
        if len(summary_lines) >= MAX_CAD_TITLE_FIELDS:
            break
        canonical_label = _canonical_title_label(label.text)
        if canonical_label is None:
            continue
        candidate = _nearest_title_value(label, state.positioned_texts, used_values)
        if candidate is None:
            continue
        used_values.add(
            (candidate.layout_name, candidate.block_path, candidate.handle, candidate.insert)
        )
        field_text = f"{canonical_label}：{candidate.text}"
        added = _append_element(
            ParsedElement(
                text=field_text,
                element_type="cad_title_field",
                section_path=[label.layout_name, "CAD 标题栏"],
                metadata={
                    "field": canonical_label,
                    "value": candidate.text,
                    "relation": "same_row_right",
                    "labelInsert": list(label.insert),
                    "valueInsert": list(candidate.insert),
                    **({"labelHandle": label.handle} if label.handle else {}),
                    **({"valueHandle": candidate.handle} if candidate.handle else {}),
                },
            ),
            label.layout_name,
            "CAD_TITLE_FIELD",
            label.block_path,
            state,
        )
        if added:
            summary_line = f"[{label.layout_name}] {field_text}"
            if summary_line not in summary_lines:
                summary_lines.append(summary_line)
    _append_cad_title_summary(summary_lines, state)


def _append_cad_title_summary(summary_lines: list[str], state: _ParseState) -> None:
    if not summary_lines:
        return
    summary = "CAD 标题栏汇总：\n" + "\n".join(summary_lines)
    is_truncated = len(summary) > MAX_CAD_TITLE_SUMMARY_CHARACTERS
    summary = summary[:MAX_CAD_TITLE_SUMMARY_CHARACTERS].rstrip()
    _append_element(
        ParsedElement(
            text=summary,
            element_type="cad_title_summary",
            section_path=["CAD 标题栏汇总"],
            metadata={
                "fieldCount": len(summary_lines),
                "truncated": is_truncated,
            },
        ),
        "CAD_TITLE_SUMMARY",
        "CAD_TITLE_SUMMARY",
        (),
        state,
    )


def _nearest_title_value(
    label: _PositionedCadText,
    texts: list[_PositionedCadText],
    used_values: set[tuple[str, tuple[str, ...], str | None, tuple[float, float, float]]],
) -> _PositionedCadText | None:
    candidates: list[tuple[float, _PositionedCadText]] = []
    label_x, label_y, label_z = label.insert
    for candidate in texts:
        candidate_key = (
            candidate.layout_name,
            candidate.block_path,
            candidate.handle,
            candidate.insert,
        )
        if (
            candidate is label
            or candidate_key in used_values
            or candidate.layout_name != label.layout_name
            or candidate.block_path != label.block_path
            or _canonical_title_label(candidate.text) is not None
            or len(candidate.text) > 256
        ):
            continue
        value_x, value_y, value_z = candidate.insert
        delta_x = value_x - label_x
        delta_y = abs(value_y - label_y)
        if delta_x <= 0 or delta_y > max(1.0, delta_x * 0.1) or abs(value_z - label_z) > 1.0:
            continue
        candidates.append((delta_x + delta_y * 4, candidate))
    return min(candidates, key=lambda item: item[0])[1] if candidates else None


def _canonical_title_label(text: str) -> str | None:
    compact = re.sub(r"[\s:：]+", "", text)
    return CAD_TITLE_FIELD_LABELS.get(compact)


def _drawing_summary(document: Drawing, state: _ParseState) -> ParsedElement:
    assert state.entity_types is not None
    assert state.layers is not None
    assert state.expanded_block_contexts is not None
    layout_names = [layout.name for layout in document.layouts]
    layer_names = sorted(state.layers)
    entity_counts = dict(sorted(state.entity_types.items()))
    units = int(document.header.get("$INSUNITS", 0))
    units_name = DXF_UNIT_NAMES.get(units, f"未知代码 {units}")
    text = (
        f"CAD 图纸摘要：DXF版本 {document.dxfversion}；"
        f"单位 {units_name}；"
        f"布局 {', '.join(layout_names) or '无'}；"
        f"图层 {', '.join(layer_names) or '无'}；"
        f"实体总数 {state.visited_entities}。"
    )
    return ParsedElement(
        text=text,
        element_type="cad_summary",
        section_path=["CAD 图纸摘要"],
        metadata={
            "dxfVersion": document.dxfversion,
            "unitsCode": units,
            "unitsName": units_name,
            "layouts": layout_names,
            "layers": layer_names,
            "entityCounts": entity_counts,
            "visitedEntityCount": state.visited_entities,
            "expandedBlockContextCount": len(state.expanded_block_contexts),
            "reusedBlockDefinitionCount": state.reused_block_definitions,
        },
    )


def _entity_metadata(
    entity: DXFEntity,
    layout_name: str,
    layer: str,
    block_path: tuple[str, ...],
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "entityType": entity.dxftype(),
        "layout": layout_name,
        "layer": layer,
    }
    handle = _dxf_value(entity, "handle", None)
    if handle:
        metadata["handle"] = str(handle)
    if block_path:
        metadata["blockPath"] = list(block_path)
    insert = _dxf_value(entity, "insert", None)
    if insert is not None:
        insert_vector = cast(Any, insert)
        try:
            metadata["insert"] = [
                float(insert_vector.x),
                float(insert_vector.y),
                float(insert_vector.z),
            ]
        except (AttributeError, TypeError, ValueError):
            pass
    return metadata


def _section_path(layout_name: str, layer: str, block_path: tuple[str, ...]) -> list[str]:
    path = [layout_name]
    path.extend(f"块:{name}" for name in block_path)
    path.append(f"图层:{layer}")
    return path


def _audit_warnings(auditor: Any) -> list[str]:
    warnings: list[str] = []
    errors = getattr(auditor, "errors", ())
    fixes = getattr(auditor, "fixes", ())
    if errors:
        warnings.append(f"DXF_AUDIT_ERRORS:{len(errors)}")
    if fixes:
        warnings.append(f"DXF_AUDIT_FIXES:{len(fixes)}")
    return warnings


def _dxf_value(entity: DXFEntity, name: str, default: object) -> object:
    try:
        return entity.dxf.get(name, default)
    except DXFAttributeError:
        return default


def _format_measurement(measurement: object | None) -> str:
    if isinstance(measurement, int | float):
        return f"{measurement:.6g}"
    if isinstance(measurement, tuple):
        return " × ".join(f"{float(value):.6g}" for value in measurement)
    return ""


def _normalize_text(text: str) -> str:
    return " ".join(text.replace("\r", "\n").split()).strip()


def _deduplicate(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))
