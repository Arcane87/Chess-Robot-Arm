import { renderState } from "./render/renderState";
import * as tf from "@tensorflow/tfjs-core";
import { getInvTransform, transformBoundary, transformCenters } from "./warp";
import { gameUpdate, makeUpdatePayload } from "../slices/gameSlice";
import { getBoxesAndScores, getInput, getXY, invalidVideo } from "./detect";
import {  Mode, MovesData, MovesPair, DeviceType } from "../types";
import { zeros } from "./math";
import { CORNER_KEYS, SQUARE_MAP } from "./constants";
import { Chess } from "chess.js";
import { processChessboardCoordinates, setupCLI } from './transformPoses';
import { clearPieceBaseBuffer } from './robotMoveExecutor';
import { MODEL_WIDTH, MODEL_HEIGHT, LABELS, PALETTE} from "../utils/constants";

const calculateScore = (state: any, move: MovesData, from_thr=0.6, to_thr=0.6) => {
  let score = 0;
  move.from.forEach(square => {
    score += 1 - Math.max(...state[square]) - from_thr;
  })

  for (let i = 0; i < move.to.length; i++) {
    score += state[move.to[i]][move.targets[i]] - to_thr;
  }

  return score
}

const processState = (state: any, movesPairs: MovesPair[], possibleMoves: Set<string>): {
  bestScore1: number, bestScore2: number, bestJointScore: number, 
  bestMove: MovesData | null, bestMoves: MovesData | null
} => {
  let bestScore1 = Number.NEGATIVE_INFINITY;
  let bestScore2 = Number.NEGATIVE_INFINITY;
  let bestJointScore = Number.NEGATIVE_INFINITY;
  let bestMove: MovesData | null = null;
  let bestMoves: MovesData | null = null;
  const seen: Set<string> = new Set();

  movesPairs.forEach(movePair => {
    if (!(movePair.move1.sans[0] in seen)) {
      seen.add(movePair.move1.sans[0]);
      const score = calculateScore(state, movePair.move1);
      if (score > 0) {
        possibleMoves.add(movePair.move1.sans[0]);
      }
      if (score > bestScore1) {
        bestMove = movePair.move1;
        bestScore1 = score;
      }
    }

    if ((movePair.move2 === null) || (movePair.moves === null) || !(possibleMoves.has(movePair.move1.sans[0]))) {
      return;
    }
    
    const score2: number = calculateScore(state, movePair.move2);
    if (score2 < 0) {
      return;
    } else if (score2 > bestScore2) {
      bestScore2 = score2;
    }

    const jointScore: number = calculateScore(state, movePair.moves);
    if (jointScore > bestJointScore) {
      bestJointScore = jointScore;
      bestMoves = movePair.moves;
    }
  })

  return {bestScore1, bestScore2, bestJointScore, bestMove, bestMoves};
}

const getBoxCenters = (boxes: tf.Tensor2D) => {
  const boxCenters: tf.Tensor2D = tf.tidy(() => {
    const l: tf.Tensor2D = tf.slice(boxes, [0, 0], [-1, 1]);
    const r: tf.Tensor2D = tf.slice(boxes, [0, 2], [-1, 1]);
    const b: tf.Tensor2D = tf.slice(boxes, [0, 3], [-1, 1]);
    const cx: tf.Tensor2D = tf.div(tf.add(l, r), 2);
    const cy: tf.Tensor2D = tf.sub(b, tf.div(tf.sub(r, l), 3));
    const boxCenters: tf.Tensor2D = tf.concat([cx, cy], 1);
    return boxCenters;
  })
  return boxCenters;
}

