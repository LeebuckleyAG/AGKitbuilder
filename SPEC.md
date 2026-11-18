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

## Investigation: how to get a real £99 at checkout

**What I found on the store (18 Nov 2026):** Discounts is empty. The discount-type picker offers only Shopify's native types plus Judge.me. **No discount Function is installed on this store.** I also have no evidence the earlier tiered-bundle Function supports fixed bundle prices, so I have not assumed it does.

| Option | Fixed £99 for mix-and-match? | Notes |
|---|---|---|
| Native automatic discounts (amount off products, buy X get Y, amount off order) | No | Fixed amounts or percentages only; can't target "one from each of six collections" and land on a fixed total |
| Shopify Bundles app | Unconfirmed | Built for defined bundles. I haven't verified it supports six independent slots with choice at a fixed total; check before ruling in or out |
| **Product Discount Function (recommended)** | **Yes, if components total at least £99** | Targets the six kit lines (qty 1 each) with a per-line fixed amount off so the six lines sum to exactly £99; rounding remainder on the last line. Keeps six real lines, variant IDs and inventory |
| Cart Transform (merge/expand to a £99 bundle parent) | Yes | Can price independently of components but is more complex; the `update` operation is Plus-only. Not needed for v1 |

**Plan constraint to confirm:** per Shopify's docs, custom apps containing Functions require Shopify Plus; other plans need a public App Store app. Confirm whether Online Golf is on Plus, and who will build/host the Function. This decides whether a custom app is possible.

### Recommended Function contract

Config comes from the Function (metafield), never from the browser.

1. Group cart lines by `_kit_id` where `_kit_key == "six-piece-kit"`.
2. Valid group = exactly six lines, qty 1, one per `_kit_category` required category. Otherwise apply nothing.
3. Only the **first** valid group is discounted (second kit stays full price, see one kit per order).
4. `discount = sum(line prices) - 9900`. If `<= 0`, apply nothing (and see below).
5. Spread `discount` across the six lines with per-line `fixedAmount` (not per item), remainder to the last line so the total is exact.
6. `combinesWith`: none, so discount codes and other automatic discounts cannot take the kit below £99.
7. Title shown at checkout: e.g. "6-piece kit price".

**Critical limitation:** a discount cannot raise a price. If an eligible set totals under £99, checkout charges more than £99. Controls: (a) the builder refuses sets under £99; (b) before launch, check that the cheapest possible choice in each step still sums to at least £99 (list min price per collection); (c) if that can't be guaranteed, use Cart Transform pricing instead.

### Gaps that need Functions (client code alone can't enforce them)

- **One kit per order:** the builder checks the cart on add, but a customer can raise a line quantity or add a second kit another way. Needs a Cart and Checkout Validation Function (availability/plan: confirm) or at minimum step 3 above so a second kit isn't discounted.
- **Removing one component** leaves five lines at full price (group invalid so no discount). Acceptable, but consider validation to block checkout with a broken kit.

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
