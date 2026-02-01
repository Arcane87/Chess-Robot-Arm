import React, { useState, useEffect, useRef } from 'react';
import { getFullRobotPose, getSquareInfo } from '../../utils/transformPoses';

const ROBOT_CONFIG = {
  BRIDGE_URL: "ws://localhost:8765", // WebSocket bridge URL
};

interface RobotControlProps {
  onMove?: (squareNumber: number, squareName: string, x: number, y: number) => void;
}

const RobotControl: React.FC<RobotControlProps> = ({ onMove }) => {
  const [squareNumber, setSquareNumber] = useState<number>(11);
  const [squareInfo, setSquareInfo] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [robotConnected, setRobotConnected] = useState<boolean>(false);
  const [bridgeConnected, setBridgeConnected] = useState<boolean>(false);
  const [debugMessages, setDebugMessages] = useState<string[]>([]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const maxReconnectAttempts = 3;

  // Add debug logging
  const addDebugMessage = (msg: string) => {
    console.log(`[DEBUG RobotControl] ${msg}`);
    setDebugMessages(prev => [...prev.slice(-10), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  // Initialize WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      addDebugMessage('Connecting to WebSocket bridge...');
      
      try {
        wsRef.current = new WebSocket(ROBOT_CONFIG.BRIDGE_URL);
        
        wsRef.current.onopen = () => {
          addDebugMessage('✅ WebSocket connected to bridge');
          setBridgeConnected(true);
          reconnectAttemptRef.current = 0;
          
          // Send a test message to verify connection
          setTimeout(() => {
            sendBridgeCommand({ type: 'status' })
              .then(response => {
                if (response.type === 'status') {
                  addDebugMessage(`Bridge status: ${JSON.stringify(response.status)}`);
                }
              })
              .catch(err => {
                addDebugMessage(`Status check failed: ${err.message}`);
              });
          }, 1000);
        };
        
        wsRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            addDebugMessage(`← FROM BRIDGE: ${JSON.stringify(data)}`);
            
            // Handle different response types
            if (data.type === 'connected') {
              setRobotConnected(true);
              setMessage('✅ Robot system connected successfully!');
              addDebugMessage('Robot system is now connected');
            } else if (data.type === 'error') {
              setMessage(`❌ ${data.message}`);
              addDebugMessage(`Error from bridge: ${data.message}`);
            } else if (data.type === 'status') {
              addDebugMessage(`Robot status: ${JSON.stringify(data.status)}`);
              if (data.status?.connected) {
                setRobotConnected(true);
              }
            } else if (data.type === 'move_complete') {
              addDebugMessage(`Move completed: ${data.message}`);
            } else if (data.type === 'gripper_complete') {
              addDebugMessage(`Gripper action completed: ${data.message}`);
            }
          } catch (error) {
            addDebugMessage(`Failed to parse message: ${event.data}`);
          }
        };
        
        wsRef.current.onerror = (error) => {
          addDebugMessage(`WebSocket error: ${error.type}`);
          setBridgeConnected(false);
        };
        
        wsRef.current.onclose = (event) => {
          addDebugMessage(`WebSocket closed: ${event.code} ${event.reason}`);
          setBridgeConnected(false);
          setRobotConnected(false);
          
          // Attempt reconnect
          if (reconnectAttemptRef.current < maxReconnectAttempts) {
            reconnectAttemptRef.current += 1;
            addDebugMessage(`Attempting reconnect ${reconnectAttemptRef.current}/${maxReconnectAttempts}...`);
            setTimeout(connectWebSocket, 2000);
          }
        };
        
      } catch (error: any) {
        addDebugMessage(`Failed to create WebSocket: ${error.message}`);
        setBridgeConnected(false);
      }
    };
    
    connectWebSocket();
    
    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const updateSquareInfo = (number: number) => {
    const info = getSquareInfo(number);
    setSquareInfo(info);
    return info;
  };

  useEffect(() => {
    updateSquareInfo(squareNumber);
  }, [squareNumber]);

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    if (value >= 1 && value <= 64) {
      setSquareNumber(value);
      updateSquareInfo(value);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    moveToSquare(squareNumber);
  };

  // Generic function to send commands to bridge
  const sendBridgeCommand = (command: any, timeout = 5000): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      const messageId = Date.now();
      const commandWithId = { ...command, id: messageId };
      
      addDebugMessage(`→ TO BRIDGE: ${JSON.stringify(command)}`);
      
      // Set up one-time message handler
      const handleMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          // Check if this response corresponds to our command
          if (data.id === messageId || !data.id) {
            wsRef.current?.removeEventListener('message', handleMessage);
            clearTimeout(timeoutId);
            resolve(data);
          }
        } catch (error) {
          // Not JSON, ignore
        }
      };
      
      const timeoutId = setTimeout(() => {
        wsRef.current?.removeEventListener('message', handleMessage);
        reject(new Error('Bridge response timeout'));
      }, timeout);
      
      wsRef.current.addEventListener('message', handleMessage);
      wsRef.current.send(JSON.stringify(commandWithId));
    });
  };

  // Connect to robot system
  const connectToRobot = async () => {
    setConnecting(true);
    setMessage('Connecting to robot system...');
    addDebugMessage('Attempting to connect robot system...');
    
    try {
      const response = await sendBridgeCommand({ type: 'connect' });
      
      if (response.type === 'connected') {
        setRobotConnected(true);
        setMessage('✅ Robot system connected!');
      } else if (response.type === 'error') {
        setMessage(`❌ Failed to connect: ${response.message}`);
        addDebugMessage(`Connection error: ${response.message}`);
      }
    } catch (error: any) {
      setMessage(`❌ Connection failed: ${error.message}`);
      addDebugMessage(`Connection exception: ${error.message}`);
    } finally {
      setConnecting(false);
    }
  };

  // Disconnect from robot system
  const disconnectFromRobot = async () => {
    setMessage('Disconnecting from robot system...');
    addDebugMessage('Sending disconnect command...');
    
    try {
      await sendBridgeCommand({ type: 'disconnect' });
      setRobotConnected(false);
      setMessage('✅ Robot system disconnected');
    } catch (error: any) {
      setMessage(`⚠️ ${error.message}`);
    }
  };

  // Test robot system
  const testRobotConnection = async () => {
    setMessage('Testing robot connection...');
    addDebugMessage('Sending test command...');
    
    try {
      const response = await sendBridgeCommand({ type: 'test', test: 'Hello Bridge!' });
      if (response.type === 'test_response') {
        setMessage(`✅ Bridge test successful: ${response.message}`);
      }
    } catch (error: any) {
      setMessage(`❌ Test failed: ${error.message}`);
    }
  };

  // Get robot status
  const getRobotStatus = async () => {
    setMessage('Getting robot status...');
    
    try {
      const response = await sendBridgeCommand({ type: 'status' });
      if (response.type === 'status') {
        const status = response.status;
        const armStatus = status?.arm?.connected ? '✅ Connected' : '❌ Disconnected';
        const gripperStatus = status?.gripper?.connected ? '✅ Connected' : '❌ Disconnected';
        setMessage(`Arm: ${armStatus}, Gripper: ${gripperStatus}`);
        addDebugMessage(`Full status: ${JSON.stringify(status)}`);
      }
    } catch (error: any) {
      setMessage(`❌ Status check failed: ${error.message}`);
    }
  };

  const moveToSquare = async (number: number) => {
    setLoading(true);
    const moveMessage = `Moving to square ${number}...`;
    setMessage(moveMessage);
    addDebugMessage(moveMessage);

    // Get square info
    const info = updateSquareInfo(number);
    if (!info) {
      const errMsg = `Square ${number} information not available.`;
      setMessage(errMsg);
      addDebugMessage(errMsg);
      setLoading(false);
      return;
    }

    if (!info.robotX || !info.robotY) {
      const errMsg = `Square ${number} robot coordinates not available. Click "Play" to calibrate first!`;
      setMessage(errMsg);
      addDebugMessage(errMsg);
      setLoading(false);
      return;
    }

    // Get full robot pose (includes Z and rotation from JSON)
    const fullPose = getFullRobotPose(number);
    
    if (!fullPose) {
      const errMsg = [
        `❌ Cannot move: Calibration not complete!`,
        `1. Click "Play" button in the main interface`,
        `2. Wait for "Corner centers logged" message in console`,
        `3. Make sure chessboard_poses.json exists in public folder`,
        `4. Try moving to square ${number} again`
      ].join('\n');
      setMessage(errMsg);
      addDebugMessage('Calibration not complete');
      setLoading(false);
      return;
    }

    // Use the calibrated pose from JSON
    const pose = {
      x: fullPose.x,
      y: fullPose.y,
      z: fullPose.z,    // Uses actual Z from JSON calibration
      rx: fullPose.rx,  // Uses actual rotation from JSON
      ry: fullPose.ry,
      rz: fullPose.rz
    };

    addDebugMessage(`Sending move command: ${JSON.stringify(pose)}`);
    
    try {
      const response = await sendBridgeCommand({
        type: 'move',
        pose: pose,
        moveType: 'clearance'
      }, 10000); // Longer timeout for move commands
      
      if (response.type === 'move_complete') {
        const successMessage = `✅ Move to ${info.squareName} completed! (X:${pose.x.toFixed(4)}, Y:${pose.y.toFixed(4)}, Z:${pose.z.toFixed(4)})`;
        setMessage(successMessage);
        addDebugMessage(successMessage);
        
        if (onMove) {
          onMove(number, info.squareName, pose.x, pose.y);
        }
      } else if (response.type === 'error') {
        const errorMessage = `❌ Move failed: ${response.message}`;
        setMessage(errorMessage);
        addDebugMessage(errorMessage);
      }
    } catch (error: any) {
      const errorMessage = `❌ Move command failed: ${error.message}`;
      setMessage(errorMessage);
      addDebugMessage(errorMessage);
      
      // Fallback to simulation mode if bridge fails
      if (error.message.includes('timeout') || error.message.includes('not connected')) {
        const fallbackMessage = `BRIDGE OFFLINE - Would move to ${info.squareName} (X:${pose.x.toFixed(4)}, Y:${pose.y.toFixed(4)}, Z:${pose.z.toFixed(4)})`;
        setMessage(fallbackMessage);
        
        if (onMove) {
          onMove(number, info.squareName, pose.x, pose.y);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Check if calibration is available to determine button state
  const isCalibrationAvailable = squareInfo?.fullPose !== undefined;
  const isRobotReady = squareInfo?.robotX && squareInfo?.robotY && isCalibrationAvailable && robotConnected;

  return (
    <div className="text-white">
      <h6 className="border-bottom pb-2 mb-2">Robot Control</h6>
      
      {/* Connection Status */}
      <div className="mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div>
            <small>Bridge: 
              <span className={bridgeConnected ? "text-success ms-2" : "text-danger ms-2"}>
                {bridgeConnected ? '✅ Connected' : '❌ Disconnected'}
              </span>
            </small>
          </div>
          <div>
            <small>Robot: 
              <span className={robotConnected ? "text-success ms-2" : "text-danger ms-2"}>
                {robotConnected ? '✅ Connected' : '❌ Disconnected'}
              </span>
            </small>
          </div>
        </div>
        
        {/* Connection Controls */}
        <div className="btn-group w-100 mb-2" role="group">
          <button 
            className="btn btn-success btn-sm"
            onClick={connectToRobot}
            disabled={connecting || !bridgeConnected || robotConnected}
          >
            {connecting ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                Connecting...
              </>
            ) : 'Connect Robot'}
          </button>
          <button 
            className="btn btn-warning btn-sm"
            onClick={disconnectFromRobot}
            disabled={!robotConnected}
          >
            Disconnect
          </button>
        </div>
        
        {/* Test and Status Buttons */}
        <div className="btn-group w-100 mb-3" role="group">
          <button 
            className="btn btn-info btn-sm"
            onClick={testRobotConnection}
            disabled={!bridgeConnected}
          >
            Test Bridge
          </button>
          <button 
            className="btn btn-secondary btn-sm"
            onClick={getRobotStatus}
            disabled={!bridgeConnected}
          >
            Get Status
          </button>
        </div>
      </div>
      
      {/* Square Movement Controls */}
      <form onSubmit={handleSubmit} className="mb-3">
        <div className="input-group input-group-sm mb-2">
          <span className="input-group-text">Square (1-64)</span>
          <input
            type="number"
            className="form-control"
            value={squareNumber}
            onChange={handleNumberChange}
            min="1"
            max="64"
            disabled={loading || !robotConnected}
          />
          <button 
            type="submit" 
            className="btn btn-primary btn-sm"
            disabled={loading || !isRobotReady || !robotConnected}
          >
            {loading ? (
              <>
                <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                Moving...
              </>
            ) : 'Move Robot'}
          </button>
        </div>
        
        <small className={`d-block mb-2 ${robotConnected ? 'text-success' : 'text-warning'}`}>
          {robotConnected 
            ? '✅ Robot is connected and ready for movement'
            : '⚠️ Connect the robot system first to enable movement'
          }
        </small>
      </form>
      
      {/* Square Info */}
      {squareInfo && (
        <div className="mb-3">
          <div><small>Square: <strong>{squareInfo.squareName}</strong></small></div>
          <div><small>Robot X: <code>{squareInfo.robotX?.toFixed(4) || 'N/A'}</code></small></div>
          <div><small>Robot Y: <code>{squareInfo.robotY?.toFixed(4) || 'N/A'}</code></small></div>
          <div><small>Robot Z: <code>{squareInfo.fullPose?.z?.toFixed(4) || 'N/A'}</code></small></div>
          <div><small>Camera X: <code>{squareInfo.cameraX?.toFixed(0) || 'N/A'}</code></small></div>
          <div><small>Camera Y: <code>{squareInfo.cameraY?.toFixed(0) || 'N/A'}</code></small></div>
          <div className={`small ${isCalibrationAvailable ? 'text-success' : 'text-warning'}`}>
            <strong>Calibration:</strong> {isCalibrationAvailable ? '✅ Available' : '⚠️ Required'}
          </div>
        </div>
      )}
      
      {/* Status Message */}
      <div className="alert alert-sm p-2 mb-2" style={{
        backgroundColor: message.includes('❌') ? '#f8d7da' : 
                        message.includes('⚠️') ? '#fff3cd' : '#d1ecf1',
        color: message.includes('❌') ? '#721c24' : 
               message.includes('⚠️') ? '#856404' : '#0c5460'
      }}>
        <small>
          <strong>Status:</strong> {message}
        </small>
      </div>
      
      {/* Debug Panel (Collapsible) */}
      <details className="small text-muted mb-3">
        <summary>Debug Info (Last 10 messages)</summary>
        <div className="mt-2 p-2 bg-dark border rounded" style={{maxHeight: '150px', overflowY: 'auto'}}>
          {debugMessages.length > 0 ? (
            debugMessages.map((msg, idx) => (
              <div key={idx} className="font-monospace small">
                {msg}
              </div>
            ))
          ) : (
            <div>No debug messages yet</div>
          )}
        </div>
      </details>
      
      <div className="small text-muted">
        <strong>Setup Instructions:</strong>
        <ol className="mt-1 mb-2" style={{fontSize: '0.75rem'}}>
          <li>Start robot bridge: <code>python robot_bridge_advanced.py</code></li>
          <li>Click "Play" in main interface to calibrate corners</li>
          <li>Click "Connect Robot" button above</li>
          <li>Select square number and click "Move Robot"</li>
        </ol>
        
        <strong>Troubleshooting:</strong>
        <ul style={{fontSize: '0.75rem'}}>
          <li>Check bridge is running (should show listening on ws://localhost:8765)</li>
          <li>Ensure UR5 and gripper are powered on</li>
          <li>Verify network connectivity to 192.168.1.20 (UR5) and 192.168.1.1 (gripper)</li>
        </ul>
        
        <strong>Square Mapping:</strong>
        <div className="row">
          <div className="col-6">
            1=A1, 2=B1, 3=C1<br/>
            9=A2, 10=B2, 11=C2<br/>
            57=A8, 58=B8, 59=C8
          </div>
          <div className="col-6">
            ... 8=H1<br/>
            ... 16=H2<br/>
            ... 64=H8
          </div>
        </div>
      </div>
    </div>
  );
};

export default RobotControl;