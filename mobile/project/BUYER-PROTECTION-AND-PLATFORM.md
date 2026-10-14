# ComicHuddle buyer protection and platform decision

Reviewed 9 October 2026. Operator: Malik LLC, Minnesota, USA-only launch; public support: maliktecks@gmail.com. This analyst owns only this document. No processor/carrier account was opened, provider contacted, funds moved or paid service purchased. Database, sandbox adapter and actual test evidence belong to the developer/QA reports. A local simulated payment is not a successful Stripe Sandbox integration.

## Recommended platform and payment flow

Keep ComicHuddle's custom app/backend for marketplace accounts, inventory, orders, disputes and seller payments. Use **Stripe Connect separate charges and transfers**, subject to processor approval and the final legal/merchant structure. Capture the buyer payment on the platform; create the seller transfer only after the release policy passes. A later bank payout is a separate step. This is a delayed-transfer proposal, not escrow.

| Option | What current official documentation establishes | Decision for this project |
| --- | --- | --- |
| Squarespace Commerce | Merchant-site products, inventory, orders, transactions, contacts and webhooks are documented. Its Stripe connection connects a merchant account. [1, 2] | Suitable for a conventional merchant storefront or optional marketing site. No native vendor onboarding, seller split or dispute-conditioned release resource was verified. A custom extension would still need substantial marketplace infrastructure; this is a suitability inference, not a claim that no third-party solution could exist. |
| Squarespace transaction integration | Public Transactions methods are list/get; refunds initiated outside Squarespace are excluded. Commerce API limits are 300 requests/minute; Create Order with an API key is additionally limited to 100/hour/site. [3, 4] | Poor primary ledger for our independent refund/transfer workflow. Do not assume importing an order charges its buyer or an API key enables seller payouts. |
| Connect separate charges/transfers | Charges and seller transfers are decoupled; platform balance bears processor fees, refunds and chargebacks. [5] | Best fit for conditional transfer timing if accepted for this business. Use an order ledger and a release worker; do not create the transfer at checkout. |
| Connected-account manual payouts | Controls movement from a connected balance to its external bank, rather than platform-to-seller allocation. Stripe expressly does not support escrow; current USA manual-payout limit is two years, versus 90 days in most other countries. [6] | Additional payout control if approved/configured; the USA limit is not permission to retain platform funds for two years. Adopt short, disclosed deadlines. |

Stripe documents both platform-balance holds before transfer and connected-balance holds before payout, tied to a clear purpose and release condition. [7] Ordinary balance accounting does not guarantee funds are individually protected: Stripe's funds-segregation feature is a private preview, not assumed here. [5] Configure platform payouts and reserves so refund and seller liabilities remain funded.

Confirm the settlement merchant/merchant-of-record role, statement descriptor, connected-account responsibilities and approved payment methods with the processor before live activation. Changing `on_behalf_of` alone does not resolve tax or legal responsibility.

## Draft US physical-comic policy

These are proposed operating rules for single comics and collection lots, including paid auction orders once binding-auction gates pass. They are not current guarantees or a statutory deadline. Workshop processing/CGC services need separate service milestones; do not apply a 72-hour comic-dispatch rule to a multi-week pressing/grading job.

### Clock and fulfillment

Use UTC elapsed hours, with the deadlines shown before purchase and stored with the order's policy version. Preserve `completedOrderAt`, the canonical verified payment time and the required delivery information. Do not restart the clock at webhook receipt or bank settlement. FTC shipment obligations can start at the properly completed order/payment authorization; legal review must align the application's clock to that rule. Shipment promises need a reasonable basis, and missed promises require applicable consent/cancellation/refund handling. [8]

| Stage | Proposed deadline | Required action |
| --- | --- | --- |
| Payment confirmation | Verified successful payment and complete order | Freeze the listing/lot manifest, amount components, delivery address and policy. Tell the seller when shipment obligations begin. A client success page does not establish payment. |
| Tracking submission | Within 48 hours | Seller supplies valid supported-carrier tracking for every parcel. A placeholder, another buyer's number or a label-created event is not physical acceptance. Warn before the deadline. |
| Physical handover | Within 72 hours | Obtain a carrier acceptance/tender scan or reviewed equivalent evidence. A valid label alone does not meet this milestone. |
| Delivery review | 48 hours after all parcels are verifiably delivered | Notify the buyer, keep seller transfer pending, and make Report a problem prominent. Missing parcel/destination/signature evidence prevents automatic release. |
| Seller release | After delivery review and all release guards pass | Transfer only the reconciled seller entitlement. Bank arrival follows processor timing and is not promised instantly. |
| Protected claim | Proposed 30 calendar days after delivery for wrong/damaged/materially misdescribed items | Review evidence even if seller funds were released. The 48-hour review is a transfer timer, not a waiver of legal or card-network rights. |

### Automatic refund eligibility

Missing valid tracking at 48 hours, or no physical acceptance by 72 hours, makes a paid order **eligible for automatic cancellation and full refund** when fresh evidence confirms the applicable failure. Immediately stop seller release. An authorized exception requires a definite revised deadline and buyer consent recorded before the applicable deadline; seller-only edits cannot extend it silently.

