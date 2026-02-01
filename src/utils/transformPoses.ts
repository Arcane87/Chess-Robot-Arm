import { getPerspectiveTransform, perspectiveTransform } from "./warp";
import { SQUARE_NAMES } from "./constants";

// Types for robot poses
export interface RobotPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

interface ChessboardPoses {
  corners: RobotPose[];
  home: RobotPose;
  drop: RobotPose;
}

// Global storage for transformed coordinates
let transformedCenters: number[][] = [];
let transformationMatrix: any = null;
let chessboardPoses: ChessboardPoses | null = null; // Store loaded poses globally

// Function to load and parse the chessboard_poses.json file
export const loadChessboardPoses = async (): Promise<ChessboardPoses> => {
  try {
    const response = await fetch('/chessboard_poses.json');
    const data: ChessboardPoses = await response.json();
    chessboardPoses = data; // Store globally for later use
    console.log('Loaded chessboard poses:', data);
    return data;
  } catch (error) {
    console.error('Failed to load chessboard poses:', error);
    throw error;
  }
};

// Calculate transformation matrix from camera coordinates to robot coordinates
export const calculateTransformation = (
  cameraCornerCenters: number[][], // [A1, H1, H8, A8] camera coordinates
  robotCornerPoses: number[][]     // [A1, H1, H8, A8] robot coordinates (x, y)
): any => {
  // Camera points: A1, H1, H8, A8
  const cameraPoints = [
    cameraCornerCenters[0],  // A1
    cameraCornerCenters[7],  // H1
    cameraCornerCenters[63], // H8
    cameraCornerCenters[56], // A8
  ];

  // Robot points from JSON: A1, H1, H8, A8 (only x, y)
  const robotPoints = robotCornerPoses;

  console.log('Calculating transformation matrix...');
  console.log('Camera corner centers:', cameraPoints);
  console.log('Robot corner poses:', robotPoints);

  // Calculate transformation matrix (from camera to robot coordinates)
  const transform = getPerspectiveTransform(robotPoints, cameraPoints);
  transformationMatrix = transform;
  
  console.log('Transformation matrix calculated:', transform);
  return transform;
};

// Apply transformation to all square centers
export const transformAllSquares = (
  allCameraCenters: number[][], // All 64 square centers from camera
  transformation: any
): number[][] => {
  if (!transformation) {
    console.error('No transformation matrix available');
    return [];
  }

  // Transform all 64 centers
  const transformed = perspectiveTransform(allCameraCenters, transformation);
  transformedCenters = transformed;
  
  console.log('Transformed all squares:', transformed);
  return transformed;
};

// Get transformed coordinates for a specific square (1-64)
export const getSquarePose = (squareNumber: number): number[] | null => {
  if (squareNumber < 1 || squareNumber > 64) {
    console.error('Square number must be between 1 and 64');
    return null;
  }
  
  if (transformedCenters.length < 64) {
    console.error('Transformed centers not available yet. Calibrate first!');
    return null;
  }
  
  return transformedCenters[squareNumber - 1]; // Convert to 0-based index
};

// Get full robot pose including Z and orientation
export const getFullRobotPose = (squareNumber: number): RobotPose | undefined => {
  const xyPose = getSquarePose(squareNumber);
  if (!xyPose || !chessboardPoses) {
    console.error('Cannot get full robot pose. Calibrate first or poses not loaded.');
    return undefined;
  }
  
  // Use first corner's Z and orientation as default
  const cornerPose = chessboardPoses.corners[0];
  
  return {
    x: xyPose[0],
    y: xyPose[1],
    z: cornerPose.z,     // From JSON
    rx: cornerPose.rx,   // From JSON
    ry: cornerPose.ry,   // From JSON
    rz: cornerPose.rz    // From JSON
  };
};

