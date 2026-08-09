import argparse
import resource
from pathlib import Path
from uuid import UUID


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    subparsers = parser.add_subparsers(dest="action", required=True)
    initialize = subparsers.add_parser("initialize", add_help=False)
    initialize.add_argument("--source", required=True)
    initialize.add_argument("--document-id", required=True)
    initialize.add_argument("--preview-root", required=True)
    initialize.add_argument("--tile-size", type=int, required=True)
    initialize.add_argument("--max-zoom", type=int, required=True)
    initialize.add_argument("--max-source-bytes", type=int, required=True)
    initialize.add_argument("--memory-bytes", type=int, required=True)
    render = subparsers.add_parser("render", add_help=False)
    render.add_argument("--document-id", required=True)
    render.add_argument("--preview-root", required=True)
    render.add_argument("--zoom", type=int, required=True)
    render.add_argument("--tile-x", type=int, required=True)
    render.add_argument("--tile-y", type=int, required=True)
    render.add_argument("--metatile-radius", type=int, required=True)
    render.add_argument("--max-cache-bytes", type=int, required=True)
    render.add_argument("--memory-bytes", type=int, required=True)
    arguments = parser.parse_args()
    resource.setrlimit(resource.RLIMIT_AS, (arguments.memory_bytes, arguments.memory_bytes))

    from app.cad_tiles import _initialize_bundle, _render_metatile

    if arguments.action == "initialize":
        _initialize_bundle(
            Path(arguments.source),
            UUID(arguments.document_id),
            Path(arguments.preview_root),
            arguments.tile_size,
            arguments.max_zoom,
            arguments.max_source_bytes,
        )
    else:
        _render_metatile(
            UUID(arguments.document_id),
            Path(arguments.preview_root),
            arguments.zoom,
            arguments.tile_x,
            arguments.tile_y,
            arguments.metatile_radius,
            arguments.max_cache_bytes,
        )


if __name__ == "__main__":
    main()
