/**
 * <kit-builder> custom element for the Kit builder section (Horizon theme).
 * Data comes from JSON script tags rendered by sections/kit-builder.liquid.
 * Cart/pricing integration lives in kit-builder-cart.js. No dependencies. Prices are minor units (pence/cents), as in `product | json`.
 */
import { getAdapter, getCart, kitLinesIn, removeLines, checkAvailability, addLines, refreshCart } from './kit-builder-cart.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const uid = () =>
  window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : 'kit-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const stripHtml = (html) => {
  const d = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
};
const imgUrl = (img, w) => {
  const src = typeof img === 'string' ? img : img && img.src;
  if (!src) return '';
  return src + (src.includes('?') ? '&' : '?') + 'width=' + w;
};
const tpl = (str, vars) => str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

const DEFAULT_LABELS = {
  addToKit: 'Add to kit',
  update: 'Update selection',
  selected: 'Selected',
  remove: 'Remove',
  edit: 'Edit',
  next: 'Next',
  back: 'Back',
  skip: 'Skip this step',
  review: 'Review kit',
  addKit: 'Add kit to cart',
  yourKit: 'Your kit',
  itemsSelected: '{count} items selected',
  stepOf: 'Step {n} of {total}',
  chooseExactly: 'Choose {n}',
  chooseRange: 'Choose {min} to {max}',
  chooseUpTo: 'Choose up to {max} (optional)',
  selectedCount: '{count} selected',
  notChosen: 'Not chosen yet',
  skipped: 'Optional, skipped',
  original: 'Original value',
  kitPrice: 'Kit price',
  total: 'Total',
  youSave: 'You save',
  incompleteHint: 'Your kit price applies once the kit is complete.',
  selectOption: 'Select {option}',
  soldOut: 'Sold out',
  limitReached: 'Limit reached',
  from: 'From',
  details: 'Product details',
  viewKit: 'View kit',
  close: 'Close',
  noProducts: 'No products available in this category right now.',
  noCollection: 'No collection selected for this category.',
  adding: 'Adding…',
  added: 'Your kit has been added to the cart.',
  viewCart: 'View cart',
  genericError: 'Something went wrong adding your kit. Please try again.',
  missing: '{category}: choose {n} more',
  tooMany: '{category}: too many items selected',
  unavailable: '{product} is no longer available. Please change it.',
  kitMin: 'Your kit needs at least {n} items',
  kitMax: 'Your kit can have at most {n} items',
  announceAdded: '{product} added to your kit',
  announceRemoved: '{product} removed from your kit',
  announceLimit: 'You have reached the limit for this category',
  announceStep: '{category}, step {n} of {total}',
  complete: 'Your kit is complete',
  forCompleteKit: 'for the complete kit',
  fixedHint: 'One fixed price, whatever you choose.',
  retailValue: 'Combined retail value',
  previewNote: 'Kit checkout is not live yet.',
  testNote: 'Test mode: pricing not yet verified. Do not publish.',
  belowPrice: 'These items total less than the kit price, so this combination is unavailable. Please change a choice.',
  wrongCurrency: 'The kit is only available in {currency}.',
  alreadyKit: 'Your cart already contains a kit. Only one kit can be ordered at a time.',
  alreadyIn: 'Already in your kit ({category})',
  replaceKit: 'Replace my kit',
  nowUnavailable: '{items} just sold out. Please change your choice.',
  notConfigured: 'This kit is not available to order yet.',
  cartCheckFailed: 'We could not check your cart. Please try again.',
};

class KitBuilder extends HTMLElement {
  connectedCallback() {
    if (this.ready) return;
    const cfgEl = this.querySelector('[data-kit-config]');
    if (!cfgEl) return;
    this.ready = true;

    this.cfg = JSON.parse(cfgEl.textContent);
    const custom = Object.fromEntries(Object.entries(this.cfg.labels || {}).filter(([, v]) => v));
    this.L = { ...DEFAULT_LABELS, ...custom };
    this.fmt = new Intl.NumberFormat(this.cfg.locale || undefined, {
      style: 'currency',
      currency: this.cfg.currency || 'GBP',
    });

    this.cats = this.cfg.categories.map((c) => {
      const el = this.querySelector(`[data-kit-products="${CSS.escape(c.id)}"]`);
      const products = el ? JSON.parse(el.textContent) : [];
      products.forEach((p) => this.prepareProduct(p));
      const effMin = c.required ? Math.max(c.min, 1) : c.min;
      return { ...c, products, effMin, max: Math.max(c.max, effMin, 1) };
    });

    this.sel = []; // { uid, catId, productId, variantId }
    this.draft = {}; // productId -> option values
    this.visited = new Set([0]);
    this.step = 0;
    this.submitting = false;
    this.errors = [];
    this.success = false;
    this.storeKey = `kit-builder:${this.cfg.kitKey || this.cfg.sectionId}`;
    this.restore();

    this.$progress = this.querySelector('[data-kit-progress]');
    this.$stage = this.querySelector('[data-kit-stage]');
    this.$summaries = [...this.querySelectorAll('[data-kit-summary]')];
    this.$bar = this.querySelector('[data-kit-bar]');
    this.$dialog = this.querySelector('[data-kit-dialog]');
    this.$live = this.querySelector('[data-kit-live]');

    this.addEventListener('click', (e) => this.onClick(e));
    this.addEventListener('change', (e) => this.onChange(e));
    if (this.$dialog) {
      this.$dialog.addEventListener('click', (e) => {
        if (e.target === this.$dialog) this.$dialog.close();
      });
    }
    if (this.$stage) this.render();
  }

