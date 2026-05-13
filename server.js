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
  // 先解码URL（客户端用encodeURIComponent编码过）
  let targetUrl;
  try {
    targetUrl = decodeURIComponent(req.query.url || '');
  } catch (e) {
    return res.status(400).json({ error: 'Invalid url parameter (decode failed)' });
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

  try {
    console.log(`Proxying: ${targetUrl}`);

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RadioProxy/1.0)',
        'Referer': urlObj.origin
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

    // 正确传输流（Node.js 18+ 兼容）
    const reader = response.body.getReader();
    const pump = () => reader.read()
      .then(({ done, value }) => {
        if (done) {
          res.end();
          return;
        }
        res.write(value);
        return pump();
      });
    pump().catch(err => {
      console.error('Stream error:', err);
      res.end();
    });

  } catch (error) {
    console.error(`Proxy error: ${error.message}`);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Proxy request failed',
        message: error.message
      });
    }
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
