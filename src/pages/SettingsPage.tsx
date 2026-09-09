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
import { LogOut, Trash2, Download } from "lucide-react";

const SettingsPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [pat, setPat] = useState("");
  const [mapsKey, setMapsKey] = useState("");
  const [provider, setProvider] = useState<string>("google");
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
  const [hasMapsKey, setHasMapsKey] = useState(false);

  useEffect(() => {
    if (!user) return;
    getSettings(user.id).then((s) => {
      if (s) {
        setProvider(s.maps_provider ?? "google");
        setHasPat(s.has_pat);
        setHasMapsKey(s.has_maps_key);
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
        maps_api_key?: string | null;
        maps_provider?: string | null;
      } = {
        id: user.id,
        maps_provider: provider,
      };

      // Only send keys if user typed a new value
      if (pat) payload.airtable_pat = pat;
      if (mapsKey) payload.maps_api_key = mapsKey;

      await upsertSettings(payload);
      if (pat) setHasPat(true);
      if (mapsKey) setHasMapsKey(true);
      setPat("");
      setMapsKey("");
      toast({ title: "Saved", description: "Settings updated." });
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
      toast({ title: "Connected", description: `Authenticated as ${result.email || "user"}.` });
    } catch (err: unknown) {
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
      const [settingsRes, mappings, logs] = await Promise.all([
        supabase.rpc("get_settings_flags", { p_user_id: user.id }),
        supabase.from("saved_mappings").select("*").eq("user_id", user.id),
        supabase.from("calculation_logs").select("*").eq("user_id", user.id),
      ]);

      const settingsRow = Array.isArray(settingsRes.data) ? settingsRes.data[0] : null;

      const payload = {
        exported_at: new Date().toISOString(),
        user: { id: user.id, email: user.email },
        settings: settingsRow ?? null,
        saved_mappings: mappings.data ?? [],
        calculation_logs: logs.data ?? [],
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
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: user.email,
        token: otpCode.trim(),
        type: "email",
      });
      if (verifyError) throw new Error("Invalid or expired code. Please try again.");

      const { error } = await supabase.functions.invoke("delete-account");
      if (error) throw error;
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
            <CardTitle className="text-base">Airtable Integration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="pat">Personal Access Token</Label>
                {hasPat && <Badge variant="outline" className="text-xs border-success text-success-foreground">Saved (Hidden)</Badge>}
              </div>
              <Input
                id="pat"
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder={hasPat ? "Enter new token to replace" : "pat..."}
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing || !hasPat}>
              {testing ? "Testing..." : "Test Connection"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Maps Provider</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="google">Google Maps</SelectItem>
                  <SelectItem value="openrouteservice">OpenRouteService</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="mapsKey">API Key</Label>
                {hasMapsKey && <Badge variant="outline" className="text-xs border-success text-success-foreground">Saved (Hidden)</Badge>}
              </div>
              <Input
                id="mapsKey"
                type="password"
                value={mapsKey}
                onChange={(e) => setMapsKey(e.target.value)}
                placeholder={hasMapsKey ? "Enter new key to replace" : "Your API key"}
              />
            </div>
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
                        This will permanently delete your account, settings, saved mappings, and
                        calculation history. This action cannot be undone.
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
