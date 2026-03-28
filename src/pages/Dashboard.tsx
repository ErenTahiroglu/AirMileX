import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getTotalRecords, getRecentLogs, CalculationLog } from "@/services/logs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const [total, setTotal] = useState(0);
  const [logs, setLogs] = useState<CalculationLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        const [t, l] = await Promise.all([
          getTotalRecords(user.id),
          getRecentLogs(user.id, 5),
        ]);
        setTotal(t);
        setLogs(l);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

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
