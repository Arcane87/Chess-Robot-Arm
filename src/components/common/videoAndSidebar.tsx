import { useRef, useState, useEffect } from "react";
import Video from "../common/video";
import { useOutletContext } from "react-router-dom";
import { useDispatch } from 'react-redux';
import { cornersReset, cornersSelect } from '../../slices/cornersSlice';
import { Container } from "../common";
import LoadModels from "../../utils/loadModels";
import { CornersDict, Mode, ModelRefs, DeviceType, CameraDevice } from "../../types"; // Added DeviceType and CameraDevice
import RecordSidebar from "../record/recordSidebar";
import UploadSidebar from "../upload/uploadSidebar";
import AnalyzeSidebar from "../broadcast/analyzeSidebar";
import { gameResetFen, gameResetMoves, gameResetStart, gameSelect } from "../../slices/gameSlice";
import { userSelect } from "../../slices/userSlice";
import { START_FEN } from "../../utils/constants";
import PlaySidebar from "../play/playSidebar";
import { useMediaQuery } from 'react-responsive';

const PortraitWarning = () => {
  return (
    <h1 className="text-white text-center w-100 p-3 h-2">
      Please use your device in landscape mode
    </h1>
  )
}

const VideoAndSidebar = ({ mode }: { mode: Mode }) => {
  const context = useOutletContext<ModelRefs>();
  const dispatch = useDispatch();
  const corners: CornersDict = cornersSelect();
  const username: string = userSelect().username; // Changed from .token to .username
  const moves: string = gameSelect().moves;
  const isPortrait = useMediaQuery({ orientation: 'portrait' });

  const [text, setText] = useState<string[]>([]);
  const [playing, setPlaying] = useState<boolean>(false);
  
  // Add state for device type
  const [deviceType, setDeviceType] = useState<DeviceType>('webcam');
  
  const videoRef = useRef<any>(null);
  const playingRef = useRef<boolean>(playing);
  const canvasRef = useRef<any>(null);
  const sidebarRef = useRef<any>(null);
  const cornersRef = useRef<CornersDict>(corners);
  const stockfishMoveRef = useRef<{ 
    sourceCoord?: number[];
    destCoord?: number[];
    uciMove?: string;
  }>({});

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    cornersRef.current = corners;
  }, [corners])

  useEffect(() => {
    LoadModels(context.piecesModelRef, context.xcornersModelRef);
    dispatch(cornersReset());
    dispatch(gameResetStart());
    dispatch(gameResetMoves());
    dispatch(gameResetFen());
  }, []);

  // Handler for device changes from DeviceButton
  const handleDeviceChange = (device: CameraDevice) => {
    setDeviceType(device.type);
    
    // Update text to show which device is active
    if (device.type === 'droidcam') {
      setText(prev => [`Switched to DroidCam`, ...prev.slice(1)]);
    } else {
      setText(prev => [`Switched to Webcam`, ...prev.slice(1)]);
    }
  };

  const props = {
    "playing": playing,
    "text": text,
    "setPlaying": setPlaying,
    "setText": setText,
    "piecesModelRef": context.piecesModelRef,
    "xcornersModelRef": context.xcornersModelRef,
    "videoRef": videoRef,
    "canvasRef": canvasRef,
    "sidebarRef": sidebarRef,
    "cornersRef": cornersRef,
    "playingRef": playingRef,
    "mode": mode,
    "stockfishMoveRef": stockfishMoveRef,
    "deviceType": deviceType,  // Added
    "droidcamUrl": "http://localhost:8080/video"  // Default DroidCam URL
  }
  
  const Sidebar = () => {
    switch(mode) {
      case "record": return <RecordSidebar {...props} onDeviceChange={handleDeviceChange} />
      case "upload": return <UploadSidebar {...props} onDeviceChange={handleDeviceChange} />
      case "play": return <PlaySidebar {...props} onDeviceChange={handleDeviceChange} />
      case "analyze": return <AnalyzeSidebar {...props} onDeviceChange={handleDeviceChange} />
    }
  }

  return (
    <Container>
      {isPortrait ? (
        <PortraitWarning />
      ) : (
        <>
          {Sidebar()}
          <Video {...props} />
        </>
      )}
    </Container>
  );
};

export default VideoAndSidebar;