  /* ---------- data helpers ---------- */

  prepareProduct(p) {
    p.optionNames = Array.isArray(p.options)
      ? p.options.map((o) => (typeof o === 'string' ? o : o.name))
      : [];
    p.optionValues = p.optionNames.map((_, i) => {
      const vals = [];
      p.variants.forEach((v) => {
        const val = v['option' + (i + 1)];
        if (val != null && !vals.includes(val)) vals.push(val);
      });
      return vals;
    });
    p.singleVariant = p.variants.length === 1;
    p.anyAvailable = p.variants.some((v) => v.available);
  }

  product(id) {
    for (const c of this.cats) {
      const p = c.products.find((x) => x.id === id);
      if (p) return p;
    }
    return null;
  }

  variantById(p, id) {
    return p.variants.find((v) => v.id === id) || null;
  }

  draftFor(p) {
    if (!this.draft[p.id]) {
      const opts = p.optionNames.map((_, i) => (p.optionValues[i].length === 1 ? p.optionValues[i][0] : null));
      this.draft[p.id] = opts;
    }
    return this.draft[p.id];
  }

  findVariant(p, opts) {
    if (!opts.length || opts.some((o) => o == null)) return p.singleVariant ? p.variants[0] : null;
    return p.variants.find((v) => opts.every((o, i) => v['option' + (i + 1)] === o)) || null;
  }

  optionEnabled(p, idx, value, opts) {
    return p.variants.some(
      (v) =>
        v.available &&
        v['option' + (idx + 1)] === value &&
        opts.every((o, i) => i === idx || o == null || v['option' + (i + 1)] === o)
    );
  }

  productImage(p, variant) {
    return (variant && variant.featured_image) || p.featured_image || (p.images && p.images[0]) || null;
  }

  catSelections(catId) {
    return this.sel.filter((s) => s.catId === catId);
  }

  items() {
    return this.sel
      .map((s) => {
        const p = this.product(s.productId);
        const v = p && this.variantById(p, s.variantId);
        return p && v ? { ...s, product: p, variant: v } : null;
      })
      .filter(Boolean);
  }

  /* ---------- status / pricing ---------- */

  catState(i) {
    const c = this.cats[i];
    const n = this.catSelections(c.id).length;
    if (i === this.step) return 'current';
    if (c.effMin > 0) return n >= c.effMin ? 'done' : 'todo';
    return n > 0 || this.visited.has(i) ? 'done' : 'todo';
  }

  validate() {
    const errors = [];
    this.cats.forEach((c, i) => {
      const n = this.catSelections(c.id).length;
      if (n < c.effMin) errors.push({ step: i, msg: tpl(this.L.missing, { category: c.title, n: c.effMin - n }) });
      if (n > c.max) errors.push({ step: i, msg: tpl(this.L.tooMany, { category: c.title }) });
    });
    const items = this.items();
    const total = items.length;
    if (this.cfg.minTotal && total < this.cfg.minTotal)
      errors.push({ step: this.cats.length, msg: tpl(this.L.kitMin, { n: this.cfg.minTotal }) });
    if (this.cfg.maxTotal && total > this.cfg.maxTotal)
      errors.push({ step: this.cats.length, msg: tpl(this.L.kitMax, { n: this.cfg.maxTotal }) });
    if (!total && !errors.length) errors.push({ step: 0, msg: tpl(this.L.missing, { category: this.cats[0].title, n: 1 }) });
    if (this.cfg.mode === 'fixed' && total && !errors.length && getAdapter(this.cfg).guardsFloor) {
      const sum = items.reduce((a, it) => a + it.variant.price, 0);
      if (sum < this.cfg.fixedPrice) errors.push({ step: this.cats.length, msg: this.L.belowPrice });
    }
    items.forEach((it) => {
      if (!it.variant.available)
        errors.push({ step: this.cats.findIndex((c) => c.id === it.catId), msg: tpl(this.L.unavailable, { product: it.product.title }) });
    });
    return errors;
  }

