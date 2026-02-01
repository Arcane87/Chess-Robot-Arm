import { SidebarButton } from "../common";

const ExportButton = ({ setText, pgn }: 
  { setText: any, pgn: string }) => {
  
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

  return (
    <SidebarButton onClick={saveToFile}>
      Save PGN to File
    </SidebarButton>
  );
};

export default ExportButton;