// SafePurchase timeline vocabulary shared by the server (lib/safepurchase.ts), the admin dashboard and the
// buyer/seller order timeline. Pure and client-safe: no server imports.

export const SAFEPURCHASE_STEPS = ['paid', 'seller_shipped', 'received', 'checked', 'shipped_to_buyer', 'delivered', 'done'] as const;
export type SafePurchaseStep = typeof SAFEPURCHASE_STEPS[number];
export const isSafePurchaseStep = (value: unknown): value is SafePurchaseStep => (SAFEPURCHASE_STEPS as readonly unknown[]).includes(value);

export const STEP_LABELS: Record<SafePurchaseStep, string> = {
  paid: 'Paid',
  seller_shipped: 'Seller shipped',
  received: 'Received',
  checked: 'Checked',
  shipped_to_buyer: 'Shipped to buyer',
  delivered: 'Delivered',
  done: 'Done',
};
/** Pickup orders hand the book over at ComicHuddle instead of shipping it to the buyer. */
export const PICKUP_STEP_LABELS: Partial<Record<SafePurchaseStep, string>> = {shipped_to_buyer: 'Ready for pickup', delivered: 'Picked up'};
export const stepLabel = (step: SafePurchaseStep, pickup = false) => (pickup && PICKUP_STEP_LABELS[step]) || STEP_LABELS[step];

/** Who moves each step forward. Only "admin" steps are set from the dashboard; the rest come from real events. */
export const STEP_SOURCE: Record<SafePurchaseStep, 'payment' | 'seller' | 'admin' | 'carrier' | 'release'> = {
  paid: 'payment', seller_shipped: 'seller', received: 'admin', checked: 'admin', shipped_to_buyer: 'admin', delivered: 'carrier', done: 'release',
};

export type StepState = 'done' | 'current' | 'upcoming' | 'failed' | 'skipped';
export type TimelineUpdate = {
  id: string; step: SafePurchaseStep; kind: 'note' | 'tracking' | 'return_shipped' | 'internal_note' | 'step';
  note: string; carrier: string | null; trackingNumber: string | null; photoIds: string[]; createdAt: string; internal: boolean;
};
export type TimelineStep = {step: SafePurchaseStep; label: string; state: StepState; at: string | null; detail: string | null; tracking: {carrier: string; number: string} | null; updates: TimelineUpdate[]};
export type SafePurchaseOutcome = 'in_progress' | 'done' | 'check_failed' | 'refunded' | 'refund_pending' | 'on_hold' | 'cancelled';
export type SafePurchaseTimeline = {
  orderId: string; orderNumber: string; title: string; fulfillment: 'shipping' | 'pickup'; sandbox: boolean;
  role: 'buyer' | 'seller' | 'admin';
  outcome: SafePurchaseOutcome; outcomeNote: string | null;
  currentStep: SafePurchaseStep | null;
  steps: TimelineStep[];
  reviewUntil: string | null;
  /** Seller only, before the book is received: where to ship. null address = not configured yet. */
  receiving?: {address: string | null};
  updatesAvailable: boolean;
};

/** Short, human order number: the first 8 characters of the order id, as Wallet history shows it. */
export const orderNumber = (orderId: string) => orderId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
/** Normalizes a typed order number ("#ab12cd34", "AB12-CD34") for search. */
export const normalizeOrderSearch = (value: string) => value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 100);

/** SafePurchase is recommended by default at or above the configured threshold (lib/commerce-protection.ts). */
export const safePurchaseRecommended = (priceCents: number | null | undefined, thresholdCents: number | null | undefined) =>
  typeof priceCents === 'number' && typeof thresholdCents === 'number' && thresholdCents > 0 && priceCents >= thresholdCents;

export const RECEIVING_ADDRESS_PLACEHOLDER = 'ComicHuddle receiving address — set by the owner';
