import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, Loader2, Sparkles } from "lucide-react";
import { cleanupAddresses, type CleanAddress, type CleanupResult } from "@/services/addressCleanup";

const confidenceVariant = (c: CleanAddress["confidence"]) =>
  c === "high" ? "default" : c === "medium" ? "secondary" : "destructive";

const ResultRow = ({ label, value }: { label: string; value: CleanAddress }) => {
  const { toast } = useToast();
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Badge variant={confidenceVariant(value.confidence)}>{value.confidence} confidence</Badge>
      </div>
      <div className="mt-1 flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{value.address}</p>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            navigator.clipboard.writeText(value.address);
            toast({ title: "Address copied" });
          }}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      {value.note && <p className="mt-1 text-xs text-muted-foreground">{value.note}</p>}
    </div>
  );
};

/** Lets users paste rough trip notes and get clean, geocoding-ready addresses. */
const AddressCleaner = () => {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CleanupResult | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await cleanupAddresses(start, end));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Address Cleaner</CardTitle>
        <CardDescription>
          Type rough notes like "client office near Kadıköy pier" and get clear addresses ready for distance calculation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cleaner-start">Start location note</Label>
              <Textarea id="cleaner-start" value={start} onChange={(e) => setStart(e.target.value)} maxLength={300} rows={2} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cleaner-end">End location note</Label>
              <Textarea id="cleaner-end" value={end} onChange={(e) => setEnd(e.target.value)} maxLength={300} rows={2} required />
            </div>
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {loading ? "Cleaning up..." : "Clean up addresses"}
          </Button>
        </form>
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        {result && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ResultRow label="Start address" value={result.start} />
            <ResultRow label="End address" value={result.end} />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AddressCleaner;
