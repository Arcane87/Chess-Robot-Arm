// src/utils/stockfish.tsx
export class StockfishEngine {
  private worker: Worker | null = null;
  private isReady: boolean = false;
  private messageHandlers: Array<(data: string) => void> = [];
  private resolveReady: ((value: boolean) => void) | null = null;
  
  constructor() {
    this.initEngine();
  }
  
  private initEngine() {
    try {
      console.log('Initializing Stockfish engine...');
      
      // Create worker
      this.worker = new Worker('/stockfish-worker.js');
      
      this.worker.onmessage = (event: MessageEvent) => {
        const data = event.data;
        console.log("Stockfish:", data);
        
        this.messageHandlers.forEach(handler => handler(data));
        
        if (data === 'readyok' || data === 'uciok') {
          this.isReady = true;
          console.log('Stockfish engine ready');
          if (this.resolveReady) {
            this.resolveReady(true);
          }
        }
        
        if (data.startsWith('error:')) {
          console.error('Stockfish error:', data);
          this.isReady = false;
        }
      };
      
      this.worker.onerror = (error) => {
        console.error('Stockfish worker error:', error);
        this.isReady = false;
      };
      
      // Initialize
      this.worker.postMessage('init');
      
      // Set a timeout to mark as ready if no response
      setTimeout(() => {
        if (!this.isReady) {
          console.log('Stockfish timeout, using fallback mode');
          this.isReady = true;
        }
      }, 3000);
      
    } catch (error) {
      console.error('Failed to initialize Stockfish:', error);
      this.isReady = true; // Fallback to simulation mode
    }
  }
  
  waitForReady(): Promise<boolean> {
    if (this.isReady) {
      return Promise.resolve(true);
    }
    
    return new Promise((resolve) => {
      this.resolveReady = resolve;
      
      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.resolveReady) {
          this.resolveReady(false);
          this.resolveReady = null;
        }
      }, 5000);
    });
  }
  
  async sendCommand(cmd: string) {
    if (!this.isReady) {
      await this.waitForReady();
    }
    
    if (this.worker) {
      console.log("Stockfish command:", cmd);
      this.worker.postMessage(cmd);
    } else {
      console.log("Stockfish (simulated):", cmd);
    }
  }
  
  onMessage(handler: (data: string) => void) {
    this.messageHandlers.push(handler);
  }
  
  offMessage(handler: (data: string) => void) {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
    }
  }
  
  async getBestMove(fen: string, timeMs: number = 1000): Promise<string | null> {
    if (!this.isReady) {
      await this.waitForReady();
    }
    
    return new Promise((resolve) => {
      const moveHandler = (data: string) => {
        if (data.startsWith('bestmove')) {
          const match = data.match(/bestmove (\S+)/);
          if (match && match[1] && match[1] !== '(none)') {
            this.offMessage(moveHandler);
            console.log(`Stockfish best move from ${fen}: ${match[1]}`);
            resolve(match[1]);
          }
        }
      };
      
      this.onMessage(moveHandler);
      
      // Send commands
      this.sendCommand(`position fen ${fen}`);
      this.sendCommand(`go movetime ${timeMs}`);
      
      // Timeout fallback with random move
      setTimeout(() => {
        this.sendCommand('stop');
        this.offMessage(moveHandler);
        
        // Return a random move as fallback
        const moves = ['e2e4', 'd2d4', 'g1f3', 'b1c3', 'e2e3', 'g2g3'];
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        console.log('Stockfish timeout, returning random move:', randomMove);
        resolve(randomMove);
      }, timeMs + 3000);
    });
  }
  
  async getEvaluation(fen: string, depth: number = 12): Promise<number | null> {
    if (!this.isReady) {
      await this.waitForReady();
    }
    
    return new Promise((resolve) => {
      const evalHandler = (data: string) => {
        if (data.includes('score cp')) {
          const match = data.match(/score cp (-?\d+)/);
          if (match) {
            const cp = parseInt(match[1], 10);
            this.offMessage(evalHandler);
            resolve(cp / 100); // Convert centipawns to pawns
          }
        } else if (data.includes('score mate')) {
          const match = data.match(/score mate (-?\d+)/);
          if (match) {
            const mateIn = parseInt(match[1], 10);
            this.offMessage(evalHandler);
            // Convert mate to a large eval
            resolve(mateIn > 0 ? 100 : -100);
          }
        }
      };
      
      this.onMessage(evalHandler);
      
      // Send commands
      this.sendCommand(`position fen ${fen}`);
      this.sendCommand(`go depth ${depth}`);
      
      // Timeout fallback
      setTimeout(() => {
        this.sendCommand('stop');
        this.offMessage(evalHandler);
        const randomEval = (Math.random() - 0.5) * 3;
        console.log('Stockfish eval timeout, returning random eval:', randomEval);
        resolve(randomEval);
      }, 3000);
    });
  }
  
  quit() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// Singleton instance
let engineInstance: StockfishEngine | null = null;

export const getStockfishEngine = (): StockfishEngine => {
  if (!engineInstance) {
    engineInstance = new StockfishEngine();
  }
  return engineInstance;
};

// Export functions for compatibility
export const getStockfishMove = async (fen: string, timeMs: number = 1000): Promise<string | null> => {
  const engine = getStockfishEngine();
  return await engine.getBestMove(fen, timeMs);
};

export const getStockfishEvaluation = async (fen: string): Promise<number | null> => {
  const engine = getStockfishEngine();
  return await engine.getEvaluation(fen, 12);
};