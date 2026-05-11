const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// 启用 CORS
app.use(cors());

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 音频代理端点
app.get('/proxy/audio', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    console.log(`Proxying: ${targetUrl}`);

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RadioProxy/1.0)',
        'Referer': new URL(targetUrl).origin
      },
      signal: AbortSignal.timeout(10000) // 10秒超时
    });

    if (!response.ok) {
      throw new Error(`Target responded with ${response.status}`);
    }

    // 设置响应头
    res.set({
      'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Length': response.headers.get('Content-Length'),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    });

    // 管道传输音频流
    response.body.pipe(res);

  } catch (error) {
    console.error(`Proxy error: ${error.message}`);
    res.status(502).json({
      error: 'Proxy request failed',
      message: error.message
    });
  }
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
