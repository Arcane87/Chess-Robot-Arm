import { useNavigate } from "react-router-dom";

const NavButton = ({ text }: { text: string }) => {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/${text.toLowerCase()}`);
  }

  return (
    <button 
      className="btn btn-dark btn-lg btn-outline-light w-100" 
      onClick={handleClick}
    > 
      {text}
    </button>
  )
}

export default NavButton;