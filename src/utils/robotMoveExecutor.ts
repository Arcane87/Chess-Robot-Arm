// Store for averaging piece base coordinates
interface PieceBaseBuffer {
  sourcePieceBase: number[][];
  capturedPieceBase: number[][];
  frameCount: number;
}

const pieceBaseBuffers: Map<string, PieceBaseBuffer> = new Map();

export interface MoveExecutionData {
  sourceSquare: number; // Square number (1-64)
  destSquare: number; // Square number (1-64)
  sourcePieceBaseCamera?: number[]; // Camera coordinates of piece base
  capturedPieceBaseCamera?: number[]; // Camera coordinates of captured piece
  isCapture: boolean;
  uciMove: string;
}

export interface RobotMoveCommand {
  type: 'move' | 'gripper';
  pose?: {
    x: number;
    y: number;
    z: number;
    rx: number;
    ry: number;
    rz: number;
  };
  moveType?: 'clearance' | 'vertical';
  action?: 'open' | 'close' | 'stop' | 'move_to_width';
  width_mm?: number;
  force_n?: number;
  speed_percent?: number;
}

// Configuration - THESE ARE DEFAULTS, WILL BE OVERRIDDEN BY JSON
const CONFIG = {
  PICKUP_Z: 0.194, // 172.10 mm for picking up
  CLEARANCE_Z: 0.240, // 240 mm for clearance movement
  FRAMES_TO_AVERAGE: 5,
  GRIPPER_OPEN_WIDTH_MM: 20.0, // Open to 20mm
  GRIPPER_CLOSE_WIDTH_MM: 0.3, // Close to 0.3mm
  GRIPPER_FORCE_N: 20, // Force in Newtons
  GRIPPER_SPEED_PERCENT: 50 // Speed percentage
};

// Get home and drop poses from the loaded JSON file
const getHomePose = (): any => {
  // Check if poses are available on window (set by transformPoses.ts)
  if ((window as any).chessboardPoses) {
    return (window as any).chessboardPoses.home;
  }
  // Fallback to reasonable defaults
  return {
    x: 0.4,
    y: 0.0,
    z: 0.3,
    rx: 2.205,
    ry: -2.277,
    rz: 0.016
  };
};

const getDropPose = (): any => {
  // Check if poses are available on window (set by transformPoses.ts)
  if ((window as any).chessboardPoses) {
    return (window as any).chessboardPoses.drop;
  }
  // Fallback to reasonable defaults
  return {
    x: 0.3,
    y: -0.2,
    z: 0.28,
    rx: 2.205,
    ry: -2.277,
    rz: 0.016
  };
};

// Average coordinates over multiple frames
const averageCoordinates = (coords: number[][]): number[] => {
  if (coords.length === 0) return [0, 0];
  
  const sum = coords.reduce((acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]], [0, 0]);
  return [sum[0] / coords.length, sum[1] / coords.length];
};

// Add piece base coordinate to buffer for averaging
export const addToPieceBaseBuffer = (
  moveKey: string,
  sourcePieceBase: number[],
  capturedPieceBase?: number[]
): { sourceAvg?: number[]; capturedAvg?: number[]; ready: boolean } => {
  
  if (!pieceBaseBuffers.has(moveKey)) {
    pieceBaseBuffers.set(moveKey, {
      sourcePieceBase: [],
      capturedPieceBase: [],
      frameCount: 0
    });
  }
  
  const buffer = pieceBaseBuffers.get(moveKey)!;
  
  buffer.sourcePieceBase.push(sourcePieceBase);
  if (capturedPieceBase) {
    buffer.capturedPieceBase.push(capturedPieceBase);
  }
  buffer.frameCount++;
  
  if (buffer.frameCount >= CONFIG.FRAMES_TO_AVERAGE) {
    const sourceAvg = averageCoordinates(buffer.sourcePieceBase);
    const capturedAvg = buffer.capturedPieceBase.length > 0 
      ? averageCoordinates(buffer.capturedPieceBase) 
      : undefined;
    
    // Clear buffer after use
    pieceBaseBuffers.delete(moveKey);
    
    return {
      sourceAvg,
      capturedAvg,
      ready: true
    };
  }
  
  return { ready: false };
};

// Clear buffer for a move
export const clearPieceBaseBuffer = (moveKey: string) => {
  pieceBaseBuffers.delete(moveKey);
};

