// Run: node checks/stripe-sandbox.mjs
// Executes the actual sandbox adapter with synthetic HTTP responses and real WebCrypto.
// No network, Stripe account, card payment, refund, transfer or bank payout is performed.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto, createHmac} from 'node:crypto';
import ts from 'typescript';

const compiled = ts.transpileModule(await readFile('lib/stripe-sandbox.ts', 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}, reportDiagnostics: true,
});
assert.equal((compiled.diagnostics ?? []).filter(row => row.category === ts.DiagnosticCategory.Error).length, 0);
const module = {exports: {}}, context = vm.createContext({module, exports: module.exports, crypto: webcrypto,
  URL, URLSearchParams, Response, Request, Headers, AbortController, TextEncoder, TextDecoder,
  Uint8Array, ArrayBuffer, Error, Date, setTimeout, clearTimeout, fetch: async () => {throw new Error('Real network forbidden.');}});
new vm.Script(compiled.outputText, {filename: 'lib/stripe-sandbox.ts'}).runInContext(context);
const {sandboxConfiguration, sandboxSetup, stripeSandbox, verifyStripeWebhook, STRIPE_SANDBOX_API_VERSION,
  STRIPE_WEBHOOK_MAX_BYTES} = module.exports;
const fixedNow = Date.parse('2026-10-09T14:00:00.000Z'), stamp = fixedNow / 1000;
const env = {COMMERCE_SANDBOX_ENABLED: 'true', COMMERCE_SANDBOX_REVIEWED: 'true',
  COMMERCE_STRIPE_TEST_SECRET_KEY: 'sk_test_SYNTHETICADAPTERFIXTURE0001',
  COMMERCE_STRIPE_TEST_WEBHOOK_SECRET: 'whsec_SYNTHETICWEBHOOKFIXTURE0001',
  COMMERCE_PUBLIC_ORIGIN: 'https://comichuddle.example.invalid'};
const ids = {order: 'order-synthetic-0001', session: 'cs_test_Session0001', intent: 'pi_Payment0001',
  charge: 'ch_Charge0001', account: 'acct_Seller0001', refund: 're_Refund0001', transfer: 'tr_Transfer0001'};
