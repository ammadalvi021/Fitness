/**
 * Smoke spec for the FitFusion AI web app.
 *
 * Covers: landing branding, login page client-side validation, the public BMI
 * calculator API, unauthenticated /dashboard redirect, and the PWA manifest.
 * Run: npm run test:e2e (from apps/web). Needs `npx playwright install chromium`.
 */
import { test, expect } from "@playwright/test";

test.describe("FitFusion AI smoke", () => {
  test("landing page loads with branding", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/FitFusion AI/);
    // Brand name rendered in the header (sr-only span next to the logo)
    await expect(page.getByText("FitFusion AI").first()).toBeAttached();
    // Primary CTAs present
    await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
  });

  test("login page renders and rejects empty submit client-side", async ({ page }) => {
    let loginApiHit = false;
    await page.route("**/api/auth/login", async (route) => {
      loginApiHit = true;
      await route.abort();
    });

    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Welcome back" })
    ).toBeVisible();

    // Submit with empty fields: HTML5 required validation must block the
    // request client-side — no navigation away, no API call.
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(loginApiHit).toBe(false);
    const emailValid = await page
      .locator("#email")
      .evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(emailValid).toBe(false);
  });

  test("POST /api/calculators/bmi classifies 80kg/180cm", async ({ request }) => {
    const res = await request.post("/api/calculators/bmi", {
      data: { weight: 80, height: 180, units: "metric" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // 80kg / 1.80m -> BMI 24.7 -> "healthy" (contract: adult classification)
    expect(body.classificationKey).toBe("healthy");
    expect(typeof body.bmi).toBe("number");
    expect(body.screeningNote).toContain("screening measure");
  });

  test("unauthenticated /dashboard redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    // Either a redirect to /login (optionally ?next=...) or the login page
    // rendered directly — both contain "login" in the location.
    await expect(page).toHaveURL(/login/);
  });

  test("manifest.webmanifest returns 200", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.name).toBe("string");
  });
});
