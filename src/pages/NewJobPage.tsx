import { useEffect, useRef, useState } from "react";
import PurposeCell from "@/components/job/PurposeCell";
import FixAddressRow from "@/components/job/FixAddressRow";
import { generatePurposes, AiAssistError } from "@/services/aiAssist";
import { buildSyncRecords } from "@/lib/jobSync";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getSettings } from "@/services/settings";
import { listBases, listTables, readRecords, syncRecords } from "@/services/airtable";
import { calculateDistances, AddressPair, DistanceResult } from "@/services/distance";
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

interface AirtableBase { id: string; name: string }
interface AirtableTable { id: string; name: string; fields: AirtableField[] }
interface AirtableField { id: string; name: string; type: string }
interface PreviewRecord { id: string; fields: Record<string, unknown> }

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
  const [showSummary, setShowSummary] = useState(false);
  const [syncedCount, setSyncedCount] = useState<number | null>(null);
  const [ratePerUnit, setRatePerUnit] = useState<number>(DEFAULT_RATE_PER_MILE);
  const [rateUnit, setRateUnit] = useState<RateUnit>("mi");
  const [notesCol, setNotesCol] = useState("");
  const [purposeCol, setPurposeCol] = useState("");
  // Table whose saved mapping finished loading; guards against cross-table upserts.
  const hydratedTableRef = useRef<string | null>(null);

  const [preview, setPreview] = useState<PreviewRecord[]>([]);
  const [distances, setDistances] = useState<DistanceResult[]>([]);
  const [purposes, setPurposes] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, { start: string; end: string }>>({});
  const [generatingPurposes, setGeneratingPurposes] = useState(false);

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

  // On table select: reset old mapping, load fields + saved mapping for the new table.
  useEffect(() => {
    hydratedTableRef.current = null; // blocks upserts until this table's mapping is loaded
    setStartCol(""); setEndCol(""); setDistanceCol(""); setCostCol(""); setStatusCol("");
    setNotesCol(""); setPurposeCol("");
    setRatePerUnit(DEFAULT_RATE_PER_MILE); setRateUnit("mi");
    setPreview([]); setDistances([]); setPurposes({}); setOverrides({});
    if (!selectedTable) return;
    const table = tables.find((t) => t.id === selectedTable);
    if (table) setFields(table.fields ?? []);

    if (!user) return;
    const tableId = selectedTable;
    let cancelled = false;
    getMapping(user.id, tableId)
      .then((m) => {
        if (cancelled) return;
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
        hydratedTableRef.current = tableId;
      })
      .catch(() => { if (!cancelled) hydratedTableRef.current = tableId; });
    return () => { cancelled = true; };
  }, [selectedTable, tables, user]);

  // Save mapping when cols or rate settings change (only after hydration for this table).
  useEffect(() => {
    if (!user || !selectedTable || !startCol || !endCol || !distanceCol) return;
    if (hydratedTableRef.current !== selectedTable) return;
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
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoadingPreview(false);
    }
  };

  const fieldName = (id: string) => fields.find((f) => f.id === id)?.name ?? id;

  /** Current addresses for a row, including AI fixes the user applied. */
  const addressesOf = (r: PreviewRecord) =>
    overrides[r.id] ?? {
      start: String(r.fields[fieldName(startCol)] ?? ""),
      end: String(r.fields[fieldName(endCol)] ?? ""),
    };

  const noteOf = (r: PreviewRecord) => (notesCol ? String(r.fields[fieldName(notesCol)] ?? "") : "");

  const setPurpose = (recordId: string, purpose: string) =>
    setPurposes((prev) => ({ ...prev, [recordId]: purpose }));

  const showCreditsToast = (description: string) =>
    toast({
      title: "Not enough credits",
      description,
      variant: "destructive",
      action: (
        <ToastAction altText="Go to pricing" onClick={() => navigate("/pricing")}>
          View plans
        </ToastAction>
      ),
    });

  const showAiError = (message: string, status: number) => {
    if (status === 402) showCreditsToast("AI credits are used up. Buy more credits to keep using AI features.");
    else if (status === 429) toast({ title: "Too many AI requests", description: message, variant: "destructive" });
    else toast({ title: "AI error", description: message, variant: "destructive" });
  };

  /** Bulk mode: drafts purposes for every row with a note. Never fails the distance job. */
  const draftBulkPurposes = async () => {
    if (!notesCol) return;
    const rows = preview.map((r) => ({ id: r.id, note: noteOf(r).trim() })).filter((x) => x.note);
    if (!rows.length) return;
    setGeneratingPurposes(true);
    try {
      const result = await generatePurposes(rows.map((x) => x.note));
      setPurposes((prev) => {
        const next = { ...prev };
        rows.forEach((x, i) => { if (result[i]) next[x.id] = result[i] as string; });
        return next;
      });
    } catch (err) {
      const e = err as AiAssistError;
      showAiError(e.message, e.status ?? 500);
    } finally {
      setGeneratingPurposes(false);
    }
  };

  /** After an AI fix is applied: recalculate only this row; error stays unless routing succeeds. */
  const recalculateRow = async (recordId: string, start: string, end: string) => {
    setOverrides((prev) => ({ ...prev, [recordId]: { start, end } }));
    try {
      const result = await calculateDistances([{ record_id: recordId, start, end }]);
      const fresh = result.results?.[0];
      if (fresh?.status === "ok") {
        setDistances((prev) => prev.map((d) => (d.record_id === recordId ? fresh : d)));
        toast({ title: "Row fixed", description: `${fresh.distance_mi.toFixed(2)} mi calculated.` });
      } else {
        toast({ title: "Still not routable", description: fresh?.error ?? "Adres Bulunamadı", variant: "destructive" });
      }
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (msg.includes("402") || msg.includes("Insufficient credits")) {
        showCreditsToast("You don't have enough credits for this calculation. Buy more credits to continue.");
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    }
  };

  const handleCalculate = async () => {
    if (!preview.length || !startCol || !endCol) return;
    setCalculating(true);
    try {
      const pairs: AddressPair[] = preview.map((r) => ({ record_id: r.id, ...addressesOf(r) }));

      const result = await calculateDistances(pairs);
      const results = result.results ?? [];
      setDistances(results);
      setShowSummary(true);
      toast({
        title: "Hesaplama tamamlandı",
        description: `${results.filter((r) => r.status === "ok").length} satır başarılı, ${results.filter((r) => r.status !== "ok").length} satır doğrulanamadı.`,
      });
      void draftBulkPurposes();
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (msg.includes("402") || msg.includes("Insufficient credits")) {
        showCreditsToast("You don't have enough credits for this calculation. Buy more credits to continue.");
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setCalculating(false);
    }
  };

  const handleSync = async () => {
    if (!distances.length) return;
    setSyncing(true);

    const distField = fieldName(distanceCol);
    const withPurpose = distances.map((d) => ({ ...d, purposeText: purposes[d.record_id] }));
    const records = buildSyncRecords(
      withPurpose,
      {
        distance: distField,
        cost: costCol ? fieldName(costCol) : null,
        status: statusCol ? fieldName(statusCol) : null,
        purpose: purposeCol ? fieldName(purposeCol) : null,
      },
      ratePerUnit,
      rateUnit,
    );

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
                    { label: "Trip Notes / Reason", value: notesCol, onChange: setNotesCol, optional: true },
                    { label: "Business Purpose", value: purposeCol, onChange: setPurposeCol, optional: true },
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
                        const addr = addressesOf(r);
                        const dist = distances.find((d) => d.record_id === r.id);
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="align-top">
                              <PurposeCell
                                purpose={undefined}
                                initialNote={noteOf(r)}
                                onChange={(p) => setPurpose(r.id, p)}
                                onError={showAiError}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs">{r.id.slice(0, 10)}</TableCell>
                            <TableCell>{addr.start}</TableCell>
                            <TableCell>{addr.end}</TableCell>
                            {distances.length > 0 && (
                              <TableCell>
                                {dist?.status === "ok" ? `${dist.distance_mi.toFixed(2)} mi` : dist?.error ?? "—"}
                              </TableCell>
                            )}
                            {distances.length > 0 && costCol && (
                              <TableCell>
                                {dist?.status === "ok"
                                  ? `$${calculateReimbursement(dist.distance_mi, ratePerUnit, rateUnit).toFixed(2)}`
                                  : "—"}
                              </TableCell>
                            )}
                            {showPurposeColumn && (
                              <TableCell className="text-xs">
                                {purposes[r.id] ?? (generatingPurposes ? "Drafting…" : <span className="text-muted-foreground">—</span>)}
                              </TableCell>
                            )}
                          </TableRow>
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
        <DialogContent className="max-w-lg">
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
                    <TableHead className="text-right">AI</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {distances.filter((d) => d.status !== "ok").map((d) => {
                    const row = preview.find((p) => p.id === d.record_id);
                    const addr = row ? addressesOf(row) : { start: "", end: "" };
                    return (
                      <TableRow key={d.record_id}>
                        <TableCell className="font-mono text-xs">{d.record_id.slice(0, 10)}</TableCell>
                        <TableCell className="text-xs">
                          {addr.start || "—"} → {addr.end || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{d.error ?? "Adres Bulunamadı"}</TableCell>
                        <TableCell className="text-right">
                          <FixAddressRow
                            start={addr.start}
                            end={addr.end}
                            onApply={(s, e) => recalculateRow(d.record_id, s, e)}
                            onError={showAiError}
                          />
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
