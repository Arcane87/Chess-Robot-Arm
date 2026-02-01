// public/stockfish-wrapper.js
// A simple wrapper that initializes the WASM engine you already have

// This is the Module object that your stockfish.wasm.js expects
var Module = {
    locateFile: function(path) {
        // Tell the WASM engine where to find the .wasm file
        if (path.endsWith('.wasm')) {
            return '/stockfish.wasm'; // Your local file
        }
        return path;
    },
    onRuntimeInitialized: function() {
        console.log('Stockfish WASM engine initialized');
    },
    print: function(text) {
        // Forward Stockfish output to console
        console.log('SF:', text);
    },
    printErr: function(text) {
        console.error('SF ERR:', text);
    }
};

// Load the stockfish.wasm.js which will initialize the WASM module
// This expects a global 'Module' object to be defined (which we just did)
var script = document.createElement('script');
script.src = '/stockfish.wasm.js'; // Your local file
script.onload = function() {
    console.log('Stockfish engine script loaded');
    // The WASM engine is now loaded and can be accessed via window.Module
    // or whatever global name your stockfish.wasm.js uses
};
document.head.appendChild(script);