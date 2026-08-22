import { Pool, type PoolClient } from "pg";
import type { AuthenticatedDevice, Enrollment, OpaqueSyncRecord, SyncRepository } from "./types.js";

export class PostgresSyncRepository implements SyncRepository {
  readonly #pool: Pool;

  constructor(connectionString: string) {
    this.#pool = new Pool({ connectionString, max: 12, idleTimeoutMillis: 30_000, statement_timeout: 10_000 });
  }

  async bootstrap(tokenHash: string, device: AuthenticatedDevice): Promise<void> {
    await this.#pool.query("INSERT INTO accounts(id) VALUES ($1) ON CONFLICT DO NOTHING", [device.accountId]);
    await this.#pool.query(`
      INSERT INTO devices(id, account_id, public_key, token_hash)
      VALUES ($1, $2, 'development-bootstrap', $3)
      ON CONFLICT (id) DO UPDATE SET token_hash = EXCLUDED.token_hash, revoked_at = NULL
    `, [device.deviceId, device.accountId, tokenHash]);
  }

  async authenticate(tokenHash: string): Promise<AuthenticatedDevice | undefined> {
    const result = await this.#pool.query<{ account_id: string; id: string }>(
      "SELECT account_id, id FROM devices WHERE token_hash = $1 AND revoked_at IS NULL",
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? { accountId: row.account_id, deviceId: row.id } : undefined;
  }

  async push(device: AuthenticatedDevice, records: OpaqueSyncRecord[]): Promise<number> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      let cursor = 0;
      for (const record of records) {
        if (record.accountId !== device.accountId || record.deviceId !== device.deviceId) throw new Error("Record ownership mismatch");
        const result = await client.query<{ cursor: string }>(`
          INSERT INTO sync_records(account_id, collection, record_id, device_id, clock, nonce, ciphertext, size, tombstone)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (account_id, collection, record_id) DO UPDATE SET
            device_id = EXCLUDED.device_id,
            clock = EXCLUDED.clock,
            nonce = EXCLUDED.nonce,
            ciphertext = EXCLUDED.ciphertext,
            size = EXCLUDED.size,
            tombstone = EXCLUDED.tombstone,
            cursor = nextval('sync_cursor'),
            updated_at = now()
          WHERE sync_records.clock < EXCLUDED.clock
          RETURNING cursor
        `, [record.accountId, record.collection, record.recordId, record.deviceId, record.clock, record.nonce, record.ciphertext, record.size, record.tombstone]);
        cursor = Math.max(cursor, Number(result.rows[0]?.cursor ?? 0));
      }
      if (!cursor) cursor = await currentCursor(client);
      await client.query("COMMIT");
      return cursor;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async pull(accountId: string, cursor: number, limit: number) {
    const result = await this.#pool.query<{
      account_id: string; device_id: string; collection: OpaqueSyncRecord["collection"];
      record_id: string; clock: string; nonce: string; ciphertext: string; tombstone: boolean; size: number; cursor: string;
    }>(`
      SELECT account_id, device_id, collection, record_id, clock, nonce, ciphertext, tombstone, size, cursor
      FROM sync_records WHERE account_id = $1 AND cursor > $2 ORDER BY cursor ASC LIMIT $3
    `, [accountId, cursor, limit + 1]);
    const hasMore = result.rows.length > limit;
    const records = result.rows.slice(0, limit).map((row) => ({
      accountId: row.account_id,
      deviceId: row.device_id,
      collection: row.collection,
      recordId: row.record_id,
      clock: row.clock,
      nonce: row.nonce,
      ciphertext: row.ciphertext,
      tombstone: row.tombstone,
      size: row.size,
      cursor: Number(row.cursor),
    }));
    return { records, cursor: records.at(-1)?.cursor ?? cursor, hasMore };
  }

  async createEnrollment(enrollment: Enrollment): Promise<void> {
    await this.#pool.query(`
      INSERT INTO device_enrollments(id, account_id, device_id, public_key, code_hash, expires_at)
      VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0))
    `, [enrollment.id, enrollment.accountId, enrollment.deviceId, enrollment.publicKey, enrollment.codeHash, enrollment.expiresAt]);
  }

  async approveEnrollment(accountId: string, enrollmentId: string, wrappedAccountKey: string, deviceToken: string, tokenHash: string): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const enrollment = await client.query<{ device_id: string; public_key: string }>(`
        UPDATE device_enrollments SET wrapped_account_key=$1, device_token=$2, token_hash=$3
        WHERE id=$4 AND account_id=$5 AND expires_at > now() AND claimed_at IS NULL
        RETURNING device_id, public_key
      `, [wrappedAccountKey, deviceToken, tokenHash, enrollmentId, accountId]);
      const row = enrollment.rows[0];
      if (!row) throw new Error("Enrollment is unavailable");
      await client.query(`
        INSERT INTO devices(id, account_id, public_key, token_hash)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (id) DO UPDATE SET public_key=EXCLUDED.public_key, token_hash=EXCLUDED.token_hash, revoked_at=NULL
      `, [row.device_id, accountId, row.public_key, tokenHash]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async takeEnrollment(enrollmentId: string, codeHash: string) {
    const result = await this.#pool.query<{ wrapped_account_key: string; device_token: string }>(`
      UPDATE device_enrollments SET claimed_at=now()
      WHERE id=$1 AND code_hash=$2 AND expires_at > now() AND claimed_at IS NULL
        AND wrapped_account_key IS NOT NULL AND device_token IS NOT NULL
      RETURNING wrapped_account_key, device_token
    `, [enrollmentId, codeHash]);
    const row = result.rows[0];
    return row ? { wrappedAccountKey: row.wrapped_account_key, deviceToken: row.device_token } : undefined;
  }

  async revokeDevice(accountId: string, deviceId: string): Promise<void> {
    await this.#pool.query("UPDATE devices SET revoked_at=now() WHERE account_id=$1 AND id=$2", [accountId, deviceId]);
  }

  async deleteCloudData(accountId: string): Promise<void> {
    await this.#pool.query("DELETE FROM sync_records WHERE account_id=$1", [accountId]);
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.#pool.query("UPDATE accounts SET deleted_at=now() WHERE id=$1", [accountId]);
    await this.#pool.query("DELETE FROM accounts WHERE id=$1", [accountId]);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

async function currentCursor(client: PoolClient): Promise<number> {
  const result = await client.query<{ cursor: string }>("SELECT last_value AS cursor FROM sync_cursor");
  return Number(result.rows[0]?.cursor ?? 0);
}
