import { getSquarePose, getSquareInfo } from './transformPoses';

// Simple function to test square coordinates
export const testSquareCoordinates = (squareNumber: number): void => {
  const pose = getSquarePose(squareNumber);
  const info = getSquareInfo(squareNumber);
  
  if (pose && info) {
    console.log(`=== Square ${squareNumber} (${info.squareName}) ===`);
    console.log(`Robot Coordinates:`);
    console.log(`  X: ${pose[0].toFixed(4)}`);
    console.log(`  Y: ${pose[1].toFixed(4)}`);
    console.log(`===============================`);
  } else {
    console.log(`Coordinates for square ${squareNumber} not available yet.`);
    console.log(`Make sure to calibrate corners and press Play first.`);
  }
};

// Expose to window for easy testing
if (typeof window !== 'undefined') {
  (window as any).testSquare = testSquareCoordinates;
  console.log('Test command available: testSquare(11)');
}