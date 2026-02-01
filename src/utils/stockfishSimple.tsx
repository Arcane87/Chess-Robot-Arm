// Simple Stockfish wrapper that mimics the OG Lichess API pattern

export class SimpleStockfish {
  private isReady: boolean = false;
  private worker: Worker | null = null;
  
  constructor() {
    this.init();
  }
  
  private init() {
    // Simulate Stockfish initialization
    setTimeout(() => {
      this.isReady = true;
      console.log("Stockfish ready (simulated)");
    }, 1000);
  }
  
  async getMove(fen: string, timeMs: number = 1000): Promise<string | null> {
    if (!this.isReady) {
      console.warn("Stockfish not ready");
      return null;
    }
    
    // Simulate thinking time and return a simple move
    return new Promise((resolve) => {
      setTimeout(() => {
        const moves = ['e2e4', 'd2d4', 'g1f3', 'b1c3', 'e2e3'];
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        console.log("Stockfish playing:", randomMove);
        resolve(randomMove);
      }, 1000);
    });
  }
  
  reset() {
    this.isReady = true;
  }
}

let instance: SimpleStockfish | null = null;

export const getStockfish = (): SimpleStockfish => {
  if (!instance) {
    instance = new SimpleStockfish();
  }
  return instance;
};

export const getStockfishEvaluation = async (fen: string): Promise<number | null> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const randomEval = (Math.random() - 0.5) * 3;
      resolve(randomEval);
    }, 500);
  });
};