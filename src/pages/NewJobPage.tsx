import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getSettings } from "@/services/settings";
import { listBases, listTables, readRecords, syncRecords } from "@/services/airtable";
import { calculateDistances, AddressPair, DistanceResult } from "@/services/distance";
import { AiAssistError, generatePurposes, suggestAddressFix, type VerifiedAddress } from "@/services/aiAssist";
import {
  getMapping,
  upsertMapping,
  calculateReimbursement,
  DEFAULT_RATE_PER_MILE,
  RateUnit,
} from "@/services/mappings";
import { insertLog } from "@/services/logs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ToastAction } from "@/components/ui/toast";
import { Pencil, Sparkles } from "lucide-react";

interface AirtableBase { id: string; name: string }
interface AirtableTable { id: string; name: string; fields: AirtableField[] }
interface AirtableField { id: string; name: string; type: string }
interface PreviewRecord { id: string; fields: Record<string, unknown> }
interface AddressFixProposal {
  recordId: string;
  originalStart: string;
  originalEnd: string;
  start: VerifiedAddress | null;
  end: VerifiedAddress | null;
}

const NewJobPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [hasPat, setHasPat] = useState(false);
  const [hasMapsKey, setHasMapsKey] = useState(false);
  const [provider, setProvider] = useState("google");

  const [bases, setBases] = useState<AirtableBase[]>([]);
  const [tables, setTables] = useState<AirtableTable[]>([]);
  const [fields, setFields] = useState<AirtableField[]>([]);

  const [selectedBase, setSelectedBase] = useState("");
  const [selectedTable, setSelectedTable] = useState("");
  const [startCol, setStartCol] = useState("");
  const [endCol, setEndCol] = useState("");
  const [distanceCol, setDistanceCol] = useState("");
  const [costCol, setCostCol] = useState("");
  const [statusCol, setStatusCol] = useState("");
  const [notesCol, setNotesCol] = useState("");
  const [purposeCol, setPurposeCol] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const [syncedCount, setSyncedCount] = useState<number | null>(null);
  const [ratePerUnit, setRatePerUnit] = useState<number>(DEFAULT_RATE_PER_MILE);
  const [rateUnit, setRateUnit] = useState<RateUnit>("mi");

  const [preview, setPreview] = useState<PreviewRecord[]>([]);
  const [distances, setDistances] = useState<DistanceResult[]>([]);
  const [purposeTexts, setPurposeTexts] = useState<Record<string, string>>({});
  const [purposeDrafts, setPurposeDrafts] = useState<Record<string, string>>({});
  const [purposeEditingId, setPurposeEditingId] = useState<string | null>(null);
  const [purposeGeneratingId, setPurposeGeneratingId] = useState<string | null>(null);
  const [fixingRecordId, setFixingRecordId] = useState<string | null>(null);
  const [fixProposal, setFixProposal] = useState<AddressFixProposal | null>(null);
  const [applyingFix, setApplyingFix] = useState(false);

  const [loadingBases, setLoadingBases] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ synced: 0, total: 0 });

  // Load settings (only flags, no raw keys)
  useEffect(() => {
    if (!user) return;
    getSettings(user.id).then((s) => {
      if (s) {
        setHasPat(s.has_pat);
        setHasMapsKey(s.has_maps_key);
        setProvider(s.maps_provider ?? "google");
      }
    });
  }, [user]);

  // Load bases when pat exists
  useEffect(() => {
    if (!hasPat) return;
    setLoadingBases(true);
    listBases()
      .then((data) => setBases(data.bases ?? []))
      .catch((e) => toast({ title: "Error loading bases", description: e.message, variant: "destructive" }))
      .finally(() => setLoadingBases(false));
  }, [hasPat]);

  // Load tables on base select
  useEffect(() => {
    if (!hasPat || !selectedBase) return;
    setLoadingTables(true);
    setSelectedTable("");
    setFields([]);
    listTables(selectedBase)
      .then((data) => setTables(data.tables ?? []))
      .catch((e) => toast({ title: "Error loading tables", description: e.message, variant: "destructive" }))
      .finally(() => setLoadingTables(false));
  }, [hasPat, selectedBase]);

  // On table select: load fields + check saved mappings
  useEffect(() => {
    if (!selectedTable) return;
    const table = tables.find((t) => t.id === selectedTable);
    if (table) setFields(table.fields ?? []);

    if (!user) return;
    getMapping(user.id, selectedTable).then((m) => {
      if (m) {
        setStartCol(m.start_col_id);
        setEndCol(m.end_col_id);
        setDistanceCol(m.distance_col_id);
        setCostCol(m.cost_col_id ?? "");
        setStatusCol(m.status_col_id ?? "");
        setNotesCol(m.notes_col_id ?? "");
        setPurposeCol(m.purpose_col_id ?? "");
        setRatePerUnit(m.rate_per_unit);
        setRateUnit(m.rate_unit);
      }
    });
  }, [selectedTable, tables, user]);

  // Save mapping when cols or rate settings change
  useEffect(() => {
    if (!user || !selectedTable || !startCol || !endCol || !distanceCol) return;
    upsertMapping({
      user_id: user.id,
      table_id: selectedTable,
      start_col_id: startCol,
      end_col_id: endCol,
      distance_col_id: distanceCol,
      cost_col_id: costCol || null,
      status_col_id: statusCol || null,
      notes_col_id: notesCol || null,
      purpose_col_id: purposeCol || null,
      rate_per_unit: ratePerUnit,
      rate_unit: rateUnit,
    }).catch(() => {});
  }, [user, selectedTable, startCol, endCol, distanceCol, costCol, statusCol, notesCol, purposeCol, ratePerUnit, rateUnit]);

  const handlePreview = async () => {
    if (!distanceCol) return;
    setLoadingPreview(true);
    try {
      const data = await readRecords(selectedBase, selectedTable, distanceCol, 5);
      setPreview(data.records ?? []);
      setDistances([]);
      setPurposeTexts({});
      setPurposeDrafts({});
      setPurposeEditingId(null);
      setFixProposal(null);
      setSyncedCount(null);
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleCalculate = async () => {
    if (!preview.length || !startCol || !endCol) return;
    setCalculating(true);
    try {
      const startField = fields.find((f) => f.id === startCol)?.name ?? startCol;
      const endField = fields.find((f) => f.id === endCol)?.name ?? endCol;

      const pairs: AddressPair[] = preview.map((r) => ({
        record_id: r.id,
        start: String(r.fields[startField] ?? ""),
        end: String(r.fields[endField] ?? ""),
      }));

      const result = await calculateDistances(pairs);
      let results = (result.results ?? []).map((d) => ({
        ...d,
        purposeText: purposeTexts[d.record_id],
      }));

      if (notesCol) {
        const notesField = fields.find((f) => f.id === notesCol)?.name ?? notesCol;
        const noteRows = results
          .map((d) => {
            const row = preview.find((p) => p.id === d.record_id);
            return {
              recordId: d.record_id,
              note: String(row?.fields[notesField] ?? "").trim(),
            };
          })
          .filter((item) => item.note.length > 0);

        if (noteRows.length > 0) {
          try {
            const generated = await generatePurposes(noteRows.map((item) => item.note));
            const nextPurposes: Record<string, string> = {};
            noteRows.forEach((item, index) => {
              const purpose = generated[index];
              if (purpose) nextPurposes[item.recordId] = purpose;
            });
            if (Object.keys(nextPurposes).length > 0) {
              setPurposeTexts((prev) => ({ ...prev, ...nextPurposes }));
              results = results.map((d) =>
                nextPurposes[d.record_id] ? { ...d, purposeText: nextPurposes[d.record_id] } : d
              );
            }
          } catch (aiError) {
            const err = aiError as Error;
            toast({
              title: "İş amacı üretilemedi",
              description: err.message,
              variant: "destructive",
              action: aiError instanceof AiAssistError && aiError.status === 402 ? (
                <ToastAction altText="Go to pricing" onClick={() => navigate("/pricing")}>
                  View plans
                </ToastAction>
              ) : undefined,
            });
          }
        }
      }

      setDistances(results);
      setShowSummary(true);
      toast({
        title: "Hesaplama tamamlandı",
        description: `${results.filter((r) => r.status === "ok").length} satır başarılı, ${results.filter((r) => r.status !== "ok").length} satır doğrulanamadı.`,
      });
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (msg.includes("402") || msg.includes("Insufficient credits")) {
        toast({
          title: "Not enough credits",
          description: "You don't have enough credits for this calculation. Buy more credits to continue.",
          variant: "destructive",
          action: (
            <ToastAction altText="Go to pricing" onClick={() => navigate("/pricing")}>
              View plans
            </ToastAction>
          ),
        });
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setCalculating(false);
    }
  };


  const handleGeneratePurpose = async (recordId: string) => {
    const note = (purposeDrafts[recordId] ?? "").trim();
    if (!note) {
      toast({ title: "Not gerekli", description: "İş amacı üretmek için kısa bir not girin.", variant: "destructive" });
      return;
    }

    setPurposeGeneratingId(recordId);
    try {
      const [purpose] = await generatePurposes([note]);
      if (!purpose) throw new Error("AI bu not için iş amacı üretemedi.");
      setPurposeTexts((prev) => ({ ...prev, [recordId]: purpose }));
      setDistances((prev) =>
        prev.map((d) => (d.record_id === recordId ? { ...d, purposeText: purpose } : d))
      );
      setPurposeEditingId(null);
      toast({ title: "İş amacı üretildi", description: purpose });
    } catch (error) {
      const err = error as Error;
      toast({
        title: "İş amacı üretilemedi",
        description: err.message,
        variant: "destructive",
        action: error instanceof AiAssistError && error.status === 402 ? (
          <ToastAction altText="Go to pricing" onClick={() => navigate("/pricing")}>
            View plans
          </ToastAction>
        ) : undefined,
      });
    } finally {
      setPurposeGeneratingId(null);
    }
  };

  const handleSuggestFix = async (recordId: string) => {
    const row = preview.find((p) => p.id === recordId);
    if (!row) return;
    const startField = fields.find((f) => f.id === startCol)?.name ?? startCol;
    const endField = fields.find((f) => f.id === endCol)?.name ?? endCol;
    const originalStart = String(row.fields[startField] ?? "").trim();
    const originalEnd = String(row.fields[endField] ?? "").trim();

    setFixingRecordId(recordId);
    setFixProposal(null);
    try {
      const suggestion = await suggestAddressFix(originalStart, originalEnd);
      const start = suggestion.start[0] ?? null;
      const end = suggestion.end[0] ?? null;
      if (!start && !end) throw new Error("AI harita ile doğrulanmış bir alternatif bulamadı.");
      setFixProposal({ recordId, originalStart, originalEnd, start, end });
    } catch (error) {
      const err = error as Error;
      toast({
        title: "Adres düzeltilemedi",
        description: err.message,
        variant: "destructive",
        action: error instanceof AiAssistError && error.status === 402 ? (
          <ToastAction altText="Go to pricing" onClick={() => navigate("/pricing")}>
            View plans
          </ToastAction>
        ) : undefined,
      });
    } finally {
      setFixingRecordId(null);
    }
  };

  const handleApplyFix = async () => {
    if (!fixProposal) return;
    const startField = fields.find((f) => f.id === startCol)?.name ?? startCol;
    const endField = fields.find((f) => f.id === endCol)?.name ?? endCol;
    const nextStart = fixProposal.start?.address ?? fixProposal.originalStart;
    const nextEnd = fixProposal.end?.address ?? fixProposal.originalEnd;

    setApplyingFix(true);
    setPreview((prev) =>
      prev.map((row) =>
        row.id === fixProposal.recordId
          ? {
              ...row,
              fields: {
                ...row.fields,
                [startField]: nextStart,
                [endField]: nextEnd,
              },
            }
          : row
      )
    );

    try {
      const recalculated = await calculateDistances([
        { record_id: fixProposal.recordId, start: nextStart, end: nextEnd },
      ]);
      const updated = recalculated.results?.[0];
      if (!updated) throw new Error("Düzeltilen adres için rota sonucu alınamadı.");
      const purposeText = purposeTexts[fixProposal.recordId];
      const nextResult = purposeText ? { ...updated, purposeText } : updated;
      setDistances((prev) =>
        prev.map((d) => (d.record_id === fixProposal.recordId ? nextResult : d))
      );

      if (updated.status === "ok") {
        setFixProposal(null);
        toast({ title: "Adres uygulandı", description: "Satır yeniden doğrulandı ve rota hesaplandı." });
      } else {
        toast({
          title: "Adres uygulandı ancak rota doğrulanamadı",
          description: updated.error ?? "Adres Bulunamadı",
          variant: "destructive",
        });
      }
    } catch (error) {
      const err = error as Error;
      toast({ title: "Adres uygulanamadı", description: err.message, variant: "destructive" });
    } finally {
      setApplyingFix(false);
    }
  };

  const handleSync = async () => {
    if (!distances.length) return;
    setSyncing(true);

    const fieldName = (id: string) => fields.find((f) => f.id === id)?.name ?? id;
    const distField = fieldName(distanceCol);
    const costField = costCol ? fieldName(costCol) : null;
    const statusField = statusCol ? fieldName(statusCol) : null;
    const purposeField = purposeCol ? fieldName(purposeCol) : null;

    const successResults = distances.filter((d) => d.status === "ok");
    const failedResults = distances.filter((d) => d.status !== "ok");

    // Successful rows: distance (+ reimbursement) written in a single update.
    const records = successResults.map((d) => {
      const values: Record<string, string | number> = {
        [distField]: `${d.distance_mi.toFixed(2)} mi`,
      };
      if (costField) {
        values[costField] = Number(
          calculateReimbursement(d.distance_mi, ratePerUnit, rateUnit).toFixed(2)
        );
      }
      if (statusField) values[statusField] = "Hesaplandı";
      if (purposeField && d.purposeText) values[purposeField] = d.purposeText;
      return { id: d.record_id, fields: values };
    });

    // Failed rows are skipped, not fatal: only the status/log column is marked.
    if (statusField) {
      failedResults.forEach((d) => {
        records.push({ id: d.record_id, fields: { [statusField]: "Adres Bulunamadı" } });
      });
    }

    setSyncProgress({ synced: 0, total: records.length });

    try {
      const result = await syncRecords({
        baseId: selectedBase,
        tableId: selectedTable,
        distanceFieldId: distField,
        records,
      });

      setSyncProgress({ synced: result.synced ?? records.length, total: records.length });

      if (user) {
        await insertLog({
          user_id: user.id,
          base_id: selectedBase,
          table_id: selectedTable,
          records_processed: result.synced ?? records.length,
          provider_used: provider,
        });
      }

      setSyncedCount(result.synced ?? records.length);
      setShowSummary(true);
      toast({ title: "Sync complete", description: `${result.synced ?? records.length} records updated.` });
    } catch (e: unknown) {
      toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const noSettings = !hasPat;
  const okCount = distances.filter((d) => d.status === "ok").length;
  const failedCount = distances.filter((d) => d.status !== "ok").length;
  const showPurposeColumn = Boolean(purposeCol || Object.keys(purposeTexts).length > 0);
  const previewColumnCount =
    4 +
    (distances.length > 0 ? 1 : 0) +
    (distances.length > 0 && costCol ? 1 : 0) +
    (showPurposeColumn ? 1 : 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container flex h-14 items-center gap-4">
          <Button variant="ghost" size="sm" asChild><Link to="/dashboard">← Dashboard</Link></Button>
          <h1 className="text-lg font-semibold text-foreground">New Mileage Job</h1>
        </div>
      </header>

      <main className="container max-w-2xl py-8 space-y-6">
        <h2 className="sr-only">Job setup</h2>
        {noSettings ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground mb-4">Configure your Airtable PAT and Maps API key first.</p>
              <Button asChild><Link to="/settings">Go to Settings</Link></Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Base & Table Selection */}
            <Card>
              <CardHeader><CardTitle className="text-base">Select Data Source</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Base</Label>
                  {loadingBases ? (
                    <p className="text-sm text-muted-foreground">Loading bases...</p>
                  ) : (
                    <Select value={selectedBase} onValueChange={setSelectedBase}>
                      <SelectTrigger><SelectValue placeholder="Select a base" /></SelectTrigger>
                      <SelectContent>
                        {bases.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {selectedBase && (
                  <div className="space-y-2">
                    <Label>Table</Label>
                    {loadingTables ? (
                      <p className="text-sm text-muted-foreground">Loading tables...</p>
                    ) : (
                      <Select value={selectedTable} onValueChange={setSelectedTable}>
                        <SelectTrigger><SelectValue placeholder="Select a table" /></SelectTrigger>
                        <SelectContent>
                          {tables.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Column Mapping */}
            {fields.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Column Mapping</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {[
                    { label: "Start Address", value: startCol, onChange: setStartCol, optional: false },
                    { label: "End Address", value: endCol, onChange: setEndCol, optional: false },
                    { label: "Distance Output", value: distanceCol, onChange: setDistanceCol, optional: false },
                    { label: "Reimbursement Amount", value: costCol, onChange: setCostCol, optional: true },
                    { label: "Status / Log", value: statusCol, onChange: setStatusCol, optional: true },
                    { label: "Trip Notes / Reason (Kaynak Not Sütunu)", value: notesCol, onChange: setNotesCol, optional: true },
                    { label: "Business Purpose (Hedef İş Amacı Sütunu)", value: purposeCol, onChange: setPurposeCol, optional: true },
                  ].map(({ label, value, onChange, optional }) => (
                    <div key={label} className="space-y-2">
                      <Label>{label}{optional && <span className="text-muted-foreground"> (optional)</span>}</Label>
                      <Select value={value || undefined} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder={`Select ${label}`} /></SelectTrigger>
                        <SelectContent>
                          {optional && <SelectItem value="__none__">None</SelectItem>}
                          {fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Reimbursement Rate */}
            {fields.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Reimbursement Rate</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="rate">Rate per unit ($)</Label>
                      <Input
                        id="rate"
                        type="number"
                        min={0}
                        step="0.01"
                        value={ratePerUnit}
                        onChange={(e) => setRatePerUnit(Math.max(0, Number(e.target.value) || 0))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Unit</Label>
                      <Select value={rateUnit} onValueChange={(v) => setRateUnit(v as RateUnit)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mi">Per mile</SelectItem>
                          <SelectItem value="km">Per kilometre</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      Default is the IRS rate of ${DEFAULT_RATE_PER_MILE.toFixed(2)} per mile (H2 2026).
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { setRatePerUnit(DEFAULT_RATE_PER_MILE); setRateUnit("mi"); }}
                    >
                      Reset to IRS rate
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            {startCol && endCol && distanceCol && (
              <div className="flex gap-3">
                <Button onClick={handlePreview} disabled={loadingPreview}>
                  {loadingPreview ? "Loading..." : "Fetch Preview"}
                </Button>
                {preview.length > 0 && (
                  <Button onClick={handleCalculate} disabled={calculating}>
                    {calculating ? "Calculating..." : "Calculate Distances"}
                  </Button>
                )}
                {distances.length > 0 && (
                  <Button onClick={handleSync} disabled={syncing}>
                    {syncing ? "Syncing..." : "Sync to Airtable"}
                  </Button>
                )}
              </div>
            )}

            {/* Sync Progress */}
            {syncing && syncProgress.total > 0 && (
              <Card>
                <CardContent className="py-4 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Synced {syncProgress.synced} of {syncProgress.total} records
                  </p>
                  <Progress value={(syncProgress.synced / syncProgress.total) * 100} />
                </CardContent>
              </Card>
            )}

            {/* Preview Table */}
            {preview.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Preview ({preview.length} records)</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"><span className="sr-only">AI purpose</span></TableHead>
                        <TableHead>Record ID</TableHead>
                        <TableHead>Start</TableHead>
                        <TableHead>End</TableHead>
                        {distances.length > 0 && <TableHead>Distance</TableHead>}
                        {distances.length > 0 && costCol && <TableHead>Amount</TableHead>}
                        {showPurposeColumn && <TableHead>Business Purpose</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.map((r) => {
                        const startField = fields.find((f) => f.id === startCol)?.name ?? startCol;
                        const endField = fields.find((f) => f.id === endCol)?.name ?? endCol;
                        const notesField = notesCol ? (fields.find((f) => f.id === notesCol)?.name ?? notesCol) : null;
                        const dist = distances.find((d) => d.record_id === r.id);
                        const purposeText = dist?.purposeText ?? purposeTexts[r.id];
                        return (
                          <Fragment key={r.id}>
                            <TableRow>
                              <TableCell>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  aria-label="Generate business purpose"
                                  title="Generate business purpose"
                                  onClick={() => {
                                    const sourceNote = notesField ? String(r.fields[notesField] ?? "") : "";
                                    setPurposeDrafts((prev) => ({
                                      ...prev,
                                      [r.id]: prev[r.id] ?? sourceNote,
                                    }));
                                    setPurposeEditingId((current) => current === r.id ? null : r.id);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{r.id.slice(0, 10)}</TableCell>
                              <TableCell>{String(r.fields[startField] ?? "")}</TableCell>
                              <TableCell>{String(r.fields[endField] ?? "")}</TableCell>
                              {distances.length > 0 && (
                                <TableCell>
                                  {dist?.status === "ok" ? `${dist.distance_mi.toFixed(2)} mi` : dist?.error ?? "—"}
                                </TableCell>
                              )}
                              {distances.length > 0 && costCol && (
                                <TableCell>
                                  {dist?.status === "ok"
                                    ? `${calculateReimbursement(dist.distance_mi, ratePerUnit, rateUnit).toFixed(2)}`
                                    : "—"}
                                </TableCell>
                              )}
                              {showPurposeColumn && (
                                <TableCell className="max-w-[240px] whitespace-normal text-sm">
                                  {purposeText ?? "—"}
                                </TableCell>
                              )}
                            </TableRow>
                            {purposeEditingId === r.id && (
                              <TableRow>
                                <TableCell colSpan={previewColumnCount}>
                                  <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 sm:flex-row">
                                    <Input
                                      value={purposeDrafts[r.id] ?? ""}
                                      onChange={(e) =>
                                        setPurposeDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                                      }
                                      placeholder="Kısa seyahat notu: müşteri toplantısı, saha ziyareti…"
                                      maxLength={300}
                                      disabled={purposeGeneratingId === r.id}
                                    />
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() => void handleGeneratePurpose(r.id)}
                                      disabled={purposeGeneratingId === r.id || !(purposeDrafts[r.id] ?? "").trim()}
                                    >
                                      <Sparkles className="mr-2 h-4 w-4" />
                                      {purposeGeneratingId === r.id ? "Üretiliyor..." : "Üret"}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>

      {/* Calculation summary */}
      <Dialog open={showSummary && distances.length > 0} onOpenChange={setShowSummary}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Hesaplama özeti</DialogTitle>
            <DialogDescription>
              {okCount} satır başarıyla hesaplandı, {failedCount} satır doğrulanamadı.
              {syncedCount !== null ? ` ${syncedCount} satır Airtable'a yazıldı.` : ""}
            </DialogDescription>
          </DialogHeader>

          {failedCount > 0 ? (
            <div className="max-h-72 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Record ID</TableHead>
                    <TableHead>Adres</TableHead>
                    <TableHead>Sebep</TableHead>
                    <TableHead className="text-right">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {distances.filter((d) => d.status !== "ok").map((d) => {
                    const row = preview.find((p) => p.id === d.record_id);
                    const startField = fields.find((f) => f.id === startCol)?.name ?? startCol;
                    const endField = fields.find((f) => f.id === endCol)?.name ?? endCol;
                    return (
                      <TableRow key={d.record_id}>
                        <TableCell className="font-mono text-xs">{d.record_id.slice(0, 10)}</TableCell>
                        <TableCell className="text-xs">
                          {String(row?.fields[startField] ?? "—")} → {String(row?.fields[endField] ?? "—")}
                        </TableCell>
                        <TableCell className="text-xs">{d.error ?? "Adres Bulunamadı"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleSuggestFix(d.record_id)}
                            disabled={fixingRecordId === d.record_id || applyingFix}
                          >
                            <Sparkles className="mr-2 h-4 w-4" />
                            {fixingRecordId === d.record_id ? "Fixing..." : "Fix with AI"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Tüm satırlar başarıyla hesaplandı.</p>
          )}

          {fixProposal && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <div>
                <p className="text-sm font-medium">Harita ile doğrulanmış AI önerisi</p>
                <p className="text-xs text-muted-foreground">
                  Uygula seçeneği adresleri önizlemede günceller ve yalnızca bu satırın rotasını yeniden doğrular.
                </p>
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Başlangıç</p>
                  <p>{fixProposal.start?.address ?? fixProposal.originalStart}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Bitiş</p>
                  <p>{fixProposal.end?.address ?? fixProposal.originalEnd}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setFixProposal(null)} disabled={applyingFix}>
                  Vazgeç
                </Button>
                <Button type="button" size="sm" onClick={() => void handleApplyFix()} disabled={applyingFix}>
                  {applyingFix ? "Uygulanıyor..." : "Uygula"}
                </Button>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {statusCol
              ? "Doğrulanamayan satırlar atlanır ve Airtable'daki durum sütununa 'Adres Bulunamadı' yazılır."
              : "Doğrulanamayan satırları Airtable'da işaretlemek için bir 'Status / Log' sütunu seçin."}
          </p>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                setShowSummary(false);
                setDistances([]);
                setPreview([]);
                setSyncedCount(null);
                setSyncProgress({ synced: 0, total: 0 });
                setPurposeTexts({});
                setPurposeDrafts({});
                setPurposeEditingId(null);
                setFixProposal(null);
              }}
            >
              Tabloyu temizle
            </Button>
            <Button onClick={() => navigate("/dashboard")}>Dashboard'a dön</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NewJobPage;
