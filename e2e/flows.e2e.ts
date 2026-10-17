import { test, expect } from "@playwright/test";

test.describe("AirMileX Phase 5B: Browser E2E Verification", () => {
  // Flow 1: Landing page loads and displays 50 free mileage credits
  test("Flow 1: Landing page loads and displays 50 free mileage credits", async ({ page }) => {
    await page.goto("/");

    // Verify main hero heading
    const heroHeading = page.locator("h1");
    await expect(heroHeading).toContainText("AirMileX: Automate Your Airtable Mileage Tracking");

    // Verify 50 free credits marketing badge
    const creditsBadge = page.locator("text=50 Free Mileage Credits on Signup");
    await expect(creditsBadge).toBeVisible();

    // Verify feature highlights mention 50 free credits
    const featureNote = page.locator("text=Start with 50 free mileage credits");
    await expect(featureNote).toBeVisible();
  });

  // Flow 2: Signup CTA navigates to signup mode and preserves /new-job intent
  test("Flow 2: Signup CTA navigates to signup mode and preserves /new-job intent", async ({ page }) => {
    // Navigate with signup mode and destination intent
    await page.goto("/?mode=signup&next=/new-job");

    const authSection = page.locator("section[aria-labelledby='auth-heading']");

    // Auth card should reflect signup state
    const cardTitle = authSection.locator(".text-xl");
    await expect(cardTitle).toContainText("Claim 50 Free Credits");

    const submitButton = authSection.locator('button[type="submit"]');
    await expect(submitButton).toHaveText("Sign Up");

    // Toggle between login and signup modes
    const toggleButton = authSection.locator("button", { hasText: "Already have an account? Sign in" });
    await expect(toggleButton).toBeVisible();
    await toggleButton.click();

    await expect(cardTitle).toContainText("Welcome Back");
    await expect(submitButton).toHaveText("Sign In");

    // Toggle back to signup
    const backToSignup = authSection.locator("button", { hasText: "Don't have an account? Sign up" });
    await backToSignup.click();
    await expect(cardTitle).toContainText("Claim 50 Free Credits");
    await expect(submitButton).toHaveText("Sign Up");
  });

  // Flow 3: Pricing shows Free Starter and 500 credits/$9
  test("Flow 3: Pricing shows Free Starter and 500 credits/$9", async ({ page }) => {
    await page.goto("/pricing");

    await expect(page.locator("h1")).toContainText("Simple, Transparent Mileage Pricing");

    // Free Starter Tier verification
    const freeStarterCard = page.locator("div.rounded-lg", { hasText: "Free Starter" });
    await expect(freeStarterCard).toBeVisible();
    await expect(freeStarterCard).toContainText("$0");
    await expect(freeStarterCard).toContainText("50 free mileage credits upon signup");
    await expect(freeStarterCard).toContainText("Operator-managed map routing");

    // Paid 500 Credits Tier verification
    const paidCard = page.locator("div.rounded-lg", { hasText: "500 Mileage Credits" });
    await expect(paidCard).toBeVisible();
    await expect(paidCard).toContainText("$9");
    await expect(paidCard).toContainText("500 distance calculations");
    await expect(paidCard).toContainText("Bulk execution up to 500 records per job");
  });

  // Flow 4: Paid checkout remains visibly disabled while the launch flag is false
  test("Flow 4: Paid checkout remains visibly disabled while the launch flag is false", async ({ page }) => {
    await page.goto("/pricing");

    // Verify Launch Readiness Notice alert
    const readinessNotice = page.locator("text=Launch Readiness Notice");
    await expect(readinessNotice.first()).toBeVisible();
    await expect(
      page.locator("text=Paid credit checkout is undergoing final payment gateway verification")
    ).toBeVisible();

    // Verify checkout button is disabled with explanatory label
    const checkoutButton = page.locator("button", { hasText: "Checkout Opening Soon ($9)" });
    await expect(checkoutButton).toBeVisible();
    await expect(checkoutButton).toBeDisabled();
  });

  // Flow 5: A disabled purchase action performs no checkout HTTP request
  test("Flow 5: A disabled purchase action performs no checkout HTTP request", async ({ page }) => {
    await page.goto("/pricing");

    const checkoutRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("paddle") || url.includes("checkout") || url.includes("payment")) {
        checkoutRequests.push(url);
      }
    });

    const checkoutButton = page.locator("button", { hasText: "Checkout Opening Soon ($9)" });
    await expect(checkoutButton).toBeDisabled();

    // Attempt to force click the disabled button
    await checkoutButton.click({ force: true }).catch(() => {});

    // Ensure zero checkout requests were dispatched
    await page.waitForTimeout(500);
    expect(checkoutRequests).toEqual([]);
  });

  // Flow 6: Logged-out access to /new-job preserves the target and reaches authentication
  test("Flow 6: Logged-out access to /new-job preserves the target and reaches authentication", async ({ page }) => {
    await page.goto("/new-job");

    // Must be redirected to root with next param preserving /new-job
    await page.waitForURL((url) => {
      return (
        url.pathname === "/" &&
        (url.search.includes("next=%2Fnew-job") || url.search.includes("next=/new-job"))
      );
    });

    const authSection = page.locator("section[aria-labelledby='auth-heading']");

    // Verify auth form is reached
    await expect(authSection.locator('input[type="email"]')).toBeVisible();
    await expect(authSection.locator('input[type="password"]')).toBeVisible();
    await expect(authSection.locator('button[type="submit"]')).toBeVisible();
  });

  // Flow 7: Airtable PAT setup instructions and required scopes are visible (UI E2E with mocked dependencies)
  test("Flow 7: Airtable PAT setup instructions and required scopes are visible (mocked session)", async ({ page }) => {
    const fakeUser = {
      id: "00000000-0000-4000-a000-000000000001",
      email: "playwright-tester@airmilex.local",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date().toISOString(),
    };

    const fakeSession = {
      access_token: "mock-jwt-token",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "mock-refresh-token",
      user: fakeUser,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };

    // Inject session into localStorage before initial page load
    await page.addInitScript(({ session }) => {
      window.localStorage.setItem("sb-lumfnuyzdyzpokcxykvn-auth-token", JSON.stringify(session));
    }, { session: fakeSession });

    // Mock Supabase backend responses for settings & flags
    await page.route("**/auth/v1/user**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeUser),
      });
    });

    await page.route("**/rest/v1/rpc/get_settings_flags**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ has_pat: false, credits: 50 }]),
      });
    });

    // 7A: Settings page instructions and scopes
    await page.goto("/settings");

    // Required scopes instruction check
    await expect(page.locator("text=How to create your Personal Access Token:")).toBeVisible();
    await expect(page.locator("text=AirMileX").first()).toBeVisible();
    await expect(page.locator("text=data.records:read")).toBeVisible();
    await expect(page.locator("text=data.records:write")).toBeVisible();
    await expect(page.locator("text=schema.bases:read")).toBeVisible();

    // 7B: New Job unconfigured state prompts user to connect Airtable
    await page.goto("/new-job");
    await expect(page.locator("text=Connect Airtable to Start")).toBeVisible();
    const connectButton = page.locator("a", { hasText: "Connect Airtable in Settings" });
    await expect(connectButton).toBeVisible();
    await expect(connectButton).toHaveAttribute("href", "/settings");
  });

  // Flow 8: Desktop and mobile layouts render the critical conversion controls
  test("Flow 8: Desktop and mobile layouts render critical conversion controls", async ({ page }) => {
    const authSection = page.locator("section[aria-labelledby='auth-heading']");

    // 8A: Desktop layout (1280x800)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    await expect(page.locator("text=50 Free Mileage Credits on Signup").first()).toBeVisible();
    await expect(authSection.locator("button", { hasText: "Continue with Google" })).toBeVisible();
    await expect(authSection.locator('input[type="email"]')).toBeVisible();
    await expect(authSection.locator('input[type="password"]')).toBeVisible();
    await expect(authSection.locator('button[type="submit"]')).toBeVisible();

    // 8B: Mobile layout (375x667)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    await expect(page.locator("text=50 Free Mileage Credits on Signup").first()).toBeVisible();
    await expect(authSection.locator("button", { hasText: "Continue with Google" })).toBeVisible();
    await expect(authSection.locator('input[type="email"]')).toBeVisible();
    await expect(authSection.locator('input[type="password"]')).toBeVisible();
    await expect(authSection.locator('button[type="submit"]')).toBeVisible();

    // Verify submit button is clickable and within screen bounds
    const box = await authSection.locator('button[type="submit"]').boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
  });

  // Flow 9: Legal pages (Terms, Privacy, Refund) render correctly under route-level lazy loading
  test("Flow 9: Legal pages render correctly with accurate retention and refund copy", async ({ page }) => {
    // 9A: Privacy Policy
    await page.goto("/privacy");
    await expect(page.locator("h1")).toContainText("PRIVACY POLICY / GİZLİLİK POLİTİKASI");
    await expect(page.locator("text=Saklama Süresi ve Hesap Silme")).toBeVisible();
    await expect(page.locator("text=Retention and Account Deletion")).toBeVisible();

    // 9B: Refund Policy
    await page.goto("/refund");
    await expect(page.locator("h1")).toContainText("REFUND POLICY / İADE POLİTİKASI");
    await expect(page.locator("text=30 Günlük Money-Back Guarantee")).toBeVisible();
    await expect(page.locator("text=Purchase Model and Subscription Cancellation")).toBeVisible();

    // 9C: Terms of Service
    await page.goto("/terms-and-conditions");
    await expect(page.locator("h1")).toContainText("TERMS OF SERVICE / HİZMET ŞARTLARI");
    await expect(page.locator("text=Paddle ve Ödeme İşlemleri")).toBeVisible();
  });

  // Flow 10: Reset password page renders correctly under lazy loading
  test("Flow 10: Reset password page renders correctly under lazy loading", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.locator("h1")).toContainText("Reset your AirMileX password");
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  // Flow 11: Settings account deletion UI step-up confirmation modal opens safely
  test("Flow 11: Settings account deletion UI modal renders and step-up confirmation flow opens", async ({ page }) => {
    const fakeUser = {
      id: "00000000-0000-4000-a000-000000000001",
      email: "playwright-tester@airmilex.local",
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date().toISOString(),
    };

    const fakeSession = {
      access_token: "mock-jwt-token",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "mock-refresh-token",
      user: fakeUser,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };

    await page.addInitScript(({ session }) => {
      window.localStorage.setItem("sb-lumfnuyzdyzpokcxykvn-auth-token", JSON.stringify(session));
    }, { session: fakeSession });

    await page.route("**/auth/v1/user**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeUser),
      });
    });

    await page.route("**/rest/v1/rpc/get_settings_flags**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ has_pat: false, credits: 50 }]),
      });
    });

    await page.goto("/settings");
    await expect(page.locator("h1").first()).toContainText("Settings");

    // Danger Zone should be visible
    const deleteButton = page.locator("button", { hasText: "Delete account" });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    // Account deletion confirmation dialog opens
    const dialog = page.locator("[role='alertdialog']");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("text=Delete your account permanently?")).toBeVisible();
    await expect(dialog.locator("text=This action cannot be undone")).toBeVisible();

    // Verify cancel button dismisses dialog
    const cancelButton = dialog.locator("button", { hasText: "Cancel" });
    await cancelButton.click();
    await expect(dialog).not.toBeVisible();
  });

  // Flow 12: 404 Not Found page renders for unmapped routes
  test("Flow 12: 404 Not Found page renders for unmapped routes", async ({ page }) => {
    await page.goto("/non-existent-page-404");
    await expect(page.locator("h1")).toContainText("404");
    await expect(page.locator("text=Oops! Page not found")).toBeVisible();
    const returnHome = page.locator("a", { hasText: "Return to Home" });
    await expect(returnHome).toBeVisible();
    await expect(returnHome).toHaveAttribute("href", "/");
  });
});
