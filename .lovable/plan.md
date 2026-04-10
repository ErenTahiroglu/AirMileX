

# Paddle Compliance Pages — Execution Plan

## Overview
Create a Footer component, Pricing page, and 3 legal pages with full provided content. Add public routes. No authentication required for any of these pages.

## Files to Create (5)

### 1. `src/components/Footer.tsx`
Minimalist footer with `Link` components to `/pricing`, `/terms-and-conditions`, `/privacy`, `/refund`. Centered, subtle text styling.

### 2. `src/pages/PricingPage.tsx`
Public page with centered layout, single pricing card for "500 Mileage Credits" with placeholder "Buy Credits" button. Footer at bottom.

### 3. `src/pages/TermsPage.tsx`
Full Terms of Service content (Turkish then English) with proper Tailwind typography: `text-2xl font-bold mb-4` for main headings, `text-xl font-semibold mt-6 mb-2` for subheadings, `mb-4 text-gray-700` for paragraphs. Max-width readable container. Footer at bottom.

### 4. `src/pages/PrivacyPage.tsx`
Same layout as Terms, with full Privacy Policy content (Turkish then English). Footer at bottom.

### 5. `src/pages/RefundPage.tsx`
Same layout as Terms, with full Refund Policy content (Turkish then English). Footer at bottom.

## Files to Modify (2)

### 6. `src/pages/AuthPage.tsx`
Add `<Footer />` import and render it at the bottom of the page (inside the outer div, after the Card).

### 7. `src/App.tsx`
Add 4 new public routes (outside ProtectedRoute):
- `/pricing` → PricingPage
- `/terms-and-conditions` → TermsPage
- `/privacy` → PrivacyPage
- `/refund` → RefundPage

Import all 4 new page components.

## Technical Notes
- All legal text embedded directly as JSX — no placeholders
- All new pages are public (no auth wrapper)
- Footer uses `react-router-dom` `Link` for client-side navigation
- Legal pages use `max-w-3xl mx-auto` for readable width

