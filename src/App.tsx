import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { ModelRefs } from "./types";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";
import { getStockfishEngine } from "./utils/stockfish";

const App = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const piecesModelRef = useRef<any>();
  const xcornersModelRef = useRef<any>();
  const modelRefs: ModelRefs = {
    "piecesModelRef": piecesModelRef,
    "xcornersModelRef": xcornersModelRef,           
  }

  useEffect(() => {
    const initTensorFlow = async () => {
      try {
        // Initialize TensorFlow backend
        await tf.setBackend('webgl');
        await tf.ready();
        console.log("TensorFlow backend:", tf.getBackend());
        
        // Initialize Stockfish (but don't wait for it)
        setTimeout(() => {
          getStockfishEngine();
          console.log("Stockfish engine initialized");
        }, 1000);
        
        setLoading(false);
      } catch (err: any) {
        console.error("TensorFlow initialization error:", err);
        setError(`TensorFlow Error: ${err.message}`);
        setLoading(false);
      }
    };
    
    initTensorFlow();
  }, []);

  if (error) {
    return (
      <div style={{ padding: '20px', color: 'white', backgroundColor: '#333', height: '100vh' }}>
        <h2>Error</h2>
        <p>{error}</p>
        <p>Please make sure WebGL is enabled in your browser.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }

  return (
    <>
      {!loading && <Outlet context={modelRefs}/>}
      {loading && (
        <div style={{ padding: '20px', color: 'white', backgroundColor: '#333', height: '100vh' }}>
          <h2>Loading TensorFlow...</h2>
          <p>Please wait while TensorFlow initializes.</p>
        </div>
      )}
    </>
  );
};

export default App;