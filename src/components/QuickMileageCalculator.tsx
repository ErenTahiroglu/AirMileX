import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Clock, Loader2, Route } from "lucide-react";
import { quickDistance, type QuickDistanceResult } from "@/services/quickDistance";

type Unit = "km" | "mi";

const QuickMileageCalculator = () => {
  const navigate = useNavigate();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [unit, setUnit] = useState<Unit>("km");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickDistanceResult | null>(null);

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await quickDistance(start, end));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const distance = result
    ? unit === "km"
      ? result.distance_km
      : result.distance_mi
    : null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">Quick Mileage Calculator</CardTitle>
        <CardDescription>
          Free driving distance between two addresses. No sign-up needed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCalculate} className="space-y-4">
          <AddressAutocomplete
            id="quick-start"
            label="Start address"
            value={start}
            onChange={setStart}
            placeholder="Kadıköy, Istanbul"
            required
          />
          <AddressAutocomplete
            id="quick-end"
            label="End address"
            value={end}
            onChange={setEnd}
            placeholder="Beşiktaş, Istanbul"
            required
          />

          <fieldset className="flex items-center gap-2">
            <legend className="sr-only">Distance unit</legend>
            {(["km", "mi"] as Unit[]).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={unit === option ? "default" : "outline"}
                aria-pressed={unit === option}
                onClick={() => setUnit(option)}
              >
                {option === "km" ? "KM" : "Miles"}
              </Button>
            ))}
          </fieldset>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Calculating...
              </>
            ) : (
              "Calculate"
            )}
          </Button>
        </form>

        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {result && distance !== null && (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Route className="h-3.5 w-3.5" />
                  Driving distance
                </div>
                <p className="mt-1 text-2xl font-semibold text-foreground">
                  {distance.toFixed(1)}
                  <span className="ml-1 text-base font-normal text-muted-foreground">
                    {unit === "km" ? "km" : "mi"}
                  </span>
                </p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Estimated time
                </div>
                <p className="mt-1 text-2xl font-semibold text-foreground">
                  {Math.floor(result.duration_min / 60) > 0 &&
                    `${Math.floor(result.duration_min / 60)}h `}
                  {result.duration_min % 60}
                  <span className="ml-1 text-base font-normal text-muted-foreground">min</span>
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm text-foreground">
                Want to do this for hundreds of rows in your Airtable table with one click?
                Start with 50 free calculations.
              </p>
              <Button className="mt-3 w-full" onClick={() => navigate("/new-job")}>
                Start with 50 free calculations
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default QuickMileageCalculator;
