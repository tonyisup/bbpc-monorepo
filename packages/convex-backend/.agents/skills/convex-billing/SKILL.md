---
name: convex-billing
description: "Add Stripe billing/payments to the Convex app via @convex-dev/stripe (checkout + webhook + gating)."
---

<!-- GENERATED from convex-agents content/capabilities/billing.json — do not edit by hand. -->

# Add billing / payments

Wire Stripe to Convex using @convex-dev/stripe: a checkout action, an httpAction webhook registered by the component (signature-verified automatically), subscription state stored in the component's tables, and server-side gating via a query.

## Workflow

1. Install the component from the repository root with pnpm: `pnpm --filter @tonyisup/bbpc-convex-api add @convex-dev/stripe@^0.1.4`.
2. Create `convex/convex.config.ts`:

   ```ts
   import { defineApp } from 'convex/server';
   import stripe from '@convex-dev/stripe/convex.config.js';
   const app = defineApp();
   app.use(stripe);
   export default app;
   ```

3. Store Stripe keys in Convex env (use the `env` micro power): `STRIPE_SECRET_KEY` (sk_test_… / sk_live_…) and `STRIPE_WEBHOOK_SECRET` (whsec_…).
4. Create `convex/http.ts` to register the webhook route (the component handles signature verification automatically):

   ```ts
   import { httpRouter } from 'convex/server';
   import { components } from './_generated/api';
   import { registerRoutes } from '@convex-dev/stripe';
   const http = httpRouter();
   registerRoutes(http, components.stripe, { webhookPath: '/stripe/webhook' });
   export default http;
   ```

5. Create `convex/billing.ts` with a checkout action and a subscription-gate query:

   ```ts
   import { action, query } from './_generated/server';
   import { components } from './_generated/api';
   import { StripeSubscriptions } from '@convex-dev/stripe';
   import { v } from 'convex/values';
   const stripeClient = new StripeSubscriptions(components.stripe, {});
   function checkoutBaseUrl(): string {
     const raw = process.env.SITE_URL;
     if (!raw) throw new Error('SITE_URL is required');
     const url = new URL(raw);
     if (url.protocol !== 'https:' && process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
       throw new Error('SITE_URL must use HTTPS outside explicit development/test runtimes');
     }
     if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('SITE_URL must be an HTTP(S) URL');
     return url.origin;
   }
   export const createSubscriptionCheckout = action({
     args: { priceId: v.string() },
     returns: v.object({ sessionId: v.string(), url: v.union(v.string(), v.null()) }),
     handler: async (ctx, args) => {
       const identity = await ctx.auth.getUserIdentity();
       if (!identity) throw new Error('Not authenticated');
       const customer = await stripeClient.getOrCreateCustomer(ctx, { userId: identity.subject, email: identity.email, name: identity.name });
       const siteUrl = checkoutBaseUrl();
       return await stripeClient.createCheckoutSession(ctx, { priceId: args.priceId, customerId: customer.customerId, mode: 'subscription', successUrl: `${siteUrl}/?success=true`, cancelUrl: `${siteUrl}/?canceled=true`, subscriptionMetadata: { userId: identity.subject } });
     },
   });
   export const isSubscribed = query({
     args: {},
     returns: v.boolean(),
     handler: async (ctx) => {
       const identity = await ctx.auth.getUserIdentity();
       if (!identity) return false;
       const subscriptions = await ctx.runQuery(components.stripe.public.listSubscriptionsByUserId, { userId: identity.subject });
       return subscriptions.some((sub) => sub.status === 'active' || sub.status === 'trialing');
     },
   });
   ```

6. Require SITE_URL as a Convex deployment environment variable. Identify and announce the exact target with convex-deploy-guard. For local/dev only, run `pnpm --filter @tonyisup/bbpc-convex-api exec convex dev --once`; stop if the resolved target is production or unclear. Staging and production use their approved deployment gates/runbooks, not this setup command. Verify output shows `✔ Installed component stripe.`
7. In Stripe Dashboard → Webhooks: add endpoint `https://<deployment>.convex.site/stripe/webhook`, subscribe to `checkout.session.completed`, `customer.subscription.*`, `invoice.*`, `payment_intent.*`. Copy the signing secret as `STRIPE_WEBHOOK_SECRET`.

## Rules

- Use @convex-dev/stripe (npm: @convex-dev/stripe@^0.1.4) — it handles webhook signature verification internally via registerRoutes; do NOT write a manual constructEvent webhook.
- Stripe keys live in Convex env (use the `env` micro power): STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.
- SITE_URL is required. It must be a valid HTTPS origin outside an explicitly configured local/test runtime; checkout fails closed when it is absent or invalid.
- Gate on server-stored subscription state via isSubscribed query (reads component tables), not client claims.
- convex/convex.config.ts must import from '@convex-dev/stripe/convex.config.js' (not .ts) — the .js extension is required by the Convex bundler.
