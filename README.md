# Kit builder for Horizon (4.5.0)

A guided bundle builder: category-by-category product selection, variant pickers, live summary, and one-click "Add kit to cart".

## Files (all new; no existing theme files are modified)

| File | Goes in theme folder |
|---|---|
| `sections/kit-builder.liquid` | `sections/` (markup, scoped CSS, schema) |
| `assets/kit-builder.js` | `assets/` (the `<kit-builder>` custom element, no dependencies) |
| `templates/page.kit-builder.json` | `templates/` (optional page template preloaded with 5 example categories) |

## Add it to a page

1. Copy the three files into the theme (Online Store > Themes > Edit code, or the CLI/GitHub integration).
2. Content > Pages: create a page and set its template to `page.kit-builder`. Or in the theme editor add the **Kit builder** section to any page template.
3. In the editor, open each **Category** block and pick a **Collection**. Set Minimum/Maximum selections and Required.

Category blocks (title, heading, description, collection, min, max, required, duplicates, image) are ordered by dragging in the editor. Kit-level rules, layout, labels and pricing display are in the section settings.

## Selection rules

- Required category: needs at least `max(min, 1)` items. Optional category: can be skipped ("Skip this step").
- Max 1: picking another product swaps the choice. Max > 1: the category locks at the limit.
- Same product twice only if "Allow the same product more than once" is on.
- Variants: only purchasable option combinations are enabled; the picker maps to the real Shopify variant ID. Single-variant products add directly.
- Selections are kept while navigating and in `sessionStorage` for the tab session.

## Pricing and discounts

The section never changes what the customer pays. It only **displays** the kit price for the mode you choose (none / fixed / percent / amount, plus minimum spend). The checkout price comes from a Shopify discount, so the two must match.

Every kit line is added with these line item properties:

- `Kit`: visible kit name (cart/checkout/order)
- `_kit_key`: the "Kit key" setting (hidden). Use it to tell the Function which kit this is
- `_kit_id`: unique per add-to-cart (hidden). Groups the lines of one kit instance
- `_kit_category`: hidden, the category title

Recommended implementation (agreed): reuse the existing tiered bundle discount Shopify Function. It should:

1. Find cart lines with `_kit_key == <this kit>`, grouped by `_kit_id`.
2. Only discount a group when every required category is present (match `_kit_category`).
3. Take the discount **from its own configuration** (fixed price / % / amount). Never trust a price sent from the browser.
4. Spread a fixed bundle price across the lines proportionally.

Keep the section's pricing settings equal to the Function's configuration. Messages like "You save" appear only when the kit is complete, matching when the Function applies. Until the Function exists, leave **Bundle pricing mode** on "Individual product pricing" so nothing fake is shown.

Alternative without a Function: an automatic Shopify discount (percentage/fixed amount on a collection or buy X get Y). It can't produce a fixed bundle price.

## Cart behaviour

`POST {routes.cart_add_url}.js` with all lines in one request (locale/market aware). Shopify rejects the whole request if any line fails, so the cart is never left half-added; the error message is shown and the kit kept. Double submit is blocked. After success the cart drawer section and cart bubble are re-fetched through the Section Rendering API and the Horizon drawer is opened; if the drawer isn't found it goes to `/cart`. Set "After adding kit" to "Go to cart page" to always redirect.

## Testing

Local jsdom suite (21 checks) covers selection, swap, limits, skip, variant availability, pricing modes, validation, payload and properties, double-submit, API errors, remove/edit, persistence and HTML escaping. Theme Check reports no schema offences. Not yet exercised in a live Horizon preview: the cart-drawer refresh, visual styling against your colour schemes, and the Function pairing. Check those first on the draft theme.

## Limitations

- Product data is read from the collection (up to "Max products per category", 50 max) via `product | json`.
- Labels are section settings (use Translate & Adapt for other languages); other strings are English defaults in `assets/kit-builder.js` (`DEFAULT_LABELS`).
- Prices assume two-decimal currencies.
- Category blocks are data-only, so the editor selects the whole section, not individual cards.
