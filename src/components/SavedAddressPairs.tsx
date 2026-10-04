import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import {
  createAddressPair, deleteAddressPair, listAddressPairs, type SavedAddressPair,
} from "@/services/addressPairs";

interface Props {
  userId: string;
  onUse: (pair: SavedAddressPair) => void;
}

/** Frequent routes: save once, send to the calculator in one click. */
const SavedAddressPairs = ({ userId, onUse }: Props) => {
  const { toast } = useToast();
  const [pairs, setPairs] = useState<SavedAddressPair[]>([]);
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = () =>
    listAddressPairs().then(setPairs).catch((e) => toast({ title: "Could not load routes", description: e.message, variant: "destructive" }));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createAddressPair(userId, { label: label.trim(), start_address: start.trim(), end_address: end.trim() });
      setLabel(""); setStart(""); setEnd("");
      await refresh();
    } catch (err) {
      toast({ title: "Could not save route", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAddressPair(id);
      setPairs((p) => p.filter((x) => x.id !== id));
    } catch (err) {
      toast({ title: "Could not delete route", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Saved Routes</CardTitle>
        <CardDescription>Save start and end addresses you use often, then load them into the calculator with one click.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved routes yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {pairs.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{p.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.start_address} → {p.end_address}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" onClick={() => onUse(p)}>
                    Use <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${p.label}`} onClick={() => handleDelete(p.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleSave} className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="pair-label">Name</Label>
            <Input id="pair-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Office → Client A" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pair-start">Start address</Label>
            <Input id="pair-start" value={start} onChange={(e) => setStart(e.target.value)} maxLength={300} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pair-end">End address</Label>
            <Input id="pair-end" value={end} onChange={(e) => setEnd(e.target.value)} maxLength={300} required />
          </div>
          <Button type="submit" variant="secondary" disabled={saving} className="sm:col-span-3 sm:w-fit">
            <Plus className="mr-1 h-4 w-4" /> {saving ? "Saving..." : "Save route"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default SavedAddressPairs;
