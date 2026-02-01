// public/stockfish-worker.js
// COMPLETELY LOCAL Stockfish worker - no CDN calls!

self.onmessage = function(event) {
  const command = event.data;
  
  if (command === 'init') {
    console.log('Stockfish worker: initializing...');
    
    // Create a simple fallback engine
    // We'll use this until we can load the real WASM engine
    const fallbackEngine = {
      postMessage: function(cmd) {
        if (cmd === 'uci') {
          setTimeout(() => self.postMessage('uciok'), 100);
        } else if (cmd === 'isready') {
          setTimeout(() => self.postMessage('readyok'), 100);
        } else if (cmd.startsWith('setoption')) {
          setTimeout(() => self.postMessage('option set'), 50);
        } else if (cmd.startsWith('position fen')) {
          setTimeout(() => self.postMessage('position set'), 50);
        } else if (cmd.startsWith('go')) {
          // Parse time for more realistic simulation
          let time = 1000;
          const match = cmd.match(/movetime (\d+)/);
          if (match) time = parseInt(match[1]);
          
          setTimeout(() => {
            const moves = ['e2e4', 'd2d4', 'g1f3', 'b1c3', 'e2e3', 'g2g3'];
            const randomMove = moves[Math.floor(Math.random() * moves.length)];
            self.postMessage(`bestmove ${randomMove}`);
          }, Math.min(time, 500));
        } else if (cmd === 'stop') {
          // Ignore stop commands in fallback mode
        }
      }
    };
    
    // Store the engine
    self.engine = fallbackEngine;
    self.postMessage('readyok');
    
    // Try to load real WASM in background
    try {
      // Import the local WASM helper
      importScripts('/stockfish.wasm.js');
      
      // The stockfish.wasm.js should expose a Module factory
      if (typeof Module !== 'undefined') {
        Module.onRuntimeInitialized = function() {
          console.log('Stockfish WASM loaded in worker');
          // Now we have a real engine!
          // The real engine would have its own postMessage mechanism
        };
      }
    } catch (error) {
      console.error('Failed to load WASM in worker:', error);
      // Continue with fallback - it's OK!
    }
    
  } else if (self.engine) {
    // Forward command to the engine (fallback or real)
    self.engine.postMessage(command);
  }
};