import { lazy, Suspense, Component, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useSearchParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SessionTimeoutWatcher } from "@/components/SessionTimeoutWatcher";
import AuthPage from "./pages/AuthPage";
import { consumePostAuthRedirect, isSafeRelativePath } from "@/lib/postAuthRedirect";

// Safe lazy loading with chunk reload fallback for stale deployment caches
function lazyWithRetry<T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await componentImport();
    } catch (error) {
      const hasRefreshed = sessionStorage.getItem("chunk_retry_reload");
      if (!hasRefreshed) {
        sessionStorage.setItem("chunk_retry_reload", "true");
        window.location.reload();
      }
      throw error;
    }
  });
}

// Selective lazy loading for heavy/secondary routes
const Dashboard = lazyWithRetry(() => import("./pages/Dashboard"));
const NewJobPage = lazyWithRetry(() => import("./pages/NewJobPage"));
const SettingsPage = lazyWithRetry(() => import("./pages/SettingsPage"));
const PricingPage = lazyWithRetry(() => import("./pages/PricingPage"));
const TermsPage = lazyWithRetry(() => import("./pages/TermsPage"));
const PrivacyPage = lazyWithRetry(() => import("./pages/PrivacyPage"));
const RefundPage = lazyWithRetry(() => import("./pages/RefundPage"));
const ResetPasswordPage = lazyWithRetry(() => import("./pages/ResetPasswordPage"));
const OAuthConsent = lazyWithRetry(() => import("./pages/OAuthConsent"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const PageFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
    <div className="flex flex-col items-center gap-2">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <span className="text-sm">Loading...</span>
    </div>
  </div>
);

class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-4">
          <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground mb-4">The page could not be loaded.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
          <RouteErrorBoundary>
            <Suspense fallback={<PageFallback />}>
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
            </Suspense>
          </RouteErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

