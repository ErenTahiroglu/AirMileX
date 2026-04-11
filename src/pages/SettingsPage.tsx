import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getSettings, upsertSettings } from "@/services/settings";
import { testConnection } from "@/services/airtable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const SettingsPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [pat, setPat] = useState("");
  const [mapsKey, setMapsKey] = useState("");
  const [provider, setProvider] = useState<string>("google");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
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
      </main>
    </div>
  );
};

export default SettingsPage;