export const getSquares = (boxes: tf.Tensor2D, centers3D: tf.Tensor3D, boundary3D: tf.Tensor3D): number[] => {
  const squares: number[] = tf.tidy(() => {
    const boxCenters3D: tf.Tensor3D = tf.expandDims(getBoxCenters(boxes), 1);
    const dist: tf.Tensor2D = tf.sum(tf.square(tf.sub(boxCenters3D, centers3D)), 2);
    const squares: any = tf.argMin(dist, 1);

    const shiftedBoundary3D: tf.Tensor3D = tf.concat([
      tf.slice(boundary3D, [0, 1, 0], [1, 3, 2]),
      tf.slice(boundary3D, [0, 0, 0], [1, 1, 2]),
    ], 1);

    const nBoxes: number = boxCenters3D.shape[0];
    
    const a: tf.Tensor2D = tf.squeeze(tf.sub(
      tf.slice(boundary3D, [0, 0, 0], [1, 4, 1]),
      tf.slice(shiftedBoundary3D, [0, 0, 0], [1, 4, 1])
    ), [2]);
    const b: tf.Tensor2D = tf.squeeze(tf.sub(
      tf.slice(boundary3D, [0, 0, 1], [1, 4, 1]),
      tf.slice(shiftedBoundary3D, [0, 0, 1], [1, 4, 1])
    ), [2]);
    const c: tf.Tensor2D = tf.squeeze(tf.sub(
      tf.slice(boxCenters3D, [0, 0, 0], [nBoxes, 1, 1]),
      tf.slice(shiftedBoundary3D, [0, 0, 0], [1, 4, 1])
    ), [2]);
    const d: tf.Tensor2D = tf.squeeze(tf.sub(
      tf.slice(boxCenters3D, [0, 0, 1], [nBoxes, 1, 1]),
      tf.slice(shiftedBoundary3D, [0, 0, 1], [1, 4, 1])
    ), [2]);
    
    const det: tf.Tensor2D = tf.sub(tf.mul(a, d), tf.mul(b, c));
    const newSquares: tf.Tensor1D = tf.where(
      tf.any(tf.less(det, 0), 1), 
      tf.scalar(-1), 
      squares
    );
    
    return newSquares.arraySync();
  });

  return squares;
}

export const getUpdate = (scoresTensor: tf.Tensor2D, squares: number[]) => {
  const update: number[][] = zeros(64, 12);
  const scores: number[][] = scoresTensor.arraySync();

  for (let i = 0; i < squares.length; i++) {
    const square = squares[i];
    if (square == -1) {
      continue;
    }
    for (let j = 0; j < 12; j++) {
      update[square][j] = Math.max(update[square][j], scores[i][j])
    }
  }
  return update;
}

const updateState = (state: number[][], update: number[][], decay: number=0.5) => {
  for (let i = 0; i < 64; i++) {
    for (let j = 0; j < 12; j++) {
      state[i][j] = decay * state[i][j] + (1 - decay) * update[i][j]
    }
  }
  return state
}

const sanToLan = (board: Chess, san: string): string => {
  board.move(san);
  const history: any = board.history({ verbose: true });
  const lan: string = history[history.length - 1].lan;
  board.undo();
  return lan;
}

// Function to log corner square centers to console AND process transformations
const logCornerCenters = (centers: number[][]) => {
  if (!centers || centers.length < 64) {
    console.error("Centers array is not valid");
    return;
  }

  // Get the four corner square centers (A1, H1, H8, A8)
  const a1Index = 0;   // A1
  const h1Index = 7;   // H1
  const h8Index = 63;  // H8
  const a8Index = 56;  // A8
  
  const cornerCenters = {
    a1: centers[a1Index],
    h1: centers[h1Index],
    h8: centers[h8Index],
    a8: centers[a8Index]
  };

  console.log("=== Corner Square Centers ===");
  console.log("Copy this JSON to save it:");
  console.log(JSON.stringify(cornerCenters, null, 2));
  console.log("=============================");
  
  // Process all coordinates for robot transformation
  processChessboardCoordinates(centers).then(() => {
    console.log("Square coordinate transformation completed!");
    console.log("You can now access robot coordinates in the console.");
  }).catch(error => {
    console.error("Failed to process coordinates:", error);
  });
  
  // Setup CLI interface for testing
  setupCLI();
};

