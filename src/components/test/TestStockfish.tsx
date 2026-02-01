import { useEffect, useState } from 'react';
import { getStockfishEngine } from '../../utils/stockfish';

const TestStockfish = () => {
  const [message, setMessage] = useState('Loading Stockfish...');
  const [engine, setEngine] = useState<any>(null);
  
  useEffect(() => {
    const init = async () => {
      const sfEngine = getStockfishEngine();
      setEngine(sfEngine);
      
      // Wait a bit for initialization
      setTimeout(async () => {
        try {
          const result = await sfEngine.analyzePosition(
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            12
          );
          
          if (result.evaluation !== undefined) {
            setMessage(`Stockfish working! Eval: ${result.evaluation > 0 ? '+' : ''}${result.evaluation.toFixed(2)}`);
          } else if (result.mateIn !== undefined) {
            setMessage(`Stockfish working! Mate in ${Math.abs(result.mateIn)}`);
          } else {
            setMessage('Stockfish loaded but no eval received');
          }
        } catch (error) {
          setMessage('Error testing Stockfish: ' + error);
        }
      }, 2000);
    };
    
    init();
  }, []);
  
  const testMove = async () => {
    if (engine) {
      setMessage('Calculating move...');
      const move = await engine.getBestMove(
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        1000
      );
      setMessage(`Best move: ${move || 'No move found'}`);
    }
  };
  
  return (
    <div style={{ padding: '20px', color: 'white', backgroundColor: '#333', height: '100vh' }}>
      <h2>Stockfish Test</h2>
      <p>{message}</p>
      <button 
        onClick={testMove}
        style={{ 
          padding: '10px 20px', 
          backgroundColor: '#007bff', 
          color: 'white', 
          border: 'none', 
          borderRadius: '5px',
          marginRight: '10px'
        }}
      >
        Test Stockfish Move
      </button>
      <button 
        onClick={() => window.location.href = '/'}
        style={{ 
          padding: '10px 20px', 
          backgroundColor: '#6c757d', 
          color: 'white', 
          border: 'none', 
          borderRadius: '5px' 
        }}
      >
        Back to Home
      </button>
    </div>
  );
};

export default TestStockfish;