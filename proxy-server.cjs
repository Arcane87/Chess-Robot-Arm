// proxy-server.cjs - CommonJS version
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 8080;

// Enable CORS for all routes
app.use(cors());

// Proxy middleware for DroidCam
app.use('/stream', createProxyMiddleware({
  target: 'http://192.168.18.4:4747',
  changeOrigin: true,
  pathRewrite: {
    '^/stream': '/video'
  },
  ws: true,
  onProxyReq: (proxyReq, req, res) => {
    proxyReq.setHeader('User-Agent', 'ChessCam-Proxy');
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Failed to connect to DroidCam' });
  }
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'droidcam-proxy' });
});

// DroidCam status endpoint
app.get('/droidcam-status', async (req, res) => {
  try {
    const testUrl = 'http://192.168.18.4:4747/video';
    const response = await fetch(testUrl, { method: 'HEAD' });
    res.json({ 
      connected: response.ok,
      ip: '192.168.18.4',
      port: 4747,
      endpoint: '/video'
    });
  } catch (error) {
    res.json({ 
      connected: false,
      error: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`DroidCam Proxy Server running on http://localhost:${PORT}`);
  console.log(`Proxy endpoint: http://localhost:${PORT}/stream`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`DroidCam status: http://localhost:${PORT}/droidcam-status`);
});