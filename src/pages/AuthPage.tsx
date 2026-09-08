import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";
import PasswordStrength from "@/components/PasswordStrength";
import { friendlyAuthError } from "@/lib/authErrors";
import { consumePostAuthRedirect, storePostAuthRedirect } from "@/lib/postAuthRedirect";
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
  const [searchParams] = useSearchParams();

  // Preserve a requested destination (e.g. an app authorization request) across sign-in.
  useEffect(() => {
    storePostAuthRedirect(searchParams.get("next"));
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = isLogin
      ? await signIn(email, password)
      : await signUp(email, password);

    setLoading(false);

    if (error) {
      const friendly = friendlyAuthError(error);
      toast({ title: friendly.title, description: friendly.description, variant: "destructive" });
      return;
    }

    if (!isLogin) {
      toast({ title: "Check your email", description: "We sent you a confirmation link." });
      return;
    }

    navigate(consumePostAuthRedirect() ?? "/dashboard");
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      const friendly = friendlyAuthError(result.error);
      toast({ title: friendly.title, description: friendly.description, variant: "destructive" });
      setGoogleLoading(false);
      return;
    }
    if (result.redirected) return;
    navigate("/dashboard");
  };

  const handleForgotPassword = async () => {
    if (!email) {
      toast({ title: "Enter your email", description: "Type your email above first, then click forgot password.", variant: "destructive" });
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      const friendly = friendlyAuthError(error);
      toast({ title: friendly.title, description: friendly.description, variant: "destructive" });
      return;
    }
    toast({ title: "Check your email", description: "We sent you a password reset link." });
  };
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Seo
        title="AirMileX — Airtable Mileage Tracking & Distance Calculator"
        description="Automate your Airtable mileage tracking. Calculate driving distances in batches and generate IRS-compliant logs with zero manual effort."
        path="/"
      />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
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
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogleSignIn}
                disabled={googleLoading}
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {googleLoading ? "Signing in..." : "Continue with Google"}
              </Button>
              <div className="relative my-4">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                  or
                </span>
              </div>
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
                  {!isLogin && <PasswordStrength password={password} />}
                </div>
                {isLogin && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
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
      </main>
      <Footer />
    </div>
  );
};

export default AuthPage;
