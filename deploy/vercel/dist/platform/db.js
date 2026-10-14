export class DomainError extends Error {
    code;
    httpStatus;
    constructor(code, message, httpStatus = 409) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.name = 'DomainError';
    }
}
export async function serializable(pool, work) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const db = await pool.connect();
        try {
            await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
            await db.query("SET LOCAL search_path = ch_platform, pg_catalog");
            await db.query("SET LOCAL statement_timeout = '10s'");
            const value = await work(db);
            await db.query('COMMIT');
            return value;
        }
        catch (error) {
            await db.query('ROLLBACK').catch(() => undefined);
            const code = error.code;
            if (!['40001', '40P01'].includes(code || '') || attempt === 3)
                throw error;
        }
        finally {
            db.release();
        }
        await new Promise(resolve => setTimeout(resolve, 20 * (2 ** attempt) + Math.floor(Math.random() * 15)));
    }
    throw new DomainError('transaction_retry_exhausted', 'Reload and retry.');
}
export async function sha256(value) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function canonicalJson(value) {
    if (typeof value === 'bigint')
        return JSON.stringify(value.toString());
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return '[' + value.map(canonicalJson).join(',') + ']';
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
}
export async function once(db, key, kind, input, work) {
    if (key.length < 8 || key.length > 180)
        throw new DomainError('bad_operation_key', 'An operation key of 8–180 characters is required.', 400);
    const hash = await sha256(canonicalJson(input));
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
    const prior = (await db.query('SELECT * FROM ch_platform.operation_requests WHERE key=$1', [key])).rows[0];
    if (prior) {
        if (prior.request_hash !== hash || prior.kind !== kind)
            throw new DomainError('operation_key_reused', 'Operation key was already used for different input.');
        if (prior.result === null)
            throw new DomainError('operation_incomplete', 'Reconcile the existing operation.');
        return prior.result;
    }
    await db.query('INSERT INTO ch_platform.operation_requests(key,kind,request_hash) VALUES($1,$2,$3)', [key, kind, hash]);
    const result = await work();
    await db.query('UPDATE ch_platform.operation_requests SET result=$2::jsonb WHERE key=$1', [key, canonicalJson(result)]);
    return result;
}
export async function outbox(db, kind, aggregateId, key, payload) {
    await db.query('INSERT INTO ch_platform.outbox_jobs(kind,aggregate_id,operation_key,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(operation_key) DO NOTHING', [kind, aggregateId, key, canonicalJson(payload)]);
}
