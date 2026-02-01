import { LABELS, PALETTE, MODEL_WIDTH, MODEL_HEIGHT } from "../constants";
import { setupCtx, drawBox, drawPoints, drawPolygon } from "./common";

interface StockfishMoveCoords {
  sourceCoord?: number[];
  destCoord?: number[];
  sourcePieceBaseCoord?: number[];
  capturedPieceBaseCoord?: number[];
  isCapture?: boolean;
  capturedSquare?: string;
  sourceSquare?: string;
}

export const renderState = (canvasRef: any, centers: number[][], boundary: number[][], state: number[][], stockfishMove?: StockfishMoveCoords) => {
  const [ctx, fontHeight, lineWidth, sx, sy] = setupCtx(canvasRef);

  console.log("DEBUG RENDER: Canvas size:", canvasRef.width, canvasRef.height);
  console.log("DEBUG RENDER: Scaling factors sx, sy:", sx, sy);
  console.log("DEBUG RENDER: Model dimensions:", MODEL_WIDTH, MODEL_HEIGHT);
  
  drawPoints(ctx, centers, "blue", sx, sy);
  drawPolygon(ctx, boundary, "blue", sx, sy);

  for (let i = 0; i < 64; i++) {
    let bestScore = 0.1;
    let bestPiece = -1;
    for (let j = 0; j < 12; j++) {
      if (state[i][j] > bestScore) {
        bestScore = state[i][j];
        bestPiece = j;
      }
    }

    if (bestPiece === -1) {
      continue;
    }
    
    const color = PALETTE[bestPiece % PALETTE.length];
    const text: string = `${LABELS[bestPiece]}:${Math.round(100 * bestScore)}`;

    drawBox(ctx, color, centers[i][0] * sx, centers[i][1] * sy, text, fontHeight, lineWidth);
  }

  // Draw stockfish move dots if available
  if (stockfishMove) {
    console.log("DEBUG RENDER: Stockfish move available:", stockfishMove);
    const { sourceCoord, destCoord, sourcePieceBaseCoord, capturedPieceBaseCoord, isCapture } = stockfishMove;
    
    // Draw source piece base (bright blue with black outline)
    if (sourcePieceBaseCoord && sourcePieceBaseCoord.length === 2) {
      const x = sourcePieceBaseCoord[0] * sx;
      const y = sourcePieceBaseCoord[1] * sy;
      console.log("DEBUG RENDER: Drawing piece base at (canvas):", x, y, "from model:", sourcePieceBaseCoord);
      
      // Draw a larger, more visible blue dot for piece base
      ctx.strokeStyle = '#000000'; // Black outline
      ctx.lineWidth = 3;
      ctx.fillStyle = '#0000FF'; // Bright blue for piece base
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2); // Larger radius
      ctx.fill();
      ctx.stroke();
      
      // Draw label
      ctx.fillStyle = '#FFFFFF'; // White text
      ctx.font = 'bold 16px Arial';
      ctx.fillText('B', x - 4, y - 8);
    }
    
    // Draw captured piece base (orange with black outline) - only for captures
    if (isCapture && capturedPieceBaseCoord && capturedPieceBaseCoord.length === 2) {
      const x = capturedPieceBaseCoord[0] * sx;
      const y = capturedPieceBaseCoord[1] * sy;
      console.log("DEBUG RENDER: Drawing captured piece base at (canvas):", x, y, "from model:", capturedPieceBaseCoord);
      
      // Draw an orange dot for captured piece base
      ctx.strokeStyle = '#000000'; // Black outline
      ctx.lineWidth = 3;
      ctx.fillStyle = '#FFA500'; // Orange for captured piece base
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2); // Larger radius
      ctx.fill();
      ctx.stroke();
      
      // Draw label
      ctx.fillStyle = '#000000'; // Black text for better contrast on orange
      ctx.font = 'bold 16px Arial';
      ctx.fillText('C', x - 4, y - 8);
    }
    
    // Draw source square (pink with black outline) - original behavior
    if (sourceCoord && sourceCoord.length === 2) {
      const x = sourceCoord[0] * sx;
      const y = sourceCoord[1] * sy;
      console.log("DEBUG RENDER: Drawing source square at (canvas):", x, y, "from model:", sourceCoord);
      
      // Draw a pink dot for square center
      ctx.strokeStyle = '#000000'; // Black outline
      ctx.lineWidth = 3;
      ctx.fillStyle = '#FF00FF'; // Bright pink
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2); // Medium radius
      ctx.fill();
      ctx.stroke();
      
      // Draw label
      ctx.fillStyle = '#FFFFFF'; // White text
      ctx.font = 'bold 16px Arial';
      ctx.fillText('S', x - 4, y - 8);
    }
    
    // Draw destination dot (green with black outline)
    if (destCoord && destCoord.length === 2) {
      const x = destCoord[0] * sx;
      const y = destCoord[1] * sy;
      console.log("DEBUG RENDER: Drawing destination at (canvas):", x, y, "from model:", destCoord);
      
      // Draw a green dot for destination
      ctx.strokeStyle = '#000000'; // Black outline
      ctx.lineWidth = 3;
      ctx.fillStyle = '#00FF00'; // Bright green
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2); // Medium radius
      ctx.fill();
      ctx.stroke();
      
      // Draw label
      ctx.fillStyle = '#FFFFFF'; // White text
      ctx.font = 'bold 16px Arial';
      ctx.fillText('D', x - 4, y - 8);
    }
  } else {
    console.log("DEBUG RENDER: No stockfish move to render");
  }
};