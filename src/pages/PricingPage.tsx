import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";
import { createCheckout } from "@/services/paddle";
import { useToast } from "@/hooks/use-toast";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";
import { Check, Info } from "lucide-react";

/**
 * Minimal launch-readiness flag for paid credit checkout.
 * Defaults to false until Phase 5 completes production Paddle credential provisioning,
 * webhook verification, and end-to-end sandbox/live transaction validation.
 */
export const IS_PAID_CHECKOUT_ENABLED =
  import.meta.env.VITE_ENABLE_PADDLE_CHECKOUT === "true";

const PricingPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [buying, setBuying] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);

  const handleBuy = async () => {
    if (!IS_PAID_CHECKOUT_ENABLED) {
      setPaymentNotice(
        "Paid credit checkout is undergoing final payment gateway verification and will open in Phase 5. Please continue using your 50 free credits in the meantime."
      );
      return;
    }
    if (!user) {
      navigate("/?next=/pricing");
      return;
    }
    setBuying(true);
    setPaymentNotice(null);
    try {
      const result = await createCheckout();
      if (result.checkout_url) {
        window.open(result.checkout_url, "_blank");
      } else {
        setPaymentNotice("Payment gateway is completing final verification. Paid purchases will open shortly. You can use your 50 free credits in the meantime.");
      }
    } catch (err: unknown) {
      const msg = (err as Error).message || "";
      if (msg.includes("Payment configuration missing") || msg.includes("500")) {
        setPaymentNotice("Payment gateway integration is undergoing final verification. Paid credit purchases will open shortly. Please continue using your 50 free credits in the meantime.");
      } else {
        toast({ title: "Checkout status", description: msg || "Please try again later.", variant: "destructive" });
      }
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Seo
        title="Pricing | AirMileX — 500 Mileage Credits for $9"
        description="Simple, transparent pricing. Start with 50 free credits on signup. 500 mileage credits for a one-time $9 when paid checkout opens. Airtable integration, operator-managed map routing."
        path="/pricing"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "AirMileX",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description: "Automated Airtable mileage tracking and driving-distance calculator.",
          offers: {
            "@type": "Offer",
            price: "9.00",
            priceCurrency: "USD",
            name: "500 Mileage Credits",
            url: "https://airmilex.lovable.app/pricing",
          },
        }}
      />
      <main className="flex-1 px-4 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Back to Home</Link>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">Simple, Transparent Mileage Pricing</h1>
          <p className="mt-2 text-muted-foreground max-w-lg mx-auto">
            Automate mileage tracking in your Airtable base without paying for Google Maps API keys or subscription fees.
          </p>

          {paymentNotice && (
            <Alert className="mt-6 text-left border-primary/30 bg-primary/5">
              <Info className="h-4 w-4 text-primary" />
              <AlertTitle className="font-semibold text-foreground">Launch Readiness Notice</AlertTitle>
              <AlertDescription className="text-sm text-muted-foreground">
                {paymentNotice}
              </AlertDescription>
            </Alert>
          )}

          <h2 className="sr-only">Credit packages</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2 text-left">
            {/* Free Tier Card */}
            <Card className="flex flex-col justify-between border-border">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">Free Starter</CardTitle>
                  <Badge variant="secondary">Included</Badge>
                </div>
                <CardDescription>Get started with automated Airtable mileage tracking</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <p className="text-3xl font-bold">$0</p>
                  <p className="text-xs text-muted-foreground mt-1">Granted automatically upon account creation</p>
                </div>
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span><strong>50 free mileage credits</strong> upon signup</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>1 credit = 1 completed distance calculation</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>Operator-managed map routing (no personal API key needed)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>Direct Airtable read & write synchronization</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>Unroutable calculations credited back per system refund rules (empty rows cost 0 credits)</span>
                  </li>
                </ul>
                <Button variant="outline" className="w-full" asChild>
                  <Link to={user ? "/new-job" : "/?mode=signup&next=/new-job"}>
                    {user ? "Go to Mileage Jobs" : "Sign Up for Free"}
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Paid Tier Card */}
            <Card className="flex flex-col justify-between border-primary/50 relative shadow-sm">
              <div className="absolute -top-3 right-4">
                <Badge className={IS_PAID_CHECKOUT_ENABLED ? "bg-primary text-primary-foreground font-semibold" : "bg-muted text-muted-foreground border border-border"}>
                  {IS_PAID_CHECKOUT_ENABLED ? "Pay As You Go" : "Checkout in Phase 5"}
                </Badge>
              </div>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">500 Mileage Credits</CardTitle>
                </div>
                <CardDescription>Scale your monthly expense reports and tax deductions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <p className="text-3xl font-bold">$9<span className="text-base font-normal text-muted-foreground"> / one-time</span></p>
                  <p className="text-xs text-muted-foreground mt-1">$0.018 per calculated trip • No recurring monthly charge</p>
                </div>
                <ul className="space-y-2.5 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span><strong>500 distance calculations</strong> for Airtable records</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>Operator-managed routing powered by Geoapify</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>Bulk execution up to 500 records per job</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>Saved column mappings & custom reimbursement rates</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>Credit refund policy applies to unroutable records (indeterminate outcomes flagged)</span>
                  </li>
                </ul>

                {!IS_PAID_CHECKOUT_ENABLED && (
                  <Alert className="border-amber-500/30 bg-amber-500/10 text-left py-2.5">
                    <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <AlertTitle className="text-xs font-semibold text-foreground">Launch Readiness Notice</AlertTitle>
                    <AlertDescription className="text-xs text-muted-foreground leading-normal mt-0.5">
                      Paid credit checkout is undergoing final payment gateway verification and will open in Phase 5.
                      Please enjoy your <strong>50 complimentary credits</strong> in the meantime.
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  className="w-full"
                  onClick={handleBuy}
                  disabled={!IS_PAID_CHECKOUT_ENABLED || buying}
                  title={!IS_PAID_CHECKOUT_ENABLED ? "Paid checkout will open in Phase 5 upon payment verification" : undefined}
                >
                  {!IS_PAID_CHECKOUT_ENABLED
                    ? "Checkout Opening Soon ($9)"
                    : buying
                    ? "Processing…"
                    : "Buy 500 Credits ($9)"}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="mt-12 text-center text-xs text-muted-foreground">
            <p>
              AirMileX uses operator-managed mapping APIs. OpenStreetMap data attribution: ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                OpenStreetMap contributors
              </a>
              . Powered by{" "}
              <a
                href="https://www.geoapify.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Geoapify
              </a>
              .
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PricingPage;
