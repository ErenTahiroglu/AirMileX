import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Footer from "@/components/Footer";

const PricingPage = () => (
  <div className="flex min-h-screen flex-col bg-background">
    <div className="flex-1 px-4 py-16">
      <div className="mx-auto max-w-md text-center">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Back to Home</Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">Pricing</h1>
        <p className="mt-2 text-muted-foreground">Simple, transparent pricing for mileage calculations.</p>

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
            <Button className="w-full" disabled>Buy Credits (Coming Soon)</Button>
          </CardContent>
        </Card>
      </div>
    </div>
    <Footer />
  </div>
);

export default PricingPage;
