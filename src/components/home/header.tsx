import { useNavigate } from "react-router-dom";

const Header = () => {
  const navigate = useNavigate();
  
  return (
    <div className="row m-2">
      <div className="h1 col-6 h-100 d-flex justify-content-center align-items-end m-0">
        <img src="favicon.ico"></img>
        <>&nbsp;</>
        <div>ChessCam</div>
      </div>
      <div className="col-6 h-100">
        <div className="h-100 d-flex justify-content-center align-items-end m-0">
          <button className="btn btn-dark btn-outline-light m-0" onClick={() => navigate("/")}>
            Home
          </button> 
        </div>
      </div>
    </div>
  );
}

export default Header;