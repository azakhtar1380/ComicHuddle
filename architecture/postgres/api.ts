/** Framework-neutral REFERENCE handlers. These are not deployed or wired into the D1 app. */
import { analyzeMarketplaceDeal, DealAnalysisError, publicDealAnalysis } from "./analyzer.js";
import { approveCustomEdition, createCustomDirectoryEntry, mergeCustomEdition } from "./moderation.js";
import type { ApproveCustomEditionInput, CustomDirectoryInput } from "./moderation.js";
import type { SessionDatabase } from "./session.js";
import type { MergeCustomEditionInput } from "./types.js";

export interface AuthenticatedActor { userId: string; roles: readonly ("MEMBER" | "MODERATOR" | "ADMIN")[] }
export interface ApiDependencies {
  authenticate(request: Request): Promise<AuthenticatedActor | null>; // verified session/JWT; not a trusted header
  database: SessionDatabase;
  publicOrigin: string; // trusted deployment config, e.g. https://comichuddle.example; never request Host
  maxMutationBodyBytes?: number; // default 16 KiB; actual streamed bytes, not a trusted Content-Length
  now?: () => Date;
  reportError?: (error: unknown) => void; // server log; never return raw SQL/contract/license details
}
class HttpRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function requireJsonMutation(request: Request, deps: ApiDependencies): void {
  let configured: URL;
  try { configured = new URL(deps.publicOrigin); } catch { throw new Error("Invalid trusted publicOrigin configuration"); }
  if (!['https:','http:'].includes(configured.protocol) || configured.origin !== deps.publicOrigin) {
    throw new Error("publicOrigin must be a canonical configured HTTP(S) origin");
  }
  if (request.headers.get("origin") !== configured.origin) throw new HttpRequestError(403, "ORIGIN_REJECTED");
  if (request.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase() !== "application/json") {
    throw new HttpRequestError(415, "JSON_CONTENT_TYPE_REQUIRED");
  }
}
async function boundedJsonBody(request: Request, deps: ApiDependencies): Promise<unknown> {
  const limit = deps.maxMutationBodyBytes ?? 16_384;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_048_576) throw new Error("Invalid trusted mutation body-byte limit");
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^[0-9]+$/.test(declaredLength)) throw new HttpRequestError(400,"INVALID_CONTENT_LENGTH");
    if (BigInt(declaredLength) > BigInt(limit)) throw new HttpRequestError(413,"REQUEST_BODY_TOO_LARGE");
  }
  if (!request.body) throw new HttpRequestError(400,"INVALID_JSON_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > limit) {
        await reader.cancel();
        throw new HttpRequestError(413,"REQUEST_BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); }
  catch { throw new HttpRequestError(400,"INVALID_JSON_BODY"); }
}
function response(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", ...extraHeaders } });
}
function errorResponse(error: unknown, deps: ApiDependencies): Response {
  if (error instanceof HttpRequestError) return response(error.status,{code:error.code});
  if (error instanceof DealAnalysisError) return response(404, { code: error.code });
  if (error instanceof TypeError || error instanceof SyntaxError) return response(400, { code: "INVALID_REQUEST" });
  const sqlCode = (error as { code?: string } | null)?.code;
  if (sqlCode === "42501") return response(403, { code: "NOT_AUTHORIZED" });
  if (sqlCode === "40001" || sqlCode === "40P01" || sqlCode === "23505") return response(409, { code: "RELOAD_CONFLICT" });
  if (sqlCode === "23514" || sqlCode === "22P02" || sqlCode === "22003" || sqlCode === "23502") return response(400, { code: "DATABASE_CONTRACT_REJECTED" });
  if (sqlCode === "P0002") return response(404, { code: "REVIEW_OR_DIRECTORY_NOT_FOUND" });
  deps.reportError?.(error);
  return response(503, { code: "ANALYSIS_TEMPORARILY_UNAVAILABLE" });
}
function isAdmin(actor: AuthenticatedActor): boolean { return actor.roles.includes("ADMIN") || actor.roles.includes("MODERATOR"); }

/** GET /api/marketplace/:listingId/deal-analysis?preview=under-review */
export async function handleDealAnalysisRequest(request: Request, deps: ApiDependencies, listingId: string): Promise<Response> {
  if (request.method !== "GET") return response(405, { code: "METHOD_NOT_ALLOWED" }, { Allow: "GET" });
  try {
    const actor = await deps.authenticate(request);
    if (!actor) return response(401, { code: "AUTHENTICATION_REQUIRED" });
    const reviewPreview = new URL(request.url).searchParams.get("preview") === "under-review";
    const result = await deps.database.withSession({ userId: actor.userId, role: "comichuddle_valuator", reviewPreview },
      (db) => analyzeMarketplaceDeal(db, listingId, { asOf: deps.now?.() }));
    return response(200, publicDealAnalysis(result));
  } catch (error) { return errorResponse(error, deps); }
}

/** POST /api/directory/custom. A failed directory search never authorizes a null FK. */
export async function handleCustomDirectoryRequest(request: Request, deps: ApiDependencies): Promise<Response> {
  if (request.method !== "POST") return response(405, { code: "METHOD_NOT_ALLOWED" }, { Allow: "POST" });
  try {
    requireJsonMutation(request,deps);
    const actor = await deps.authenticate(request);
    if (!actor) return response(401, { code: "AUTHENTICATION_REQUIRED" });
    const input = await boundedJsonBody(request,deps) as CustomDirectoryInput;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Expected custom entry object");
    const result = await deps.database.withSession({ userId: actor.userId, role: "comichuddle_collector" },
      (db) => createCustomDirectoryEntry(db, input, actor.userId));
    return response(201, { ...result, quoteState: "CUSTOM_PENDING_REVIEW", purchaseEligible: false });
  } catch (error) { return errorResponse(error, deps); }
}

/** POST /api/admin/directory-reviews/:reviewId/merge. Actor always comes from verified auth. */
export async function handleMergeReviewRequest(request: Request, deps: ApiDependencies, reviewId: string): Promise<Response> {
  if (request.method !== "POST") return response(405, { code: "METHOD_NOT_ALLOWED" }, { Allow: "POST" });
  try {
    requireJsonMutation(request,deps);
    const actor = await deps.authenticate(request);
    if (!actor) return response(401, { code: "AUTHENTICATION_REQUIRED" });
    if (!isAdmin(actor)) return response(403, { code: "NOT_AUTHORIZED" });
    const body = await boundedJsonBody(request,deps) as Omit<MergeCustomEditionInput, "reviewId" | "actorUserId">;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("Expected merge object");
    const input = { ...body, reviewId, actorUserId: actor.userId };
    const result = await deps.database.withSession({ userId: actor.userId, role: "comichuddle_moderator" },
      (db) => mergeCustomEdition(db, input));
    return response(200, result);
  } catch (error) { return errorResponse(error, deps); }
}

/** POST /api/admin/directory-reviews/:reviewId/approve. No price field is consumed. */
export async function handleApproveReviewRequest(request: Request, deps: ApiDependencies, reviewId: string): Promise<Response> {
  if (request.method !== "POST") return response(405, { code: "METHOD_NOT_ALLOWED" }, { Allow: "POST" });
  try {
    requireJsonMutation(request,deps);
    const actor = await deps.authenticate(request);
    if (!actor) return response(401, { code: "AUTHENTICATION_REQUIRED" });
    if (!isAdmin(actor)) return response(403, { code: "NOT_AUTHORIZED" });
    const body = await boundedJsonBody(request,deps) as Omit<ApproveCustomEditionInput, "reviewId" | "actorUserId">;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("Expected approval object");
    const result = await deps.database.withSession({ userId: actor.userId, role: "comichuddle_moderator" },
      (db) => approveCustomEdition(db, { ...body, reviewId, actorUserId: actor.userId }));
    return response(200, result);
  } catch (error) { return errorResponse(error, deps); }
}
