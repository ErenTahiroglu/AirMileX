import { Link } from "react-router-dom";

const Footer = () => (
  <footer className="w-full border-t py-6 mt-auto">
    <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
      <Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
      <Link to="/terms-and-conditions" className="hover:text-foreground transition-colors">Terms of Service</Link>
      <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
      <Link to="/refund" className="hover:text-foreground transition-colors">Refund Policy</Link>
    </div>
    <p className="mt-3 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} AirMileX. All rights reserved.</p>
  </footer>
);

export default Footer;
