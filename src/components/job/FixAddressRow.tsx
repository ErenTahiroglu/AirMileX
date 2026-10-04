import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { suggestAddressFix, type AddressFixResult } from "@/services/aiAssist";

interface Props {
  start: string;
  end: string;
  onApply: (start: string, end: string) => Promise<void>;
  onError: (message: string, status: number) => void;
}

/** "Fix with AI" for one failed row: shows only map-verified suggestions. */
const FixAddressRow = ({ start, end, onApply, onError }: Props) => {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<AddressFixResult | null>(null);
  const [pickStart, setPickStart] = useState<string | null>(null);
  const [pickEnd, setPickEnd] = useState<string | null>(null);

  const ask = async () => {
    setLoading(true);
    try {
      const r = await suggestAddressFix(start, end);
      setResult(r);
      setPickStart(r.start[0]?.address ?? null);
      setPickEnd(r.end[0]?.address ?? null);
    } catch (err) {
      const e = err as Error & { status?: number };
      onError(e.message, e.status ?? 500);
    } finally {
      setLoading(false);
    }
  };

  if (!result) {
    return (
      <Button size="sm" variant="outline" onClick={ask} disabled={loading}>
        {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
        Fix with AI
      </Button>
    );
  }

  const none = result.start.length === 0 && result.end.length === 0;
  if (none) return <p className="text-xs text-muted-foreground">No map-verified fix found. Edit the address in Airtable.</p>;

  const Options = ({ label, list, picked, setPicked, original }: {
    label: string; list: { address: string }[]; picked: string | null; setPicked: (v: string) => void; original: string;
  }) => (
    <fieldset className="space-y-1">
      <legend className="text-xs text-muted-foreground">{label}</legend>
      {[...list.map((x) => x.address), ...(list.length ? [] : [original])].map((a) => (
        <label key={a} className="flex items-center gap-2 text-xs">
          <input type="radio" checked={picked === a} onChange={() => setPicked(a)} />
          {a}{list.length === 0 && " (unchanged)"}
        </label>
      ))}
    </fieldset>
  );

  return (
    <div className="space-y-2">
      <Options label="Start" list={result.start} picked={pickStart ?? start} setPicked={setPickStart} original={start} />
      <Options label="End" list={result.end} picked={pickEnd ?? end} setPicked={setPickEnd} original={end} />
      <Button
        size="sm"
        disabled={applying}
        onClick={async () => {
          setApplying(true);
          try { await onApply(pickStart ?? start, pickEnd ?? end); } finally { setApplying(false); }
        }}
      >
        {applying ? "Recalculating..." : "Use and recalculate"}
      </Button>
    </div>
  );
};

export default FixAddressRow;
