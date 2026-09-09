import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { createCheckout } from "@/services/paddle";
import { useToast } from "@/hooks/use-toast";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";

const PricingPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [buying, setBuying] = useState(false);

  const handleBuy = async () => {
    if (!user) {
      navigate("/auth");
      return;
    }
    setBuying(true);
    try {
      const result = await createCheckout();
      if (result.checkout_url) {
        window.open(result.checkout_url, "_blank");
      } else {
        toast({ title: "Error", description: "No checkout URL returned.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Checkout failed", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Seo
        title="Pricing | AirMileX — 500 Mileage Credits for $9"
        description="Simple, transparent pricing. Buy 500 mileage credits for a one-time $9. Airtable integration, multiple map providers, saved column mappings."
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
        <div className="mx-auto max-w-md text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Back to Home</Link>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">Pricing</h1>
          <p className="mt-2 text-muted-foreground">Simple, transparent pricing for mileage calculations.</p>

          <h2 className="sr-only">Credit packages</h2>
          <Card className="mt-10 text-left">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">500 Mileage Credits</CardTitle>
              <CardDescription>Calculate distances for up to 500 Airtable records</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-3xl font-bold">$9<span className="text-base font-normal text-muted-foreground"> / one-time</span></p>
              <ul className="space-y-1 text-sm text-muted-foreground text-left">
                <li>✓ 500 distance calculations</li>
                <li>✓ Airtable integration</li>
                <li>✓ Multiple map providers</li>
                <li>✓ Saved column mappings</li>
              </ul>
              <Button className="w-full" onClick={handleBuy} disabled={buying}>
                {buying ? "Processing…" : "Buy Credits"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PricingPage;
