// debug-proxy.mjs
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());

const POSSIBLE_BASES = [
  'http://192.168.18.4:4747',
  'http://192.168.18.4:8080',
  'http://192.168.18.4:4748'
];

let activeBase = null;

// Function to test which URL works
const findWorkingUrl = async () => {
  console.log('Testing DroidCam URLs...');
  
  for (const url of POSSIBLE_BASES) {
    try {
      console.log(`Trying ${url}...`);
      
      // Test /video endpoint
      const videoTest = await fetch(`${url}/video`, { signal: AbortSignal.timeout(3000) });
      if (videoTest.ok) {
        console.log(`✓ Found working URL: ${url}`);
        return url;
      }
      
      // Test root endpoint
      const rootTest = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (rootTest.ok) {
        console.log(`✓ Found working URL: ${url}`);
        return url;
      }
    } catch (error) {
      console.log(`✗ ${url} failed: ${error.message}`);
    }
  }
  
  return null;
};

// Status endpoint that shows all tests
app.get('/debug-status', async (req, res) => {
  const results = {};
  
  for (const url of POSSIBLE_BASES) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      results[url] = {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText
      };
    } catch (error) {
      results[url] = {
        error: error.message,
        ok: false
      };
    }
  }
  
  res.json({
    timestamp: new Date().toISOString(),
    activeBase,
    results,
    yourNetwork: {
      computerIP: req.ip,
      userAgent: req.get('User-Agent')
    }
  });
});

// Simple frame endpoint that tries all URLs
app.get('/frame', async (req, res) => {
  if (!activeBase) {
    // Try to find a working URL
    activeBase = await findWorkingUrl();
  }
  
  if (!activeBase) {
    res.status(503).send('DroidCam not connected');
    return;
  }
  
  try {
    // Try /shot.jpg first
    let response = await fetch(`${activeBase}/shot.jpg`, { signal: AbortSignal.timeout(5000) });
    
    if (!response.ok) {
      // Try /video if /shot.jpg fails
      response = await fetch(`${activeBase}/video`, { signal: AbortSignal.timeout(5000) });
    }
    
    if (!response.ok) {
      throw new Error(`DroidCam returned ${response.status}`);
    }
    
    // Set appropriate headers
    res.set({
      'Content-Type': response.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache'
    });
    
    // Get the body and send it
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
    
  } catch (error) {
    console.error('Frame error:', error);
    // Try to find a new working URL
    activeBase = await findWorkingUrl();
    res.status(500).send(`Failed: ${error.message}`);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', activeBase });
});

// Initialize on startup
findWorkingUrl().then(url => {
  activeBase = url;
  if (activeBase) {
    console.log(`Using DroidCam at: ${activeBase}`);
  } else {
    console.log('No working DroidCam URL found');
  }
});

// Try to reconnect periodically
setInterval(async () => {
  if (!activeBase) {
    activeBase = await findWorkingUrl();
  }
}, 10000); // Every 10 seconds

app.listen(8080, () => {
  console.log('Debug proxy running on http://localhost:8080');
  console.log('Test endpoints:');
  console.log('  http://localhost:8080/debug-status');
  console.log('  http://localhost:8080/frame');
  console.log('  http://localhost:8080/health');
});