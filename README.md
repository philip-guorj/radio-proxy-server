# 环球听听 - 音频代理服务器

简易音频流代理服务器，解决跨域和访问限制问题。

## 功能特性

- ✅ 代理音频流，绕过 CORS 限制
- ✅ 支持 HTTP/HTTPS 音频流
- ✅ 自动转发 Content-Type 和 Content-Length
- ✅ 健康检查端点 `/health`
- ✅ CORS 支持
- ✅ 10秒超时保护

## 本地开发

### 安装依赖
```bash
npm install
```

### 启动服务器
```bash
npm start
```

服务器将在 `http://localhost:3000` 启动

### 测试

健康检查：
```bash
curl http://localhost:3000/health
```

代理音频流：
```bash
curl "http://localhost:3000/proxy/audio?url=https://stream.zeno.fm/0r0xa7929f0uv"
```

## 部署到 Render

### 方法一：通过 Render Dashboard（推荐）

1. 访问 [render.com](https://render.com) 并登录
2. 点击 "New +" → "Web Service"
3. 连接你的 GitHub 仓库
4. 配置：
   - **Name**: `radio-proxy`（或你喜欢的名字）
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
5. 点击 "Create Web Service"
6. 等待部署完成，记下生成的 URL（例如：`https://radio-proxy-xxx.onrender.com`）

### 方法二：通过 render.yaml（自动化部署）

1. 将代码推送到 GitHub 仓库
2. 在 Render Dashboard 中选择 "New +" → "Blueprint"
3. 选择仓库，Render 会自动读取 `render.yaml` 配置

## 使用方法

部署成功后，在客户端应用中使用：

```javascript
const PROXY_CONFIG = {
  cloudProxyUrl: 'https://your-app-name.onrender.com/proxy/audio?url=',
  localProxyUrl: 'http://localhost:3000/proxy/audio?url=',
};
```

## API 文档

### GET /health

健康检查端点

**响应示例：**
```json
{
  "status": "ok",
  "timestamp": "2026-05-11T17:24:20.285Z"
}
```

### GET /proxy/audio?url=ENCODED_URL

代理音频流

**参数：**
- `url` (必需): 要代理的音频流 URL（需要 URL 编码）

**示例：**
```bash
# 代理 Zeno 音频流
curl "https://your-app.onrender.com/proxy/audio?url=https%3A%2F%2Fstream.zeno.fm%2F0r0xa7929f0uv"
```

**响应头：**
- `Content-Type`: 原始音频流的 Content-Type
- `Accept-Ranges: bytes`
- `Cache-Control: no-cache`

## 注意事项

⚠️ **Free Tier 限制：**
- Render 免费套餐会在 15 分钟无活动后休眠
- 首次请求可能需要 30-60 秒唤醒（冷启动）
- 每月有带宽限制

💡 **建议：**
- 生产环境建议使用付费套餐或自建服务器
- 可以考虑使用 Railway、Fly.io 等其他平台

## 故障排查

### 代理失败
- 检查目标 URL 是否可访问
- 确认 URL 已正确编码
- 查看服务器日志：`Render Dashboard → Logs`

### 超时
- 默认超时 10 秒
- 可修改 `server.js` 中的 `AbortSignal.timeout(10000)`

## 许可证

MIT

## 作者

为"环球听听"项目定制开发
