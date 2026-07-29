# ODA File Converter package (local only)

Place the approved official Linux x64 Debian package in this folder with this exact name:

```text
oda-file-converter.deb
```

The package is ignored by Git and is only copied into the locally built DWG Parser Worker image. Do not add the package, a licence file, or credentials to Git.

DWG conversion is enabled by default. Use the root-level `compose.dwg.yaml` override to build this image; after the first successful build, inspect the real executable path and version inside the container, then set the actual `DWG_CONVERTER_RELEASE` value in `.env` before starting the full stack.
