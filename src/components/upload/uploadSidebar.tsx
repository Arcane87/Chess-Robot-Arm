import { VideoButton, PlayButton, RestartButton, PlaybackButtons, StopButton } from "./buttons";
import { CornersButton, Sidebar, FenButton, DeviceButton } from "../common";
import { SetBoolean, SetStringArray, CameraDevice } from "../../types";

const UploadSidebar = ({ videoRef, xcornersModelRef, piecesModelRef, canvasRef, 
  sidebarRef, text, setText, playing, setPlaying, cornersRef, onDeviceChange }: {  // Added onDeviceChange
  videoRef: any, xcornersModelRef: any, piecesModelRef: any, canvasRef: any, sidebarRef: any,
  text: string[], setText: SetStringArray,
  playing: boolean, setPlaying: SetBoolean,
  cornersRef: any,
  onDeviceChange?: (device: CameraDevice) => void  // Added
}) => {

  const inputStyle = {
    display: playing ? "none": "inline-block"
  }

  return (
    <Sidebar sidebarRef={sidebarRef} playing={playing} text={text} setText={setText} >
      {/* Note: Upload mode typically uses uploaded video files, not live camera.
          But we include DeviceButton for consistency, though it won't be used in upload mode. */}
      <li className="my-1" style={inputStyle}>
        <DeviceButton videoRef={videoRef} onDeviceChange={onDeviceChange} />
      </li>
      <li className="my-1" style={inputStyle}>
        <VideoButton videoRef={videoRef} canvasRef={canvasRef} setPlaying={setPlaying} />
      </li>
      <li className="my-1" style={inputStyle}>
        <CornersButton piecesModelRef={piecesModelRef} xcornersModelRef={xcornersModelRef} 
        videoRef={videoRef} canvasRef={canvasRef} setText={setText} />
      </li>
      <li className="my-1" style={inputStyle}>
        <FenButton piecesModelRef={piecesModelRef} videoRef={videoRef} 
        canvasRef={canvasRef} setText={setText} cornersRef={cornersRef} />
      </li>
      <li className="my-1" style={inputStyle}>
        <PlaybackButtons videoRef={videoRef} />
      </li>
      <li className="my-1">
        <div className="btn-group w-100" role="group">
          <PlayButton videoRef={videoRef} playing={playing} setPlaying={setPlaying} />
          <StopButton videoRef={videoRef} setPlaying={setPlaying} setText={setText} />
          <RestartButton videoRef={videoRef} setText={setText} />
        </div>
      </li>
    </Sidebar>
  );
};

export default UploadSidebar;