Before dispatching a refund, acquire an order lock and recheck current processor status, amounts already refunded, open chargebacks, carrier evidence, buyer-approved exceptions and any pending release/transfer. Automatically refund only clearly unshipped, undisputed failures. A carrier outage, conflicting scan, actual-shipment evidence, unsupported carrier or ambiguous destination creates manual review with the seller transfer frozen; it is not a fictional no-shipment finding. Review exceptions promptly, notify both parties and set a definite next action rather than an indefinite hold. Do not delay a legally due refund while attempting seller recovery.

For a fully unfulfilled order, propose returning the buyer's full paid total, including applicable item, shipping, tax and platform buyer fees. Do not deduct processor fees from that refund. Cancel an uncaptured authorization rather than describing it as a completed refund. Display refund-requested/pending/succeeded/failed accurately; a queued job is not money returned.

### Delivery, returns and disputes

- Verify carrier, unique tracking, shipment dates, destination match and every parcel in the lot. An estimated delivery date, seller tick box, buyer silence or screenshot alone cannot trigger release. Reused/unrelated tracking and mismatched destinations require investigation.
- Proposed high-value control: require signature service for orders of $750 or more, with the threshold configurable and disclosed. Confirm applicable insurance/collectible coverage and limits; preserve purchase and packing evidence. Do not advertise automatic insurance reimbursement or assume a valuation estimate proves an insured loss.
- Wrong edition, missing lot copies, undisclosed restoration, damaged slabs, counterfeit/signature concerns and materially different condition can be protected claims. Save the frozen listing/manifest, certification details, pre-shipment photos, private messages, package/label photos and buyer evidence. An unboxing video may help; do not make it the sole route to a claim.
- Freeze release when a claim is opened. Proposed service target: acknowledgement within one business day, seller evidence within two business days and a reasoned decision promptly after sufficient evidence. Escalate inconclusive authenticity/condition cases; do not pretend that a photo gives a professional grade.
- For seller-fault returns, propose a prepaid tracked return and no restocking/processor deduction from a covered refund. Set a disclosed return-dispatch deadline, such as seven calendar days after receipt of the label, with reasonable support extensions. Verify the returned copy/certification and condition. Suspected counterfeit handling needs case review rather than automatic recirculation.
- Separate discretionary buyer-remorse returns, disclosed before checkout, from protection for non-delivery and material listing failures. A seller's no-returns preference cannot remove the platform's covered remedies. Prevent a duplicate credit when a processor dispute and platform refund overlap.

Proposed release guards: verified funding, all-parcel delivery plus 48 hours, any required signature, clear destination, no open claim/refund/chargeback/risk hold, eligible verified seller, sufficient funds and no existing release operation. Re-evaluate atomically immediately before creating a transfer. Delivery is evidence of arrival, not proof of the comic's authenticity or satisfaction of every claim.

## Refund, transfer and financial responsibilities

Refunding a separate charge does **not** reverse its seller transfer. Reversal is a separate operation and may fail for insufficient seller balance. [5] Indirect-charge disputes debit the platform amount and fees, with or without `on_behalf_of`; seller recovery does not eliminate that platform exposure. [9]

Stripe refunds can remain pending when available balance is inadequate; original processing fees are generally not returned. Refunds normally return to the original payment method, and failures require follow-up. [10] Therefore:

1. Keep buyer refund, seller transfer reversal, tax adjustment and fee reversal as distinct linked ledger operations. A refund failure must leave the case active and release blocked.
2. Maintain operator-funded refund/dispute liquidity and seller-recovery rules. Do not treat undistributed seller proceeds or collected tax as earned platform revenue. Set pilot transaction/seller limits according to support and loss capacity; no universal reserve percentage is established here.
3. Define who bears processing, shipping, chargeback and return costs in seller terms, and how full/partial refunds reverse the platform commission. Do not promise sellers reimbursement of fees the processor does not return.
4. Prevent platform bank payouts from draining funds needed for pending seller entitlements and refunds. Reconcile balances daily; failed transfer/reversal attempts require durable retry/manual recovery, not success labels.
5. Complete existing [BUSINESS-COMMERCE.md](BUSINESS-COMMERCE.md) tax, seller verification, auction and operating gates. A buyer-protection fund is not insurance and cannot guarantee unlimited compensation.

## Processor and legal scope

Minnesota Commerce says money transmission requires licensing unless an exemption applies. [11] Current §53B.29's agent-of-payee exemption requires written seller appointment, public holding-out and payment to the agent discharging the buyer's obligation with no buyer loss if the agent fails to remit. The relevant conditions remain in the inspected 2026 Chapter 56, §12 amendment. §53B.30 permits the commissioner to demand proof of an exemption. [12–14]

FinCEN's payment-processor exemption depends on goods/services, regulated clearance/settlement, a formal agreement and an agreement with the seller/creditor. Its secured-transaction ruling found an integral-service exemption on specific represented facts; that is not blanket clearance for ComicHuddle. [15, 16]

