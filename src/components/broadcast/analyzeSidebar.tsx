import { CornersButton, Sidebar, RecordButton, StopButton, DeviceButton } from "../common";
import { SetBoolean, SetStringArray, CameraDevice } from "../../types";
import { getStockfishEvaluation } from "../../utils/stockfish";

const AnalyzeSidebar = ({ piecesModelRef, xcornersModelRef, videoRef, canvasRef, sidebarRef, 
  playing, setPlaying, text, setText, onDeviceChange }: {  // Added onDeviceChange
  piecesModelRef: any, xcornersModelRef: any, videoRef: any, canvasRef: any, sidebarRef: any,
  playing: boolean, setPlaying: SetBoolean, 
  text: string[], setText: SetStringArray,
  onDeviceChange?: (device: CameraDevice) => void  // Added
}) => {
  const inputStyle = {
    display: playing ? "none": "inline-block"
  }
  
  const handleAnalyze = async () => {
    setText(["Analyzing position..."]);
    try {
      const evalValue = await getStockfishEvaluation("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
      
      if (evalValue !== null) {
        const evalText = evalValue > 0 ? `+${evalValue.toFixed(2)}` : evalValue.toFixed(2);
        setText([`Evaluation: ${evalText}`, evalValue > 0 ? "White is better" : evalValue < 0 ? "Black is better" : "Equal"]);
      } else {
        setText(["Analysis failed: Could not get evaluation"]);
      }
    } catch (error) {
      console.error("Analysis error:", error);
      setText(["Analysis failed"]);
    }
  };
  
  return (
    <Sidebar sidebarRef={sidebarRef} playing={playing} text={text} setText={setText} >
      <li className="my-1" style={inputStyle}>
        <DeviceButton videoRef={videoRef} onDeviceChange={onDeviceChange} />  {/* Added onDeviceChange */}
      </li>
      <li className="my-1" style={inputStyle}>
        <CornersButton piecesModelRef={piecesModelRef} xcornersModelRef={xcornersModelRef} videoRef={videoRef} canvasRef={canvasRef} 
        setText={setText} />
      </li>
      <li className="my-1" style={inputStyle}>
        <button 
          className="btn btn-dark btn-sm btn-outline-light w-100"
          onClick={handleAnalyze}
        >
          Analyze Position
        </button>
      </li>
      <li className="my-1">
        <div className="btn-group w-100" role="group">
          <RecordButton playing={playing} setPlaying={setPlaying} />
          <StopButton setPlaying={setPlaying} setText={setText} />
        </div>
      </li>
    </Sidebar>
  );
};

export default AnalyzeSidebar;