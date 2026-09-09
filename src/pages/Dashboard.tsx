import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getTotalRecords, getRecentLogs, CalculationLog } from "@/services/logs";
import { getSettings } from "@/services/settings";
import { createCheckout } from "@/services/paddle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [total, setTotal] = useState(0);
  const [credits, setCredits] = useState<number | null>(null);
  const [logs, setLogs] = useState<CalculationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [buyingCredits, setBuyingCredits] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        const [t, l, s] = await Promise.all([
          getTotalRecords(user.id),
          getRecentLogs(user.id, 5),
          getSettings(user.id),
        ]);
        setTotal(t);
        setLogs(l);
        setCredits(s?.credits ?? 0);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const handleBuyCredits = async () => {
    setBuyingCredits(true);
    try {
      const result = await createCheckout();
      if (result.checkout_url) {
        window.open(result.checkout_url, "_blank");
      } else {
        toast({ title: "Error", description: "No checkout URL returned.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Checkout failed", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setBuyingCredits(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container flex h-14 items-center justify-between">
          <h1 className="text-lg font-semibold text-foreground">Mileage Calculator</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>Sign Out</Button>
          </div>
        </div>
      </header>

      <main className="container py-8 space-y-6">
        <div className="flex gap-3">
          <Button asChild><Link to="/settings">Settings</Link></Button>
          <Button asChild><Link to="/new-job">New Mileage Job</Link></Button>
        </div>

        <h2 className="sr-only">Account overview</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Total Records Processed</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              ) : (
                <p className="text-3xl font-bold text-foreground">{total.toLocaleString()}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Credits Remaining</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              ) : (
                <>
                  <p className="text-3xl font-bold text-foreground">{credits?.toLocaleString() ?? 0}</p>
                  <Button
                    size="sm"
                    onClick={handleBuyCredits}
                    disabled={buyingCredits}
                  >
                    {buyingCredits ? "Processing…" : "Buy 500 Credits — $9"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {logs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Syncs</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead>Provider</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>{new Date(log.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>{log.records_processed}</TableCell>
                      <TableCell>{log.provider_used}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
