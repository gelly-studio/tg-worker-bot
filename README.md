# Cloudflare Worker TG 消息发送与图床管理

一个基于 Cloudflare Workers 和 D1 数据库的轻量级 Telegram 消息发送与图床管理系统。具备 Turnstile 人机验证登录保护，支持图片压缩、发送文本及后台图库管理。

## ✨ 功能特点

-   **安全登录**：集成 Cloudflare Turnstile 人机验证，配合 Cookie 会话管理。
-   **消息发送**：支持纯文本及图片（自动压缩为 JPEG）发送到指定 Telegram 频道/群组。
-   **图库管理**：独立的后台管理界面，支持浏览历史图片、批量复制链接、批量删除（同时删除 D1 记录和 TG 消息）。
-   **响应式设计**：支持移动端和桌面端操作。
-   **零费用**：利用 Cloudflare Workers 免费版托管，无需服务器成本。

## 🚀 部署步骤

### 1. 准备工作

1.  **Telegram Bot**: 与 [@BotFather](https://t.me/botfather) 对话获取 `TG_BOT_TOKEN`。
2.  **Chat ID**: 获取你要发送消息的频道或群组 ID (`TG_CHAT_ID`)。
3.  **Cloudflare Turnstile**: 在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 注册一个站点，获取 `SITE KEY` 和 `SECRET KEY`。
4.  **Cloudflare D1**: 创建一个新的 D1 数据库，获取 **Database ID**。

### 2. 创建 Worker

1.  在 Cloudflare Dashboard 创建一个新的 Worker。
2.  将本项目的 `index.js` 代码完整粘贴到编辑器中并保存。
3.  **绑定 D1 数据库**：
    *   进入 Worker 的 **Settings** -> **Variables**。
    *   在 **D1 database bindings** 区域，添加 Binding，变量名填写 `DATABASE`，选择刚才创建的 D1 数据库。

### 3. 配置环境变量

在 **Settings** -> **Variables** 的 **Environment variables** 区域添加以下变量：

| 变量名 (Name) | 描述 | 示例 |
| :--- | :--- | :--- |
| `TG_BOT_TOKEN` | Telegram Bot Token (必填) | `123456:ABC-DEF...` |
| `TG_CHAT_ID` | 发送目标的 ID (频道ID需带 -100) | `-1001234567890` |
| `USERNAME` | 登录用户名 (默认 admin) | `admin` |
| `PASSWORD` | 登录密码 (默认 password) | `mySecurePassword` |
| `TURNSTILE_SITE_KEY` | Turnstile 网站密钥 | `0x4AAAA...` |
| `TURNSTILE_SECRET_KEY` | Turnstile 秘钥 | `0x4AAAA...` |
| `ADMIN_PATH` | 后台管理路径 (选填) | `admin` |
| `DOMAIN` | 域名 (选填，通常留空) | - |

---

## 📖 使用方法

### 1. 登录系统

首次访问 Worker 地址，系统会自动跳转至登录页。

-   **输入凭据**：填写你在环境变量中设置的 `USERNAME` 和 `PASSWORD`。
-   **人机验证**：勾选 "我是机器人" 复选框完成验证（必须完成勾选，无需验证码）。
-   点击 **登录**。登录成功后，浏览器会为你生成一个有效期 24 小时的 Cookie。

### 2. 发送消息 (前台)

登录成功后默认进入发送界面 (首页)：

1.  **输入文本**（选填）：
    *   在文本框中输入消息内容。支持 Telegram 语法。
2.  **添加图片**：
    *   点击 "添加附件" 按钮，或直接将图片文件**拖拽**到虚线框内。
    *   支持**多选**图片上传。
    *   系统会自动将图片压缩为 JPEG 格式以加快上传速度。
3.  **发送**：
    *   点击底部的 **发送** 按钮。
    *   进度条显示当前上传进度。
    *   发送成功后，界面下方会显示返回的图片链接，点击 "复制内容" 可一键复制所有链接。
    *   界面上的消息和已选图片会在发送后自动清空。

### 3. 后台图库管理

点击右上角用户头像下拉菜单中的 **后台管理**，或直接访问 `/ADMIN_PATH` 进入管理页。

-   **浏览**：
    *   页面以网格形式展示所有历史上传的图片。
    *   翻页功能支持查看大量历史记录。
-   **选择**：
    *   **单选**：点击任意图片卡片，卡片变为蓝色高亮，右上角出现对勾。
    *   **多选**：依次点击多张图片，顶部计数器显示已选数量。
-   **复制链接**：
    *   选中图片后，点击顶部 **复制** 按钮，所有选中的图片 URL 将复制到剪贴板。
-   **删除图片**（小心操作）：
    *   选中图片后，点击顶部红色 **删除** 按钮。
    *   这将**同时**执行两个操作：
        1.  从 Telegram 频道中删除对应的消息。
        2.  从 D1 数据库中删除对应记录。
    *   删除操作不可恢复。

---

## 🔐 安全建议

1.  请务必修改默认的 `USERNAME` 和 `PASSWORD`。
2.  建议将 Worker 绑定自定义域名并强制 HTTPS。
3.  建议将 GitHub 仓库设置为 **Private (私有)**，以免泄露你的架构逻辑。
