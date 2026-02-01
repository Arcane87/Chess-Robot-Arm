// WebSocket connection for DroidCam - runs in separate thread
let ws = null;
let frameCount = 0;
let lastFrameTime = 0;

self.onmessage = function(e) {
  const { type, url } = e.data;
  
  switch(type) {
    case 'connect':
      connectWebSocket(url);
      break;
    case 'disconnect':
      if (ws) {
        ws.close();
        ws = null;
      }
      break;
    default:
      break;
  }
};

function connectWebSocket(url) {
  console.log('[Worker] Connecting to WebSocket:', url);
  
  ws = new WebSocket(url);
  
  ws.onopen = function() {
    console.log('[Worker] WebSocket connected');
    self.postMessage({ type: 'connected' });
    lastFrameTime = performance.now();
  };
  
  ws.onmessage = async function(event) {
    // Handle JSON metadata
    if (typeof event.data === 'string') {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'frame') {
          // We'll wait for binary data
        }
      } catch (e) {
        // Not JSON, ignore
      }
      return;
    }
    
    // Binary frame data
    frameCount++;
    
    // Calculate FPS
    const now = performance.now();
    const fps = Math.round(1000 / (now - lastFrameTime));
    lastFrameTime = now;
    
    // Convert to Blob
    let blob;
    if (event.data instanceof ArrayBuffer) {
      blob = new Blob([event.data], { type: 'image/jpeg' });
    } else {
      blob = event.data;
    }
    
    // Create ImageBitmap (off-thread operation)
    try {
      const imageBitmap = await createImageBitmap(blob);
      
      // Send frame back to main thread
      self.postMessage({
        type: 'frame',
        imageBitmap: imageBitmap,
        frameNumber: frameCount,
        fps: fps
      }, [imageBitmap]); // Transfer ImageBitmap (zero-copy)
      
    } catch (error) {
      console.error('[Worker] Error processing frame:', error);
    }
  };
  
  ws.onerror = function(error) {
    console.error('[Worker] WebSocket error:', error);
    self.postMessage({ type: 'error', error: error.message });
  };
  
  ws.onclose = function() {
    console.log('[Worker] WebSocket closed');
    self.postMessage({ type: 'closed' });
  };
}