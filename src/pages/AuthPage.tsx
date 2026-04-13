import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import Footer from "@/components/Footer";
import { MapPin, Zap, FileText } from "lucide-react";

const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = isLogin
      ? await signIn(email, password)
      : await signUp(email, password);

    setLoading(false);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    if (!isLogin) {
      toast({ title: "Check your email", description: "We sent you a confirmation link." });
      return;
    }

    navigate("/dashboard");
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast({ title: "Error", description: (result.error as Error).message, variant: "destructive" });
      setGoogleLoading(false);
      return;
    }
    if (result.redirected) return;
    navigate("/dashboard");
  

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-4xl grid gap-10 md:grid-cols-2 md:gap-16 items-center">
          {/* Hero / Marketing Section */}
          <div className="space-y-6 text-center md:text-left">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              AirMileX: Automate Your Airtable Mileage Tracking
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Instantly calculate driving distances between addresses in your Airtable base and generate IRS-compliant mileage logs with zero manual effort.
            </p>
            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <p className="text-sm text-muted-foreground">Connect your Airtable base and map address columns in seconds.</p>
              </div>
              <div className="flex items-start gap-3">
                <Zap className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <p className="text-sm text-muted-foreground">Batch-calculate distances using Google Maps or OpenRouteService.</p>
              </div>
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <p className="text-sm text-muted-foreground">Generate accurate, audit-ready mileage records automatically.</p>
              </div>
            </div>
          </div>

          {/* Auth Card */}
          <Card className="w-full max-w-sm mx-auto md:mx-0">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Get Started</CardTitle>
              <CardDescription>{isLogin ? "Sign in to your account" : "Create a new account"}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="••••••••"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Loading..." : isLogin ? "Sign In" : "Sign Up"}
                </Button>
              </form>
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
              >
                {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default AuthPage;
