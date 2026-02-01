import { useEffect, useState } from "react";
import { Chessboard } from "kokopu-react";
import { Chess } from "chess.js";

const Board = ({ pgn }: { pgn: string }) => {
  const [fen, setFen] = useState<string>("");

  useEffect(() => {
    try {
      const chess = new Chess();
      if (pgn.includes("[FEN")) {
        // Extract FEN from PGN header
        const fenMatch = pgn.match(/\[FEN "([^"]+)"\]/);
        if (fenMatch) {
          chess.load(fenMatch[1]);
        }
      }
      chess.loadPgn(pgn);
      setFen(chess.fen());
    } catch (error) {
      console.error("Error parsing PGN:", error);
      setFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    }
  }, [pgn]);

  return (
    <div className="ratio ratio-21x9 d-flex justify-content-center align-items-center">
      <div style={{ width: "100%", height: "100%" }}>
        <Chessboard 
          position={fen}
          squareSize={40}
          coordinateVisible={true}
          turnVisible={true}
        />
      </div>
    </div>
  );
}

export default Board;