const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');

const app = express();

// 启用 CORS
app.use(cors());

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 音频代理端点（使用http/https模块，更可靠）
app.get('/proxy/audio', (req, res) => {
  // 先解码URL（兼容 Java URLEncoder 和 JS encodeURIComponent）
  let targetUrl;
  try {
    // Java URLEncoder 把空格编码成 '+'，需要先替换成 '%20' 才能让 decodeURIComponent 正确解码
    const encodedUrl = (req.query.url || '').replace(/\+/g, '%20');
    targetUrl = decodeURIComponent(encodedUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid url parameter (decode failed)', detail: e.message });
  }

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // 验证URL格式
  let urlObj;
  try {
    urlObj = new URL(targetUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format: ' + targetUrl });
  }

  console.log(`Proxying: ${targetUrl}`);

  const protocol = urlObj.protocol === 'https:' ? https : http;

  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': urlObj.origin,
      'Accept': '*/*',
      'Connection': 'keep-alive'
    }
  };

  const proxyReq = protocol.get(targetUrl, options, (proxyRes) => {
    console.log(`Target responded: ${proxyRes.statusCode}`);

    // 转发响应头
    res.set({
      'Content-Type': proxyRes.headers['content-type'] || 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    });

    // 管道传输数据（最稳定）
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy request error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy request failed', message: err.message });
    }
  });

  // 处理客户端断开连接
  res.on('close', () => {
    proxyReq.destroy();
  });
});

// 根路径
app.get('/', (req, res) => {
  res.json({
    service: 'Radio Proxy Server',
    status: 'running',
    endpoints: {
      health: '/health',
      proxy: '/proxy/audio?url=ENCODED_URL'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Radio Proxy Server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Proxy: http://localhost:${PORT}/proxy/audio?url=...`);
});
