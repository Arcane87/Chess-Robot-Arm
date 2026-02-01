import { Sidebar } from "../common";
import React, { useState } from 'react';

const ExportSidebar = ({ pgn }: { pgn: string }) => {
  const [text, setText] = useState<string[]>(["Save PGN locally or copy to clipboard"]);

  const saveToFile = () => {
    const blob = new Blob([pgn], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chess_game_${new Date().toISOString().slice(0, 10)}.pgn`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setText(["PGN saved to file"]);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(pgn);
    setText(["PGN copied to clipboard"]);
  };

  return (
    <Sidebar playing={false} text={text} setText={setText}>
      <li className="border-top"></li>
      <li className="my-2">
        <button 
          className="btn btn-dark btn-sm btn-outline-light w-100"
          onClick={saveToFile}
        >
          Save PGN to File
        </button>
      </li>
      <li className="my-2">
        <button 
          className="btn btn-dark btn-sm btn-outline-light w-100"
          onClick={copyToClipboard}
        >
          Copy PGN to Clipboard
        </button>
      </li>
    </Sidebar>
  );
};

export default ExportSidebar;