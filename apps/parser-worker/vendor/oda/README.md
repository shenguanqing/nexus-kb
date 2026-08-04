# ODA File Converter package (local only)

Place the approved official Linux x64 Debian package in this folder with this exact name:

```text
oda-file-converter.deb
```

The package is ignored by Git and is only copied into the locally built DWG Parser Worker image. Do not add the package, a licence file, or credentials to Git.

基础模式默认关闭 DWG。完成 ODA 包放置与 `.env` 配置后，使用 `pnpm docker:full -- up -d --build` 启动专用 DWG Worker；首次成功构建后，在容器内确认真实可执行文件路径与版本，再将实际 `DWG_CONVERTER_RELEASE` 写入 `.env`。
