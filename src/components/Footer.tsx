import { Link, useNavigate } from "react-router-dom";

const Footer = () => {
  const navigate = useNavigate();

  const handleNav = (path: string) => {
    navigate(path);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return (
    <footer className="w-full border-t py-6 mt-auto">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <button onClick={() => handleNav("/pricing")} className="hover:text-foreground transition-colors">Pricing</button>
        <button onClick={() => handleNav("/terms-and-conditions")} className="hover:text-foreground transition-colors">Terms of Service</button>
        <button onClick={() => handleNav("/privacy")} className="hover:text-foreground transition-colors">Privacy Policy</button>
        <button onClick={() => handleNav("/refund")} className="hover:text-foreground transition-colors">Refund Policy</button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} AirMileX. All rights reserved.</p>
    </footer>
  );
};

export default Footer;
