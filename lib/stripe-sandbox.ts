/** Server-only sandbox adapter. No live keys, browser secrets or automatic payouts. */
export const STRIPE_SANDBOX_API_VERSION = '2026-09-30.endive';
export const STRIPE_WEBHOOK_MAX_BYTES = 262_144;
const API_ORIGIN = 'https://api.stripe.com';
const MAX_CENTS = 99_999_999;
type StripeObject = Record<string, unknown>;
export type StripeSandboxEnv = {
  COMMERCE_SANDBOX_ENABLED?: unknown;
  COMMERCE_SANDBOX_REVIEWED?: unknown;
  COMMERCE_STRIPE_TEST_SECRET_KEY?: unknown;
  COMMERCE_STRIPE_TEST_WEBHOOK_SECRET?: unknown;
  COMMERCE_PUBLIC_ORIGIN?: unknown;
};
export type StripeBinding = {orderId: string; amountCents: number; paymentIntentId?: string};
export type StripeSellerBinding = {profileId: string; userId: string};
export type StripeCheckoutInput = {
  orderId: string; amountCents: number; title: string; successUrl: string; cancelUrl: string;
  buyerEmail?: string; itemAmountCents?: number; shippingCents?: number; taxCents?: number;
};
export class StripeSandboxError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryable = false) {
    super(message); this.name = 'StripeSandboxError';
  }
}
function fail(code: string, message: string, status = 400, retryable = false): never {
  throw new StripeSandboxError(code, message, status, retryable);
}
function isObject(value: unknown): value is StripeObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function configuredOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
      parsed.pathname === '/' && !parsed.search && !parsed.hash ? parsed.origin : null;
  } catch { return null; }
}
function testKey(value: unknown): value is string {
  return typeof value === 'string' && /^sk_test_[A-Za-z0-9]{16,}$/.test(value);
}
function webhookKey(value: unknown): value is string {
  return typeof value === 'string' && /^whsec_[A-Za-z0-9]{16,}$/.test(value);
}
export function sandboxConfiguration(env: StripeSandboxEnv, origin?: string) {
  const enabled = env.COMMERCE_SANDBOX_ENABLED === 'true';
  const secret = env.COMMERCE_STRIPE_TEST_SECRET_KEY;
  let reason = 'sandbox_ready';
  // An owner flag can never turn this adapter into a live-money integration.
  if (typeof secret === 'string' && /^(sk|rk)_live_/.test(secret)) reason = 'live_key_rejected';
  else if (!enabled) reason = 'sandbox_disabled';
  else if (!testKey(secret)) reason = 'test_secret_missing';
  else if (!webhookKey(env.COMMERCE_STRIPE_TEST_WEBHOOK_SECRET)) reason = 'webhook_secret_missing';
  else if (!configuredOrigin(origin ?? env.COMMERCE_PUBLIC_ORIGIN)) reason = 'public_origin_invalid';
  else if (env.COMMERCE_SANDBOX_REVIEWED !== 'true') reason = 'integration_review_required';
  const ready = reason === 'sandbox_ready';
  return {enabled, ready, checkoutEnabled: ready, reason, apiVersion: STRIPE_SANDBOX_API_VERSION};
}
export const sandboxSetup = sandboxConfiguration;
function localId(value: unknown, name = 'Order ID'): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    fail('invalid_identifier', `${name} is invalid.`);
}
function stripeId(value: unknown, prefix: string): asserts value is string {
  if (typeof value !== 'string' || !new RegExp('^' + prefix + '[A-Za-z0-9]+$').test(value) || value.length > 255)
    fail('invalid_identifier', 'Stripe object ID is invalid.');
}
function cents(value: unknown, minimum = 1): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > MAX_CENTS)
    fail('invalid_amount', 'Amount must be a bounded integer number of USD cents.');
}
function idempotencyKey(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{15,254}$/.test(value))
    fail('invalid_idempotency_key', 'A persisted random idempotency key is required.');
}
function returnUrl(value: unknown, origin: string): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value))
    fail('invalid_return_url', 'Return URL is invalid.');
  let url: URL;
  try { url = new URL(value); } catch { return fail('invalid_return_url', 'Return URL is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.origin !== origin)
    fail('invalid_return_url', 'Return URL must use the configured site origin.');
  // Preserve Stripe's literal {CHECKOUT_SESSION_ID} template after URL validation.
  return value;
}
function providerUrl(value: unknown, hostname: string): string {
  if (typeof value !== 'string' || value.length > 8192) fail('stripe_invalid_response', 'Stripe returned an invalid URL.', 502);
  let url: URL;
  try { url = new URL(value); } catch { return fail('stripe_invalid_response', 'Stripe returned an invalid URL.', 502); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname !== hostname || url.port)
    fail('stripe_invalid_response', 'Stripe returned an unexpected URL.', 502);
  return value;
}
function objectId(value: unknown): unknown { return isObject(value) ? value.id : value; }
function responseObject(value: unknown, kind: string, requireSandboxMode = true): StripeObject {
  if (!isObject(value) || value.object !== kind || (requireSandboxMode ? value.livemode !== false :
    value.livemode !== undefined && value.livemode !== false))
    fail('stripe_invalid_response', 'Stripe returned an unexpected or live-mode object.', 502);
  return value;
}
function verifyOrderMetadata(object: StripeObject, orderId: string, optional = false) {
  const metadata = isObject(object.metadata) ? object.metadata : {};
  if ((!optional && metadata.order_id !== orderId) ||
    (metadata.order_id !== undefined && metadata.order_id !== orderId) ||
    (metadata.orderId !== undefined && metadata.orderId !== orderId))
    fail('stripe_order_mismatch', 'Stripe object does not match this order.', 502);
}
function validateBinding(binding: StripeBinding) {
  if (!isObject(binding)) fail('invalid_binding', 'A server-recorded order binding is required.');
  localId(binding.orderId); cents(binding.amountCents, 50);
  if (binding.paymentIntentId !== undefined) stripeId(binding.paymentIntentId, 'pi_');
}
async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    await response.body?.cancel();
    fail('stripe_invalid_response', 'Stripe response exceeded its limit.', 502);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); fail('stripe_invalid_response', 'Stripe response exceeded its limit.', 502); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.byteLength; }
  return bytes;
}
type AdapterOptions = {fetch?: typeof fetch; now?: () => number; timeoutMs?: number; origin?: string};
export function stripeSandbox(env: StripeSandboxEnv, options: AdapterOptions = {}) {
  const config = sandboxConfiguration(env, options.origin);
  const origin = configuredOrigin(options.origin ?? env.COMMERCE_PUBLIC_ORIGIN);
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    fail('invalid_timeout', 'Stripe timeout is invalid.');
  function assertReady() {
    const current = sandboxConfiguration(env, options.origin);
    if (!current.ready || !testKey(env.COMMERCE_STRIPE_TEST_SECRET_KEY) || !origin ||
      configuredOrigin(options.origin ?? env.COMMERCE_PUBLIC_ORIGIN) !== origin)
      fail(current.ready ? 'sandbox_configuration_changed' : current.reason, 'Stripe sandbox is not ready. No payment was started.', 503);
  }
  async function request(method: 'GET' | 'POST', route: string, fields?: Record<string, string>, key?: string): Promise<StripeObject> {
    assertReady(); if (method === 'POST') idempotencyKey(key);
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const task = (async () => {
        const response = await fetcher(API_ORIGIN + '/v1/' + route, {
          method, redirect: 'error', signal: controller.signal,
          headers: {
            Authorization: 'Bearer ' + env.COMMERCE_STRIPE_TEST_SECRET_KEY,
            'Stripe-Version': STRIPE_SANDBOX_API_VERSION,
            ...(method === 'POST' ? {'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': key!} : {}),
          },
          ...(method === 'POST' ? {body: new URLSearchParams(fields)} : {}),
        });
        // Never expose Stripe's message/body, which can contain keys or customer data.
        if (!response.ok) {
          await response.body?.cancel();
          const transient = response.status === 429 || response.status >= 500;
          fail('stripe_provider_error', 'Stripe could not complete this sandbox request. Reconcile before retrying.',
            response.status === 409 ? 409 : transient ? 503 : 502, transient);
        }
        const bytes = await readBounded(response, 524_288);
        let parsed: unknown;
        try { parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
        catch { return fail('stripe_invalid_response', 'Stripe returned an invalid response.', 502); }
        if (!isObject(parsed)) fail('stripe_invalid_response', 'Stripe returned an invalid response.', 502);
        return parsed;
      })();
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(); reject(new StripeSandboxError('stripe_timeout', 'Stripe response was not confirmed. Reconcile before retrying.', 504, true));
        }, timeoutMs);
      });
      return await Promise.race([task, deadline]);
    } catch (error) {
      if (error instanceof StripeSandboxError) throw error;
      return fail('stripe_unavailable', 'Stripe response was not confirmed. Reconcile before retrying.', 503, true);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  function metadata(orderId: string, prefix = 'metadata') {
    return {[prefix + '[order_id]']: orderId, [prefix + '[orderId]']: orderId};
  }
  async function retrieveCheckout(sessionId: string, binding: StripeBinding, flags: {requirePaid?: boolean} = {}) {
    stripeId(sessionId, 'cs_test_'); validateBinding(binding);
    const session = responseObject(await request('GET', 'checkout/sessions/' + sessionId), 'checkout.session');
    if (session.id !== sessionId || session.mode !== 'payment' || session.currency !== 'usd' ||
      session.amount_total !== binding.amountCents || session.client_reference_id !== binding.orderId)
      fail('stripe_order_mismatch', 'Checkout does not match this order.', 502);
    verifyOrderMetadata(session, binding.orderId);
    if (session.url !== null && session.url !== undefined) providerUrl(session.url, 'checkout.stripe.com');
    if (binding.paymentIntentId !== undefined && objectId(session.payment_intent) !== binding.paymentIntentId)
      fail('stripe_order_mismatch', 'Checkout payment does not match this order.', 502);
    if (flags.requirePaid !== false) {
      if (session.status !== 'complete' || session.payment_status !== 'paid')
        fail('stripe_payment_unconfirmed', 'Payment has not been confirmed.', 409);
      stripeId(objectId(session.payment_intent), 'pi_');
    }
    return session;
  }
  async function retrievePaymentIntent(intentId: string, binding: StripeBinding, flags: {requireSucceeded?: boolean} = {}) {
    stripeId(intentId, 'pi_'); validateBinding(binding);
    const intent = responseObject(await request('GET', 'payment_intents/' + intentId), 'payment_intent');
    if (intent.id !== intentId || intent.currency !== 'usd' || intent.amount !== binding.amountCents ||
      intent.transfer_group !== 'ORDER_' + binding.orderId ||
      (binding.paymentIntentId !== undefined && binding.paymentIntentId !== intentId))
      fail('stripe_order_mismatch', 'Payment does not match this order.', 502);
    verifyOrderMetadata(intent, binding.orderId);
    // Destination charges would bypass the delivery/review release gate.
    if (intent.transfer_data != null || intent.application_fee_amount != null)
      fail('stripe_invalid_response', 'Payment has an unexpected automatic transfer.', 502);
    if (flags.requireSucceeded !== false) {
      if (intent.status !== 'succeeded' || intent.amount_received !== binding.amountCents)
        fail('stripe_payment_unconfirmed', 'Payment has not been confirmed.', 409);
      stripeId(objectId(intent.latest_charge), 'ch_');
    }
    return intent;
  }
  async function retrieveCharge(chargeId: string, binding: StripeBinding & {paymentIntentId: string}, flags: {requireUnrefunded?: boolean} = {}) {
    stripeId(chargeId, 'ch_'); stripeId(binding.paymentIntentId, 'pi_');
    const intent = await retrievePaymentIntent(binding.paymentIntentId, binding);
    if (objectId(intent.latest_charge) !== chargeId) fail('stripe_order_mismatch', 'Charge does not match this order.', 502);
    const charge = responseObject(await request('GET', 'charges/' + chargeId), 'charge');
    if (charge.id !== chargeId || objectId(charge.payment_intent) !== binding.paymentIntentId ||
      charge.currency !== 'usd' || charge.amount !== binding.amountCents || charge.amount_captured !== binding.amountCents ||
      charge.paid !== true || charge.captured !== true || charge.status !== 'succeeded')
      fail('stripe_order_mismatch', 'Charge does not match this paid order.', 502);
    verifyOrderMetadata(charge, binding.orderId, true); cents(charge.amount_refunded, 0);
    if (Number(charge.amount_refunded) > binding.amountCents ||
      (flags.requireUnrefunded === true && (charge.amount_refunded !== 0 || charge.refunded !== false || charge.disputed !== false)))
      fail('stripe_charge_unavailable', 'Charge requires refund or dispute review.', 409);
    return charge;
  }
  async function retrieveAccount(accountId: string, binding?: StripeSellerBinding) {
    stripeId(accountId, 'acct_');
    const account = responseObject(await request('GET', 'accounts/' + accountId), 'account', false);
    if (account.id !== accountId || account.country !== 'US') fail('stripe_account_mismatch', 'Seller account is unavailable.', 502);
    if (binding) {
      localId(binding.profileId, 'Profile ID'); localId(binding.userId, 'User ID');
      const m = isObject(account.metadata) ? account.metadata : {};
      if (m.profile_id !== binding.profileId || m.user_id !== binding.userId)
        fail('stripe_account_mismatch', 'Seller account does not match this profile.', 502);
    }
    return account;
  }
  async function retrieveRefund(refundId: string, binding: {orderId: string; paymentIntentId: string; amountCents: number}, flags: {requireSucceeded?: boolean} = {}) {
    stripeId(refundId, 're_'); localId(binding.orderId); stripeId(binding.paymentIntentId, 'pi_'); cents(binding.amountCents);
    const refund = responseObject(await request('GET', 'refunds/' + refundId), 'refund', false);
    if (refund.id !== refundId || objectId(refund.payment_intent) !== binding.paymentIntentId ||
      refund.amount !== binding.amountCents || refund.currency !== 'usd')
      fail('stripe_refund_mismatch', 'Refund does not match this request.', 502);
    verifyOrderMetadata(refund, binding.orderId);
    if (!['succeeded', 'pending', 'failed', 'canceled', 'requires_action'].includes(String(refund.status)))
      fail('stripe_invalid_response', 'Refund status is invalid.', 502);
    if (flags.requireSucceeded === true && refund.status !== 'succeeded')
      fail('stripe_refund_unconfirmed', 'Refund has not completed.', 409);
    return refund;
  }
  return {
    configuration: config, retrieveCheckout, retrievePaymentIntent, retrieveCharge, retrieveRefund, retrieveAccount,
    async createCheckout(input: StripeCheckoutInput, key: string) {
      assertReady(); localId(input.orderId); cents(input.amountCents, 50); idempotencyKey(key);
      if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 250 || /[\u0000-\u001f\u007f]/.test(input.title))
        fail('invalid_title', 'Order title is invalid.');
      const shipping = input.shippingCents ?? 0, tax = input.taxCents ?? 0;
      const item = input.itemAmountCents ?? input.amountCents - shipping - tax;
      cents(item); cents(shipping, 0); cents(tax, 0);
      if (item + shipping + tax !== input.amountCents) fail('invalid_amount', 'Order breakdown does not match the total.');
      const fields: Record<string, string> = {
        mode: 'payment', ui_mode: 'hosted_page',
        client_reference_id: input.orderId, success_url: returnUrl(input.successUrl, origin!), cancel_url: returnUrl(input.cancelUrl, origin!),
        // Fulfillment uses the route's immutable, buyer-confirmed US address.
        // Do not collect a second shipping address that could contradict it.
        'billing_address_collection': 'required',
        'payment_intent_data[transfer_group]': 'ORDER_' + input.orderId,
        ...metadata(input.orderId), ...metadata(input.orderId, 'payment_intent_data[metadata]'),
      };
      const lines = [{name: input.title, amount: item}, ...(shipping ? [{name: 'Shipping', amount: shipping}] : []),
        ...(tax ? [{name: 'Sales tax — server-calculated', amount: tax}] : [])];
      lines.forEach((line, index) => {
        fields[`line_items[${index}][price_data][currency]`] = 'usd';
        fields[`line_items[${index}][price_data][unit_amount]`] = String(line.amount);
        fields[`line_items[${index}][price_data][product_data][name]`] = line.name;
        fields[`line_items[${index}][quantity]`] = '1';
      });
      if (input.buyerEmail !== undefined) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.buyerEmail) || input.buyerEmail.length > 254)
          fail('invalid_email', 'Buyer email is invalid.');
        fields.customer_email = input.buyerEmail;
      }
      const session = responseObject(await request('POST', 'checkout/sessions', fields, key), 'checkout.session');
      stripeId(session.id, 'cs_test_'); providerUrl(session.url, 'checkout.stripe.com');
      if (session.currency !== 'usd' || session.amount_total !== input.amountCents || session.mode !== 'payment' ||
        session.status !== 'open' || session.payment_status !== 'unpaid' || session.client_reference_id !== input.orderId)
        fail('stripe_order_mismatch', 'Checkout does not match this order.', 502);
      verifyOrderMetadata(session, input.orderId); return session;
    },
    async createSellerAccount(input: StripeSellerBinding & {email: string}, key: string) {
      localId(input.profileId, 'Profile ID'); localId(input.userId, 'User ID'); idempotencyKey(key);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254)
        fail('invalid_email', 'Seller email is invalid.');
      const account = responseObject(await request('POST', 'accounts', {
        country: 'US', default_currency: 'usd', email: input.email,
        'controller[fees][payer]': 'application', 'controller[losses][payments]': 'application',
        'controller[stripe_dashboard][type]': 'express', 'capabilities[transfers][requested]': 'true',
        'settings[payouts][schedule][interval]': 'manual',
        'metadata[profile_id]': input.profileId, 'metadata[user_id]': input.userId,
      }, key), 'account', false);
      stripeId(account.id, 'acct_');
      if (account.country !== 'US' || !isObject(account.metadata) || account.metadata.profile_id !== input.profileId ||
        account.metadata.user_id !== input.userId) fail('stripe_account_mismatch', 'Seller account does not match this profile.', 502);
      return account;
    },
    async createAccountLink(accountId: string, urls: {refreshUrl: string; returnUrl: string}, key = crypto.randomUUID()) {
      assertReady(); stripeId(accountId, 'acct_');
      const link = responseObject(await request('POST', 'account_links', {
        account: accountId, type: 'account_onboarding', refresh_url: returnUrl(urls.refreshUrl, origin!), return_url: returnUrl(urls.returnUrl, origin!),
      }, key), 'account_link', false);
      providerUrl(link.url, 'connect.stripe.com');
      if (!Number.isSafeInteger(link.expires_at) || Number(link.expires_at) <= (options.now ?? Date.now)() / 1000)
        fail('stripe_invalid_response', 'Seller onboarding link has expired.', 502);
      return link;
    },
    async createRefund(input: {paymentIntentId: string; amountCents: number; orderId: string; orderAmountCents: number; remainingAmountCents: number}, key: string) {
      localId(input.orderId); stripeId(input.paymentIntentId, 'pi_'); cents(input.amountCents); cents(input.orderAmountCents, 50);
      cents(input.remainingAmountCents, 0); idempotencyKey(key);
      if (input.remainingAmountCents > input.orderAmountCents || input.amountCents > input.remainingAmountCents)
        fail('refund_exceeds_remaining', 'Refund exceeds the order’s remaining refundable amount.');
      const binding = {orderId: input.orderId, amountCents: input.orderAmountCents, paymentIntentId: input.paymentIntentId};
      const intent = await retrievePaymentIntent(input.paymentIntentId, binding);
      const charge = await retrieveCharge(String(objectId(intent.latest_charge)), binding);
      // A delayed dispute webhook must not let a local refund compensate the
      // buyer twice. Unknown current provider dispute status also needs review.
      if (charge.disputed !== false)
        fail('stripe_charge_disputed', 'Charge requires dispute review before refund.', 409);
      if (input.amountCents > input.orderAmountCents - Number(charge.amount_refunded))
        fail('refund_exceeds_remaining', 'Refund exceeds Stripe’s remaining refundable amount.', 409);
      const refund = responseObject(await request('POST', 'refunds', {
        payment_intent: input.paymentIntentId, amount: String(input.amountCents), reason: 'requested_by_customer', ...metadata(input.orderId),
      }, key), 'refund', false);
      stripeId(refund.id, 're_');
      if (objectId(refund.payment_intent) !== input.paymentIntentId || refund.amount !== input.amountCents || refund.currency !== 'usd')
        fail('stripe_refund_mismatch', 'Refund does not match this request.', 502);
      verifyOrderMetadata(refund, input.orderId);
      if (!['succeeded', 'pending', 'failed', 'canceled', 'requires_action'].includes(String(refund.status)))
        fail('stripe_invalid_response', 'Refund status is invalid.', 502);
      return refund;
    },
    async createTransfer(input: {amountCents: number; destination: string; sourceTransaction: string; orderId: string; paymentIntentId: string; orderAmountCents: number}, key: string) {
      localId(input.orderId); stripeId(input.destination, 'acct_'); stripeId(input.sourceTransaction, 'ch_');
      stripeId(input.paymentIntentId, 'pi_'); cents(input.amountCents); cents(input.orderAmountCents, 50); idempotencyKey(key);
      if (input.amountCents > input.orderAmountCents) fail('transfer_exceeds_order', 'Seller transfer exceeds the paid order.');
      await retrieveCharge(input.sourceTransaction, {orderId: input.orderId, paymentIntentId: input.paymentIntentId, amountCents: input.orderAmountCents}, {requireUnrefunded: true});
      const account = await retrieveAccount(input.destination);
      if (account.details_submitted !== true || account.payouts_enabled !== true || !isObject(account.capabilities) || account.capabilities.transfers !== 'active')
        fail('stripe_account_unavailable', 'Seller onboarding is not complete.', 409);
      const transfer = responseObject(await request('POST', 'transfers', {
        amount: String(input.amountCents), currency: 'usd', destination: input.destination, source_transaction: input.sourceTransaction,
        transfer_group: 'ORDER_' + input.orderId, ...metadata(input.orderId),
      }, key), 'transfer');
      stripeId(transfer.id, 'tr_');
      if (transfer.amount !== input.amountCents || transfer.currency !== 'usd' || objectId(transfer.destination) !== input.destination ||
        objectId(transfer.source_transaction) !== input.sourceTransaction || transfer.transfer_group !== 'ORDER_' + input.orderId || transfer.reversed !== false)
        fail('stripe_transfer_mismatch', 'Transfer does not match this release.', 502);
      verifyOrderMetadata(transfer, input.orderId); return transfer;
    },
  };
}
export type StripeVerifiedEvent = StripeObject & {id: string; type: string; livemode: false; data: {object: StripeObject}};
/** Signature authentication only. Caller must persist event-ID dedupe and re-retrieve bound payment state. */
export async function verifyStripeWebhook(rawBody: Uint8Array | string, signature: string, env: StripeSandboxEnv,
  options: {now?: () => number; toleranceSeconds?: number} = {}): Promise<StripeVerifiedEvent> {
  if (env.COMMERCE_SANDBOX_ENABLED !== 'true' || !testKey(env.COMMERCE_STRIPE_TEST_SECRET_KEY) ||
    !webhookKey(env.COMMERCE_STRIPE_TEST_WEBHOOK_SECRET))
    fail('webhook_not_configured', 'Stripe sandbox webhook is not configured.', 503);
  if (!(typeof rawBody === 'string' || rawBody instanceof Uint8Array)) fail('invalid_webhook', 'Webhook body is invalid.');
  if (typeof rawBody === 'string' && rawBody.length > STRIPE_WEBHOOK_MAX_BYTES) fail('invalid_webhook', 'Webhook body is too large.', 413);
  const bytes = typeof rawBody === 'string' ? new TextEncoder().encode(rawBody) : rawBody;
  if (bytes.byteLength === 0 || bytes.byteLength > STRIPE_WEBHOOK_MAX_BYTES) fail('invalid_webhook', 'Webhook body size is invalid.', 413);
  if (typeof signature !== 'string' || signature.length > 4096) fail('invalid_webhook_signature', 'Webhook signature is invalid.');
  const timestamps: string[] = [], signatures: string[] = [];
  for (const part of signature.split(',')) {
    const match = /^([^=]+)=(.+)$/.exec(part.trim()); if (!match) continue;
    if (match[1] === 't') timestamps.push(match[2]);
    if (match[1] === 'v1' && /^[a-fA-F0-9]{64}$/.test(match[2])) signatures.push(match[2].toLowerCase());
  }
  if (timestamps.length !== 1 || !/^\d{10,12}$/.test(timestamps[0]) || !signatures.length || signatures.length > 16)
    fail('invalid_webhook_signature', 'Webhook signature is invalid.');
  const tolerance = options.toleranceSeconds ?? 300, now = (options.now ?? Date.now)();
  if (!Number.isInteger(tolerance) || tolerance < 1 || tolerance > 300 || !Number.isFinite(now))
    fail('invalid_webhook_configuration', 'Webhook verification configuration is invalid.', 500);
  const stamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(stamp) || Math.abs(now / 1000 - stamp) > tolerance)
    fail('expired_webhook_signature', 'Webhook signature is outside the accepted time window.');
  const prefix = new TextEncoder().encode(timestamps[0] + '.'), signed = new Uint8Array(prefix.length + bytes.length);
  signed.set(prefix); signed.set(bytes, prefix.length);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.COMMERCE_STRIPE_TEST_WEBHOOK_SECRET),
    {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed));
  let matched = 0;
  for (const candidate of signatures) {
    let difference = 0;
    for (let i = 0; i < digest.length; i++) difference |= digest[i] ^ parseInt(candidate.slice(i * 2, i * 2 + 2), 16);
    matched |= Number(difference === 0);
  }
  if (!matched) fail('invalid_webhook_signature', 'Webhook signature is invalid.');
  // Parsing occurs only after authentication of the original bytes.
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { return fail('invalid_webhook', 'Signed webhook body is invalid.'); }
  if (!isObject(parsed) || parsed.object !== 'event' || typeof parsed.id !== 'string' || !/^evt_[A-Za-z0-9]+$/.test(parsed.id) ||
    parsed.id.length > 255 || typeof parsed.type !== 'string' || !/^[a-z0-9_.]{1,128}$/.test(parsed.type) ||
    parsed.livemode !== false || !isObject(parsed.data) || !isObject(parsed.data.object) ||
    (parsed.data.object.livemode !== undefined && parsed.data.object.livemode !== false))
    fail('invalid_webhook', 'Signed webhook event is invalid or live-mode.');
  return parsed as StripeVerifiedEvent;
}