export const detect = async (modelRef: any, videoRef: any, keypoints: number[][], deviceType: DeviceType = 'webcam', droidcamCanvasRef?: any): 
  Promise<{boxes: tf.Tensor2D, scores: tf.Tensor2D}> => {
  
  // For DroidCam with worker, check if canvas has content before processing
  if (deviceType === 'droidcam' && droidcamCanvasRef?.current) {
    const ctx = droidcamCanvasRef.current.getContext('2d');
    if (ctx) {
      // Check if canvas is empty or hasn't been drawn to yet
      const imageData = ctx.getImageData(0, 0, 1, 1).data;
      // Check if canvas is empty (all zeros or undefined)
      if (imageData[0] === 0 && imageData[1] === 0 && imageData[2] === 0) {
        // Return empty tensors to skip this frame
        return {
          boxes: tf.tensor2d([], [0, 4]),
          scores: tf.tensor2d([], [0, 12])
        };
      }
    }
  }

  const getInput = (videoRef: any, keypoints: number[][] | null=null, paddingRatio: number=12, deviceType: DeviceType = 'webcam', droidcamCanvasRef?: any): {
    image4D: tf.Tensor4D, width: number, height: number, padding: number[], roi: number[]
  } => {
    let roi: number[];
    let videoWidth: number, videoHeight: number;
    let sourceElement: any;
    
    if (deviceType === 'droidcam' && droidcamCanvasRef?.current) {
      // Use the DroidCam canvas as the source
      sourceElement = droidcamCanvasRef.current;
      videoWidth = sourceElement.width;
      videoHeight = sourceElement.height;
    } else {
      sourceElement = videoRef.current;
      videoWidth = sourceElement.videoWidth;
      videoHeight = sourceElement.videoHeight;
    }
    
    // Early return if source has no dimensions
    if (videoWidth === 0 || videoHeight === 0) {
      // Return dummy values to avoid errors
      const dummyTensor: tf.Tensor4D = tf.zeros([1, MODEL_HEIGHT, MODEL_WIDTH, 3]) as tf.Tensor4D;
      return {
        image4D: dummyTensor,
        width: MODEL_WIDTH,
        height: MODEL_HEIGHT,
        padding: [0, 0, 0, 0],
        roi: [0, 0, MODEL_WIDTH, MODEL_HEIGHT]
      };
    }
    
    if (keypoints !== null) {
      const bbox = getBbox(keypoints);
      let paddingLeft: number = Math.floor(bbox.width / paddingRatio);
      let paddingRight: number = Math.floor(bbox.width / paddingRatio);
      let paddingTop: number = Math.floor(bbox.height / paddingRatio);
      const paddingBottom: number = Math.floor(bbox.height / paddingRatio)

      const paddedRoiWidth: number = bbox.width + paddingLeft + paddingRight;
      const paddedRoiHeight: number = bbox.height + paddingTop + paddingBottom;
      const ratio: number = paddedRoiHeight / paddedRoiWidth;
      const desiredRatio: number = MODEL_HEIGHT / MODEL_WIDTH;

      if (ratio > desiredRatio) {
          const targetWidth: number = paddedRoiHeight / desiredRatio;
          const dx: number = targetWidth - paddedRoiWidth;
          paddingLeft += Math.floor(dx / 2);
          paddingRight += dx - Math.floor(dx / 2);
      } else {
          const targetHeight: number = paddedRoiWidth * desiredRatio;
          paddingTop += targetHeight - paddedRoiHeight;
      }
      roi = [Math.round(Math.max(videoWidth * (bbox.xmin - paddingLeft) / MODEL_WIDTH, 0)),
        Math.round(Math.max(videoHeight * (bbox.ymin - paddingTop) / MODEL_HEIGHT, 0)),
        Math.round(Math.min(videoWidth * (bbox.xmax + paddingRight) / MODEL_WIDTH, videoWidth)),
        Math.round(Math.min(videoHeight * (bbox.ymax + paddingBottom) / MODEL_HEIGHT, videoHeight))]
    } else {
      roi = [0, 0, videoWidth, videoHeight];
    }
    
    const [image4D, width, height, padding]: [tf.Tensor4D, number, number, number[]] = tf.tidy(() => {
      let image: tf.Tensor3D;
      
      if (deviceType === 'droidcam' && droidcamCanvasRef?.current) {
        // Use DroidCam video from the worker canvas
        image = tf.browser.fromPixels(droidcamCanvasRef.current);
      } else {
        // Use webcam video
        image = tf.browser.fromPixels(videoRef.current);
      }
      
      // Cropping
      image = tf.slice(image,
        [roi[1], roi[0], 0], 
        [roi[3] - roi[1], roi[2] - roi[0], 3]
      );
      const height: number = image.shape[0];
      const width: number = image.shape[1];
      
      // Resizing
      const ratio: number = height / width;
      const desiredRatio: number = MODEL_HEIGHT / MODEL_WIDTH;
      let resizeHeight: number = MODEL_HEIGHT;
      let resizeWidth: number = MODEL_WIDTH;
      if (ratio > desiredRatio) {
        resizeWidth = Math.round(MODEL_HEIGHT / ratio); 
      } else {
        resizeHeight = Math.round(MODEL_WIDTH * ratio);
      }
      image = tf.image.resizeBilinear(image, [resizeHeight, resizeWidth]);

      // Padding
      const dx: number = MODEL_WIDTH - image.shape[1];
      const dy: number = MODEL_HEIGHT - image.shape[0];
      const padRight: number = Math.floor(dx / 2);
      const padLeft: number = dx - padRight
      const padBottom: number = Math.floor(dy / 2);
      const padTop: number = dy - padBottom;
      const padding: number[] = [padLeft, padRight, padTop, padBottom]
      image = tf.pad(image, [
        [padTop, padBottom],
        [padLeft, padRight],
        [0, 0]
      ], 114);
      
      // Transpose + scale + expand
      const image4D: tf.Tensor4D = tf.expandDims(tf.div(image, 255.0), 0) as tf.Tensor4D;

      return [image4D, width, height, padding];
    });
    return {image4D, width, height, padding, roi}
  };

  const getBbox = (points: number[][]) => {
    const xs: number[] = points.map(p => p[0]);
    const ys: number[] = points.map(p => p[1]);
    const xmin: number = Math.min(...xs);
    const xmax: number = Math.max(...xs);
    const ymin: number = Math.min(...ys);
    const ymax: number = Math.max(...ys);

    const width: number = xmax - xmin;
    const height: number = ymax - ymin;

    const bbox: any = {
      "xmin": xmin,
      "xmax": xmax,
      "ymin": ymin,
      "ymax": ymax,
      "width": width,
      "height": height
    }

    return bbox
  }

  const {image4D, width, height, padding, roi} = getInput(videoRef, keypoints, 12, deviceType, droidcamCanvasRef);
  let videoWidth: number, videoHeight: number;
  let sourceElement: any;
  
  if (deviceType === 'droidcam' && droidcamCanvasRef?.current) {
    sourceElement = droidcamCanvasRef.current;
    videoWidth = sourceElement.videoWidth || sourceElement.width;
    videoHeight = sourceElement.videoHeight || sourceElement.height;
  } else {
    sourceElement = videoRef.current;
    videoWidth = sourceElement.videoWidth;
    videoHeight = sourceElement.videoHeight;
  }
  
  // Skip processing if no valid dimensions
  if (videoWidth === 0 || videoHeight === 0) {
    tf.dispose([image4D]);
    return {
      boxes: tf.tensor2d([], [0, 4]),
      scores: tf.tensor2d([], [0, 12])
    };
  }
  
  const preds: tf.Tensor3D = modelRef.current.predict(image4D);
  const {boxes, scores} = getBoxesAndScores(preds, width, height, videoWidth, videoHeight, padding, roi);
  
  tf.dispose([image4D, preds]);

  return {boxes, scores}
}

