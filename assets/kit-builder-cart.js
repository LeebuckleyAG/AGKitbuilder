/**
 * Kit builder: cart integration layer.
 *
 * Everything that touches the cart or depends on how the £99 price is enforced lives here, so the UI
 * (kit-builder.js) never needs to change when the pricing integration does.
 *
 * An adapter turns the customer's validated selection into cart lines:
 *   build(ctx) -> [{ id, quantity, properties }]
 *   guardsFloor: true when checkout pricing is a discount (it can only lower prices), so the builder must
 *                refuse sets whose components total less than the kit price.
 *   ready(cfg):  returns an error string when the adapter is not configured, else ''.
 *
 * ctx = { cfg, kitId, items: [{ variantId, title, handle, category }] }
 */

const base = (cfg, kitId) => ({ _kit_key: cfg.kitKey, _kit_id: kitId });

export const adapters = {
  /**
   * Six component lines tagged with hidden properties. A checkout Function (custom app on Plus, or an
   * app that reads these properties) discounts the group to the fixed kit price.
   */
  properties: {
    guardsFloor: true,
    ready: () => '',
    build({ cfg, kitId, items }) {
      return items.map((it) => ({
        id: it.variantId,
        quantity: 1,
        properties: { Kit: cfg.kitName, ...base(cfg, kitId), _kit_category: it.category },
      }));
    },
  },

  /**
   * Appstle "Build a box" (fixed price) bring-your-own-UI contract, per Appstle's developer docs:
   * one £99 box line plus one child line per component, which the app discounts 100%. Inventory stays on
   * the component variants. NOT yet verified against an installed app (see SPEC.md).
   */
  appstle: {
    guardsFloor: false,
    ready: (cfg) =>
      cfg.boxVariantId && cfg.bundleRef ? '' : 'Pricing integration is not configured (box product and bundle reference).',
    build({ cfg, kitId, items }) {
      const common = {
        '_appstle-bb-id': cfg.bundleRef,
        _appstle_bundles_type: 'SINGLE_PRODUCT_BUILD_A_BOX',
        _appstle_bundle_instance_id: kitId,
        '__appstle-bb-name': cfg.kitName,
        ...base(cfg, kitId),
      };
      const box = {
        id: cfg.boxVariantId,
        quantity: 1,
        properties: {
          ...common,
          '__appstle-bb-variants': items.map((i) => `${i.variantId}:1`).join(','),
          products: items.map((i) => `1x ${i.title}`).join(', '),
        },
      };
      const children = items.map((it) => ({
        id: it.variantId,
        quantity: 1,
        properties: { ...common, '_appstle-bb-child': 'true', _kit_category: it.category },
      }));
      return [box, ...children];
    },
  },
};

export const getAdapter = (cfg) => adapters[cfg.integration] || adapters.properties;

const rootOf = (cfg) => (cfg.rootUrl.endsWith('/') ? cfg.rootUrl : cfg.rootUrl + '/');

export async function getCart(cfg) {
  const res = await fetch(`${rootOf(cfg)}cart.js`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('cart');
  return res.json();
}

export const kitLinesIn = (cart) => (cart.items || []).filter((i) => i.properties && i.properties._kit_key);

export async function removeLines(cfg, lines) {
  if (!lines.length) return;
  const updates = {};
  lines.forEach((l) => (updates[l.key] = 0));
  await fetch(`${rootOf(cfg)}cart/update.js`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ updates }),
  });
}

/** Re-check live availability of each chosen variant. Returns titles that are no longer purchasable. */
export async function checkAvailability(cfg, items) {
  const handles = [...new Set(items.map((i) => i.handle))];
  const live = {};
  await Promise.all(
    handles.map(async (h) => {
      try {
        const res = await fetch(`${rootOf(cfg)}products/${h}.js`, { headers: { Accept: 'application/json' } });
        if (res.ok) live[h] = await res.json();
      } catch (e) {
        /* unknown: don't block, add.js still rejects unavailable stock atomically */
      }
    })
  );
  return items
    .filter((i) => {
      const p = live[i.handle];
      const v = p && p.variants.find((x) => x.id === i.variantId);
      return p && (!v || !v.available);
    })
    .map((i) => i.title);
}

/** Add all lines in one request. If Shopify adds only some (partial stock), remove them and throw. */
export async function addLines(cfg, lines, kitId, genericError) {
  const res = await fetch(`${cfg.cartAddUrl}.js`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ items: lines }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    try {
      const cart = await getCart(cfg);
      await removeLines(cfg, kitLinesIn(cart).filter((l) => l.properties._kit_id === kitId));
    } catch (e) {
      /* best effort */
    }
    throw new Error(data.description || data.message || genericError);
  }
  return data;
}

/** Refresh Horizon's cart drawer and bubble, then open the drawer. Falls back to the cart page. */
export async function refreshCart(cfg) {
  const goCart = () => window.location.assign(cfg.cartUrl);
  if (cfg.afterAdd === 'cart') return goCart();
  try {
    const drawer = document.querySelector('cart-drawer-component');
    if (!drawer) return goCart();
    const sectionOf = (el) => {
      const wrap = el && el.closest('.shopify-section');
      return wrap ? wrap.id.replace(/^shopify-section-/, '') : null;
    };
    const ids = [...new Set([sectionOf(drawer), sectionOf(document.querySelector('.cart-bubble'))].filter(Boolean))];
    if (ids.length) {
      const res = await fetch(`${rootOf(cfg)}?sections=${encodeURIComponent(ids.join(','))}`);
      if (res.ok) {
        const sections = await res.json();
        Object.values(sections).forEach((html) => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          ['cart-items-component', '.cart-bubble'].forEach((sel) => {
            const fresh = doc.querySelector(sel);
            const current = document.querySelector(sel);
            if (fresh && current) current.replaceWith(fresh);
          });
        });
      }
    }
    document.dispatchEvent(new CustomEvent('cart:update', { bubbles: true, detail: { source: 'kit-builder' } }));
    if (typeof drawer.open === 'function') drawer.open();
    else goCart();
  } catch (e) {
    goCart();
  }
}
