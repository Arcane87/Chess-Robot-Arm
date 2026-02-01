import { CornersButton, Sidebar, RecordButton, StopButton, DeviceButton } from "../common";
import { Game, SetBoolean, SetStringArray, CameraDevice } from "../../types";
import { useEffect, useRef, useState, useCallback } from "react";
import { Chess, Color } from "chess.js";
import { useDispatch } from "react-redux";
import { gameSelect, gameUpdate, makeBoard, makeUpdatePayload } from "../../slices/gameSlice";
import { getStockfishEngine } from "../../utils/stockfish";
import RobotControl from "./robotControl";
import { executeRobotMove, clearPieceBaseBuffer } from "../../utils/robotMoveExecutor";
  
const PlaySidebar = ({ piecesModelRef, xcornersModelRef, videoRef, canvasRef, sidebarRef, 
  playing, setPlaying, text, setText, cornersRef, stockfishMoveRef, onDeviceChange }: {  // Added onDeviceChange
  piecesModelRef: any, xcornersModelRef: any, videoRef: any, canvasRef: any, sidebarRef: any,
  playing: boolean, setPlaying: SetBoolean, 
  text: string[], setText: SetStringArray,
  cornersRef: any,
  stockfishMoveRef: any,
  onDeviceChange?: (device: CameraDevice) => void  // Added
}) => {
  const game: Game = gameSelect();
  const [playerColor, setPlayerColor] = useState<Color>('w');
  const [isStockfishThinking, setIsStockfishThinking] = useState(false);
  const [stockfishReady, setStockfishReady] = useState(false);
  const [executingMove, setExecutingMove] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [lastExecutedMove, setLastExecutedMove] = useState<string>('');
  const dispatch = useDispatch();

  // Refs to track state without triggering re-renders
  const gameRef = useRef<Game>(game);
  const playerColorRef = useRef<Color>(playerColor);
  const playingRef = useRef<boolean>(playing);
  const stockfishEngineRef = useRef(getStockfishEngine());

  // Sync refs with state
  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    playerColorRef.current = playerColor;
  }, [playerColor]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Auto mode effect
  useEffect(() => {
    if (autoMode && 
        stockfishMoveRef.current?.readyForExecution && 
        stockfishMoveRef.current?.uciMove && 
        stockfishMoveRef.current?.uciMove !== lastExecutedMove) {
      handleExecuteRobotMove();
    }
  }, [stockfishMoveRef.current?.readyForExecution, autoMode, lastExecutedMove]);

  // Function to apply Stockfish move
  const applyStockfishMove = useCallback(async () => {
    if (!playingRef.current || isStockfishThinking || !stockfishReady) {
      return;
    }

    const currentGame = gameRef.current;
    const currentPlayerColor = playerColorRef.current;
    
    // Check if it's Stockfish's turn
    const colorToMove = currentGame.fen.split(" ")[1];
    if (colorToMove === currentPlayerColor) {
      return;
    }

    setIsStockfishThinking(true);

    try {
      const move = await stockfishEngineRef.current.getBestMove(currentGame.fen, 1000);
      
      if (move) {
        console.log(`Stockfish playing: ${move}`);
        
        const from = move.substring(0, 2);
        const to = move.substring(2, 4);
        const promotion = move.length > 4 ? move.substring(4, 5) : undefined;
        
        const board = makeBoard(currentGame);
        
        let isCapture = false;
        let capturedSquare = "";
        try {
          const moveObj = { from, to };
          if (promotion) {
            (moveObj as any).promotion = promotion;
          }
          
          const moveResult = board.move(moveObj);
          isCapture = !!moveResult.captured;
          capturedSquare = to;
          
          board.undo();
        } catch (error) {
          console.error("Error checking move:", error);
        }
        
        stockfishMoveRef.current = {
          uciMove: move,
          isCapture,
          capturedSquare: isCapture ? capturedSquare : ""
        };
        
        const board2 = makeBoard(currentGame);
        const legalMoves = board2.moves({ verbose: true });
        const isValidMove = legalMoves.some(m => 
          m.from === from && m.to === to && (!promotion || m.promotion === promotion)
        );
        
        if (isValidMove) {
          try {
            const moveObj = { from, to };
            if (promotion) {
              (moveObj as any).promotion = promotion;
            }
            
            board2.move(moveObj);
            const payload = makeUpdatePayload(board2);
            
            if (gameRef.current.fen === currentGame.fen) {
              dispatch(gameUpdate(payload));
              setText(prev => [
                `Stockfish played: ${move}${isCapture ? ' (Capture!)' : ''}`,
                ...prev.slice(1)
              ]);
            }
          } catch (error) {
            console.error("Error applying Stockfish move:", error);
          }
        }
      }
    } catch (error) {
      console.error("Stockfish error:", error);
    } finally {
      setIsStockfishThinking(false);
    }
  }, [dispatch, setText, isStockfishThinking, stockfishReady, stockfishMoveRef]);

  // Effect to trigger Stockfish when position changes
  useEffect(() => {
    if (!playing || isStockfishThinking || !stockfishReady) {
      return;
    }

    const colorToMove = game.fen.split(" ")[1];
    
    if (colorToMove !== playerColor) {
      const timer = setTimeout(() => {
        applyStockfishMove();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [game.fen, playing, playerColor, isStockfishThinking, stockfishReady, applyStockfishMove]);

  const handleExecuteRobotMove = async () => {
    const move = stockfishMoveRef.current;
    
    if (!move?.readyForExecution || !move.uciMove) {
      setText(['Move not ready for execution', 'Wait for coordinates to stabilize']);
      return;
    }
    
    setExecutingMove(true);
    setText(['Executing robot move...', 'Please wait']);
    
    try {
      const moveData = {
        sourceSquare: move.sourceSquareNumber!,
        destSquare: move.destSquareNumber!,
        sourcePieceBaseCamera: move.averagedSourcePieceBase,
        capturedPieceBaseCamera: move.averagedCapturedPieceBase,
        isCapture: move.isCapture || false,
        uciMove: move.uciMove
      };
      
      await executeRobotMove(moveData);
      
      setLastExecutedMove(move.uciMove);
      setText([
        '✅ Robot move executed!',
        `Move: ${move.uciMove}`,
        move.isCapture ? 'Capture move completed' : 'Move completed'
      ]);
      
    } catch (error: any) {
      console.error('Move execution error:', error);
      setText(['❌ Robot move failed:', error.message || 'Unknown error']);
    } finally {
      setExecutingMove(false);
    }
  };

  const handleColorSelect = (selectedColor: Color) => {
    setPlayerColor(selectedColor);
    
    const board = new Chess();
    const payload = makeUpdatePayload(board);
    dispatch(gameUpdate(payload));
    
    stockfishMoveRef.current = {};
    setLastExecutedMove('');
    
    setText([`Playing as ${selectedColor === 'w' ? 'White' : 'Black'}`, "vs Stockfish"]);
    
    if (selectedColor === 'b' && stockfishReady) {
      setTimeout(() => {
        applyStockfishMove();
      }, 500);
    }
  };
  
  const resetGame = () => {
    const board = new Chess();
    const payload = makeUpdatePayload(board);
    dispatch(gameUpdate(payload));
    
    stockfishMoveRef.current = {};
    setLastExecutedMove('');
    
    setText(["Game reset"]);
  };

  // Initialize Stockfish
  useEffect(() => {
    const initStockfish = async () => {
      try {
        const engine = stockfishEngineRef.current;
        const isReady = await engine.waitForReady();
        setStockfishReady(isReady);
      } catch (error) {
        console.error("Failed to initialize Stockfish:", error);
        setStockfishReady(false);
      }
    };
    
    initStockfish();
  }, []);
  
  return (
    <div className="d-flex flex-column">
      <Sidebar sidebarRef={sidebarRef} playing={playing} text={text} setText={setText} >
        <li className="my-1" style={{display: playing ? "none": "inline-block"}}>
          <DeviceButton videoRef={videoRef} onDeviceChange={onDeviceChange} />  {/* Added onDeviceChange */}
        </li>
        <li className="my-1" style={{display: playing ? "none": "inline-block"}}>
          <div className="dropdown">
            <button className="btn btn-dark btn-sm btn-outline-light dropdown-toggle w-100" 
              id="colorButton" data-bs-toggle="dropdown" aria-expanded="false">
              Playing as: {playerColor === 'w' ? 'White' : 'Black'}
              {!stockfishReady && " (Loading Stockfish...)"}
              {isStockfishThinking && " (Stockfish thinking...)"}
            </button>
            <ul className="dropdown-menu" aria-labelledby="colorButton">
              <li>
                <a className="dropdown-item" href="#" onClick={() => handleColorSelect('w')}>
                  White (Human) vs Black (Stockfish)
                </a>
              </li>
              <li>
                <a className="dropdown-item" href="#" onClick={() => handleColorSelect('b')}>
                  Black (Human) vs White (Stockfish)
                </a>
              </li>
            </ul>
          </div>
        </li>
        <li className="my-1" style={{display: playing ? "none": "inline-block"}}>
          <CornersButton piecesModelRef={piecesModelRef} xcornersModelRef={xcornersModelRef} videoRef={videoRef} canvasRef={canvasRef} 
          setText={setText} />
        </li>
        
        {/* Auto Mode Toggle */}
        <li className="my-1">
          <div className="form-check form-switch text-white">
            <input
              className="form-check-input"
              type="checkbox"
              id="autoModeToggle"
              checked={autoMode}
              onChange={(e) => setAutoMode(e.target.checked)}
              disabled={executingMove}
            />
            <label className="form-check-label" htmlFor="autoModeToggle">
              Auto Execute Robot Moves
            </label>
          </div>
        </li>
        
        {/* Execute Robot Move Button (only show when not in auto mode) */}
        {!autoMode && (
          <li className="my-1">
            <button 
              className="btn btn-dark btn-sm btn-outline-light w-100"
              onClick={handleExecuteRobotMove}
              disabled={executingMove || !stockfishMoveRef.current?.readyForExecution}
            >
              {executingMove ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                  Executing...
                </>
              ) : 'Execute Robot Move'}
            </button>
          </li>
        )}
        
        {/* Clear Buffer Button for testing */}
        <li className="my-1">
          <button 
            className="btn btn-dark btn-sm btn-outline-secondary w-100"
            onClick={() => {
              if (stockfishMoveRef.current?.uciMove) {
                clearPieceBaseBuffer(stockfishMoveRef.current.uciMove);
                stockfishMoveRef.current.readyForExecution = false;
                setText(['Buffer cleared', 'Collecting new coordinates...']);
              }
            }}
            disabled={executingMove}
          >
            Clear Buffer
          </button>
        </li>
        
        <li className="my-1">
          <div className="btn-group w-100" role="group">
            <RecordButton playing={playing} setPlaying={setPlaying} />
            <button 
              className="btn btn-dark btn-sm btn-outline-light w-100"
              onClick={resetGame}
              disabled={executingMove}
            >
              Reset Game
            </button>
          </div>
        </li>
      </Sidebar>
      
      {/* Robot Control Section BELOW the Sidebar */}
      <div style={{minWidth: "200px", margin: "0 4px"}}>
        <RobotControl />
      </div>
    </div>
  );
};
  
export default PlaySidebar;