const randomKey = '1ac4ab6d-3b8b-4dbf-a8cd-000000000001', amount = 10_000;
const metadata = {order_id: ids.order, orderId: ids.order};
const binding = {orderId: ids.order, amountCents: amount, paymentIntentId: ids.intent};
const checkoutInput = {orderId: ids.order, amountCents: amount, title: 'Synthetic comic collection',
  successUrl: env.COMMERCE_PUBLIC_ORIGIN + '/orders?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: env.COMMERCE_PUBLIC_ORIGIN + '/marketplace', buyerEmail: 'buyer@example.invalid'};
const checkout = {id: ids.session, object: 'checkout.session', livemode: false, currency: 'usd', amount_total: amount,
  client_reference_id: ids.order, metadata, mode: 'payment', status: 'open', payment_status: 'unpaid',
  payment_intent: null, url: 'https://checkout.stripe.com/c/pay/' + ids.session};
const paidCheckout = {...checkout, status: 'complete', payment_status: 'paid', payment_intent: ids.intent, url: null};
const intent = {id: ids.intent, object: 'payment_intent', livemode: false, currency: 'usd', amount,
  amount_received: amount, metadata, transfer_group: 'ORDER_' + ids.order, status: 'succeeded',
  latest_charge: ids.charge, transfer_data: null, application_fee_amount: null};
const charge = {id: ids.charge, object: 'charge', livemode: false, amount, amount_captured: amount,
  amount_refunded: 0, paid: true, captured: true, currency: 'usd', status: 'succeeded', payment_intent: ids.intent,
  disputed: false, refunded: false, metadata};
const account = {id: ids.account, object: 'account', country: 'US', metadata: {profile_id: 'seller-profile', user_id: 'seller-user'},
  details_submitted: true, payouts_enabled: true, capabilities: {transfers: 'active'}};
const refund = {id: ids.refund, object: 'refund', amount: 2_000, currency: 'usd', payment_intent: ids.intent, metadata, status: 'succeeded'};
const transfer = {id: ids.transfer, object: 'transfer', livemode: false, amount: 8_000, currency: 'usd',
  destination: ids.account, source_transaction: ids.charge, transfer_group: 'ORDER_' + ids.order, metadata, reversed: false};
const clone = value => structuredClone(value), plain = value => JSON.parse(JSON.stringify(value));
let passed = 0; const failures = [];
async function test(name, run) {
  try {await run(); passed++; console.log('PASS: ' + name);}
  catch (error) {failures.push({name, error: error.message}); console.error('FAIL: ' + name + ' — ' + error.message);}
}
function mock({override, config = env, timeoutMs = 100, idempotency = false} = {}) {
  const requests = [], cache = new Map(); let simulatedCreates = 0;
  const fetcher = async (url, options) => {
    const route = new URL(url).pathname, fields = Object.fromEntries(new URLSearchParams(options.body ?? ''));
    requests.push({url, route, options, fields});
    const custom = await override?.({url, route, options, fields, requests}); if (custom !== undefined) return custom;
    if (idempotency && options.method === 'POST') {
      const key = route + ':' + options.headers['Idempotency-Key'], params = JSON.stringify(fields);
      if (cache.has(key)) {
        if (cache.get(key).params !== params) return Response.json({error: {message: 'Sensitive upstream conflict'}}, {status: 409});
        return Response.json(cache.get(key).object);
      }
      const object = {...checkout, amount_total: Number(fields['line_items[0][price_data][unit_amount]'])};
      cache.set(key, {params, object}); simulatedCreates++; return Response.json(object);
    }
    if (route === '/v1/checkout/sessions') return Response.json(checkout);
    if (route === '/v1/checkout/sessions/' + ids.session) return Response.json(paidCheckout);
    if (route === '/v1/payment_intents/' + ids.intent) return Response.json(intent);
    if (route === '/v1/charges/' + ids.charge) return Response.json(charge);
    if (route === '/v1/accounts' || route === '/v1/accounts/' + ids.account) return Response.json(account);
    if (route === '/v1/account_links') return Response.json({object: 'account_link', expires_at: stamp + 300, url: 'https://connect.stripe.com/setup/c/' + ids.account + '/synthetic'});
    if (route === '/v1/refunds' || route === '/v1/refunds/' + ids.refund) return Response.json(refund);
    if (route === '/v1/transfers') return Response.json(transfer);
    throw new Error('Unexpected synthetic request');
  };
  return {client: stripeSandbox(config, {fetch: fetcher, now: () => fixedNow, timeoutMs}), requests, cache,
    get simulatedCreates() {return simulatedCreates;}};
}
async function rejectsCode(run, code) {await assert.rejects(run, error => error.code === code);}
const bodyEvent = (changes = {}) => JSON.stringify({id: 'evt_Synthetic0001', object: 'event', type: 'checkout.session.completed',
  livemode: false, data: {object: paidCheckout}, ...changes});
function signature(body, timestamp = stamp, secret = env.COMMERCE_STRIPE_TEST_WEBHOOK_SECRET) {
  return 't=' + timestamp + ',v1=' + createHmac('sha256', secret).update(timestamp + '.').update(body).digest('hex');
}
const webhook = (body, header = signature(body), config = env, options = {}) =>
  verifyStripeWebhook(body, header, config, {now: () => fixedNow, ...options});
const refundInput = {paymentIntentId: ids.intent, amountCents: 2_000, orderId: ids.order,
  orderAmountCents: amount, remainingAmountCents: amount};
const transferInput = {amountCents: 8_000, destination: ids.account, sourceTransaction: ids.charge,
  orderId: ids.order, paymentIntentId: ids.intent, orderAmountCents: amount};

await test('No configuration is disabled and never exposes a secret', () => {
  const config = sandboxConfiguration({}); assert.equal(config.checkoutEnabled, false); assert.equal(config.ready, false);
  assert.equal(config.enabled, false); assert.equal(config.reason, 'sandbox_disabled');
  assert.equal(sandboxSetup, sandboxConfiguration);
  assert.ok(!JSON.stringify(sandboxConfiguration(env)).includes(env.COMMERCE_STRIPE_TEST_SECRET_KEY));
  assert.ok(!JSON.stringify(sandboxConfiguration(env)).includes(env.COMMERCE_STRIPE_TEST_WEBHOOK_SECRET));
});
await test('An owner flag cannot enable a live or restricted-live Stripe key', () => {
  for (const key of [['sk','live','SYNTHETICLIVEKEY0000001'].join("_"), ['rk','live','SYNTHETICLIVEKEY0000001'].join("_")]) {
    const config = sandboxConfiguration({...env, COMMERCE_STRIPE_TEST_SECRET_KEY: key});
    assert.equal(config.ready, false); assert.equal(config.checkoutEnabled, false); assert.equal(config.reason, 'live_key_rejected');
  }
});
await test('Malformed, whitespace and publishable keys fail closed; reviewed test restricted keys are eligible', () => {
  for (const key of ['sk_test_short', 'sk_test_SYNTHETICKEY 0000001', 'pk_test_SYNTHETICKEY0000001', true])
    assert.equal(sandboxConfiguration({...env, COMMERCE_STRIPE_TEST_SECRET_KEY: key}).ready, false);
  assert.equal(sandboxConfiguration({...env,COMMERCE_STRIPE_TEST_SECRET_KEY:'rk_test_SYNTHETICKEY0000001'}).ready,true);
});
await test('Explicit review and sandbox flags, webhook key and HTTPS origin are mandatory', () => {
  for (const change of [{COMMERCE_SANDBOX_ENABLED: true}, {COMMERCE_SANDBOX_REVIEWED: 'false'},
    {COMMERCE_SANDBOX_REVIEWED: true}, {COMMERCE_STRIPE_TEST_WEBHOOK_SECRET: ''}, {COMMERCE_PUBLIC_ORIGIN: 'http://comic.example.invalid'},
    {COMMERCE_PUBLIC_ORIGIN: 'https://comic.example.invalid/path'}, {COMMERCE_PUBLIC_ORIGIN: 'https://u:p@comic.example.invalid'}])
    assert.equal(sandboxConfiguration({...env, ...change}).checkoutEnabled, false);
  assert.equal(sandboxConfiguration(env).checkoutEnabled, true); assert.equal(sandboxConfiguration(env).apiVersion, STRIPE_SANDBOX_API_VERSION);
});
await test('Missing setup produces no outbound API attempt', async () => {
  const state = mock({config: {}});
  await rejectsCode(() => state.client.createCheckout(checkoutInput, randomKey), 'sandbox_disabled');
  await rejectsCode(() => state.client.retrieveAccount(ids.account), 'sandbox_disabled');
  assert.equal(state.requests.length, 0);
});
await test('Revoking the sandbox flag or switching the canonical origin disables an existing adapter', async () => {
  const revoked = clone(env), state = mock({config: revoked}); revoked.COMMERCE_SANDBOX_ENABLED = 'false';
  await rejectsCode(() => state.client.createCheckout(checkoutInput, randomKey), 'sandbox_disabled');
  assert.equal(state.requests.length, 0);
  const changed = clone(env), other = mock({config: changed}); changed.COMMERCE_PUBLIC_ORIGIN = 'https://other.example.invalid';
  await rejectsCode(() => other.client.createCheckout(checkoutInput, randomKey), 'sandbox_configuration_changed');
  assert.equal(other.requests.length, 0);
});
await test('Hosted checkout uses server cents, exact metadata and persisted idempotency, with no automatic transfer', async () => {
  const state = mock(), result = await state.client.createCheckout(checkoutInput, randomKey);
  assert.equal(result.id, ids.session); const {url, options, fields} = state.requests[0];
  assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions'); assert.equal(options.redirect, 'error');
  assert.equal(options.headers['Stripe-Version'], '2026-09-30.endive'); assert.equal(options.headers['Idempotency-Key'], randomKey);
  assert.equal(options.headers.Authorization, 'Bearer ' + env.COMMERCE_STRIPE_TEST_SECRET_KEY);
  assert.equal(fields.ui_mode, 'hosted_page'); assert.equal(fields.mode, 'payment'); assert.ok(!Object.keys(fields).some(key=>key.startsWith('payment_method_types')), 'Stripe selects configured, device-eligible methods dynamically');
  assert.equal(fields.client_reference_id, ids.order); assert.equal(fields['metadata[order_id]'], ids.order);
  assert.equal(fields['payment_intent_data[metadata][order_id]'], ids.order); assert.equal(fields['payment_intent_data[transfer_group]'], 'ORDER_' + ids.order);
  assert.equal(fields['line_items[0][price_data][unit_amount]'], String(amount)); assert.equal(fields['line_items[0][price_data][currency]'], 'usd');
  assert.equal(fields.billing_address_collection, 'required'); assert.equal(fields.success_url, checkoutInput.successUrl);
  assert.ok(!Object.keys(fields).some(key => key.startsWith('shipping_address_collection')));
  assert.ok(!Object.keys(fields).some(key => /transfer_data|application_fee|destination|payout/.test(key)));
  assert.ok(!Object.keys(fields).some(key => /secret|card_number|cvc/.test(key)));
});
await test('Server item, shipping and tax cents reconcile exactly without optional shopper amounts', async () => {
  const state = mock(); await state.client.createCheckout({...checkoutInput, itemAmountCents: 8_000, shippingCents: 1_000, taxCents: 1_000}, randomKey);
  assert.equal(state.requests[0].fields['line_items[0][price_data][unit_amount]'], '8000');
  assert.equal(state.requests[0].fields['line_items[1][price_data][unit_amount]'], '1000');
  assert.equal(state.requests[0].fields['line_items[2][price_data][unit_amount]'], '1000');
  assert.ok(!Object.keys(state.requests[0].fields).some(key => /optional_items|allow_promotion/.test(key)));
});
await test('Retrying unchanged Checkout with its persisted key returns one synthetic provider object', async () => {
  const state = mock({idempotency: true}); const a = await state.client.createCheckout(checkoutInput, randomKey);
  const b = await state.client.createCheckout(checkoutInput, randomKey); assert.equal(a.id, b.id); assert.equal(state.simulatedCreates, 1);
  assert.equal(state.requests[0].options.body.toString(), state.requests[1].options.body.toString());
});
await test('Reusing a key with altered totals is an explicit sanitized conflict', async () => {
  const state = mock({idempotency: true}); await state.client.createCheckout(checkoutInput, randomKey);
  await assert.rejects(() => state.client.createCheckout({...checkoutInput, amountCents: 9_000}, randomKey), error =>
    error.code === 'stripe_provider_error' && error.status === 409 && !error.message.includes('Sensitive'));
  assert.equal(state.simulatedCreates, 1);
});
await test('Zero, fractional, tiny, negative, nonnumeric and unsafe charge totals never reach Stripe', async () => {
  const state = mock();
  for (const amountCents of [0, 1, 49, 50.1, -100, NaN, Infinity, 100_000_000, Number.MAX_SAFE_INTEGER, '10000'])
    await rejectsCode(() => state.client.createCheckout({...checkoutInput, amountCents}, randomKey), 'invalid_amount');
  assert.equal(state.requests.length, 0);
});
await test('Negative components and mismatched breakdown never reach Stripe', async () => {
  const state = mock();
  for (const change of [{itemAmountCents: 0}, {shippingCents: -1}, {taxCents: -1}, {itemAmountCents: 9000, shippingCents: 0, taxCents: 0}])
    await rejectsCode(() => state.client.createCheckout({...checkoutInput, ...change}, randomKey), 'invalid_amount');
  assert.equal(state.requests.length, 0);
});
await test('Invalid identifiers, titles and weak idempotency keys cannot start Checkout', async () => {
  const state = mock();
  await rejectsCode(() => state.client.createCheckout({...checkoutInput, orderId: '../../other'}, randomKey), 'invalid_identifier');
  await rejectsCode(() => state.client.createCheckout({...checkoutInput, title: 'Secret\nheader'}, randomKey), 'invalid_title');
  await rejectsCode(() => state.client.createCheckout(checkoutInput, 'weak'), 'invalid_idempotency_key');
  assert.equal(state.requests.length, 0);
});
await test('Checkout rejects external, insecure, credentialed and malformed return URLs', async () => {
  const state = mock();
  for (const successUrl of ['https://evil.example.invalid/order', 'http://comichuddle.example.invalid/order',
    'https://u:p@comichuddle.example.invalid/order', '//comichuddle.example.invalid/order',
    'javascript:alert(1)', 'https://comichuddle.example.invalid/\\evil', checkoutInput.successUrl + '\n'])
    await rejectsCode(() => state.client.createCheckout({...checkoutInput, successUrl}, randomKey), 'invalid_return_url');
  assert.equal(state.requests.length, 0);
});
await test('Only Stripe HTTPS Checkout URLs can be returned to the browser', async () => {
  for (const url of ['https://checkout.stripe.com.evil.example.invalid/pay', 'http://checkout.stripe.com/pay',
    'https://u:p@checkout.stripe.com/pay', 'https://checkout.stripe.com:444/pay', 'javascript:alert(1)']) {
    const state = mock({override: () => Response.json({...checkout, url})});
    await rejectsCode(() => state.client.createCheckout(checkoutInput, randomKey), 'stripe_invalid_response');
    const retrieved = mock({override: () => Response.json({...checkout, url})});
    await rejectsCode(() => retrieved.client.retrieveCheckout(ids.session, {orderId: ids.order, amountCents: amount}, {requirePaid: false}), 'stripe_invalid_response');
  }
});
await test('Create response must be an open unpaid sandbox session bound to the order', async () => {
  for (const change of [{livemode: true}, {livemode: undefined}, {object: 'payment_intent'}, {status: 'complete'},
    {payment_status: 'paid'}, {amount_total: 1}, {currency: 'eur'}, {metadata: {order_id: 'other'}}, {client_reference_id: 'other'}]) {
    const state = mock({override: () => Response.json({...checkout, ...change})});
    await assert.rejects(() => state.client.createCheckout(checkoutInput, randomKey));
  }
});
await test('Paid Checkout retrieval checks the saved session, total, order and exact intent', async () => {
  const state = mock(); const result = await state.client.retrieveCheckout(ids.session, binding);
  assert.equal(result.payment_status, 'paid'); assert.equal(state.requests[0].options.method, 'GET');
  assert.equal(state.requests[0].options.headers['Idempotency-Key'], undefined);
  await rejectsCode(() => state.client.retrieveCheckout('cs_live_fake', binding), 'invalid_identifier');
});
await test('Cross-order, amount, currency, metadata and intent mismatches cannot mark payment paid', async () => {
  for (const change of [{id: 'cs_test_Other'}, {amount_total: 9999}, {currency: 'cad'}, {mode: 'setup'},
    {client_reference_id: 'other'}, {metadata: {order_id: ids.order, orderId: 'other'}}, {payment_intent: 'pi_Other'}]) {
    const state = mock({override: () => Response.json({...paidCheckout, ...change})});
    await rejectsCode(() => state.client.retrieveCheckout(ids.session, binding), 'stripe_order_mismatch');
  }
});
await test('Redirect completion and processing/unpaid sessions cannot prove a payment', async () => {
  for (const change of [{status: 'open'}, {payment_status: 'unpaid'}, {payment_status: 'no_payment_required'}]) {
    const state = mock({override: () => Response.json({...paidCheckout, ...change})});
    await rejectsCode(() => state.client.retrieveCheckout(ids.session, binding), 'stripe_payment_unconfirmed');
  }
  const state = mock({override: () => Response.json(checkout)});
  assert.equal((await state.client.retrieveCheckout(ids.session, {orderId: ids.order, amountCents: amount}, {requirePaid: false})).status, 'open');
});
await test('PaymentIntent requires exact sandbox order, transfer group and captured amount', async () => {
  const good = mock(); assert.equal((await good.client.retrievePaymentIntent(ids.intent, binding)).latest_charge, ids.charge);
  for (const change of [{id: 'pi_Other'}, {livemode: true}, {currency: 'eur'}, {amount: 9999},
    {metadata: {}}, {transfer_group: 'OTHER'}, {amount_received: 0}, {status: 'processing'}]) {
    const state = mock({override: () => Response.json({...intent, ...change})});
    await assert.rejects(() => state.client.retrievePaymentIntent(ids.intent, binding));
  }
});
await test('Automatic destination transfers or application fees are rejected', async () => {
  for (const change of [{transfer_data: {destination: ids.account}}, {application_fee_amount: 100}]) {
    const state = mock({override: () => Response.json({...intent, ...change})});
    await rejectsCode(() => state.client.retrievePaymentIntent(ids.intent, binding), 'stripe_invalid_response');
  }
});
await test('Malformed provider JSON and nonobject responses are sanitized', async () => {
  for (const response of [new Response('bad SECRET provider json'), Response.json([]), Response.json(null)]) {
    const state = mock({override: () => response});
    await assert.rejects(() => state.client.retrieveAccount(ids.account), error => error.code === 'stripe_invalid_response' && !error.message.includes('SECRET'));
  }
});
await test('HTTP failure responses expose no provider payload, key or customer information', async () => {
  for (const status of [400, 401, 409, 429, 500]) {
    const state = mock({override: () => Response.json({error: {message: env.COMMERCE_STRIPE_TEST_SECRET_KEY + ' buyer@example.invalid'}}, {status})});
    await assert.rejects(() => state.client.retrieveAccount(ids.account), error => error.code === 'stripe_provider_error' &&
      error.retryable === (status === 429 || status >= 500) && !error.message.includes('sk_test') && !error.message.includes('@'));
  }
});
await test('Network failures are uncertain and never automatically replayed', async () => {
  const state = mock({override: () => {throw new Error('SECRET NETWORK ' + env.COMMERCE_STRIPE_TEST_SECRET_KEY);}});
  await assert.rejects(() => state.client.createCheckout(checkoutInput, randomKey), error => error.code === 'stripe_unavailable' && error.retryable && !error.message.includes('SECRET'));
  assert.equal(state.requests.length, 1);
});
await test('Timeout aborts the request and reports uncertainty without starting another charge', async () => {
  const state = mock({timeoutMs: 5, override: () => new Promise(() => {})});
  await assert.rejects(() => state.client.createCheckout(checkoutInput, randomKey), error => error.code === 'stripe_timeout' && error.status === 504 && error.retryable);
  assert.equal(state.requests.length, 1); assert.equal(state.requests[0].options.signal.aborted, true);
});
await test('Oversized declared and streaming Stripe responses are bounded', async () => {
  for (const response of [new Response('small', {headers: {'content-length': '600000'}}), new Response('x'.repeat(524_289))]) {
    const state = mock({override: () => response});
    await rejectsCode(() => state.client.retrieveAccount(ids.account), 'stripe_invalid_response');
  }
});
await test('A partial refund re-verifies intent and charge before refunding the original payment', async () => {
  const state = mock(), result = await state.client.createRefund(refundInput, randomKey);
  assert.equal(result.status, 'succeeded');
  assert.ok(state.requests.some(request => request.route === '/v1/payment_intents/' + ids.intent));
  assert.ok(state.requests.some(request => request.route === '/v1/charges/' + ids.charge));
  const request = state.requests.at(-1); assert.equal(request.route, '/v1/refunds');
  assert.equal(request.fields.payment_intent, ids.intent); assert.equal(request.fields.amount, '2000');
  assert.equal(request.fields['metadata[order_id]'], ids.order); assert.equal(request.options.headers['Idempotency-Key'], randomKey);
  assert.ok(!Object.keys(request.fields).some(key => /destination|card|bank|reverse_transfer/.test(key)));
});
await test('Full refund is supported with exactly the remaining order amount', async () => {
  const state = mock({override: ({route}) => route === '/v1/refunds' ? Response.json({...refund, amount}) : undefined});
  assert.equal((await state.client.createRefund({...refundInput, amountCents: amount}, randomKey)).amount, amount);
});
await test('Zero, negative, excess and invalid refund amounts cannot reach the refund API', async () => {
  const state = mock();
  for (const change of [{amountCents: 0}, {amountCents: -1}, {amountCents: 2_000.5},
    {remainingAmountCents: 1999}, {remainingAmountCents: 10001}, {orderAmountCents: 49}])
    await assert.rejects(() => state.client.createRefund({...refundInput, ...change}, randomKey));
  assert.equal(state.requests.length, 0);
});
await test('Provider refunded amount overrides an optimistic local remaining balance', async () => {
  const state = mock({override: ({route}) => route === '/v1/charges/' + ids.charge ? Response.json({...charge, amount_refunded: 9000}) : undefined});
  await rejectsCode(() => state.client.createRefund(refundInput, randomKey), 'refund_exceeds_remaining');
  assert.ok(!state.requests.some(request => request.route === '/v1/refunds'));
});
await test('Current open or unknown charge disputes block refunds despite a delayed webhook', async () => {
  for (const disputed of [true, undefined, 'false']) {
    const state = mock({override: ({route}) => route === '/v1/charges/' + ids.charge ? Response.json({...charge, disputed}) : undefined});
    await rejectsCode(() => state.client.createRefund(refundInput, randomKey), 'stripe_charge_disputed');
    assert.ok(!state.requests.some(request => request.route === '/v1/refunds'));
  }
  const partial = mock({override: ({route}) => route === '/v1/charges/' + ids.charge ? Response.json({...charge, amount_refunded: 1000}) : undefined});
  assert.equal((await partial.client.createRefund({...refundInput, remainingAmountCents: 9000}, randomKey)).amount, 2000);
  assert.equal(partial.requests.filter(request => request.route === '/v1/refunds').length, 1);
});
await test('Pending and failed refunds are returned as unconfirmed states, never as completed', async () => {
  for (const status of ['pending', 'failed', 'requires_action', 'canceled']) {
    const state = mock({override: ({route}) => route === '/v1/refunds' ? Response.json({...refund, status}) : undefined});
    assert.equal((await state.client.createRefund(refundInput, randomKey)).status, status);
  }
});
await test('Refund reconciliation requires exact intent, amount, currency, order and completion', async () => {
  const good = mock(); assert.equal((await good.client.retrieveRefund(ids.refund, {orderId: ids.order, paymentIntentId: ids.intent, amountCents: 2000}, {requireSucceeded: true})).id, ids.refund);
  for (const change of [{id: 're_Other'}, {payment_intent: 'pi_Other'}, {amount: 1000}, {currency: 'cad'},
    {metadata: {order_id: 'other'}}, {livemode: true}, {status: 'pending'}]) {
    const state = mock({override: () => Response.json({...refund, ...change})});
    await assert.rejects(() => state.client.retrieveRefund(ids.refund, {orderId: ids.order, paymentIntentId: ids.intent, amountCents: 2000}, {requireSucceeded: true}));
  }
});
await test('Create-refund response cannot substitute another order or payment', async () => {
  for (const change of [{payment_intent: 'pi_Other'}, {amount: 3000}, {currency: 'eur'}, {metadata: {order_id: 'other'}}, {status: 'made-up'}]) {
    const state = mock({override: ({route}) => route === '/v1/refunds' ? Response.json({...refund, ...change}) : undefined});
    await assert.rejects(() => state.client.createRefund(refundInput, randomKey));
  }
});
await test('Seller release uses separate transfer, saved source charge and exact server amount', async () => {
  const state = mock(), result = await state.client.createTransfer(transferInput, randomKey); assert.equal(result.id, ids.transfer);
  const request = state.requests.at(-1); assert.equal(request.route, '/v1/transfers'); assert.equal(request.fields.amount, '8000');
  assert.equal(request.fields.currency, 'usd'); assert.equal(request.fields.destination, ids.account);
  assert.equal(request.fields.source_transaction, ids.charge); assert.equal(request.fields.transfer_group, 'ORDER_' + ids.order);
  assert.equal(request.options.headers['Idempotency-Key'], randomKey);
  assert.ok(!state.requests.some(row => row.route.includes('payout')));
});
await test('Disputed, partially refunded and fully refunded charges cannot release seller funds', async () => {
  for (const change of [{disputed: true}, {amount_refunded: 100}, {refunded: true}, {paid: false}, {captured: false}]) {
    const state = mock({override: ({route}) => route === '/v1/charges/' + ids.charge ? Response.json({...charge, ...change}) : undefined});
    await assert.rejects(() => state.client.createTransfer(transferInput, randomKey));
    assert.ok(!state.requests.some(request => request.route === '/v1/transfers'));
  }
});
await test('Another charge or payment cannot be substituted for the order charge', async () => {
  const state = mock();
  await rejectsCode(() => state.client.createTransfer({...transferInput, sourceTransaction: 'ch_Other'}, randomKey), 'stripe_order_mismatch');
  assert.ok(!state.requests.some(request => request.route === '/v1/transfers'));
  const wrong = mock({override: ({route}) => route === '/v1/charges/' + ids.charge ? Response.json({...charge, payment_intent: 'pi_Other'}) : undefined});
  await rejectsCode(() => wrong.client.createTransfer(transferInput, randomKey), 'stripe_order_mismatch');
});
await test('Incomplete, disabled or non-US sellers cannot receive transfers', async () => {
  for (const change of [{country: 'CA'}, {details_submitted: false}, {payouts_enabled: false}, {capabilities: {transfers: 'pending'}}]) {
    const state = mock({override: ({route}) => route === '/v1/accounts/' + ids.account ? Response.json({...account, ...change}) : undefined});
    await assert.rejects(() => state.client.createTransfer(transferInput, randomKey));
    assert.ok(!state.requests.some(request => request.route === '/v1/transfers'));
  }
});
await test('Transfer response verifies exact destination, source charge, amount and order', async () => {
  for (const change of [{destination: 'acct_Other'}, {source_transaction: 'ch_Other'}, {amount: 1000},
    {transfer_group: 'OTHER'}, {metadata: {order_id: 'other'}}, {livemode: true}, {reversed: true}]) {
    const state = mock({override: ({route}) => route === '/v1/transfers' ? Response.json({...transfer, ...change}) : undefined});
    await assert.rejects(() => state.client.createTransfer(transferInput, randomKey));
  }
});
await test('US Express onboarding binds profile and user, explicitly disables automatic bank payouts', async () => {
  const state = mock(); await state.client.createSellerAccount({profileId: 'seller-profile', userId: 'seller-user', email: 'seller@example.invalid'}, randomKey);
  const request = state.requests[0]; assert.equal(request.route, '/v1/accounts'); assert.equal(request.fields.country, 'US');
  assert.equal(request.fields['controller[stripe_dashboard][type]'], 'express');
  assert.equal(request.fields['controller[fees][payer]'], 'application'); assert.equal(request.fields['controller[losses][payments]'], 'application');
  assert.equal(request.fields['settings[payouts][schedule][interval]'], 'manual');
  assert.equal(request.fields['metadata[profile_id]'], 'seller-profile'); assert.equal(request.fields['metadata[user_id]'], 'seller-user');
  assert.equal(request.fields.type, undefined); assert.equal(request.fields.external_account, undefined);
});
await test('Seller account creation and retrieval reject mismatched profile metadata', async () => {
  for (const change of [{country: 'CA'}, {metadata: {profile_id: 'other', user_id: 'seller-user'}}, {livemode: true}]) {
    const state = mock({override: () => Response.json({...account, ...change})});
    await assert.rejects(() => state.client.createSellerAccount({profileId: 'seller-profile', userId: 'seller-user', email: 'seller@example.invalid'}, randomKey));
    await assert.rejects(() => state.client.retrieveAccount(ids.account, {profileId: 'seller-profile', userId: 'seller-user'}));
  }
});
await test('Onboarding links are HTTPS Stripe single-use links with canonical site returns', async () => {
  const state = mock(), urls = {refreshUrl: env.COMMERCE_PUBLIC_ORIGIN + '/seller/refresh', returnUrl: env.COMMERCE_PUBLIC_ORIGIN + '/seller/return'};
  const link = await state.client.createAccountLink(ids.account, urls, randomKey); assert.match(link.url, /^https:\/\/connect\.stripe\.com\//);
  assert.equal(state.requests[0].fields.type, 'account_onboarding'); assert.equal(state.requests[0].fields.account, ids.account);
  assert.equal(state.requests[0].options.headers['Idempotency-Key'], randomKey);
  await rejectsCode(() => state.client.createAccountLink(ids.account, {...urls, returnUrl: 'https://evil.example.invalid'}, randomKey), 'invalid_return_url');
});
await test('Expired or unexpected-host seller onboarding links are never returned', async () => {
  for (const change of [{expires_at: stamp - 1}, {url: 'https://connect.stripe.com.evil.example.invalid'}, {url: 'javascript:evil'}]) {
    const state = mock({override: () => Response.json({object: 'account_link', expires_at: stamp + 300, url: 'https://connect.stripe.com/setup', ...change})});
    await rejectsCode(() => state.client.createAccountLink(ids.account, {refreshUrl: checkoutInput.cancelUrl, returnUrl: checkoutInput.cancelUrl}, randomKey), 'stripe_invalid_response');
  }
});
await test('Webhook authenticates actual raw bytes using HMAC SHA-256 before parsing', async () => {
  const body = bodyEvent(); assert.equal((await webhook(new TextEncoder().encode(body), signature(body))).id, 'evt_Synthetic0001');
  await rejectsCode(() => webhook(body, signature(body, stamp, 'whsec_WRONGSYNTHETICSECRET0001')), 'invalid_webhook_signature');
});
await test('Webhook supports rotating multiple v1 signatures while ignoring obsolete schemes', async () => {
  const body = bodyEvent(), valid = signature(body).split('v1=')[1];
  assert.equal((await webhook(body, `t=${stamp},v0=${'a'.repeat(64)},v1=${'0'.repeat(64)},v1=${valid}`)).id, 'evt_Synthetic0001');
  await rejectsCode(() => webhook(body, `t=${stamp},v0=${valid}`), 'invalid_webhook_signature');
});
await test('Stale, future and malformed timestamps or duplicated t values are rejected', async () => {
  const body = bodyEvent();
  for (const timestamp of [stamp - 301, stamp + 301]) await rejectsCode(() => webhook(body, signature(body, timestamp)), 'expired_webhook_signature');
  for (const header of [`t=${stamp},t=${stamp},v1=${'0'.repeat(64)}`, `t=NaN,v1=${'0'.repeat(64)}`, `t=-1,v1=${'0'.repeat(64)}`, '', 'v1=abc'])
    await rejectsCode(() => webhook(body, header), 'invalid_webhook_signature');
});
await test('Changed body and unauthenticated malformed JSON fail signature authentication first', async () => {
  const body = bodyEvent(); await rejectsCode(() => webhook(body + ' ', signature(body)), 'invalid_webhook_signature');
  await rejectsCode(() => webhook('{NOT JSON', signature(body)), 'invalid_webhook_signature');
});
await test('Correctly signed malformed JSON, live events and unexpected event shapes are rejected', async () => {
  for (const body of ['{NOT JSON', '[]', bodyEvent({livemode: true}), bodyEvent({livemode: undefined}),
    bodyEvent({object: 'payment_intent'}), bodyEvent({id: 'bad'}), bodyEvent({type: '../../other'}), bodyEvent({data: {object: null}}),
    bodyEvent({data: {object: {...paidCheckout, livemode: true}}})])
    await rejectsCode(() => webhook(body), 'invalid_webhook');
});
await test('Raw Unicode bytes authenticate without reserialization or normalization', async () => {
  const body = bodyEvent({data: {object: {...paidCheckout, syntheticLabel: 'Comic — café ⚡'}}});
  assert.equal((await webhook(new TextEncoder().encode(body), signature(body))).data.object.syntheticLabel, 'Comic — café ⚡');
  await rejectsCode(() => webhook(body.replace('café', 'cafe'), signature(body)), 'invalid_webhook_signature');
});
await test('Webhook size, signature count and clock tolerance are bounded', async () => {
  await rejectsCode(() => webhook('x'.repeat(STRIPE_WEBHOOK_MAX_BYTES + 1), 'bad'), 'invalid_webhook');
  const body = bodyEvent(), valid = signature(body);
  await rejectsCode(() => webhook(body, valid + ',' + Array.from({length: 17}, () => 'v1=' + '0'.repeat(64)).join(',')), 'invalid_webhook_signature');
  for (const toleranceSeconds of [0, -1, 301, Infinity])
    await rejectsCode(() => webhook(body, valid, env, {toleranceSeconds}), 'invalid_webhook_configuration');
});
await test('Webhook rejects absent credentials and every live key even with owner flags', async () => {
  const body = bodyEvent();
  for (const config of [{}, {...env, COMMERCE_SANDBOX_ENABLED: 'false'}, {...env, COMMERCE_STRIPE_TEST_SECRET_KEY: ['sk','live','SYNTHETIC0000000001'].join("_")}])
    await rejectsCode(() => webhook(body, signature(body), config), 'webhook_not_configured');
});
await test('Authenticated retries retain the event ID for durable caller deduplication', async () => {
  const body = bodyEvent(), first = await webhook(body), repeated = await webhook(body, signature(body, stamp + 10));
  assert.equal(first.id, repeated.id); assert.deepEqual(plain(first), plain(repeated));
  // The adapter authenticates delivery, not exactly-once application. DB ledger owns deduplication.
});
await test('Signature validation can precede the integration review without enabling checkout', async () => {
  const config = {...env, COMMERCE_SANDBOX_REVIEWED: 'false'}, body = bodyEvent();
  assert.equal((await webhook(body, signature(body), config)).livemode, false);
  assert.equal(sandboxConfiguration(config).checkoutEnabled, false);
});

await test('Embedded Payment Element sessions use the exact bound secret and return URL without hosted redirects',async()=>{
 const requests=[];const client=stripeSandbox(env,{fetch:async(url,options)=>{requests.push(new URLSearchParams(options.body));return Response.json({...checkout,url:null,client_secret:ids.session+'_secret_SYNTHETICSESSION0001'})}});
 const result=await client.createCheckout({...checkoutInput,uiMode:'elements'},randomKey);
 assert.equal(result.client_secret,ids.session+'_secret_SYNTHETICSESSION0001');assert.equal(requests[0].get('ui_mode'),'elements');assert.equal(requests[0].get('return_url'),checkoutInput.successUrl);assert.equal(requests[0].has('success_url'),false);assert.equal(requests[0].has('cancel_url'),false);
});
await test('A borrowed embedded client secret cannot authorize a different order session',async()=>{
 const client=stripeSandbox(env,{fetch:async()=>Response.json({...checkout,url:null,client_secret:'cs_test_OTHER_secret_SYNTHETICSESSION0001'})});await rejectsCode(()=>client.createCheckout({...checkoutInput,uiMode:'elements'},randomKey),'stripe_order_mismatch');
});

console.log(`Stripe sandbox adapter: ${passed} named groups passed; ${failures.length} failed. Synthetic HTTP/signature tests only; actual Stripe sandbox transactions not run.`);
if (failures.length) process.exitCode = 1;
