import Header from "./header";
import Socials from "./socials";
import NavButton from "./navButton";

const Home = () => {
  return (
    <div className="container-flex d-flex overflow-hidden h-100 flex-column p-0 m-0 text-center text-white bg-dark">
      <Header />
      <div className="row m-2">
        <div className="col">
          <NavButton text="Upload" />
        </div>
        <div className="col">
          <NavButton text="Record" />
        </div>
      </div>
      <div className="row m-2">
        <div className="col">
          <NavButton text="Analyze" />
        </div>
        <div className="col">
          <NavButton text="Play" />
        </div>
      </div>
      <div className="row m-2">
        <div className="col">
          <NavButton text="Export" />
        </div>
        <div className="col">
          <NavButton text="FAQ" />
        </div>
      </div>
      <div className="row my-2 mx-0 mt-auto">
        <Socials />
        <div key="privacy" className="col">
          <a href="/privacy" className="btn btn-dark btn-lg btn-outline-light w-20">
            Privacy
          </a>
        </div>
      </div>
    </div>
  );
};

export default Home;