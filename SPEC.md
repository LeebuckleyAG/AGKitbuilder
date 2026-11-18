# Kit builder: specification (v1, fixed £99 six-piece kit)

## Commercial rules (confirmed)

- Six products for a fixed **£99 GBP**: (1) jacket or gilet, (2) midlayer or approved polo, (3) additional polo, (4) trousers or shorts, (5) belt or hat, (6) socks.
- Price is £99 whichever eligible products are chosen. No price differences between choices in v1. Price is never calculated from item prices.
- £99 is shown prominently: hero, step header, live summary, mobile bar, review step.
- Combined retail value and "You save" show only when the kit is complete **and** the combined selling price exceeds £99. Never otherwise.
- Checkout must charge exactly £99 for the complete kit (delivery and tax separate).
- Each component keeps its own Shopify variant ID and inventory tracking (six separate cart lines).
- One kit per order.

## Builder behaviour (implemented)

| Rule | Implementation |
|---|---|
| Six steps, one product each | Six Category blocks, min 1 / max 1, all required. Step 2 collection = midlayers + approved polos; step 3 = polos |
| Fixed price display | Pricing mode "Fixed bundle price" = 99; shown in hero, step header, summary, bar, review |
| No fake savings | Retail value / saving only when complete and sum > £99 |
| Never under-charge/over-charge silently | A discount can only lower a price. If a chosen set totals less than £99 the builder refuses it ("combination unavailable") instead of letting checkout charge more than £99 |
| Same product in two steps | Blocked by default (setting "Same product can't fill two categories") |
| One kit per order | Add is refused if `/cart.js` already has a line with `_kit_key`. See "Gaps" for checkout-side enforcement |
| GBP only | Add refused if cart currency differs from "Kit currency" |
| Launch gate | "Checkout pricing status": **Preview** (add to cart disabled, default), **Testing** (enabled, amber test banner), **Live**. Only switch to Live after the verification below passes |
| Cart lines | One `/cart/add.js` request, 6 lines, qty 1, properties `Kit` (visible), `_kit_key`, `_kit_id`, `_kit_category` (hidden) |

## Pricing integration (investigated 18 Nov 2026)

**Store facts:** Shopify Basic plan. Discounts page is empty and the discount-type picker shows only native types plus Judge.me, so **no Function or bundle app is installed**. Custom apps containing Functions need Plus; public apps with Functions work on every plan.

**Options**

| Option | Verdict |
|---|---|
| Native automatic discounts | Can't express "one from each of six collections for a fixed total" |
| Shopify Bundles (free) | Fixed bundles and multipacks only; no mix-and-match |
| Custom Function (our own app) | Needs Plus. Contract kept below for an upgrade |
| **Third-party bundle app with a bring-your-own-UI contract** | **Only route that works on Basic today** |

**Apps that publicly support a custom UI (none installed, none verified by me in a store):**
- **Appstle Bundles:** documents a "build a box" fixed-price contract for custom themes: a priced box line plus component lines discounted 100% by an automatic discount, inventory kept on the components. Pricing and plan requirements not confirmed from the sources I read.
- **Flex Bundles:** custom mix-and-match on Shopify's Cart Transform API with your own front end; listing shows from $99/month.
- **Kitenzo Bundle Builder:** theme, Hydrogen and headless API.
- Bundly (from $29/month) is mix-and-match with fixed price, but uses its own widget rather than a custom UI.

**Recommendation:** evaluate **Appstle first** because its documented contract matches this build and keeps component variants and inventory real. Nothing is installed or purchased until you approve. Flex Bundles is the fallback.

### How the integration layer works (built)

`assets/kit-builder-cart.js` holds all cart and pricing logic; the UI never changes when pricing does. Section setting **Pricing integration** selects an adapter:

- `properties` (default): six component lines with `Kit`, `_kit_key`, `_kit_id`, `_kit_category`. For a checkout Function (Plus) or an app that reads them. Because a discount can only lower prices, the builder refuses sets totalling under £99.
- `appstle`: one box line (the £99 "Kit box product" variant) plus six child lines, using Appstle's documented properties (`_appstle-bb-id`, `_appstle_bundles_type`, `__appstle-bb-variants`, `_appstle-bb-child`, `_appstle_bundle_instance_id`). Price is exact whatever the items cost, so the under-£99 refusal is off. **Written from Appstle's docs, never run against the installed app.**

To add another app (e.g. Flex), add an adapter object in `kit-builder-cart.js` (`build`, `ready`, `guardsFloor`).

### Setup for the Appstle adapter (once approved)

1. Create a "6-Piece Kit" product at £99, one variant, not in any collection shown to customers.
2. In Appstle create a fixed-price build-a-box rule with the six collections (1 each) and inventory mode "add child product on checkout" so component lines exist.
3. In the section set Pricing integration = Appstle, Kit box product = that product, Bundle reference = the rule's `uniqueRef`.
4. Keep status on Preview, then Testing, and run the checklist below.

### Cart safety built in

- Stock is re-checked live (`/products/{handle}.js`) just before adding; the add request is atomic and any partial add is rolled back.
- One kit per order: add is refused when a `_kit_key` line is already in the cart, with a "Replace my kit" action.
- Items are added in one request, qty 1 each.

### Still not enforceable from the theme (needs the integration/app)

- Customer raising a kit line quantity or adding a second kit by another route: confirm the chosen app discounts only one kit and blocks extra quantity.
- Per-step limits (one jacket etc.) are enforced by the builder UI only; confirm the app rule enforces them too.

## Verification before "Live" (all must pass, on the draft theme, in real checkout)

1. Cheapest and dearest eligible combinations both total exactly £99.00 (item subtotal after discount).
2. Delivery and VAT shown separately and correctly; order total = £99 + delivery.
3. Kit plus unrelated cart items: only kit lines discounted.
4. Discount code entered: kit price unchanged or code rejected.
5. Quantity changed to 2 on a kit line / second kit added: blocked or second kit not discounted.
6. Remove one component: no partial discount.
7. Order in admin: six lines, correct variant IDs, properties present, discount shown, inventory decremented per variant.
8. Refund of one component behaves acceptably (agree policy).
9. Non-GBP market: kit blocked.
10. Out-of-stock variant: cannot be selected; whole-request add fails cleanly if stock changes.

## Decisions I made (change if wrong)

- "Normal selling price" = the variant's current selling price (`price`). Compare-at prices are ignored.
- Same product can't fill two steps.
- v1 supports the fixed-price mode only; percentage and amount modes were removed from the section settings.
- Kit key default `six-piece-kit`; don't change after launch.

## Open questions

1. Is Online Golf on Shopify Plus? Who will build and host the discount/validation Functions?
2. Min eligible price per step, to prove no set can total under £99.
3. Which collections feed step 2 ("approved polos") and step 3?
