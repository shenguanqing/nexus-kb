# 生产 Secret 挂载目录

本目录只保留说明文件。真实文件必须由 Vault、Secret Manager、受控配置管理或部署平台在目标服务器生成，权限固定为 `0600`，目录权限固定为 `0700`，不得提交 Git。

生产启动前必须存在：

- `database_url`
- `deployment_agent_token`
- `parser_internal_token`
- `postgres_password`
- `redis_password`
- `redis_url`
- `system_config_encryption_key`
- `tls_certificate.pem`
- `tls_key.pem`

`database_url` 与 `redis_url` 必须包含与对应密码文件一致的 URL 编码凭据。TLS 证书必须覆盖 `NEXUS_KB_PUBLIC_HOST`，私钥必须匹配，且剩余有效期至少七天。`pnpm production:check` 会在不输出任何 Secret 正文的前提下验证这些条件。
