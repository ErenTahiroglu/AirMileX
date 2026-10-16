import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useSearchParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SessionTimeoutWatcher } from "@/components/SessionTimeoutWatcher";
import AuthPage from "./pages/AuthPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import Dashboard from "./pages/Dashboard";
import SettingsPage from "./pages/SettingsPage";
import NewJobPage from "./pages/NewJobPage";
import PricingPage from "./pages/PricingPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import RefundPage from "./pages/RefundPage";
import OAuthConsent from "./pages/OAuthConsent";
import NotFound from "./pages/NotFound";
import { consumePostAuthRedirect, isSafeRelativePath } from "@/lib/postAuthRedirect";

const queryClient = new QueryClient();

const AuthRedirect = () => {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  if (loading) return null;
  if (user) {
    const urlNext = searchParams.get("next");
    const safeUrlNext = isSafeRelativePath(urlNext) ? urlNext : null;
    const target = safeUrlNext ?? consumePostAuthRedirect() ?? "/dashboard";
    if (safeUrlNext) {
      consumePostAuthRedirect();
    }
    return <Navigate to={target} replace />;
  }
  return <AuthPage />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <SessionTimeoutWatcher />
          <Routes>
            <Route path="/" element={<AuthRedirect />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/terms-and-conditions" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/refund" element={<RefundPage />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="/new-job" element={<ProtectedRoute><NewJobPage /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