// Send command via WebSocket (same as RobotControl)
const sendCommand = (command: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      const ws = new WebSocket('ws://localhost:8765');
      
      ws.onopen = () => {
        console.log('Sending robot command:', command);
        ws.send(JSON.stringify(command));
        // Don't wait for response, just resolve
        setTimeout(() => {
          ws.close();
          resolve();
        }, 500);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };
      
      // Fallback in case of timeout
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        resolve(); // Resolve anyway to continue execution
      }, 1000);
      
    } catch (error) {
      console.error('Failed to send command:', error);
      reject(error);
    }
  });
};

// Execute a single robot command with delay
const executeCommand = async (command: RobotMoveCommand, delay: number = 3500): Promise<void> => {
  try {
    await sendCommand(command);
    // Wait for the robot to complete the move
    await new Promise(resolve => setTimeout(resolve, delay));
  } catch (error) {
    console.error('Command execution failed:', error);
    throw error;
  }
};

// Generate and execute robot move commands
export const executeRobotMove = async (moveData: MoveExecutionData): Promise<void> => {
  const { sourceSquare, destSquare, isCapture } = moveData;
  
  console.log('Executing robot move:', moveData);
  
  // Get square center poses from transformPoses
  const getSquarePose = (window as any).getSquarePose;
  const getFullRobotPose = (window as any).getFullRobotPose;
  
  if (!getSquarePose || !getFullRobotPose) {
    throw new Error('Square pose functions not available. Calibrate first!');
  }
  
  const sourceSquarePoseRobot = getSquarePose(sourceSquare);
  const destSquarePoseRobot = getSquarePose(destSquare);
  
  if (!sourceSquarePoseRobot || !destSquarePoseRobot) {
    throw new Error('Square poses not available. Calibrate first!');
  }
  
  // Get orientation from JSON (use first corner's orientation)
  let orientation = { rx: 2.205, ry: -2.277, rz: 0.016 };
  if ((window as any).chessboardPoses && (window as any).chessboardPoses.corners && (window as any).chessboardPoses.corners[0]) {
    const corner = (window as any).chessboardPoses.corners[0];
    orientation = { rx: corner.rx, ry: corner.ry, rz: corner.rz };
  }
  
  // Get home and drop poses from JSON
  const homePose = getHomePose();
  const dropPose = getDropPose();
  
  console.log('Using poses from JSON:', {
    home: homePose,
    drop: dropPose,
    orientation,
    gripperConfig: {
      openWidth: CONFIG.GRIPPER_OPEN_WIDTH_MM,
      closeWidth: CONFIG.GRIPPER_CLOSE_WIDTH_MM,
      force: CONFIG.GRIPPER_FORCE_N,
      speed: CONFIG.GRIPPER_SPEED_PERCENT
    }
  });
  
  // Create poses with proper Z heights
  const sourceSquareClearance = [...sourceSquarePoseRobot];
  const destSquareClearance = [...destSquarePoseRobot];
  const sourceSquarePickup = [...sourceSquarePoseRobot];
  const destSquarePickup = [...destSquarePoseRobot];
  
  // Set Z heights
  sourceSquareClearance[2] = CONFIG.CLEARANCE_Z;
  destSquareClearance[2] = CONFIG.CLEARANCE_Z;
  sourceSquarePickup[2] = CONFIG.PICKUP_Z;
  destSquarePickup[2] = CONFIG.PICKUP_Z;
  
  // Convert to pose objects
  const createPose = (coords: number[]) => ({
    x: coords[0],
    y: coords[1],
    z: coords[2],
    rx: orientation.rx,
    ry: orientation.ry,
    rz: orientation.rz
  });
  
  if (!isCapture) {
    // Non-capturing move sequence
    await executeCommand({
      type: 'move',
      pose: createPose(sourceSquareClearance),
      moveType: 'clearance'
    }, 3500);
    
    await executeCommand({
      type: 'move',
      pose: createPose(sourceSquarePickup),
      moveType: 'vertical'
    }, 1000);
    
    await executeCommand({
      type: 'gripper',
      action: 'close',
      width_mm: CONFIG.GRIPPER_CLOSE_WIDTH_MM,
      force_n: CONFIG.GRIPPER_FORCE_N,
      speed_percent: CONFIG.GRIPPER_SPEED_PERCENT
    }, 500);
    
    await executeCommand({
      type: 'move',
      pose: createPose(sourceSquareClearance),
      moveType: 'vertical'
    }, 1000);
    
    await executeCommand({
      type: 'move',
      pose: createPose(destSquareClearance),
      moveType: 'clearance'
    }, 3500);
    
    await executeCommand({
      type: 'move',
      pose: createPose(destSquarePickup),
      moveType: 'vertical'
    }, 1000);
    
    await executeCommand({
      type: 'gripper',
      action: 'open',
      width_mm: CONFIG.GRIPPER_OPEN_WIDTH_MM,
      force_n: CONFIG.GRIPPER_FORCE_N,
      speed_percent: CONFIG.GRIPPER_SPEED_PERCENT
    }, 500);
    
    await executeCommand({
      type: 'move',
      pose: createPose(destSquareClearance),
      moveType: 'vertical'
    }, 1000);
    
    await executeCommand({
      type: 'move',
      pose: homePose,
      moveType: 'clearance'
    }, 4000);
    
  } else {
    // Capturing move sequence
    
    // Step 1: Remove captured piece
    await executeCommand({
      type: 'move',
      pose: createPose(destSquareClearance),
      moveType: 'clearance'
    }, 3500);
    
    await executeCommand({
      type: 'move',
      pose: createPose(destSquarePickup),
      moveType: 'vertical'
    }, 1000);
    
    await executeCommand({
      type: 'gripper',
      action: 'close',
      width_mm: CONFIG.GRIPPER_CLOSE_WIDTH_MM,
      force_n: CONFIG.GRIPPER_FORCE_N,
      speed_percent: CONFIG.GRIPPER_SPEED_PERCENT
    }, 500);
    
    await executeCommand({
      type: 'move',
      pose: createPose(destSquareClearance),
      moveType: 'vertical'
    }, 1000);
    
    await executeCommand({
      type: 'move',
      pose: { ...dropPose, z: CONFIG.CLEARANCE_Z },
      moveType: 'clearance'
    }, 3500);
    
    await executeCommand({
      type: 'move',
      pose: dropPose,
      moveType: 'vertical'
    }, 1000);
    
    await executeCommand({
      type: 'gripper',
      action: 'open',
      width_mm: CONFIG.GRIPPER_OPEN_WIDTH_MM,
      force_n: CONFIG.GRIPPER_FORCE_N,
      speed_percent: CONFIG.GRIPPER_SPEED_PERCENT
    }, 500);
    
    await executeCommand({
      type: 'move',
      pose: { ...dropPose, z: CONFIG.CLEARANCE_Z },
      moveType: 'vertical'
    }, 1000);
    
    // Step 2: Move capturing piece
    await executeCommand({
      type: 'move',
      pose: createPose(sourceSquareClearance),
      moveType: 'clearance'
    }, 3500);
    
    await executeCommand({
      type: 'move',
      pose: createPose(sourceSquarePickup),
      moveType: 'vertical'
    }, 1000);
    
    await executeCommand({
      type: 'gripper',
      action: 'close',
      width_mm: CONFIG.GRIPPER_CLOSE_WIDTH_MM,
      force_n: CONFIG.GRIPPER_FORCE_N,
      speed_percent: CONFIG.GRIPPER_SPEED_PERCENT
    }, 500);
    
    await executeCommand({
      type: 'move',
      pose: createPose(sourceSquareClearance),
      moveType: 'vertical'
    }, 1000);
    
    await executeCommand({
      type: 'move',
      pose: createPose(destSquareClearance),
      moveType: 'clearance'
    }, 3500);
    
    await executeCommand({
      type: 'move',
      pose: createPose(destSquarePickup),
      moveType: 'vertical'
    }, 1000);
    
    await executeCommand({
      type: 'gripper',
      action: 'open',
      width_mm: CONFIG.GRIPPER_OPEN_WIDTH_MM,
      force_n: CONFIG.GRIPPER_FORCE_N,
      speed_percent: CONFIG.GRIPPER_SPEED_PERCENT
    }, 500);
    
    await executeCommand({
      type: 'move',
      pose: createPose(destSquareClearance),
      moveType: 'vertical'
    }, 1000);
    
    await executeCommand({
      type: 'move',
      pose: homePose,
      moveType: 'clearance'
    }, 4000);
  }
  
  console.log('✅ Robot move sequence completed with specified gripper widths');
};