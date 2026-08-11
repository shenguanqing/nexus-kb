# ODA File Converter 安装包（仅本地）

将已获组织批准的官方 Linux x64 Debian 安装包放入此目录，并使用以下固定文件名。构建前必须按[部署运维手册](../../../../docs/06-部署运维手册.md#91-cad--dwg-转换流程)完成许可证审批、恶意代码扫描、SHA-256 校验和登记及版本固定：

```text
oda-file-converter.deb
```

该文件已被 Git 忽略，只会复制到本地构建的 DWG Parser Worker 镜像中。不要将安装包、许可证或凭据提交到 Git。

基础模式默认关闭 DWG。放置安装包并完成 `.env` 配置后，使用 `pnpm docker:full -- up -d --build` 启动专用 DWG Worker。首次成功构建后，在容器内确认实际可执行文件路径和版本，再将实际版本填写到 `DWG_CONVERTER_RELEASE`。完整步骤见根目录 [README](../../../../README.md#启用-dwg-解析按需)。
