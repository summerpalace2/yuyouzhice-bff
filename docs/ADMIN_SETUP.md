# 管理员功能配置与使用

## 1. 当前管理员模型

管理员不使用单独的登录页面。管理员与普通用户共用“账号/密码登录”，登录成功后由 Java 返回 `ADMIN` 或 `SUPER_ADMIN` 角色，Web BFF 再开放管理控制台。

当前实际 Java 配置文件是：

`D:\scenic-guide\ai\.env`

不要把管理员密码写入前端、代码、测试 fixture 或命令行参数。

## 2. 手动初始化首个管理员

也可以直接编辑服务端文件 `D:\scenic-guide\ai\.env`，加入或修改以下三项；`<YOUR_PASSWORD>` 只替换为你自己的密码，不要把真实值提交到代码仓库：

```dotenv
ADMIN_BOOTSTRAP_MODE=provision
ADMIN_BOOTSTRAP_USERNAME=your-admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=<YOUR_PASSWORD>
```

密码至少 12 位。`provision` 会按显式账号创建管理员，即使数据库里已经有旧管理员也不会覆盖旧账号；如果只想在“完全没有管理员”时创建首个账号，可使用 `one-time`。

在 Web 项目目录执行：

```powershell
cd "C:\Users\summer\Documents\Codex\2026-08-12\loop-p0-functional-inventory-1-home"
.\scripts\configure-admin.ps1
```

脚本会在本地安全提示输入账号和密码，不会把密码显示在终端命令行中。密码至少 12 位，建议账号使用邮箱并保持小写。

随后启动：

```powershell
.\start-local.ps1 -NoBrowser
```

脚本使用显式 `provision` 模式：没有管理员时创建首个 `ADMIN` 用户；已有管理员时创建你刚刚配置的新管理员，但不会覆盖旧账号，也不会修改旧密码。初始化成功后，将服务端配置中的 `ADMIN_BOOTSTRAP_MODE` 改回 `disabled`，再重启 Java，避免每次启动都重复尝试。

## 3. 管理能力

管理员登录后可以进入“管理中心”，当前由 BFF 代理并由 Java 统一鉴权：

- 用户列表、用户详情、角色调整、账号停用；
- 知识库文档查询和编辑；
- Java RAG / Embedding / Qdrant 状态概览；
- 数字人名称、音色、语言和欢迎语配置；
- 站点语言、语音能力、知识同步和上传上限等系统设置；
- 普通用户访问管理 API 返回 403，未登录访问返回 401。

角色和账号状态每次通过 Java 的 `/ai/auth/me` 重新确认，管理员被降权或停用后，旧令牌不会继续拥有管理权限。
