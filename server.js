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

  try {
    console.log(`Proxying: ${targetUrl}`);

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': urlObj.origin,
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive'
      }
      // 注意：音频流不能设置超时，因为流是持续的
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
