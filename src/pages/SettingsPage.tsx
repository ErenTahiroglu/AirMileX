import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getSettings, upsertSettings } from "@/services/settings";
import { testConnection } from "@/services/airtable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { LogOut, Trash2, Download, ArrowRight, ExternalLink, KeyRound } from "lucide-react";

const SettingsPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [pat, setPat] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteStep, setDeleteStep] = useState<"confirm" | "verify">("confirm");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hasPat, setHasPat] = useState(false);
  const [connectionUser, setConnectionUser] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getSettings(user.id).then((s) => {
      if (s) {
        setHasPat(s.has_pat);
      }
    });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const payload: {
        id: string;
        airtable_pat?: string | null;
      } = {
        id: user.id,
      };

      // Only send keys if user typed a new value
      if (pat) payload.airtable_pat = pat;

      await upsertSettings(payload);
      if (pat) {
        setHasPat(true);
        setConnectionUser(null);
      }
      setPat("");
      toast({ title: "Saved", description: "Settings updated successfully." });
    } catch (err: unknown) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testConnection();
      setConnectionUser(result.email || "Verified");
      toast({ title: "Connected", description: `Authenticated as ${result.email || "user"}.` });
    } catch (err: unknown) {
      setConnectionUser(null);
      toast({ title: "Connection Failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const handleSignOutEverywhere = async () => {
    setSigningOut(true);
    // scope: 'global' revokes all refresh tokens for this user across all devices
    const { error } = await supabase.auth.signOut({ scope: "global" });
    setSigningOut(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Signed out everywhere", description: "All your sessions have been ended." });
    navigate("/", { replace: true });
  };

  const handleExportData = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const [settingsRes, mappings, logs, addressPairs] = await Promise.all([
        supabase.rpc("get_settings_flags", { p_user_id: user.id }),
        supabase.from("saved_mappings").select("*").eq("user_id", user.id),
        supabase.from("calculation_logs").select("*").eq("user_id", user.id),
        supabase.from("saved_address_pairs").select("*").eq("user_id", user.id),
      ]);

      const settingsRow = Array.isArray(settingsRes.data) ? settingsRes.data[0] : null;

      const payload = {
        exported_at: new Date().toISOString(),
        user: { id: user.id, email: user.email },
        settings: settingsRow ?? null,
        saved_mappings: mappings.data ?? [],
        calculation_logs: logs.data ?? [],
        saved_address_pairs: addressPairs.data ?? [],
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `airmilex-data-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: "Data exported", description: "Your data has been downloaded." });
    } catch (err: unknown) {
      toast({ title: "Export failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleSendDeleteCode = async () => {
    if (!user?.email) return;
    setSendingCode(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: user.email,
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
      setDeleteStep("verify");
      toast({
        title: "Code sent",
        description: `We sent a 6-digit code to ${user.email}. Enter it to confirm deletion.`,
      });
    } catch (err: unknown) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSendingCode(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user?.email) return;
    setDeleting(true);
    try {
      const code = otpCode.trim();
      if (code.length !== 6) {
        throw new Error("Please enter a valid 6-digit confirmation code.");
      }

      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: { otp_code: code },
      });

      if (error) {
        let msg = error.message;
        try {
          if ("context" in error && error.context) {
            const body = await (error.context as Response).json();
            if (body?.error) msg = body.error;
          }
        } catch {
          // ignore parsing error
        }
        throw new Error(msg || "Failed to delete account");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      await supabase.auth.signOut({ scope: "global" });
      toast({ title: "Account deleted", description: "Your account and data have been removed." });
      navigate("/", { replace: true });
    } catch (err: unknown) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const resetDeleteDialog = () => {
    setDeleteStep("confirm");
    setDeleteConfirm("");
    setOtpCode("");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container flex h-14 items-center gap-4">
          <Button variant="ghost" size="sm" asChild><Link to="/dashboard">← Dashboard</Link></Button>
          <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        </div>
      </header>

      <main className="container max-w-lg py-8 space-y-6">
        <h2 className="sr-only">Account settings</h2>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                Airtable Integration
              </CardTitle>
              {hasPat ? (
                <Badge variant="outline" className="text-xs border-green-600 text-green-700 bg-green-50">
                  {connectionUser ? `✓ Connected (${connectionUser})` : "✓ Token Saved"}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs border-amber-500 text-amber-700 bg-amber-50">
                  Token Required
                </Badge>
              )}
            </div>
            <CardDescription>
              Connect your Airtable account with a Personal Access Token to read addresses and write back calculated distances.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">How to create your Personal Access Token:</span>
                <a
                  href="https://airtable.com/create/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                >
                  Create token on Airtable
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <ol className="list-decimal list-inside space-y-1 pl-1">
                <li>Create a token named <span className="font-mono text-foreground">AirMileX</span>.</li>
                <li>Add scopes: <span className="font-mono text-foreground">data.records:read</span>, <span className="font-mono text-foreground">data.records:write</span>, <span className="font-mono text-foreground">schema.bases:read</span>.</li>
                <li>Under <strong>Access</strong>, select the workspace or bases containing your mileage tables.</li>
                <li>Paste the token below and click <strong>Save Settings</strong>.</li>
              </ol>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="pat">Personal Access Token</Label>
                {hasPat && <span className="text-xs text-muted-foreground">Token is securely stored</span>}
              </div>
              <Input
                id="pat"
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder={hasPat ? "•••••••••••••••••••• (Enter new token to replace)" : "pat..."}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving || (!pat && hasPat)} size="sm">
                {saving ? "Saving..." : "Save Token"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleTest} disabled={testing || !hasPat}>
                {testing ? "Testing..." : "Test Connection"}
              </Button>
              {hasPat && (
                <Button variant="secondary" size="sm" asChild className="ml-auto">
                  <Link to="/new-job" className="inline-flex items-center gap-1">
                    Start Mileage Job
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Maps Integration</CardTitle>
            <CardDescription>
              Driving distance calculations are operator-managed and included with your AirMileX account credits. Powered by{" "}
              <a
                href="https://www.geoapify.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Geoapify
              </a>{" "}
              | ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                OpenStreetMap
              </a>{" "}
              contributors.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No personal map API key required. Calculations run automatically using operator-managed routing services.
            </p>
          </CardContent>
        </Card>


        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? "Saving..." : "Save Settings"}
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Security</CardTitle>
            <CardDescription>Manage your sessions or permanently delete your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out everywhere
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sign out of all sessions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will end your session on every device where you're currently signed in,
                    including this one. You'll need to sign in again to continue.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={signingOut}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleSignOutEverywhere}
                    disabled={signingOut}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {signingOut ? "Signing out..." : "Sign out everywhere"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleExportData}
              disabled={exporting}
            >
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "Exporting..." : "Export my data (JSON)"}
            </Button>

            <AlertDialog onOpenChange={(open) => { if (!open) resetDeleteDialog(); }}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                {deleteStep === "confirm" ? (
                  <>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete your account permanently?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete your account, settings, saved address pairs,
                        saved mappings, and calculation history. This action cannot be undone.
                        An audit log of the deletion request timestamp and status is retained for
                        security and rate-limiting purposes.
                        <br /><br />
                        We strongly recommend exporting your data first. Type <strong>DELETE</strong>{" "}
                        to continue — we'll then email a 6-digit code to confirm.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder="DELETE"
                      autoComplete="off"
                    />
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={sendingCode}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault();
                          handleSendDeleteCode();
                        }}
                        disabled={sendingCode || deleteConfirm !== "DELETE"}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {sendingCode ? "Sending code..." : "Send confirmation code"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </>
                ) : (
                  <>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Enter confirmation code</AlertDialogTitle>
                      <AlertDialogDescription>
                        We sent a 6-digit code to <strong>{user?.email}</strong>. Enter it below to
                        permanently delete your account.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="123456"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                    />
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault();
                          handleDeleteAccount();
                        }}
                        disabled={deleting || otpCode.length !== 6}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {deleting ? "Deleting..." : "Delete forever"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </>
                )}
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default SettingsPage;
