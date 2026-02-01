import { Chess } from "chess.js";
import { getStockfishMove } from "./stockfish";

export interface StockfishMoveResult {
  move: string | null;
  // Remove evaluation and mateIn since we don't have them in the current implementation
}

export class StockfishGame {
  private board: Chess;
  private isCalculating: boolean = false;
  
  constructor(fen?: string) {
    this.board = fen ? new Chess(fen) : new Chess();
  }
  
  getFen(): string {
    return this.board.fen();
  }
  
  getTurn(): 'w' | 'b' {
    return this.board.turn();
  }
  
  // Check if it's Stockfish's turn (Stockfish always plays opposite of player)
  isStockfishTurn(playerColor: 'w' | 'b'): boolean {
    return this.board.turn() !== playerColor;
  }
  
  // Make a move (from player or from previous Stockfish calculation)
  makeMove(moveUci: string): boolean {
    try {
      const move = this.board.move(moveUci);
      return !!move;
    } catch (error) {
      console.error('Invalid move:', error);
      return false;
    }
  }
  
  // Get Stockfish's move - returns only move, no evaluation in current implementation
  async getEngineMove(timeMs: number = 1000): Promise<StockfishMoveResult> {
    if (this.isCalculating) {
      console.warn('Stockfish already calculating');
      return { move: null };
    }
    
    this.isCalculating = true;
    
    const move = await getStockfishMove(this.board.fen(), timeMs);
    
    this.isCalculating = false;
    
    return { move };
  }
  
  reset() {
    this.board.reset();
  }
  
  loadFen(fen: string): boolean {
    try {
      this.board = new Chess(fen);
      return true;
    } catch (error) {
      console.error('Invalid FEN:', error);
      return false;
    }
  }
}

// Singleton instance
let gameInstance: StockfishGame | null = null;

export const getStockfishGame = (): StockfishGame => {
  if (!gameInstance) {
    gameInstance = new StockfishGame();
  }
  return gameInstance;
};