Before live funds, have the actual Connect flow, seller appointments, receipt language, buyer discharge, ownership of funds, dispute authority and retention reviewed against applicable state/federal scope. Use processor-hosted onboarding and approved funds flows; do not assume a Stripe subscription alone appoints Malik LLC as an authorized delegate or establishes an exemption. USA-only transactions still involve destination-state requirements. This research establishes questions and supported mechanisms, not legal certification; no filing is automatically assumed necessary.

## Carrier access and sandbox release checklist

USPS's current onboarding uses its Business Account/COP, an app, OAuth credentials and TEM testing; Tracking is listed in its default API product. FedEx's tracking docs distinguish ordinary tracking from signature proof: detailed signature access requires the associated shipper billing account. [17, 18] UPS publishes its OAuth app onboarding route. [19] Carrier credentials, production entitlements, quota, event accuracy and permitted evidence use remain unverified for Malik LLC.

Recommended initial carrier set is USPS/UPS/FedEx only where an approved adapter can verify events. Test acceptance, delivered, exception, return-to-sender, pickup and multi-parcel states. Official event codes must map to verified policy states; label creation must not map to handover. Store sensitive delivery/signature evidence privately, and use a support-reviewed evidence route when the carrier cannot provide required proof. Carrier outages must freeze automated decisions and alert an operator.

To make payment sandbox setup concrete:

1. Operator creates/uses its own Stripe account and isolated Sandbox, enables the approved Connect configuration and provides test keys through secure server configuration. No identity, bank detail or secret key should be pasted into public source or chat. Confirm the chosen account/API configuration rather than assuming a legacy account type.
2. Use hosted seller onboarding/test fixtures, a test buyer checkout and supported test payment methods. Enforce USA/USD scope and server-side canonical price/manifest checks. Keep live keys and live charge paths disabled independently.
3. Configure a reachable HTTPS webhook endpoint authenticated by Stripe signatures; a private preview sign-in wall must not block provider callbacks. Save processed event IDs and order/payment references. Reject invalid signatures and cross-environment/cross-account events.
4. Use a durable transactional order store with ownership controls, immutable policy/listing snapshots, payment/refund/transfer IDs, private carrier evidence, append-only audit events and unique idempotency/outbox operations. Avoid a client state or temporary JSON file as the sole financial ledger.
5. QA must execute success, decline/authentication, delayed/duplicate/out-of-order webhook, simultaneous last-copy purchases, 48h/72h boundaries, outages, late tracking, multi-parcel delivery, claim/release races, full/partial refund, duplicate refund, transfer failure/reversal, post-release dispute, reserve shortfall and restart/recovery. Reconcile actual Sandbox objects with ledger totals.
6. Keep test UI labels explicit and fail closed without securely configured account/webhook/DB/carrier access. Record which tests use a local simulator and which use real Stripe Sandbox. Production enablement additionally needs approved operator/seller accounts, legal/tax/policy decisions, monitoring and staffed support. Passing a simulator cannot satisfy those external gates.

## Official sources

All accessed 9 October 2026. The document's timeouts, claim/return windows, signature threshold and service targets are proposals; source constraints are identified separately above.

1. [Squarespace Commerce APIs](https://developers.squarespace.com/commerce-apis/overview)
2. [Squarespace Stripe connection](https://support.squarespace.com/hc/en-us/articles/206540917-Connect-Stripe-to-process-credit-card-payments)
3. [Squarespace Transactions API](https://developers.squarespace.com/commerce-apis/transactions-overview)
4. [Squarespace API rate limits](https://developers.squarespace.com/commerce-apis/rate-limits)
5. [Stripe separate charges/transfers, refund/reversal rules](https://docs.stripe.com/connect/separate-charges-and-transfers?integration=mobile&platform=react-native)
6. [Stripe manual payouts and escrow limitation](https://docs.stripe.com/connect/manual-payouts)
7. [Stripe Connect account balances](https://docs.stripe.com/connect/account-balances)
8. [FTC merchandise-order rule guide](https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule)
9. [Stripe Connect dispute responsibilities](https://docs.stripe.com/connect/disputes)
10. [Stripe refunds](https://docs.stripe.com/refunds)
11. [Minnesota Commerce money transmission](https://mn.gov/commerce/licensing/list/financial-institutions/money-transmission/)
12. [Minnesota §53B.29 exemptions](https://www.revisor.mn.gov/statutes/cite/53B.29)
13. [2026 Chapter 56, §12 amendment](https://www.revisor.mn.gov/laws/2026/0/56/laws.0.12.0)
14. [Minnesota §53B.30 exemption demonstration](https://www.revisor.mn.gov/statutes/cite/53B.30)
15. [FinCEN payment-processor ruling](https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/application-money-services-business)
16. [FinCEN secured-transaction ruling FIN-2014-R005](https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/whether-company-offers-secured-transaction)
17. [USPS API onboarding](https://developers.usps.com/getting-started)
18. [FedEx tracking and signature-proof documentation](https://developer.fedex.com/api/en-us/catalog/track/v1/docs.html)
19. [UPS API onboarding](https://developer.ups.com/get-started)

No audience setting, processor configuration, policy activation or external account was changed by this analyst review.