  get complete() {
    return this.validate().length === 0;
  }

  pricing() {
    const items = this.items();
    const sum = items.reduce((a, it) => a + it.variant.price, 0);
    const c = this.cfg;
    const complete = this.complete;
    // Fixed price: the displayed kit price never depends on the selected items.
    if (c.mode === 'fixed') {
      const showValue = complete && sum > c.fixedPrice;
      return { fixed: true, sum, total: c.fixedPrice, saving: showValue ? sum - c.fixedPrice : 0, showValue, count: items.length };
    }
    let total = sum;
    if (complete && c.mode !== 'none' && sum >= (c.minSpend || 0)) {
      if (c.mode === 'percent' && c.percentOff > 0) total = Math.round(sum * (1 - c.percentOff / 100));
      if (c.mode === 'amount' && c.amountOff > 0) total = Math.max(0, sum - c.amountOff);
    }
    return { fixed: false, sum, total, saving: sum - total, showValue: sum !== total, count: items.length };
  }

  /* ---------- persistence ---------- */

  persist() {
    try {
      sessionStorage.setItem(this.storeKey, JSON.stringify(this.sel));
    } catch (e) {
      /* storage unavailable: selections stay in memory */
    }
  }

  restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(this.storeKey) || '[]');
      this.sel = saved.filter((s) => {
        const c = this.cats.find((x) => x.id === s.catId);
        const p = c && c.products.find((x) => x.id === s.productId);
        return p && p.variants.some((v) => v.id === s.variantId);
      });
    } catch (e) {
      this.sel = [];
    }
  }

  /* ---------- rendering ---------- */

  render() {
    this.renderProgress();
    this.renderStage();
    this.renderSummary();
  }

  renderProgress() {
    if (!this.$progress) return;
    const reviewState = this.step === this.cats.length ? 'current' : this.complete ? 'done' : 'todo';
    const steps = this.cats.map((c, i) => {
      const n = this.catSelections(c.id).length;
      const state = this.catState(i);
      const count = c.effMin > 0 ? `<span class="kb__step-count">${Math.min(n, c.max)}/${c.effMin}</span>` : '';
      return `<li><button type="button" class="kb__step" data-action="goto" data-step="${i}" data-state="${state}" ${
        i === this.step ? 'aria-current="step"' : ''
      }><span class="kb__step-num" aria-hidden="true">${state === 'done' ? '✓' : i + 1}</span>${esc(c.title)} ${count}${
        state === 'done' ? '<span class="kb__sr"> (complete)</span>' : ''
      }</button></li>`;
    });
    steps.push(
      `<li><button type="button" class="kb__step" data-action="goto" data-step="${this.cats.length}" data-state="${reviewState}" ${
        this.step === this.cats.length ? 'aria-current="step"' : ''
      }><span class="kb__step-num" aria-hidden="true">${reviewState === 'done' ? '✓' : this.cats.length + 1}</span>${esc(this.L.review)}</button></li>`
    );
    this.$progress.innerHTML = `<ol>${steps.join('')}</ol>`;
    const cur = this.$progress.querySelector('[aria-current="step"]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
  }

  ruleText(c) {
    if (!c.required && c.effMin === 0) return tpl(this.L.chooseUpTo, { max: c.max });
    if (c.effMin === c.max) return tpl(this.L.chooseExactly, { n: c.max });
    return tpl(this.L.chooseRange, { min: c.effMin, max: c.max });
  }

  renderStage() {
    const last = this.cats.length;
    if (this.step >= last) {
      this.$stage.innerHTML = this.reviewHtml();
      return;
    }
    const c = this.cats[this.step];
    const n = this.catSelections(c.id).length;
    let body;
    if (!c.hasCollection) body = `<p class="kb__empty">${esc(this.L.noCollection)}</p>`;
    else if (!c.products.length) body = `<p class="kb__empty">${esc(this.L.noProducts)}</p>`;
    else body = `<div class="kb__grid">${c.products.map((p) => this.cardHtml(c, p)).join('')}</div>`;

    const skip =
      !c.required && c.effMin === 0
        ? `<button type="button" class="kb__link" data-action="next">${esc(this.L.skip)}</button>`
        : '<span></span>';
    this.$stage.innerHTML = `
      ${this.priceBarHtml()}
      <div class="kb__cat-head">
        <p class="kb__eyebrow">${esc(tpl(this.L.stepOf, { n: this.step + 1, total: this.cats.length + 1 }))}</p>
        <h2 tabindex="-1" data-kit-heading>${esc(c.heading || c.title)}</h2>
        ${c.description ? `<p>${esc(c.description)}</p>` : ''}
        <p class="kb__rule">${esc(this.ruleText(c))} · ${esc(tpl(this.L.selectedCount, { count: n }))}</p>
      </div>
      ${body}
      <div class="kb__nav">
        ${
          this.step > 0
            ? `<button type="button" class="button button-secondary" data-action="prev">${esc(this.L.back)}</button>`
            : skip
        }
        <span style="display:flex;gap:16px;align-items:center">
          ${this.step > 0 ? skip : ''}
          <button type="button" class="button" data-action="next">${esc(
            this.step === last - 1 ? this.L.review : this.L.next
          )}</button>
        </span>
      </div>`;
  }

  priceHtml(p, variant) {
    if (!this.cfg.showItemPrices) return '';
    if (variant) {
      const was = variant.compare_at_price > variant.price ? `<s>${this.fmt.format(variant.compare_at_price / 100)}</s>` : '';
      return `<p class="kb__price">${was}${this.fmt.format(variant.price / 100)}</p>`;
    }
    const prices = p.variants.map((v) => v.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const label = min === max ? this.fmt.format(min / 100) : `${esc(this.L.from)} ${this.fmt.format(min / 100)}`;
    return `<p class="kb__price">${label}</p>`;
  }

  cardHtml(c, p, error) {
    const opts = this.draftFor(p);
    const variant = this.findVariant(p, opts);
    const chosen = this.catSelections(c.id).filter((s) => s.productId === p.id);
    const selectedHere = chosen.length > 0;
    const sameVariant = chosen.some((s) => variant && s.variantId === variant.id);
    const full = this.catSelections(c.id).length >= c.max;
    const soldOut = !p.anyAvailable;
    const img = this.productImage(p, variant);
    const showOpts = !p.singleVariant;

    const optionsHtml = showOpts
      ? p.optionNames
          .map((name, i) => {
            const group = `kb-${this.cfg.sectionId}-${p.id}-${i}`;
            const values = p.optionValues[i]
              .map((val) => {
                const enabled = this.optionEnabled(p, i, val, opts);
                const checked = opts[i] === val;
                return `<label class="kb__chip"><input type="radio" name="${esc(group)}" value="${esc(val)}" data-kit-opt data-product="${p.id}" data-index="${i}" ${
                  checked ? 'checked' : ''
                } ${enabled ? '' : 'disabled'}><span>${esc(val)}${enabled ? '' : `<span class="kb__sr"> (${esc(this.L.soldOut)})</span>`}</span></label>`;
              })
              .join('');
            return `<fieldset class="kb__opt"><legend>${esc(name)}</legend><div class="kb__opt-values">${values}</div></fieldset>`;
          })
          .join('')
      : '';

    const desc = this.cfg.showDetails ? stripHtml(p.description).slice(0, 420) : '';
    const details = desc
      ? `<details class="kb__details"><summary>${esc(this.L.details)}</summary><p>${esc(desc)}</p></details>`
      : '';

    let label = this.L.addToKit;
    let pressed = false;
    let disabled = false;
    if (soldOut) {
      label = this.L.soldOut;
      disabled = true;
    } else if (selectedHere && !c.allowDuplicates) {
      if (sameVariant) {
        label = this.L.selected;
        pressed = true;
      } else label = this.L.update;
    } else if (full && c.max > 1) {
      label = this.L.limitReached;
      disabled = true;
    }

    return `<article class="kb__card" data-product="${p.id}" data-selected="${selectedHere}" data-soldout="${soldOut}">
      <div class="kb__media">
        ${
          img
            ? `<img src="${esc(imgUrl(img, 600))}" srcset="${esc(imgUrl(img, 400))} 400w, ${esc(imgUrl(img, 600))} 600w, ${esc(
                imgUrl(img, 900)
              )} 900w" sizes="(min-width: 1000px) 22vw, 50vw" alt="${esc((img && img.alt) || p.title)}" loading="lazy" width="600" height="750">`
            : ''
        }
        <span class="kb__check" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 7.5l3 3 7-7" stroke="currentColor" stroke-width="1.8" fill="none"/></svg></span>
      </div>
      <div class="kb__body">
        <h3 class="kb__name">${esc(p.title)}</h3>
        ${this.priceHtml(p, variant)}
        ${optionsHtml}
        ${details}
        <p class="kb__error" role="alert" data-kit-card-error>${esc(error || '')}</p>
        <button type="button" class="button kb__pick" data-action="pick" data-product="${p.id}" aria-pressed="${pressed}" ${
          disabled ? 'disabled' : ''
        }>${esc(label)}${pressed ? '' : `<span class="kb__sr">: ${esc(p.title)}</span>`}</button>
      </div></article>`;
  }

  updateCard(productId, error) {
    const card = this.$stage.querySelector(`.kb__card[data-product="${productId}"]`);
    const cat = this.cats[this.step];
    const p = this.product(productId);
    if (!card || !cat || !p) return;
    const active = document.activeElement;
    const key =
      active && card.contains(active)
        ? { action: active.dataset.action, name: active.name, value: active.value }
        : null;
    const tmp = document.createElement('div');
    tmp.innerHTML = this.cardHtml(cat, p, error);
    card.replaceWith(tmp.firstElementChild);
    if (key) {
      const sel = key.action
        ? `.kb__card[data-product="${productId}"] [data-action="${key.action}"]`
        : `.kb__card[data-product="${productId}"] input[name="${CSS.escape(key.name)}"][value="${CSS.escape(key.value)}"]`;
      const next = this.$stage.querySelector(sel);
      if (next && !next.disabled) next.focus();
    }
  }

  refreshCategoryCards() {
    // Re-render only what depends on selection counts (card buttons and the rule line).
    const c = this.cats[this.step];
    if (!c) return;
    c.products.forEach((p) => this.updateCard(p.id));
    const rule = this.$stage.querySelector('.kb__rule');
    if (rule) rule.textContent = `${this.ruleText(c)} · ${tpl(this.L.selectedCount, { count: this.catSelections(c.id).length })}`;
  }

  priceBarHtml() {
    if (this.cfg.mode !== 'fixed') return '';
    return `<p class="kb__pricebar"><strong>${this.fmt.format(this.cfg.fixedPrice / 100)}</strong> ${esc(this.L.forCompleteKit)}</p>`;
  }

  reviewHtml() {
    const ok = this.complete;
    return `
      ${this.priceBarHtml()}
      <div class="kb__cat-head">
        <p class="kb__eyebrow">${esc(tpl(this.L.stepOf, { n: this.cats.length + 1, total: this.cats.length + 1 }))}</p>
        <h2 tabindex="-1" data-kit-heading>${esc(this.L.review)}</h2>
        <p>${esc(ok ? this.L.complete : '')}</p>
      </div>
      <div class="kb__review-grid"><div data-kit-review>${this.summaryInner(true)}</div></div>
      <div class="kb__nav">
        <button type="button" class="button button-secondary" data-action="prev">${esc(this.L.back)}</button>
        <span></span>
      </div>`;
  }

  summaryInner(forReview) {
    const items = this.items();
    const pr = this.pricing();
    const needed = this.cats.reduce((a, c) => a + c.effMin, 0);
    const groups = this.cats
      .map((c, i) => {
        const its = items.filter((it) => it.catId === c.id);
        const n = its.length;
        const meta = c.effMin > 0 ? `${Math.min(n, c.max)}/${c.effMin}` : n ? String(n) : '';
        const list = its.length
          ? `<ul class="kb__sum-items">${its
              .map((it) => {
                const img = this.productImage(it.product, it.variant);
                const vt = it.product.singleVariant ? '' : it.variant.title;
                return `<li class="kb__sum-item">
                  ${img ? `<img class="kb__sum-thumb" src="${esc(imgUrl(img, 120))}" alt="" width="48" height="60" loading="lazy">` : '<span class="kb__sum-thumb"></span>'}
                  <span class="kb__sum-name">${esc(it.product.title)}${vt ? `<span class="kb__sum-var">${esc(vt)}</span>` : ''}${
                  it.variant.available ? '' : `<span class="kb__sum-var" style="color:#b42318">${esc(this.L.soldOut)}</span>`
                }</span>
                  <span class="kb__sum-actions">
                    <button type="button" class="kb__link" data-action="edit" data-uid="${esc(it.uid)}">${esc(this.L.edit)}</button>
                    <button type="button" class="kb__link" data-action="remove" data-uid="${esc(it.uid)}" aria-label="${esc(this.L.remove + ': ' + it.product.title)}">${esc(this.L.remove)}</button>
                  </span></li>`;
              })
              .join('')}</ul>`
          : `<p class="kb__none">${esc(c.effMin > 0 ? this.L.notChosen : this.L.skipped)}</p>`;
        return `<li><h3><button type="button" class="kb__link" style="text-transform:inherit;letter-spacing:inherit;font-size:inherit;text-decoration:none" data-action="goto" data-step="${i}">${esc(c.title)}</button><span>${esc(meta)}</span></h3>${list}</li>`;
      })
      .join('');

    let totals;
    if (pr.fixed) {
      totals = `<div class="kb__total"><span>${esc(this.L.kitPrice)}</span><span>${this.fmt.format(pr.total / 100)}</span></div>`;
      if (pr.showValue && this.cfg.showOriginalValue)
        totals =
          `<div><span>${esc(this.L.retailValue)}</span><s>${this.fmt.format(pr.sum / 100)}</s></div>` +
          `<div class="kb__saving"><span>${esc(this.L.youSave)}</span><span>${this.fmt.format(pr.saving / 100)}</span></div>` +
          totals;
      if (!pr.showValue) totals += `<p class="kb__hint">${esc(this.L.fixedHint)}</p>`;
    } else if (this.cfg.mode === 'none' || !pr.saving) {
      totals = `<div class="kb__total"><span>${esc(this.L.total)}</span><span>${this.fmt.format(pr.total / 100)}</span></div>`;
      if (this.cfg.mode !== 'none' && !this.complete)
        totals += `<p class="kb__hint">${esc(this.L.incompleteHint)}${this.cfg.savingsMessage ? ' ' + esc(this.cfg.savingsMessage) : ''}</p>`;
    } else {
      totals = `${
        this.cfg.showOriginalValue ? `<div><span>${esc(this.L.original)}</span><s>${this.fmt.format(pr.sum / 100)}</s></div>` : ''
      }
        <div class="kb__saving"><span>${esc(this.L.youSave)}</span><span>${this.fmt.format(pr.saving / 100)}</span></div>
        <div class="kb__total"><span>${esc(this.L.kitPrice)}</span><span>${this.fmt.format(pr.total / 100)}</span></div>`;
    }
    const status = this.cfg.pricingStatus;
    const banner =
      status === 'preview'
        ? `<p class="kb__test" role="note">${esc(this.L.previewNote)}</p>`
        : status === 'testing'
        ? `<p class="kb__test" role="note">${esc(this.L.testNote)}</p>`
        : '';

    const errs = this.errors.length
      ? `<ul class="kb__errors" role="alert">${this.errors.map((e) => `<li>${esc(e.msg)}</li>`).join('')}</ul>${
          this.offerReplace
            ? `<button type="button" class="kb__link" data-action="replace-kit">${esc(this.L.replaceKit)}</button>`
            : ''
        }`
      : '<ul class="kb__errors" role="alert"></ul>';
    const ok = this.success
      ? `<p class="kb__success" role="status">${esc(this.L.added)} <a href="${esc(this.cfg.cartUrl)}">${esc(this.L.viewCart)}</a></p>`
      : '';

    return `<div class="kb__sum">
      <h2>${esc(this.L.yourKit)}</h2>
      ${pr.fixed ? `<p class="kb__kitprice"><strong>${this.fmt.format(pr.total / 100)}</strong> <span>${esc(this.L.forCompleteKit)}</span></p>` : ''}
      ${banner}
      <p class="kb__sum-count">${esc(tpl(this.L.itemsSelected, { count: items.length }))}${needed ? ` · ${items.length >= needed && this.complete ? esc(this.L.complete) : ''}` : ''}</p>
      ${forReview ? '' : ''}
      <ul class="kb__sum-groups">${groups}</ul>
      <div class="kb__totals">${totals}</div>
      ${errs}${ok}
      <button type="button" class="button kb__add" data-action="add-kit" ${
        this.submitting ? 'aria-busy="true" aria-disabled="true"' : ''
      } ${status === 'preview' ? 'disabled' : ''}>${esc(this.submitting ? this.L.adding : this.L.addKit)}</button>
    </div>`;
  }

  renderSummary() {
    const html = this.summaryInner(false);
    // On the review step the full summary is shown in the stage; the aside is redundant there only on mobile.
    this.$summaries.forEach((el) => (el.innerHTML = html));
    const review = this.$stage.querySelector('[data-kit-review]');
    if (review) review.innerHTML = html;
    if (this.$bar) {
      const pr = this.pricing();
      this.$bar.hidden = !pr.count;
      this.$bar.innerHTML = `<span class="kb__bar-info"><span>${esc(tpl(this.L.itemsSelected, { count: pr.count }))}</span><strong>${this.fmt.format(
        pr.total / 100
      )}</strong></span><button type="button" class="button" data-action="open-summary">${esc(this.L.viewKit)}</button>`;
    }
  }

  /* ---------- actions ---------- */

  announce(msg) {
    if (!this.$live) return;
    this.$live.textContent = '';
    setTimeout(() => (this.$live.textContent = msg), 30);
  }

  goTo(i, { focus = true, scroll = true } = {}) {
    const max = this.cats.length;
    this.step = Math.max(0, Math.min(i, max));
    this.visited.add(this.step);
    this.errors = [];
    this.render();
    if (this.$dialog && this.$dialog.open) this.$dialog.close();
    const heading = this.$stage.querySelector('[data-kit-heading]');
    if (scroll) {
      const target = this.$progress || this.$stage;
      target.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    }
    if (focus && heading) heading.focus({ preventScroll: true });
    const c = this.cats[this.step];
    this.announce(
      c ? tpl(this.L.announceStep, { category: c.title, n: this.step + 1, total: max + 1 }) : this.L.review
    );
  }

  onClick(e) {
    const start = e.target.closest('[data-kit-start]');
    if (start) {
      e.preventDefault();
      const target = this.querySelector('.kb__builder');
      target.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      const h = this.querySelector('[data-kit-heading]');
      if (h) h.focus({ preventScroll: true });
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn || !this.contains(btn)) return;
    const action = btn.dataset.action;
    switch (action) {
      case 'goto':
        this.goTo(Number(btn.dataset.step));
        break;
      case 'prev':
        this.goTo(this.step - 1);
        break;
      case 'next':
        this.goTo(this.step + 1);
        break;
      case 'pick':
        this.pick(Number(btn.dataset.product));
        break;
      case 'remove':
        this.removeItem(btn.dataset.uid);
        break;
      case 'edit':
        this.editItem(btn.dataset.uid);
        break;
      case 'open-summary':
        if (this.$dialog && this.$dialog.showModal) this.$dialog.showModal();
        break;
      case 'close-summary':
        if (this.$dialog) this.$dialog.close();
        break;
      case 'add-kit':
        this.addKit();
        break;
      case 'replace-kit':
        this.replaceKit();
        break;
    }
  }

  onChange(e) {
    const input = e.target.closest('[data-kit-opt]');
    if (!input) return;
    const p = this.product(Number(input.dataset.product));
    if (!p) return;
    const opts = this.draftFor(p);
    const changed = Number(input.dataset.index);
    opts[changed] = input.value;
    // Clear other option choices that are no longer purchasable with the new selection.
    p.optionNames.forEach((_, i) => {
      if (i !== changed && opts[i] != null && !this.optionEnabled(p, i, opts[i], opts)) opts[i] = null;
    });
    this.updateCard(p.id);
  }

  pick(productId) {
    const c = this.cats[this.step];
    const p = this.product(productId);
    if (!c || !p) return;
    const opts = this.draftFor(p);
    const v = this.findVariant(p, opts);
    if (!v) {
      const missing = p.optionNames.find((_, i) => opts[i] == null);
      this.updateCard(p.id, tpl(this.L.selectOption, { option: (missing || '').toLowerCase() }));
      this.announce(tpl(this.L.selectOption, { option: missing || '' }));
      return;
    }
    if (!v.available) {
      this.updateCard(p.id, this.L.soldOut);
      return;
    }
    const here = this.catSelections(c.id);
    if (this.cfg.uniqueAcrossCategories) {
      const other = this.sel.find((x) => x.productId === p.id && x.catId !== c.id);
      if (other) {
        const oc = this.cats.find((x) => x.id === other.catId);
        this.updateCard(p.id, tpl(this.L.alreadyIn, { category: oc ? oc.title : '' }));
        return;
      }
    }
    const same = here.find((s) => s.productId === p.id);
    if (same && !c.allowDuplicates) {
      if (same.variantId === v.id) {
        this.sel = this.sel.filter((s) => s !== same); // toggle off
        this.announce(tpl(this.L.announceRemoved, { product: p.title }));
      } else {
        same.variantId = v.id;
        this.announce(tpl(this.L.announceAdded, { product: p.title }));
      }
    } else {
      if (here.length >= c.max) {
        if (c.max === 1) this.sel = this.sel.filter((s) => s.catId !== c.id);
        else {
          this.announce(this.L.announceLimit);
          return;
        }
      }
      this.sel.push({ uid: uid(), catId: c.id, productId: p.id, variantId: v.id });
      this.announce(tpl(this.L.announceAdded, { product: p.title }));
    }
    this.afterSelectionChange();
  }

  removeItem(uidValue) {
    const it = this.sel.find((s) => s.uid === uidValue);
    if (!it) return;
    const p = this.product(it.productId);
    this.sel = this.sel.filter((s) => s !== it);
    if (p) this.announce(tpl(this.L.announceRemoved, { product: p.title }));
    this.afterSelectionChange();
  }

  editItem(uidValue) {
    const it = this.sel.find((s) => s.uid === uidValue);
    if (!it) return;
    const i = this.cats.findIndex((c) => c.id === it.catId);
    const p = this.product(it.productId);
    const v = p && this.variantById(p, it.variantId);
    if (!p || !v) return;
    if (this.cats[i].allowDuplicates) this.sel = this.sel.filter((s) => s !== it);
    this.draft[p.id] = p.optionNames.map((_, k) => v['option' + (k + 1)]);
    this.persist();
    this.goTo(i, { focus: false });
    const card = this.$stage.querySelector(`.kb__card[data-product="${p.id}"]`);
    if (card) {
      card.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
      const pick = card.querySelector('[data-action="pick"]');
      if (pick) pick.focus({ preventScroll: true });
    }
  }

  afterSelectionChange() {
    this.errors = [];
    this.success = false;
    this.persist();
    this.renderProgress();
    if (this.step < this.cats.length) this.refreshCategoryCards();
    else this.renderStage();
    this.renderSummary();
  }

  /* ---------- cart ---------- */

  async addKit() {
    if (this.submitting) return;
    const adapter = getAdapter(this.cfg);
    const errors = this.validate();
    if (errors.length) {
      this.errors = errors;
      this.renderSummary();
      this.announce(errors.map((e) => e.msg).join('. '));
      if (this.$dialog && this.$dialog.open) this.$dialog.close();
      this.goToErrorStep(errors[0].step, errors);
      return;
    }
    if (this.cfg.pricingStatus === 'preview') return;
    const fail = (msg, extra = {}) => {
      this.submitting = false;
      this.errors = [{ step: this.step, msg, ...extra }];
      this.renderSummary();
      this.announce(msg);
    };
    const notReady = adapter.ready(this.cfg);
    if (notReady) return fail(notReady);
    if (this.cfg.kitCurrency && this.cfg.currency !== this.cfg.kitCurrency)
      return fail(tpl(this.L.wrongCurrency, { currency: this.cfg.kitCurrency }));

    this.submitting = true;
    this.errors = [];
    this.renderSummary();
    try {
      if (this.cfg.oneKitPerOrder) {
        let cart;
        try {
          cart = await getCart(this.cfg);
        } catch (e) {
          return fail(this.L.cartCheckFailed);
        }
        if (kitLinesIn(cart).length) {
          this.offerReplace = true;
          return fail(this.L.alreadyKit);
        }
      }
      const picked = this.items().map((it) => ({
        variantId: it.variant.id,
        title: it.product.title,
        handle: it.product.handle,
        category: this.cats.find((c) => c.id === it.catId).title,
      }));
      const gone = await checkAvailability(this.cfg, picked);
      if (gone.length) {
        // Reflect live stock in the UI so the customer can pick something else.
        gone.forEach((t) => {
          const it = this.items().find((x) => x.product.title === t);
          if (it) it.variant.available = false;
        });
        this.render();
        return fail(tpl(this.L.nowUnavailable, { items: gone.join(', ') }));
      }
      const kitId = uid();
      const lines = adapter.build({ cfg: this.cfg, kitId, items: picked });
      await addLines(this.cfg, lines, kitId, this.L.genericError);
      this.sel = [];
      this.draft = {};
      this.success = true;
      this.offerReplace = false;
      this.persist();
      this.submitting = false;
      this.render();
      this.announce(this.L.added);
      await refreshCart(this.cfg);
    } catch (err) {
      fail(err && err.message ? err.message : this.L.genericError);
    }
  }

  async replaceKit() {
    if (this.submitting) return;
    try {
      const cart = await getCart(this.cfg);
      await removeLines(this.cfg, kitLinesIn(cart));
      this.offerReplace = false;
      this.errors = [];
      await this.addKit();
    } catch (e) {
      this.errors = [{ step: this.step, msg: this.L.cartCheckFailed }];
      this.renderSummary();
    }
  }

  goToErrorStep(step, errors) {
    if (step !== this.step) this.goTo(step);
    this.errors = errors;
    this.render();
  }
}

if (!customElements.get('kit-builder')) customElements.define('kit-builder', KitBuilder);
