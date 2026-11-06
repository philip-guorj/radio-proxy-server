const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { pipeline } = require('stream');

const app = express();
app.use(cors());

// ============================================================
// 范围 B：实时收听上报（转发期间周期性 upsert br-api 的 listening_active）
// TELEMETRY_URL 未配置时安全跳过（不影响转发主流程）。
// 长流靠 45s 定时器续活；HLS m3u8 轮询每次请求本就会命中并刷新 last_seen。
// ============================================================
const TELEMETRY_URL = process.env.BR_TELEMETRY_URL || 'https://breezeradio.com.cn/api/telemetry/active';      // 如 https://<br-api>/api/telemetry/active
const TELEMETRY_KEY = process.env.BR_TELEMETRY_KEY || '';
const TELEMETRY_INTERVAL_MS = 45000;

function reportActiveListening(targetUrl, clientIp, res) {
  if (!TELEMETRY_URL) return; // 未配置 → 安全 no-op
  const payload = { source: 'proxy', url: targetUrl, client_ip: clientIp || '' };
  const send = () => {
    try {
      fetch(TELEMETRY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Br-Telemetry-Key': TELEMETRY_KEY },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch (e) { /* fetch 缺失/失败都静默降级，绝不影响音频转发 */ }
  };
  send(); // 首次
  const timer = setInterval(send, TELEMETRY_INTERVAL_MS);
  res.on('close', () => { try { clearInterval(timer); } catch (e) {} });
  res.on('finish', send); // 流正常结束时刷一次，保留在 90s 窗口内
}

// ============================================================
// HLS(m3u8) 播放列表重写
// ============================================================
// 分片常写相对路径（如 cctv2_audio/xxx.ts），经本代理拉取时相对路径会被解析到
// 本代理域名下（.../proxy/xxx.ts）→ 404。故转发 m3u8 时把每个 URI 重写为
// 「回指本代理」的相对地址；用相对地址，腾讯云主域名与 Render 备用域名都能
// 自行回指自身，无需探测 Host。与云端 br-api（api_server.py /proxy/audio）一致。
// ============================================================
const HLS_PROXY_PATH = '/proxy/audio?url=';

function isHlsPlaylist(url, contentType) {
  if ((contentType || '').toLowerCase().indexOf('mpegurl') !== -1) return true;
  return (url || '').toLowerCase().indexOf('.m3u8') !== -1;
}

function wrapSegmentUrl(ref, baseUrl) {
  const uri = (ref || '').trim();
  if (!uri) return uri;
  if (uri.indexOf(HLS_PROXY_PATH) !== -1) return uri; // 已包装，防二次嵌套
  let absolute;
  try {
    absolute = new URL(uri, baseUrl).href;
  } catch (e) {
    return uri;
  }
  return HLS_PROXY_PATH + encodeURIComponent(absolute);
}

// 普通行是分片/子播放列表；#EXT-X-KEY / #EXT-X-MAP / #EXT-X-MEDIA 的 URI="..." 也需重写
function rewriteM3u8(text, baseUrl) {
  return text.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line) return raw;
    if (line.charAt(0) === '#') {
      if (line.indexOf('URI="') === -1) return line;
      return line.replace(/URI="([^"]*)"/g, (m, uri) => 'URI="' + wrapSegmentUrl(uri, baseUrl) + '"');
    }
    return wrapSegmentUrl(line, baseUrl);
  }).join('\n') + '\n';
}

function pickHeaders(upstreamRes, names) {
  const out = {};
  for (const name of names) {
    if (upstreamRes.headers[name] !== undefined) out[name] = upstreamRes.headers[name];
  }
  return out;
}

// HLS 播放列表读全文重写，其余字节透传。baseUrl 必须是最终（重定向后）的上游 URL
function sendUpstream(res, upstreamRes, baseUrl) {
  const contentType = upstreamRes.headers['content-type'] || '';
  if (isHlsPlaylist(baseUrl, contentType)) {
    const chunks = [];
    upstreamRes.on('data', (chunk) => chunks.push(chunk));
    upstreamRes.on('error', (err) => {
      console.error('HLS read error:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'HLS read failed', message: err.message });
      else res.end();
    });
    upstreamRes.on('end', () => {
      const body = Buffer.concat(chunks);
      const text = body.toString('utf8');
      if (text.indexOf('#EXTM3U') === -1) {
        // 像 HLS 但不是播放列表 → 原样返回，避免误伤
        if (!res.headersSent) {
          res.status(200).set(pickHeaders(upstreamRes, ['content-type', 'accept-ranges']));
          res.set('Content-Length', String(body.length));
          res.end(body);
        }
        return;
      }
      const rewritten = rewriteM3u8(text, baseUrl);
      console.log('HLS rewritten:', baseUrl.slice(0, 80), text.length + 'B -> ' + rewritten.length + 'B');
      if (!res.headersSent) {
        res.status(200).set({
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(rewritten);
      }
    });
    return;
  }
  const headersToForward = pickHeaders(
    upstreamRes, ['content-type', 'content-length', 'accept-ranges', 'icy-name', 'icy-genre']);
  if (!headersToForward['content-type']) headersToForward['content-type'] = 'audio/mpeg';
  res.set(headersToForward);
  pipeline(upstreamRes, res, (err) => {
    if (err) console.error('Pipeline error:', err.message);
  });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: 'v2.2', timestamp: new Date().toISOString() });
});

app.get(['/proxy/audio', '/proxy/audio.m3u8'], (req, res) => {
  let targetUrl;
  try {
    targetUrl = decodeURIComponent((req.query.url || '').replace(/\+/g, '%20'));
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

  // 范围 B：实时收听上报（转发期间周期性续活，res 关闭时停止）
  const clientIp = ((req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  reportActiveListening(targetUrl, clientIp, res);

  const isHttps = urlObj.protocol === 'https:';
  const mod = isHttps ? https : http;
  const port = urlObj.port || (isHttps ? 443 : 80);

  const options = {
    hostname: urlObj.hostname,
    port: port,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36',
      'Referer': urlObj.origin,
      'Accept': '*/*',
      'Accept-Encoding': 'identity'
    },
    timeout: 15000
  };

  const proxyReq = mod.request(options, (proxyRes) => {
    console.log('Target status:', proxyRes.statusCode);

    if (proxyRes.statusCode === 200) {
      sendUpstream(res, proxyRes, targetUrl);
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
          headers: options.headers,
          timeout: 15000
        };
        const newReq = newMod.request(newOptions, (newRes) => {
          console.log('Redirect status:', newRes.statusCode);
          if (newRes.statusCode === 200) {
            sendUpstream(res, newRes, newUrl.href);
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
      if (!res.headersSent) res.status(502).json({ error: 'Redirect without location', status: proxyRes.statusCode });
    } else {
      if (!res.headersSent) res.status(502).json({ error: 'Target error', status: proxyRes.statusCode });
      return;
    }
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Proxy request failed', message: err.message });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ error: 'Proxy request timeout' });
  });

  res.on('close', () => { try { proxyReq.destroy(); } catch(e) {} });

  proxyReq.end();
});

app.get('/', (req, res) => {
  res.json({ service: 'Radio Proxy Server', version: 'v2.2', status: 'running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Radio Proxy Server v2.2 running on port ' + PORT);
});
