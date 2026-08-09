from ezdxf.addons.drawing.properties import RenderContext
from ezdxf.document import Drawing
from ezdxf.fonts import fonts

_CJK_FONT_FAMILIES = ("Noto Sans CJK SC", "Noto Sans CJK", "WenQuanYi Zen Hei")
_CAD_FALLBACK_FONT_FAMILIES = {
    "dejavu sans",
    "dejavu sans condensed",
    "liberation sans",
    "open sans",
    "sans-serif",
}


def cad_render_context(document: Drawing) -> RenderContext:
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
