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
    return res.status(400).json({ error: 'Invalid url parameter' });
  }

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  let urlObj;
  try {
    urlObj = new URL(targetUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  console.log('Proxying:', targetUrl);

  const isHttps = urlObj.protocol === 'https:';
  const mod = isHttps ? https : http;
  const port = urlObj.port || (isHttps ? 443 : 80);
  const path = urlObj.pathname + urlObj.search;

  const options = {
    hostname: urlObj.hostname,
    port: port,
    path: path,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36',
      'Referer': urlObj.origin,
      'Accept': '*/*'
    }
  };

  const proxyReq = mod.request(options, (proxyRes) => {
    console.log('Target status:', proxyRes.statusCode);

    if (proxyRes.statusCode === 200) {
      res.set({
        'Content-Type': proxyRes.headers['content-type'] || 'audio/mpeg',
        'Accept-Ranges': 'bytes'
      });
      proxyRes.pipe(res);
    } else if ([301, 302, 303, 307, 308].indexOf(proxyRes.statusCode) !== -1) {
      const location = proxyRes.headers.location;
      if (location) {
        console.log('Redirecting to:', location);
        const newUrl = new URL(location, targetUrl);
        const newIsHttps = newUrl.protocol === 'https:';
        const newMod = newIsHttps ? https : http;
        const newPort = newUrl.port || (newIsHttps ? 443 : 80);
        const newOptions = {
          hostname: newUrl.hostname,
          port: newPort,
          path: newUrl.pathname + newUrl.search,
          method: 'GET',
          headers: options.headers
        };
        const newReq = newMod.request(newOptions, (newRes) => {
          console.log('Redirect status:', newRes.statusCode);
          if (newRes.statusCode === 200) {
            res.set({
              'Content-Type': newRes.headers['content-type'] || 'audio/mpeg',
              'Accept-Ranges': 'bytes'
            });
            newRes.pipe(res);
          } else {
            if (!res.headersSent) res.status(502).json({ error: 'Redirect target error', status: newRes.statusCode });
          }
        });
        newReq.on('error', (err) => {
          if (!res.headersSent) res.status(502).json({ error: 'Redirect failed', message: err.message });
        });
        newReq.end();
        return;
      }
    } else {
      if (!res.headersSent) res.status(502).json({ error: 'Target error', status: proxyRes.statusCode });
      return;
    }
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Proxy request failed', message: err.message });
  });

  res.on('close', () => { proxyReq.destroy(); });

  proxyReq.end();
});

app.get('/', (req, res) => {
  res.json({ service: 'Radio Proxy Server', status: 'running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Radio Proxy Server running on port ' + PORT);
});
