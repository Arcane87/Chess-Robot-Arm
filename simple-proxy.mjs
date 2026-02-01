import express from 'express';
import cors from 'cors';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';

const app = express();
app.use(cors());

const DROIDCAM_HOST = '192.168.18.4';
const DROIDCAM_PORT = 4747;
const DROIDCAM_PATH = '/video';

/* --------------------------------------------------
   CORS SETUP
-------------------------------------------------- */
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

app.options('*', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
    'Access-Control-Max-Age': '86400'
  });
  res.sendStatus(204);
});

/* --------------------------------------------------
   MJPEG STREAM PROXY (for display)
-------------------------------------------------- */
app.get('/video', (req, res) => {
  console.log('📡 Display stream requested');
  
  const droidcamReq = http.request({
    host: DROIDCAM_HOST,
    port: DROIDCAM_PORT,
    path: DROIDCAM_PATH,
    method: 'GET',
    headers: {
      'User-Agent': 'MJPEG-Proxy',
      'Accept': 'multipart/x-mixed-replace'
    }
  }, (droidcamRes) => {
    res.writeHead(200, {
      'Content-Type': droidcamRes.headers['content-type'] || 'multipart/x-mixed-replace',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    
    droidcamRes.pipe(res);
    
    droidcamRes.on('end', () => {
      console.log('⚠️ Display stream ended');
      res.end();
    });
  });
  
  droidcamReq.on('error', (err) => {
    console.error('❌ Display stream error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: err.message });
    }
  });
  
  req.on('close', () => {
    console.log('❌ Display client disconnected');
    droidcamReq.destroy();
  });
  
  droidcamReq.end();
});

/* --------------------------------------------------
   HEALTH
-------------------------------------------------- */
app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    mode: 'real-time binary streaming',
    endpoints: {
      display: '/video',
      websocket: 'ws://localhost:8080'
    }
  });
});

/* --------------------------------------------------
   CREATE HTTP SERVER
-------------------------------------------------- */
const server = http.createServer(app);

/* --------------------------------------------------
   WEBSOCKET SERVER FOR REAL-TIME BINARY STREAMING
-------------------------------------------------- */
const wss = new WebSocketServer({ server });

// Store active DroidCam connection
let droidcamConnection = null;
let frameCount = 0;

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket client connected');
  
  // Close any existing DroidCam connection
  if (droidcamConnection) {
    droidcamConnection.destroy();
    droidcamConnection = null;
  }
  
  // Set up DroidCam connection
  const droidcamReq = http.request({
    host: DROIDCAM_HOST,
    port: DROIDCAM_PORT,
    path: DROIDCAM_PATH,
    method: 'GET',
    headers: {
      'User-Agent': 'MJPEG-Proxy',
      'Accept': 'multipart/x-mixed-replace'
    }
  }, (droidcamRes) => {
    console.log('✅ Connected to DroidCam stream');
    
    let buffer = Buffer.alloc(0);
    let lastFrameTime = Date.now();
    
    droidcamRes.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      
      // Find JPEG frames in the buffer
      while (true) {
        const startIndex = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
        if (startIndex === -1) break;
        
        const endIndex = buffer.indexOf(Buffer.from([0xFF, 0xD9]), startIndex);
        if (endIndex === -1) break;
        
        // Extract the JPEG frame
        const jpegFrame = buffer.slice(startIndex, endIndex + 2);
        
        // Send raw binary frame via WebSocket
        if (ws.readyState === WebSocket.OPEN) {
          // Calculate FPS
          const now = Date.now();
          const frameInterval = now - lastFrameTime;
          lastFrameTime = now;
          
          // Send frame with minimal metadata
          ws.send(JSON.stringify({
            type: 'frame',
            frame: frameCount++,
            fps: Math.round(1000 / frameInterval),
            size: jpegFrame.length
          }));
          
          // Send binary frame data
          ws.send(jpegFrame);
        }
        
        // Remove processed frame from buffer
        buffer = buffer.slice(endIndex + 2);
      }
    });
    
    droidcamRes.on('end', () => {
      console.log('⚠️ DroidCam stream ended');
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'end' }));
        ws.close();
      }
    });
    
    droidcamRes.on('error', (err) => {
      console.error('DroidCam stream error:', err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', error: err.message }));
        ws.close();
      }
    });
  });
  
  droidcamReq.on('error', (err) => {
    console.error('❌ DroidCam connection error:', err.message);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', error: err.message }));
      ws.close();
    }
  });
  
  droidcamReq.end();
  
  // Store reference for cleanup
  droidcamConnection = droidcamReq;
  
  // Handle WebSocket close
  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    if (droidcamConnection) {
      droidcamConnection.destroy();
      droidcamConnection = null;
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

/* --------------------------------------------------
   START SERVER
-------------------------------------------------- */
const PORT = 8080;
server.listen(PORT, () => {
  console.log(`🚀 Real-Time Proxy Server running`);
  console.log(`➡️  Display stream: http://localhost:${PORT}/video`);
  console.log(`➡️  Binary stream:  ws://localhost:${PORT}`);
  console.log(`➡️  Health:         http://localhost:${PORT}/health`);
});