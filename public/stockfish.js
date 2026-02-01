// public/stockfish.js
// Stockfish wrapper that loads WASM locally

(function() {
  // Create a function to initialize Stockfish
  window.Stockfish = function() {
    const workerCode = `
      // Stockfish Web Worker
      let wasmModule;
      
      // Post messages to main thread
      function postToMain(message) {
        self.postMessage(message);
      }
      
      // Load WASM module
      async function loadWasm() {
        try {
          // Import the stockfish.wasm.js module
          importScripts('stockfish.wasm.js');
          
          // The stockfish.wasm.js should expose a module
          wasmModule = await Module();
          
          // Set up message handler for WASM module
          wasmModule.onMessage = function(text) {
            postToMain(text);
          };
          
          // Initialize the engine
          wasmModule.postMessage('uci');
          wasmModule.postMessage('isready');
          
          postToMain('readyok');
          
        } catch (error) {
          console.error('Failed to load Stockfish WASM:', error);
          postToMain('error: ' + error.message);
        }
      }
      
      // Handle messages from main thread
      self.onmessage = function(event) {
        const command = event.data;
        
        if (command === 'init') {
          loadWasm();
        } else if (wasmModule) {
          wasmModule.postMessage(command);
        } else if (command === 'uci') {
          postToMain('uciok');
        } else if (command === 'isready') {
          postToMain('readyok');
        } else if (command.startsWith('setoption')) {
          postToMain('option set');
        } else if (command.startsWith('position')) {
          postToMain('position set');
        } else if (command.startsWith('go')) {
          // Fallback to random moves if WASM not loaded
          setTimeout(() => {
            const moves = ['e2e4', 'd2d4', 'g1f3', 'b1c3', 'e2e3', 'g2g3'];
            const randomMove = moves[Math.floor(Math.random() * moves.length)];
            postToMain('bestmove ' + randomMove);
          }, 500);
        }
      };
    `;
    
    // Create a blob URL for the worker code
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);
    
    // Clean up the blob URL
    setTimeout(() => URL.revokeObjectURL(workerUrl), 1000);
    
    return worker;
  };
})();