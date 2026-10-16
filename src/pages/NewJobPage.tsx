import { useEffect, useRef, useState } from "react";
import PurposeCell from "@/components/job/PurposeCell";
import FixAddressRow from "@/components/job/FixAddressRow";
import { generatePurposes, AiAssistError } from "@/services/aiAssist";
import { executeJobSync } from "@/lib/newJobSync";
import { buildSyncRecords } from "@/lib/jobSync";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getSettings } from "@/services/settings";
import { listBases, listTables, readRecords, readEligibleRecords, type SyncProgress } from "@/services/airtable";
import { calculateDistances, AddressPair, DistanceResult } from "@/services/distance";
import {
  executeBulkDistanceCalculation,
  partitionRecordsForContinuation,
  formatCalculationNotification,
  type CalculationProgress,
} from "@/lib/bulkCalculation";
import { Badge } from "@/components/ui/badge";
import {
  getMapping,
  upsertMapping,
  calculateReimbursement,
  DEFAULT_RATE_PER_MILE,
  RateUnit,
  MappingCoordinator,
} from "@/services/mappings";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowRight, Info, KeyRound } from "lucide-react";
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
  const [provider, setProvider] = useState("geoapify");
  const [credits, setCredits] = useState<number>(0);

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
  const activeTableIdRef = useRef<string | null>(null);
  const calculatedMappingRef = useRef<{ start: string; end: string; distance: string } | null>(null);
  const [mappingStatus, setMappingStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [failedSyncIds, setFailedSyncIds] = useState<string[]>([]);
  const [confirmedSyncIds, setConfirmedSyncIds] = useState<string[]>([]);

  const [preview, setPreview] = useState<PreviewRecord[]>([]);
  const [retrievalMeta, setRetrievalMeta] = useState<{
    isFullLoad: boolean;
    limitReached: boolean;
    exhausted: boolean;
    total: number;
  } | null>(null);
  const [distances, setDistances] = useState<DistanceResult[]>([]);
  const [purposes, setPurposes] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, { start: string; end: string }>>({});
  const [generatingPurposes, setGeneratingPurposes] = useState(false);

  const [loadingBases, setLoadingBases] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const isCalculatingRef = useRef(false);
  const cancelCalculationRef = useRef(false);
  const [calcProgress, setCalcProgress] = useState<CalculationProgress | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({
    processed: 0,
    confirmed: 0,
    failed: 0,
    indeterminate: 0,
    total: 0,
  });

  const mappingCoordinatorRef = useRef<MappingCoordinator | null>(null);
  if (!mappingCoordinatorRef.current) {
    mappingCoordinatorRef.current = new MappingCoordinator(upsertMapping, (status, err) => {
      setMappingStatus(status);
      setMappingError(err ?? null);
      if (err) {
        toast({
          title: "Error saving column mapping",
          description: err,
          variant: "destructive",
        });
      }
    });
  }

  // Load settings (only flags, no raw keys)
  useEffect(() => {
    if (!user) return;
    getSettings(user.id).then((s) => {
      if (s) {
        setHasPat(s.has_pat);
        setProvider(s.maps_provider ?? "geoapify");
        setCredits(s.credits ?? 0);
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

  // Load tables on base select; clear previous job state on base switch
  useEffect(() => {
    if (!hasPat || !selectedBase) return;
    setLoadingTables(true);
    setSelectedTable("");
    setFields([]);
    setPreview([]);
    setRetrievalMeta(null);
    setDistances([]);
    setPurposes({});
    setOverrides({});
    setFailedSyncIds([]);
    setConfirmedSyncIds([]);
    setSyncedCount(null);
    setSyncProgress({ processed: 0, confirmed: 0, failed: 0, indeterminate: 0, total: 0 });
    calculatedMappingRef.current = null;
    mappingCoordinatorRef.current?.setActiveTable(null);

    listTables(selectedBase)
      .then((data) => setTables(data.tables ?? []))
      .catch((e) => toast({ title: "Error loading tables", description: e.message, variant: "destructive" }))
      .finally(() => setLoadingTables(false));
  }, [hasPat, selectedBase]);

  // On table select: reset old mapping, load fields + saved mapping for the new table.
  useEffect(() => {
    activeTableIdRef.current = selectedTable;
    hydratedTableRef.current = null; // blocks upserts until this table's mapping is loaded
    mappingCoordinatorRef.current?.setActiveTable(selectedTable || null);

    setStartCol(""); setEndCol(""); setDistanceCol(""); setCostCol(""); setStatusCol("");
    setNotesCol(""); setPurposeCol("");
    setRatePerUnit(DEFAULT_RATE_PER_MILE); setRateUnit("mi");
    setPreview([]); setRetrievalMeta(null); setDistances([]); setPurposes({}); setOverrides({});
    setFailedSyncIds([]); setConfirmedSyncIds([]); setSyncedCount(null);
    setSyncProgress({ processed: 0, confirmed: 0, failed: 0, indeterminate: 0, total: 0 });
    calculatedMappingRef.current = null;
    setMappingError(null);

    if (!selectedTable) {
      setMappingStatus("idle");
      return;
    }
    const table = tables.find((t) => t.id === selectedTable);
    if (table) setFields(table.fields ?? []);

    if (!user) return;
    const tableId = selectedTable;
    let cancelled = false;
    setMappingStatus("loading");

    getMapping(user.id, tableId)
      .then((m) => {
        if (cancelled || activeTableIdRef.current !== tableId) return;
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
          setMappingStatus("saved");
        } else {
          setMappingStatus("idle");
        }
        hydratedTableRef.current = tableId;
      })
      .catch((err) => {
        if (cancelled || activeTableIdRef.current !== tableId) return;
        const msg = (err as Error).message || "Failed to load mapping";
        setMappingStatus("error");
        setMappingError(msg);
        toast({
          title: "Error loading column mapping",
          description: msg,
          variant: "destructive",
        });
      });

    return () => { cancelled = true; };
  }, [selectedTable, tables, user]);

  // Save mapping with serialized coordinator (only after hydration for this table).
  useEffect(() => {
    if (!user || !selectedTable || !startCol || !endCol || !distanceCol) return;
    if (hydratedTableRef.current !== selectedTable || activeTableIdRef.current !== selectedTable) return;

    // Invalidate calculated distances if source address-column mappings change
    if (
      calculatedMappingRef.current &&
      (calculatedMappingRef.current.start !== startCol ||
        calculatedMappingRef.current.end !== endCol ||
        calculatedMappingRef.current.distance !== distanceCol) &&
      distances.length > 0
    ) {
      setDistances([]);
      setPurposes({});
      setOverrides({});
      setConfirmedSyncIds([]);
      setFailedSyncIds([]);
      setSyncedCount(null);
      calculatedMappingRef.current = null;
    }

    mappingCoordinatorRef.current?.scheduleSave(selectedTable, {
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
    });
  }, [user, selectedTable, startCol, endCol, distanceCol, costCol, statusCol, notesCol, purposeCol, ratePerUnit, rateUnit]);

  const handlePreview = async () => {
    if (!distanceCol) return;
    setLoadingPreview(true);
    try {
      const data = await readRecords(selectedBase, selectedTable, distanceCol, 5);
      const recs = data.records ?? [];
      setPreview(recs);
      setRetrievalMeta({
        isFullLoad: false,
        limitReached: false,
        exhausted: recs.length < 5,
        total: recs.length,
      });
      setDistances([]);
      setPurposes({});
      setOverrides({});
      setFailedSyncIds([]);
      setConfirmedSyncIds([]);
      setSyncedCount(null);
      setSyncProgress({ processed: 0, confirmed: 0, failed: 0, indeterminate: 0, total: 0 });
      calculatedMappingRef.current = null;
    } catch (e: unknown) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleLoadEligibleRecords = async () => {
    if (!distanceCol || !startCol || !endCol) {
      toast({
        title: "Mapping required",
        description: "Please map Start Address, End Address, and Distance Output before loading records.",
        variant: "destructive",
      });
      return;
    }
    setLoadingPreview(true);
    try {
      // Ensure latest column mapping is saved to Supabase before fetching projected records
      await mappingCoordinatorRef.current?.waitForLatest();

      const data = await readEligibleRecords(selectedBase, selectedTable, distanceCol, 500);
      const recs = data.records ?? [];
      setPreview(recs);
      setRetrievalMeta({
        isFullLoad: true,
        limitReached: data.limitReached,
        exhausted: data.exhausted,
        total: data.total,
      });
      setDistances([]);
      setPurposes({});
      setOverrides({});
      setFailedSyncIds([]);
      setConfirmedSyncIds([]);
      setSyncedCount(null);
      setSyncProgress({ processed: 0, confirmed: 0, failed: 0, indeterminate: 0, total: 0 });
      calculatedMappingRef.current = null;

      if (data.limitReached) {
        toast({
          title: "Record limit reached",
          description: "Loaded maximum 500 eligible records. Additional uncalculated records may remain in Airtable.",
        });
      } else {
        toast({
          title: "Records loaded",
          description: `Loaded all ${data.total} eligible records from table.`,
        });
      }
    } catch (e: unknown) {
      toast({ title: "Error loading records", description: (e as Error).message, variant: "destructive" });
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

  /** User-requested: drafts purposes in bounded batches of 10 for rows with notes lacking purposes. */
  const draftBulkPurposesBatch = async () => {
    if (!notesCol || generatingPurposes) return;
    const allPending = preview
      .map((r) => ({ id: r.id, note: noteOf(r).trim() }))
      .filter((x) => x.note && !purposes[x.id]);
    const rows = allPending.slice(0, 10);
    if (!rows.length) return;
    setGeneratingPurposes(true);
    try {
      const result = await generatePurposes(rows.map((x) => x.note));
      setPurposes((prev) => {
        const next = { ...prev };
        rows.forEach((x, i) => { if (result[i]) next[x.id] = result[i] as string; });
        return next;
      });
      const remainingAfterBatch = allPending.length - rows.length;
      toast({
        title: "AI purposes drafted",
        description: `Drafted ${rows.length} purpose(s).${remainingAfterBatch > 0 ? ` ${remainingAfterBatch} row(s) still pending.` : ""}`,
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

  const {
    okRecordIds,
    indeterminateRecordIds,
    remainingToCalculate: remainingPreviewToCalculate,
    indeterminateRecords,
  } = partitionRecordsForContinuation(preview, distances);

  const validAddressCount = preview.filter((r) => {
    const addr = addressesOf(r);
    return Boolean(addr.start.trim() && addr.end.trim());
  }).length;

  const validRemainingCount = remainingPreviewToCalculate.filter((r) => {
    const addr = addressesOf(r);
    return Boolean(addr.start.trim() && addr.end.trim());
  }).length;

  const validIndeterminateCount = indeterminateRecords.filter((r) => {
    const addr = addressesOf(r);
    return Boolean(addr.start.trim() && addr.end.trim());
  }).length;

  const runCalculation = async (recordsToRun: PreviewRecord[], isFullRecalc = false) => {
    if (!recordsToRun.length || !startCol || !endCol) return;
    if (isCalculatingRef.current || calculating) return;

    const validInRun = recordsToRun.filter((r) => {
      const addr = addressesOf(r);
      return Boolean(addr.start.trim() && addr.end.trim());
    }).length;

    if (credits < validInRun) {
      showCreditsToast(
        `Calculation requires ${validInRun} credits, but you only have ${credits} credits available. Please purchase more credits to proceed.`
      );
      return;
    }

    isCalculatingRef.current = true;
    setCalculating(true);
    cancelCalculationRef.current = false;
    calculatedMappingRef.current = { start: startCol, end: endCol, distance: distanceCol };
    if (isFullRecalc) {
      setConfirmedSyncIds([]);
      setFailedSyncIds([]);
      setSyncedCount(null);
    }
    setSyncProgress({ processed: 0, confirmed: 0, failed: 0, indeterminate: 0, total: 0 });

    try {
      const recordsToCalculate = recordsToRun.map((r) => ({
        id: r.id,
        ...addressesOf(r),
      }));

      const res = await executeBulkDistanceCalculation(recordsToCalculate, {
        batchSize: 5,
        availableCredits: credits,
        isCancelled: () => cancelCalculationRef.current,
        onBatchComplete: (batchResults, creditsRemaining, refundError) => {
          setDistances((prev) => {
            const nextMap = new Map(prev.map((d) => [d.record_id, d]));
            for (const b of batchResults) nextMap.set(b.record_id, b);
            return Array.from(nextMap.values());
          });
          if (typeof creditsRemaining === "number") {
            setCredits(creditsRemaining);
          }
          if (refundError) {
            toast({
              title: "Refund error",
              description: `Warning: Server failed to refund credits for failed rows: ${refundError}. Your credit balance may not reflect compensation.`,
              variant: "destructive",
            });
          }
        },
        onProgress: (p) => {
          setCalcProgress(p);
        },
        fetchAuthoritativeCreditsFn: async () => {
          if (!user) return null;
          const s = await getSettings(user.id);
          return s?.credits ?? null;
        },
      });

      setDistances((prev) => {
        const nextMap = new Map(prev.map((d) => [d.record_id, d]));
        for (const b of res.results) nextMap.set(b.record_id, b);
        return Array.from(nextMap.values());
      });

      if (typeof res.creditsRemaining === "number") {
        setCredits(res.creditsRemaining);
      }
      setShowSummary(true);

      if (res.cancelled) {
        toast({
          title: "Calculation cancelled",
          description: `Stopped scheduling new batches. Completed results have been preserved (${res.summary.ok} ok, ${res.summary.error + res.summary.indeterminate} uncompleted).`,
        });
      } else {
        const notif = formatCalculationNotification(res.summary, res.refundErrors);
        toast({
          title: notif.title,
          description: notif.description,
          variant: notif.variant,
        });
      }
      // Note: Never auto-invoke draftBulkPurposes() for bulk calculations!
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (msg.includes("402") || msg.includes("Insufficient credits")) {
        showCreditsToast("You don't have enough credits for this calculation. Buy more credits to continue.");
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      isCalculatingRef.current = false;
      setCalculating(false);
      setCalcProgress(null);
      // Synchronize with authoritative balance from DB
      if (user) {
        getSettings(user.id)
          .then((s) => {
            if (s && typeof s.credits === "number") setCredits(s.credits);
          })
          .catch(() => {});
      }
    }
  };

  const handleCalculate = async () => {
    const targetRecords = remainingPreviewToCalculate;
    if (!targetRecords.length) return;
    await runCalculation(targetRecords, distances.length === 0);
  };

  const handleRetryIndeterminate = async () => {
    if (calculating || syncing) return;
    if (validIndeterminateCount === 0) return;

    if (credits < validIndeterminateCount) {
      showCreditsToast(
        `Retrying indeterminate records requires ${validIndeterminateCount} credits, but you only have ${credits} credits available. Please purchase more credits to proceed.`
      );
      return;
    }

    const confirmed = window.confirm(
      `Warning: ${validIndeterminateCount} record(s) previously ended in an indeterminate state. Credits may have already been charged if the server processed them. Re-running will consume up to ${validIndeterminateCount} additional credit(s). Do you want to proceed with retrying these records?`
    );
    if (!confirmed) return;

    await runCalculation(indeterminateRecords, false);
  };

  const handleResetAndRecalculateAll = async () => {
    if (calculating || syncing) return;

    // Check credit sufficiency BEFORE clearing existing results and synchronization state
    if (credits < validAddressCount) {
      showCreditsToast(
        `Recalculation requires ${validAddressCount} credits, but you only have ${credits} credits available. Please purchase more credits to proceed.`
      );
      return;
    }

    const confirmed = window.confirm(
      `Recalculating all ${validAddressCount} valid record(s) will clear existing completed results and consume up to ${validAddressCount} credits. Do you want to proceed?`
    );
    if (!confirmed) return;

    setDistances([]);
    setConfirmedSyncIds([]);
    setFailedSyncIds([]);
    await runCalculation(preview, true);
  };


  const handleSync = async () => {
    // Ensure any background mapping saves have finished
    await mappingCoordinatorRef.current?.waitForLatest();

    await executeJobSync({
      user,
      selectedBase,
      selectedTable,
      startCol,
      endCol,
      distanceCol,
      costCol,
      statusCol,
      notesCol,
      purposeCol,
      ratePerUnit,
      rateUnit,
      distances,
      purposes,
      confirmedSyncIds,
      failedSyncIds,
      syncedCount,
      provider,
      calculating,
      syncing,
      generatingPurposes,
      setSyncing,
      setMappingStatus,
      setMappingError,
      setSyncProgress,
      setConfirmedSyncIds,
      setFailedSyncIds,
      setSyncedCount,
      setShowSummary,
      toast,
    });
  };

  const noSettings = !hasPat;
  const okCount = distances.filter((d) => d.status === "ok").length;
  const failedCount = distances.filter((d) => d.status !== "ok").length;
  const showPurposeColumn = Boolean(purposeCol || notesCol || Object.keys(purposes).length > 0);
  const allSyncRecords = buildSyncRecords(
    distances.map((d) => ({ ...d, purposeText: purposes[d.record_id] })),
    { cost: Boolean(costCol), status: Boolean(statusCol), purpose: Boolean(purposeCol) },
    ratePerUnit,
    rateUnit
  );
  const allSynced = allSyncRecords.length > 0 && allSyncRecords.every((r) => confirmedSyncIds.includes(r.id));
  const hasFailedSync = failedSyncIds.length > 0;

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
            <CardContent className="py-10 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <KeyRound className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-foreground">Connect Airtable to Start</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  You have <strong className="text-foreground">{credits} mileage credits</strong> available. Connect your Airtable account with a Personal Access Token to load your addresses and calculate driving distances.
                </p>
              </div>
              <Button asChild>
                <Link to="/settings" className="inline-flex items-center gap-2">
                  Connect Airtable in Settings
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
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
                    <Select value={selectedBase} onValueChange={setSelectedBase} disabled={calculating || syncing}>
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
                      <Select value={selectedTable} onValueChange={setSelectedTable} disabled={calculating || syncing}>
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
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base">Column Mapping</CardTitle>
                  {mappingStatus === "loading" && <span className="text-xs text-muted-foreground">Loading mapping...</span>}
                  {mappingStatus === "saving" && <span className="text-xs text-amber-500 font-medium">Saving mapping...</span>}
                  {mappingStatus === "saved" && <span className="text-xs text-green-600 font-medium">✓ Mapping saved</span>}
                  {mappingStatus === "error" && (
                    <span className="text-xs text-destructive font-medium" title={mappingError ?? "Error saving mapping"}>
                      ✕ Mapping not saved
                    </span>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {[
                    { label: "Start Address", value: startCol, onChange: setStartCol, required: true },
                    { label: "End Address", value: endCol, onChange: setEndCol, required: true },
                    { label: "Distance Output", value: distanceCol, onChange: setDistanceCol, required: true },
                    { label: "Reimbursement Amount", value: costCol, onChange: setCostCol, required: false },
                    { label: "Status / Log", value: statusCol, onChange: setStatusCol, required: false },
                    { label: "Trip Notes / Reason", value: notesCol, onChange: setNotesCol, required: false },
                    { label: "Business Purpose", value: purposeCol, onChange: setPurposeCol, required: false },
                  ].map(({ label, value, onChange, required }) => (
                    <div key={label} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>{label}</Label>
                        {required ? (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-primary/40 text-primary font-semibold">Required</Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">Optional</span>
                        )}
                      </div>
                      <Select
                        value={value || undefined}
                        onValueChange={(v) => onChange(v === "__none__" ? "" : v)}
                        disabled={calculating || syncing}
                      >
                        <SelectTrigger><SelectValue placeholder={`Select ${label}`} /></SelectTrigger>
                        <SelectContent>
                          {!required && <SelectItem value="__none__">None</SelectItem>}
                          {fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                  {(!startCol || !endCol || !distanceCol) && (
                    <p className="text-xs text-muted-foreground bg-muted/40 p-2.5 rounded border border-border">
                      💡 Select <strong>Start Address</strong>, <strong>End Address</strong>, and <strong>Distance Output</strong> columns above to enable preview and calculation actions.
                    </p>
                  )}
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
                        disabled={calculating || syncing}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Unit</Label>
                      <Select
                        value={rateUnit}
                        onValueChange={(v) => setRateUnit(v as RateUnit)}
                        disabled={calculating || syncing}
                      >
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
                      disabled={calculating || syncing}
                    >
                      Reset to IRS rate
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            {startCol && endCol && distanceCol && (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={handlePreview} disabled={loadingPreview || calculating || syncing}>
                      {loadingPreview ? "Loading..." : "Fetch Preview (5)"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleLoadEligibleRecords}
                      disabled={loadingPreview || calculating || syncing}
                    >
                      {loadingPreview ? "Loading..." : "Load Eligible Records (up to 500)"}
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground pt-1 border-t border-border/50">
                    <p>• <strong>Preview (5):</strong> Samples up to 5 uncalculated records to test mapping before spending credits.</p>
                    <p>• <strong>Load Eligible (up to 500):</strong> Bulk loads all uncalculated records in this table for full processing.</p>
                  </div>
                </div>

                {preview.length > 0 && credits < (distances.length > 0 ? validRemainingCount : validAddressCount) && (
                  <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
                    <Info className="h-4 w-4" />
                    <AlertTitle>Insufficient Credits</AlertTitle>
                    <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs mt-1">
                      <span>
                        This calculation requires <strong>{distances.length > 0 ? validRemainingCount : validAddressCount} credits</strong>, but your available balance is <strong>{credits} credits</strong>.
                      </span>
                      <Button size="sm" variant="destructive" asChild className="shrink-0">
                        <Link to="/pricing">Buy 500 Credits ($9)</Link>
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {preview.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3">
                    {validRemainingCount > 0 && (
                      <Button
                        onClick={handleCalculate}
                        disabled={calculating || syncing || credits < validRemainingCount}
                      >
                        {calculating
                          ? "Calculating..."
                          : distances.length > 0
                          ? `Continue Calculation (${validRemainingCount} remaining, ${validRemainingCount} credits)`
                          : `Calculate Distances (${validAddressCount} credits)`}
                      </Button>
                    )}
                    {indeterminateRecordIds.size > 0 && validIndeterminateCount > 0 && (
                      <Button
                        variant="outline"
                        onClick={handleRetryIndeterminate}
                        disabled={calculating || syncing || credits < validIndeterminateCount}
                      >
                        {`Retry Indeterminate (${validIndeterminateCount} records, ${validIndeterminateCount} credits)`}
                      </Button>
                    )}
                    {distances.length > 0 && (
                      <Button
                        variant="outline"
                        onClick={handleResetAndRecalculateAll}
                        disabled={calculating || syncing || credits < validAddressCount}
                      >
                        Recalculate All Records ({validAddressCount} credits)
                      </Button>
                    )}
                    {calculating && (
                      <Button
                        variant="outline"
                        onClick={() => { cancelCalculationRef.current = true; }}
                      >
                        Stop After Current Batch
                      </Button>
                    )}
                    {notesCol && preview.some((r) => noteOf(r).trim() && !purposes[r.id]) && (
                      <Button
                        variant="outline"
                        onClick={draftBulkPurposesBatch}
                        disabled={calculating || syncing || generatingPurposes}
                      >
                        {generatingPurposes ? "Drafting AI (10)..." : "Draft AI Purposes (10 Records)"}
                      </Button>
                    )}
                    {distances.length > 0 && (
                      <Button
                        onClick={handleSync}
                        disabled={
                          syncing ||
                          calculating ||
                          generatingPurposes ||
                          allSynced ||
                          mappingStatus === "saving" ||
                          mappingStatus === "error" ||
                          mappingStatus === "loading"
                        }
                      >
                        {syncing
                          ? "Syncing..."
                          : generatingPurposes
                          ? "Generating AI Purposes..."
                          : allSynced
                          ? "✓ All Records Synced"
                          : hasFailedSync
                          ? `Retry Failed Records (${failedSyncIds.length})`
                          : "Sync to Airtable"}
                      </Button>
                    )}
                  </div>
                )}

                {preview.length > 0 && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                    <span>
                      {distances.length > 0
                        ? `${okRecordIds.size} completed, ${indeterminateRecordIds.size > 0 ? `${indeterminateRecordIds.size} indeterminate, ` : ""}${validRemainingCount} valid remaining to calculate.`
                        : `${validAddressCount} valid address pair(s) to calculate.`}
                      {preview.length - validAddressCount > 0 && ` (${preview.length - validAddressCount} invalid/empty address pair(s) excluded from credits)`}
                    </span>
                    <span className={credits < (okRecordIds.size > 0 ? validRemainingCount : validAddressCount) ? "text-destructive font-semibold" : ""}>
                      Available balance: {credits} credits
                    </span>
                  </div>
                )}

              </div>
            )}

            {/* Calculation Progress */}
            {calculating && calcProgress && (
              <Card>
                <CardContent className="py-4 space-y-2">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Calculating batch {calcProgress.currentBatch} of {calcProgress.totalBatches} ({calcProgress.processed} of {calcProgress.total} records)</span>
                    <span>
                      {calcProgress.completed} ok
                      {calcProgress.failed > 0 ? `, ${calcProgress.failed} failed` : ""}
                      {calcProgress.indeterminate > 0 ? `, ${calcProgress.indeterminate} unconfirmed` : ""}
                    </span>
                  </div>
                  <Progress value={(calcProgress.processed / calcProgress.total) * 100} />
                </CardContent>
              </Card>
            )}

            {/* Sync Progress */}
            {syncing && syncProgress.total > 0 && (
              <Card>
                <CardContent className="py-4 space-y-2">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Processing: {syncProgress.processed} of {syncProgress.total}</span>
                    <span>
                      {syncProgress.confirmed} confirmed
                      {syncProgress.failed > 0 ? `, ${syncProgress.failed} failed` : ""}
                      {syncProgress.indeterminate > 0 ? `, ${syncProgress.indeterminate} unconfirmed` : ""}
                    </span>
                  </div>
                  <Progress value={(syncProgress.processed / syncProgress.total) * 100} />
                </CardContent>
              </Card>
            )}

            {/* Preview Table */}
            {preview.length > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base">
                    {retrievalMeta?.isFullLoad ? "Eligible Records" : "Preview"} ({preview.length} records)
                  </CardTitle>
                  {retrievalMeta?.isFullLoad && (
                    retrievalMeta.limitReached ? (
                      <Badge variant="outline" className="text-amber-600 border-amber-500">
                        500 records loaded (limit reached; more records may exist in Airtable)
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-green-700 bg-green-50 border-green-200">
                        All {retrievalMeta.total} eligible records loaded (complete)
                      </Badge>
                    )
                  )}
                </CardHeader>
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
                        const isBlankPair = !addr.start.trim() || !addr.end.trim();
                        return (
                          <TableRow key={r.id} className={isBlankPair ? "bg-muted/20" : undefined}>
                            <TableCell className="align-top">
                              <PurposeCell
                                purpose={undefined}
                                initialNote={noteOf(r)}
                                onChange={(p) => setPurpose(r.id, p)}
                                onError={showAiError}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs">{r.id.slice(0, 10)}</TableCell>
                            <TableCell>
                              {addr.start.trim() || <span className="text-xs text-muted-foreground italic">(empty)</span>}
                            </TableCell>
                            <TableCell>
                              {addr.end.trim() || <span className="text-xs text-muted-foreground italic">(empty)</span>}
                            </TableCell>
                            {distances.length > 0 && (
                              <TableCell>
                                {isBlankPair ? (
                                  <span className="text-xs text-muted-foreground">Empty address (0 credits)</span>
                                ) : dist?.status === "ok" ? (
                                  `${dist.distance_mi.toFixed(2)} mi`
                                ) : (
                                  dist?.error ?? "—"
                                )}
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
                  <p className="text-xs text-muted-foreground text-center pt-4">
                    Mapping and routing powered by{" "}
                    <a
                      href="https://www.geoapify.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      Geoapify
                    </a>{" "}
                    | ©{" "}
                    <a
                      href="https://www.openstreetmap.org/copyright"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      OpenStreetMap
                    </a>{" "}
                    contributors
                  </p>
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
            <DialogTitle>Calculation Summary</DialogTitle>
            <DialogDescription>
              {okCount} record(s) calculated successfully, {failedCount} could not be verified.
              {syncedCount !== null ? ` ${syncedCount} record(s) synced to Airtable.` : ""}
            </DialogDescription>
          </DialogHeader>

          {failedCount > 0 ? (
            <div className="max-h-72 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Record ID</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Reason</TableHead>
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
            <p className="text-sm text-muted-foreground">All records were calculated successfully.</p>
          )}

          <p className="text-xs text-muted-foreground">
            {statusCol
              ? "Unverified records are skipped, or marked with 'Adres Bulunamadı' in your Airtable status column."
              : "To mark unverified records in Airtable, select a 'Status / Log' column in Column Mapping."}
          </p>

          <p className="text-xs text-muted-foreground text-center pt-1">
            Mapping and routing powered by{" "}
            <a
              href="https://www.geoapify.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Geoapify
            </a>{" "}
            | ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              OpenStreetMap
            </a>{" "}
            contributors
          </p>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                setShowSummary(false);
                setDistances([]);
                setPreview([]);
                setPurposes({});
                setOverrides({});
                setSyncedCount(null);
                setConfirmedSyncIds([]);
                setFailedSyncIds([]);
                setSyncProgress({ processed: 0, confirmed: 0, failed: 0, indeterminate: 0, total: 0 });
                calculatedMappingRef.current = null;
              }}
            >
              Clear Results
            </Button>
            <Button onClick={() => navigate("/dashboard")}>Return to Dashboard</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NewJobPage;
