import { findPieces } from "../../utils/findPieces";
import { useEffect, useRef, useState, useCallback } from "react";
import { CORNER_KEYS, MARKER_DIAMETER, MARKER_RADIUS, MEDIA_ASPECT_RATIO, MEDIA_CONSTRAINTS } from "../../utils/constants";
import { Corners } from ".";
import { useWindowWidth, useWindowHeight } from '@react-hook/window-size';
import { useDispatch } from 'react-redux';
import { cornersSet } from "../../slices/cornersSlice";
import { getMarkerXY, getXY } from "../../utils/detect";
import { CornersDict, Game, Mode, MovesPair, SetBoolean, SetStringArray, DeviceType } from "../../types";
import { gameSelect, makeBoard } from "../../slices/gameSlice";
import { getMovesPairs } from "../../utils/moves";
import { Chess } from "chess.js";

const Video = ({ piecesModelRef, canvasRef, videoRef, sidebarRef, playing, 
  setPlaying, playingRef, setText, mode, cornersRef, stockfishMoveRef, 
  deviceType = 'webcam', droidcamUrl = 'http://localhost:8080/video' }: {
  piecesModelRef: any, canvasRef: any, videoRef: any, sidebarRef: any, 
  playing: boolean, setPlaying: SetBoolean, playingRef: any,
  setText: SetStringArray, mode: Mode,
  cornersRef: any,
  stockfishMoveRef?: any,
  deviceType?: DeviceType,
  droidcamUrl?: string
}) => {
  const game: Game = gameSelect();

  const displayRef = useRef<any>(null);
  const boardRef = useRef<Chess>(makeBoard(game));
  const movesPairsRef = useRef<MovesPair[]>(getMovesPairs(boardRef.current));
  const lastMoveRef = useRef<string>(game.lastMove);
  const moveTextRef = useRef<string>("");
  
  // DroidCam Web Worker refs
  const droidcamWorkerRef = useRef<Worker | null>(null);
  const droidcamCanvasRef = useRef<any>(null);
  const displayCanvasRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [droidcamError, setDroidcamError] = useState<string>('');
  const [droidcamFps, setDroidcamFps] = useState<number>(0);
  const [workerReady, setWorkerReady] = useState<boolean>(false);

  const windowWidth = useWindowWidth();
  const windowHeight = useWindowHeight();
  const dispatch = useDispatch();

  useEffect(() => {
    const board = makeBoard(game);
    moveTextRef.current = getMoveText(board);
    if (game.greedy === true) {
      board.undo();
    } else {
      movesPairsRef.current = getMovesPairs(board);
    }
    boardRef.current = board;
    lastMoveRef.current = game.lastMove;
  }, [game])

  const getMoveText = (board: Chess): string => {
    const history: string[] = board.history();
    
    if (history.length == 0) {
      return "";
    }
  
    if (history.length == 1) {
      return `1. ${history[history.length - 1]}`
    }
  
    const firstMove: string = history[history.length - 2];
    const secondMove: string = history[history.length - 1];
    const nHalfMoves: number = Math.floor(history.length / 2);
    if (history.length % 2 == 0) {
      return `${nHalfMoves}.${firstMove} ${secondMove}`
    } 
    
    return `${nHalfMoves}...${firstMove} ${nHalfMoves + 1}.${secondMove}`
  }

  const setupWebcam = async () => {
    console.log("Setting up Webcam...");
    
    // Clean up DroidCam
    stopDroidCam();
    
    const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
    if (videoRef.current !== null) {
      videoRef.current.srcObject = stream;
      videoRef.current.style.display = 'block';
      console.log("Webcam stream started");
    }
    return stream;
  };

  // Setup DroidCam using Web Worker
  const setupDroidCam = useCallback(() => {
    console.log("Setting up DroidCam with Web Worker...");
    setDroidcamError('');
    setDroidcamFps(0);
    setWorkerReady(false);
    
    // Stop webcam if active
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    
    // Create canvases if they don't exist
    if (!droidcamCanvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position: absolute; top: -1000px; left: -1000px; width: 640px; height: 480px;';
      canvas.id = 'droidcam-processing-canvas';
      document.body.appendChild(canvas);
      droidcamCanvasRef.current = canvas;
    }
    
    if (!displayCanvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position: absolute; top: -1000px; left: -1000px; width: 640px; height: 480px;';
      canvas.id = 'droidcam-display-canvas';
      document.body.appendChild(canvas);
      displayCanvasRef.current = canvas;
    }
    
    // Create or reuse Web Worker
    if (!droidcamWorkerRef.current) {
      droidcamWorkerRef.current = new Worker(new URL('../../workers/droidcamWorker', import.meta.url));
      
      droidcamWorkerRef.current.onmessage = (event) => {
        const { type, imageBitmap, fps, frameNumber } = event.data;
        
        switch(type) {
          case 'connected':
            console.log('[Main] Worker connected');
            setWorkerReady(true);
            break;
            
          case 'frame':
            if (imageBitmap) {
              // Draw to display canvas (for video stream)
              const displayCtx = displayCanvasRef.current.getContext('2d');
              displayCanvasRef.current.width = imageBitmap.width;
              displayCanvasRef.current.height = imageBitmap.height;
              displayCtx.drawImage(imageBitmap, 0, 0);
              
              // Draw to processing canvas (for TensorFlow)
              const processCtx = droidcamCanvasRef.current.getContext('2d');
              droidcamCanvasRef.current.width = imageBitmap.width;
              droidcamCanvasRef.current.height = imageBitmap.height;
              processCtx.drawImage(imageBitmap, 0, 0);
              
              // Create/update video stream from display canvas
              if (!streamRef.current && videoRef.current) {
                streamRef.current = displayCanvasRef.current.captureStream(30);
                videoRef.current.srcObject = streamRef.current;
                videoRef.current.style.display = 'block';
                console.log('📹 DroidCam video stream started from Web Worker');
              }
              
              setDroidcamFps(fps);
              
              // Update FPS in UI (but don't block main thread)
              if (frameNumber % 30 === 0) {
                setText(prev => {
                  const newText = [...prev];
                  const droidcamIndex = newText.findIndex(t => t.includes('DroidCam:'));
                  if (droidcamIndex >= 0) {
                    newText[droidcamIndex] = `DroidCam: ${fps} FPS (Worker)`;
                  } else if (newText.length > 2) {
                    newText[2] = `DroidCam: ${fps} FPS (Worker)`;
                  }
                  return newText;
                });
              }
            }
            break;
            
          case 'error':
            setDroidcamError(event.data.error);
            break;
            
          case 'closed':
            setWorkerReady(false);
            break;
        }
      };
    }
    
    // Connect worker to WebSocket
    if (droidcamWorkerRef.current) {
      droidcamWorkerRef.current.postMessage({
        type: 'connect',
        url: 'ws://localhost:8080'
      });
    }
    
    return () => {
      stopDroidCam();
    };
  }, [videoRef, setText]);

  const stopDroidCam = useCallback(() => {
    console.log('Stopping DroidCam...');
    
    // Stop worker
    if (droidcamWorkerRef.current) {
      droidcamWorkerRef.current.postMessage({ type: 'disconnect' });
      droidcamWorkerRef.current.terminate();
      droidcamWorkerRef.current = null;
    }
    
    // Stop stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Clear video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setWorkerReady(false);
    setDroidcamFps(0);
    setDroidcamError('');
  }, [videoRef]);

  const awaitSetupWebcam = async () => {
    if (deviceType === 'droidcam') {
      return setupDroidCam();
    }
    return setupWebcam();
  }

  const updateWidthHeight = () => {
    if (!sidebarRef.current || !displayRef.current || !canvasRef.current) {
      return;
    }
    
    if (!sidebarRef.current.offsetWidth || !displayRef.current.offsetWidth) {
      return;
    }
    
    let height = ((windowWidth - sidebarRef.current.offsetWidth - MARKER_DIAMETER) 
    / MEDIA_ASPECT_RATIO) + MARKER_DIAMETER;
    if (height > windowHeight) {
      height = windowHeight;
    }

    if ((canvasRef.current.offsetHeight == 0) || (canvasRef.current.offsetWidth) == 0) {
      return;
    }
    
    const width: number = ((height - MARKER_DIAMETER) * MEDIA_ASPECT_RATIO) + MARKER_DIAMETER;
    const oldHeight: number = canvasRef.current.height;
    const oldWidth: number = canvasRef.current.width;

    displayRef.current.style.width = `${width}px`;
    displayRef.current.style.height = `${height}px`;
    displayRef.current.width = width;
    displayRef.current.height = height;

    if (videoRef.current && videoRef.current.offsetWidth) {
      canvasRef.current.width = videoRef.current.offsetWidth;
      canvasRef.current.height = videoRef.current.offsetHeight;
    }
    
    CORNER_KEYS.forEach((key) => {
      const xy = getXY(cornersRef.current[key], oldHeight, oldWidth);
      const payload: any = {
        "xy": getMarkerXY(xy, canvasRef.current.height, canvasRef.current.width),
        "key": key
      }
      dispatch(cornersSet(payload)) 
    })
  }

  useEffect(() => {
    const initTimer = setTimeout(() => {
      updateWidthHeight();
    }, 100);

    let streamPromise: any = null;
    if (mode !== "upload") {
      streamPromise = awaitSetupWebcam()
    }

    // Start chess detection - pass the processing canvas for DroidCam
    const cleanupFindPieces = findPieces(
      piecesModelRef, 
      videoRef, 
      canvasRef, 
      playingRef, 
      setText, 
      dispatch,
      cornersRef, 
      boardRef, 
      movesPairsRef, 
      lastMoveRef, 
      moveTextRef, 
      mode, 
      stockfishMoveRef, 
      deviceType,
      droidcamCanvasRef  // Pass the processing canvas
    );

    const stopWebcam = async () => {
      if (deviceType === 'webcam') {
        const stream = await streamPromise;
        if (stream !== null) {
          stream.getTracks().forEach((track: any) => track.stop());
        }
      } else {
        stopDroidCam();
      }
    }

    return () => {
      clearTimeout(initTimer);
      if (cleanupFindPieces) {
        cleanupFindPieces();
      }
      stopWebcam();
    }
  }, [deviceType, mode, setupDroidCam, stopDroidCam]);

  useEffect(() => {
    updateWidthHeight();
  }, [windowWidth, windowHeight]);

  useEffect(() => {
    if ((mode !== "upload") || (videoRef.current.src === "")) {
      return;
    }
    
    if (playingRef.current === true) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  }, [playing])

  const canvasStyle: React.CSSProperties = {
    position: "absolute",
    left: MARKER_RADIUS,
    top: MARKER_RADIUS,
    zIndex: 10
  }

  const videoContainerStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    padding: MARKER_RADIUS,
    position: "relative",
    overflow: "hidden"
  }

  const videoStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "contain"
  }

  const liveStyle: React.CSSProperties = {
    position: "relative",
    backgroundColor: "#343a40",
  }

  const onLoadedMetadata = () => {  
    if (mode === "upload") {
      return;
    }
    window.setTimeout(() => {
      if (!(videoRef.current) || !videoRef.current.srcObject) {
        return;
      }
      
      const tracks = videoRef.current.srcObject.getVideoTracks();
      if (tracks.length == 0) {
        return;
      }

      try {
        const capabilities = tracks[0].getCapabilities();
        console.log("Capabilities", capabilities);
        
        if (capabilities.zoom) {
          tracks[0].applyConstraints({
            zoom: capabilities.zoom.min,
          })
        }
      } catch (_) {
        console.log("Cannot update track capabilities")
      }

      try {
        const settings = tracks[0].getSettings();
        console.log("Settings", settings);
      } catch (_) {
        console.log("Cannot log track settings")
      }
    }, 2000);
  };

  const onCanPlay = () => {
    updateWidthHeight();
  }

  const onEnded = () => {
    if (mode === "upload") {
      videoRef.current.currentTime = videoRef.current.duration;
      videoRef.current.pause();
    }
    setPlaying(false);
  }

  return (
    <div className="d-flex align-top justify-content-center">
      <div ref={displayRef} style={liveStyle} >
        <div className="video-container" style={videoContainerStyle} >
          <video 
            ref={videoRef} 
            autoPlay={mode !== "upload"} 
            playsInline={true} 
            muted={true}
            onLoadedMetadata={onLoadedMetadata} 
            style={{
              ...videoStyle,
              display: 'block',
              position: 'relative',
              zIndex: 1
            }} 
            onCanPlay={onCanPlay} 
            onEnded={onEnded} 
          />
          <canvas ref={canvasRef} style={canvasStyle} />
        </div>
        <Corners />
      </div>
    </div>
  );
};

export default Video;