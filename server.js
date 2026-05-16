const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');

const app = express();
app.use(cors());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/proxy/audio', (req, res) => {
  let targetUrl;
  try {
    const encodedUrl = (req.query.url || '').replace(/\+/g, '%20');
    targetUrl = decodeURIComponent(encodedUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid url parameter', detail: e.message });
  }

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  let urlObj;
  try {
    urlObj = new URL(targetUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format', detail: e.message });
  }

  console.log(`Proxying: ${targetUrl}`);

  const protocol = urlObj.protocol === 'https:' ? https : http;

  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': urlObj.origin,
      'Accept': '*/*',
      'Connection': 'keep-alive'
    }
  };

  const proxyReq = protocol.request(options, (proxyRes) => {
    console.log(`Target responded: ${proxyRes.statusCode}`);

    // 处理重定向
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
      const location = proxyRes.headers.location;
      if (location) {
        console.log(`Redirecting to: ${location}`);
        targetUrl = location;
        const newUrlObj = new URL(targetUrl);
        const newProtocol = newUrlObj.protocol === 'https:' ? https : http;
        const newOptions = {
          hostname: newUrlObj.hostname,
          port: newUrlObj.port || (newUrlObj.protocol === 'https:' ? 443 : 80),
          path: newUrlObj.pathname + newUrlObj.search,
          method: 'GET',
          headers: options.headers
        };
        const redirectReq = newProtocol.request(newOptions, (redirectRes) => {
          console.log(`Redirect target responded: ${redirectRes.statusCode}`);
          if (redirectRes.statusCode !== 200) {
            if (!res.headersSent) {
              res.status(502).json({ error: 'Redirect target error', status: redirectRes.statusCode });
            }
            return;
          }
          res.set({
            'Content-Type': redirectRes.headers['content-type'] || 'audio/mpeg',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache'
          });
          redirectRes.pipe(res);
        });
        redirectReq.on('error', (err) => {
          if (!res.headersSent) {
            res.status(502).json({ error: 'Redirect failed', message: err.message });
          }
        });
        redirectReq.end();
        return;
      }
    }

    if (proxyRes.statusCode !== 200) {
      let body = '';
      proxyRes.on('data', (c) => { body += c; });
      proxyRes.on('end', () => {
        if (!res.headersSent) {
          res.status(502).json({ error: 'Target error', status: proxyRes.statusCode, message: body.substring(0, 200) });
        }
      });
      return;
    }

    res.set({
      'Content-Type': proxyRes.headers['content-type'] || 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    });

    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy request failed', message: err.message });
    }
  });

  res.on('close', () => { proxyReq.destroy(); });

  proxyReq.end();
});

app.get('/', (req, res) => {
  res.json({
    service: 'Radio Proxy Server',
    status: 'running',
    endpoints: { health: '/health', proxy: '/proxy/audio?url=ENCODED_URL' }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Radio Proxy Server running on port ${PORT}`);
});
