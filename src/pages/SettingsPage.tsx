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
import { LogOut, Trash2 } from "lucide-react";

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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container flex h-14 items-center gap-4">
          <Button variant="ghost" size="sm" asChild><Link to="/dashboard">← Dashboard</Link></Button>
          <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        </div>
      </header>

      <main className="container max-w-lg py-8 space-y-6">
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
            <CardDescription>Manage your account sessions across all devices.</CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default SettingsPage;
