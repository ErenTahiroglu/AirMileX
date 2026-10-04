import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, PenLine } from "lucide-react";
import { generatePurposes } from "@/services/aiAssist";

interface Props {
  purpose: string | undefined;
  initialNote: string;
  onChange: (purpose: string) => void;
  onError: (message: string, status: number) => void;
}

/** Per-row manual mode: type a quick note, get a business purpose for that row. */
const PurposeCell = ({ purpose, initialNote, onChange, onError }: Props) => {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(initialNote);
  const [loading, setLoading] = useState(false);

  const draft = async () => {
    if (!note.trim()) return;
    setLoading(true);
    try {
      const [p] = await generatePurposes([note]);
      if (p) { onChange(p); setOpen(false); }
      else onError("The AI could not draft a purpose for this note.", 502);
    } catch (err) {
      const e = err as Error & { status?: number };
      onError(e.message, e.status ?? 500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-start gap-1">
      <span className="text-xs">{purpose ?? <span className="text-muted-foreground">—</span>}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label="Draft business purpose with AI">
            <PenLine className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-2">
          <p className="text-xs text-muted-foreground">Trip note, e.g. "Acme audit"</p>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} onKeyDown={(e) => e.key === "Enter" && draft()} />
          <Button size="sm" onClick={draft} disabled={loading || !note.trim()}>
            {loading && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Draft purpose
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default PurposeCell;