export const getKeypoints = (cornersRef: any, canvasRef: any): number[][] => {
  const keypoints = CORNER_KEYS.map(x =>
    getXY(cornersRef.current[x], canvasRef.current.height, canvasRef.current.width)
  );
  return keypoints
}

export const findPieces = (modelRef: any, videoRef: any, canvasRef: any,
playingRef: any, setText: any, dispatch: any, cornersRef: any, boardRef: any, 
movesPairsRef: any, lastMoveRef: any, moveTextRef: any, mode: Mode,
stockfishMoveRef?: any, deviceType: DeviceType = 'webcam', droidcamVideoRef?: any, droidcamUrl?: string) => {
  let centers: number[][] | null = null;
  let boundary: number[][];
  let centers3D: tf.Tensor3D;
  let boundary3D: tf.Tensor3D;
  let state: number[][];
  let keypoints: number[][];
  let possibleMoves: Set<string>;
  let requestId: number;
  let greedyMoveToTime: { [move: string] : number};
  let hasLoggedCornerCenters = false; // Flag to track if we've logged corner centers

  // Buffer for averaging piece base coordinates
  const pieceBaseBuffer: {
    source: number[][];
    captured: number[][];
    moveKey: string;
    collecting: boolean;
    framesCollected: number;
  } = {
    source: [],
    captured: [],
    moveKey: '',
    collecting: false,
    framesCollected: 0
  };

  // Ref to track last logged move to avoid repetitive logs
  const lastLoggedMoveRef = { current: '' };

  const loop = async () => {
    if (playingRef.current === false || invalidVideo(videoRef, deviceType)) {
      centers = null
    } else {
      if (centers === null) {
        keypoints = getKeypoints(cornersRef, canvasRef);
        const invTransform = getInvTransform(keypoints);
        [centers, centers3D] = transformCenters(invTransform);
        [boundary, boundary3D] = transformBoundary(invTransform);
        state = zeros(64, 12);
        possibleMoves = new Set<string>;
        greedyMoveToTime = {};
        
        // Log corner centers to console once when centers are first computed
        // AND process transformations for robot coordinates
        if (!hasLoggedCornerCenters && centers && centers.length >= 64) {
          logCornerCenters(centers);
          hasLoggedCornerCenters = true;
          
          // Add message to display
          setText((prev: string[]) => {
            const newText = [...prev];
            if (newText.length > 2) {
              // Keep FPS and move text, add our message
              newText[2] = "Corner centers logged & robot coordinates calculated";
            } else {
              newText.push("Corner centers logged & robot coordinates calculated");
            }
            return newText;
          });
        }
      }
      const startTime: number = performance.now();
      const startTensors: number = tf.memory().numTensors;

      const {boxes, scores} = await detect(modelRef, videoRef, keypoints, deviceType, droidcamVideoRef);
      const squares: number[] = getSquares(boxes, centers3D, boundary3D);
      
      // Get box centers (piece base coordinates)
      const boxCenters = getBoxCenters(boxes);
      const boxCentersArray = boxCenters.arraySync();
      tf.dispose(boxCenters);
      
      // Create a map from square to piece base coordinate
      const squareToPieceBase: {[square: number]: number[]} = {};
      for (let i = 0; i < squares.length; i++) {
        const square = squares[i];
        if (square !== -1) {
          squareToPieceBase[square] = boxCentersArray[i];
        }
      }
      
      const update: number[][] = getUpdate(scores, squares);
      state = updateState(state, update);
      const {bestScore1, bestScore2, bestJointScore, bestMove, bestMoves} = processState(state, movesPairsRef.current, possibleMoves);

      const endTime: number = performance.now();
      const fps: string = (1000 / (endTime - startTime)).toFixed(1);
      
      let hasMove: boolean = false;
      if ((bestMoves !== null) && (mode !== "play")) {
        const move: string = bestMoves.sans[0];
        hasMove = (bestScore2 > 0) && (bestJointScore > 0) && (possibleMoves.has(move));
        if (hasMove) {
          boardRef.current.move(move);
          possibleMoves.clear();
          greedyMoveToTime = {};
        }
      }

      let hasGreedyMove: boolean = false;
      if (bestMove !== null && !(hasMove) && (bestScore1 > 0)) {
        const move: string = bestMove.sans[0];
        if (!(move in greedyMoveToTime)) { 
          greedyMoveToTime[move] = endTime;
        }

        const secondElapsed = (endTime - greedyMoveToTime[move]) > 1000;
        const newMove = sanToLan(boardRef.current, move) !== lastMoveRef.current;
        hasGreedyMove = secondElapsed && newMove;
        if (hasGreedyMove) {
          boardRef.current.move(move);
          greedyMoveToTime = {greedyMove: greedyMoveToTime[move]};
        }
      }
      
      if (hasMove || hasGreedyMove) {
        // No takebacks in "play" mode
        const greedy = (mode === "play") ? false : hasGreedyMove;
        const payload = makeUpdatePayload(boardRef.current, greedy);
        console.log("payload", payload);
        dispatch(gameUpdate(payload));
      }
      
      // Calculate stockfish move coordinates if available
      let stockfishMoveCoords: { 
        sourceCoord?: number[]; 
        destCoord?: number[]; 
        sourcePieceBaseCoord?: number[];
        capturedPieceBaseCoord?: number[];
        isCapture?: boolean;
        capturedSquare?: string;
        sourceSquare?: string;
      } = {};
      
      if (stockfishMoveRef?.current?.uciMove && centers) {
        const move = stockfishMoveRef.current.uciMove;
        const isCapture = stockfishMoveRef.current.isCapture || false;
        const capturedSquare = stockfishMoveRef.current.capturedSquare || "";
        
        // Only log when move changes to avoid repetitive logs
        if (move !== lastLoggedMoveRef.current) {
          console.log("Stockfish move:", move, "Is capture:", isCapture, "Captured square:", capturedSquare);
          lastLoggedMoveRef.current = move;
        }
        
        const fromSquare = move.substring(0, 2);
        const toSquare = move.substring(2, 4);
        const fromIndex = SQUARE_MAP[fromSquare];
        const toIndex = SQUARE_MAP[toSquare];
        
        if (fromIndex !== undefined && toIndex !== undefined && 
            fromIndex < centers.length && toIndex < centers.length) {
          
          // Get the actual piece base coordinate from the detected piece
          const sourcePieceBaseCoord = squareToPieceBase[fromIndex];
          
          // Get captured piece base coordinate if it's a capture
          let capturedPieceBaseCoord = undefined;
          if (isCapture && capturedSquare) {
            const capturedSquareIndex = SQUARE_MAP[capturedSquare];
            if (capturedSquareIndex !== undefined) {
              capturedPieceBaseCoord = squareToPieceBase[capturedSquareIndex];
            }
          }
          
          // Use actual piece base coordinate if available, otherwise fall back to square center
          stockfishMoveCoords = {
            sourceCoord: centers[fromIndex],
            destCoord: centers[toIndex],
            sourcePieceBaseCoord: sourcePieceBaseCoord || centers[fromIndex],
            capturedPieceBaseCoord: capturedPieceBaseCoord,
            isCapture,
            capturedSquare,
            sourceSquare: fromSquare
          };
          
          // Update the ref with actual coordinates
          stockfishMoveRef.current = {
            ...stockfishMoveRef.current,
            sourceCoord: centers[fromIndex],
            destCoord: centers[toIndex],
            sourcePieceBaseCoord: sourcePieceBaseCoord || centers[fromIndex],
            capturedPieceBaseCoord: capturedPieceBaseCoord,
            isCapture,
            capturedSquare,
            sourceSquare: fromSquare
          };
          
          // Collect piece base coordinates for averaging (first 5 frames)
          if (sourcePieceBaseCoord) {
            // Check if this is a new move
            if (pieceBaseBuffer.moveKey !== move) {
              // New move, reset buffer
              pieceBaseBuffer.source = [];
              pieceBaseBuffer.captured = [];
              pieceBaseBuffer.moveKey = move;
              pieceBaseBuffer.collecting = true;
              pieceBaseBuffer.framesCollected = 0;
              
              // Clear any previous buffer
              clearPieceBaseBuffer(move);
            }
            
            if (pieceBaseBuffer.collecting && pieceBaseBuffer.framesCollected < 5) {
              // Add current frame's coordinates to buffer
              pieceBaseBuffer.source.push(sourcePieceBaseCoord);
              
              if (isCapture && capturedPieceBaseCoord) {
                pieceBaseBuffer.captured.push(capturedPieceBaseCoord);
              }
              
              pieceBaseBuffer.framesCollected++;
              
              // After 5 frames, average and store
              if (pieceBaseBuffer.framesCollected >= 5) {
                // Average source coordinates
                const sourceSum = pieceBaseBuffer.source.reduce(
                  (acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]], 
                  [0, 0]
                );
                const sourceAvg = sourceSum.map(val => val / pieceBaseBuffer.source.length);
                
                // Average captured coordinates if available
                let capturedAvg;
                if (pieceBaseBuffer.captured.length >= 5) {
                  const capturedSum = pieceBaseBuffer.captured.reduce(
                    (acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]], 
                    [0, 0]
                  );
                  capturedAvg = capturedSum.map(val => val / pieceBaseBuffer.captured.length);
                }
                
                // Store averaged coordinates
                stockfishMoveRef.current = {
                  ...stockfishMoveRef.current,
                  averagedSourcePieceBase: sourceAvg,
                  averagedCapturedPieceBase: capturedAvg,
                  readyForExecution: true,
                  sourceSquareNumber: fromIndex + 1, // Convert to 1-64
                  destSquareNumber: toIndex + 1, // Convert to 1-64
                  collectedFrames: pieceBaseBuffer.framesCollected
                };
                
                pieceBaseBuffer.collecting = false;
                
                // Update UI text
                setText((prev: string[]) => {
                  const newText = [...prev];
                  // Replace or add the message at index 2
                  if (newText.length > 2) {
                    newText[2] = `Robot move ready! (${pieceBaseBuffer.framesCollected} frames averaged)`;
                  } else {
                    newText.push(`Robot move ready! (${pieceBaseBuffer.framesCollected} frames averaged)`);
                  }
                  return newText;
                });
              }
            }
          }
        }
      }
      
      // Prepare text with coordinates if stockfish move is available
      let displayText = [`FPS: ${fps}`, moveTextRef.current];
      
      // Add device type indicator
      if (deviceType === 'droidcam') {
        displayText.push(`Device: DroidCam`);
      }
      
      // Add stockfish move coordinates if available
      if (stockfishMoveCoords.sourceCoord && stockfishMoveCoords.destCoord) {
        const { sourceCoord, destCoord, sourcePieceBaseCoord, capturedPieceBaseCoord, isCapture } = stockfishMoveCoords;
        
        // Display square center coordinates (as before)
        displayText.push(`Src Square: (${sourceCoord[0].toFixed(0)}, ${sourceCoord[1].toFixed(0)})`);
        displayText.push(`Dst Square: (${destCoord[0].toFixed(0)}, ${destCoord[1].toFixed(0)})`);
        
        // Add piece base coordinates if available
        if (sourcePieceBaseCoord) {
          displayText.push(`Piece Base: (${sourcePieceBaseCoord[0].toFixed(0)}, ${sourcePieceBaseCoord[1].toFixed(0)})`);
        }
        
        // Add captured piece base coordinates if available
        if (isCapture && capturedPieceBaseCoord) {
          displayText.push(`Captured Piece: (${capturedPieceBaseCoord[0].toFixed(0)}, ${capturedPieceBaseCoord[1].toFixed(0)})`);
        }
        
        // Add collection status if collecting
        if (pieceBaseBuffer.collecting) {
          displayText.push(`Collecting: ${pieceBaseBuffer.framesCollected}/5 frames`);
        }
      }
      
      setText(displayText);
      
      renderState(canvasRef.current, centers, boundary, state, stockfishMoveCoords);

      tf.dispose([boxes, scores]);

      const endTensors: number = tf.memory().numTensors;
      if (startTensors < endTensors) {
        console.error(`Memory Leak! (${endTensors} > ${startTensors})`)
      }
    }
    requestId = requestAnimationFrame(loop);
  }
  requestId = requestAnimationFrame(loop);

  return () => {
    tf.disposeVariables();
    if (requestId) {
      window.cancelAnimationFrame(requestId);
    }
  };
};