// Get square name and pose for a given number
export const getSquareInfo = (squareNumber: number): {
  squareName: string;
  cameraX: number;
  cameraY: number;
  robotX?: number;
  robotY?: number;
  fullPose?: RobotPose;
} | null => {
  if (squareNumber < 1 || squareNumber > 64) {
    return null;
  }
  
  const index = squareNumber - 1;
  const squareName = SQUARE_NAMES[index];
  
  // Try to get camera coordinates from global cache
  let cameraX = 0;
  let cameraY = 0;
  if (typeof window !== 'undefined' && (window as any).centersCache) {
    const cameraCenters = (window as any).centersCache;
    if (cameraCenters.length > index) {
      cameraX = cameraCenters[index][0];
      cameraY = cameraCenters[index][1];
    }
  }
  
  // Get robot coordinates
  const robotPose = getSquarePose(squareNumber);
  const fullPose = getFullRobotPose(squareNumber);
  
  return {
    squareName,
    cameraX,
    cameraY,
    robotX: robotPose?.[0],
    robotY: robotPose?.[1],
    fullPose
  };
};

// Store poses on window for access by robotMoveExecutor
export const storePosesOnWindow = (poses: any) => {
  if (typeof window !== 'undefined') {
    (window as any).chessboardPoses = poses;
    console.log('Chessboard poses stored on window:', poses);
  }
};

// Main function to process everything
export const processChessboardCoordinates = async (
  cameraCenters: number[][] // All 64 square centers from camera
): Promise<void> => {
  if (!cameraCenters || cameraCenters.length < 64) {
    console.error('Invalid camera centers array');
    return;
  }
  
  // Store camera centers globally for access
  if (typeof window !== 'undefined') {
    (window as any).centersCache = cameraCenters;
  }
  
  try {
    // Load robot poses
    const poses = await loadChessboardPoses();
    
    // Store poses on window for robotMoveExecutor to access
    storePosesOnWindow(poses);
    
    // Extract robot corner coordinates (x, y only)
    const robotCorners = poses.corners.map(pose => [pose.x, pose.y]);
    
    // Calculate transformation
    const transform = calculateTransformation(cameraCenters, robotCorners);
    
    // Transform all squares
    const transformed = transformAllSquares(cameraCenters, transform);
    
    console.log('=== TRANSFORMATION COMPLETE ===');
    console.log('All 64 squares have been transformed to robot coordinates');
    console.log('Default Z height:', poses.corners[0].z);
    console.log('Default orientation:', poses.corners[0].rx, poses.corners[0].ry, poses.corners[0].rz);
    console.log('Home pose:', poses.home);
    console.log('Drop pose:', poses.drop);
    console.log('Use getSquareInfo(squareNumber) to get coordinates');
    console.log('Example: getSquareInfo(11) for C2');
    console.log('================================');
    
  } catch (error) {
    console.error('Failed to process chessboard coordinates:', error);
  }
};

// Get all transformed centers for debugging/export
export const getAllTransformedCenters = (): number[][] => {
  return transformedCenters;
};

// Export a simple CLI-like interface for testing
export const setupCLI = () => {
  if (typeof window !== 'undefined') {
    (window as any).getSquarePose = getSquarePose;
    (window as any).getSquareInfo = getSquareInfo;
    (window as any).getFullRobotPose = getFullRobotPose;
    (window as any).transformedCenters = transformedCenters;
    (window as any).getAllTransformedCenters = getAllTransformedCenters;
    (window as any).chessboardPoses = chessboardPoses;
    
    console.log('=== CHESSBOARD COORDINATES CLI ===');
    console.log('Commands available in console:');
    console.log('- getSquarePose(11) - Get robot XY coordinates for square 11');
    console.log('- getSquareInfo(11) - Get square name and all coordinates');
    console.log('- getFullRobotPose(11) - Get full robot pose (with Z and orientation)');
    console.log('- transformedCenters - Array of all 64 transformed centers');
    console.log('- getAllTransformedCenters() - Function to get all centers');
    console.log('- chessboardPoses - The loaded chessboard poses from JSON');
    console.log('==================================');
  }
};

// Transform camera coordinates to robot coordinates using existing transformation
export const transformCameraToRobot = (cameraPoint: number[]): number[] => {
  if (!transformationMatrix) {
    console.error('Transformation matrix not available. Calibrate first!');
    return cameraPoint; // Fallback to camera coordinates
  }
  
  try {
    // Add homogeneous coordinate
    const pointWithHomogeneous = [cameraPoint[0], cameraPoint[1], 1];
    const transformed = perspectiveTransform([pointWithHomogeneous], transformationMatrix);
    return transformed[0];
  } catch (error) {
    console.error('Failed to transform camera point:', error);
    return cameraPoint;
  }
};

// Export existing variables/functions that might be needed
export { transformationMatrix, transformedCenters };