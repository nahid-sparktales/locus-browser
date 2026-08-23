import { Pool, type PoolClient } from "pg";
import type {
  AuthenticatedDevice,
  Enrollment,
  OpaqueSyncRecord,
  PasskeyCeremony,
  PasskeyClaim,
  RegisteredDevice,
  StoredPasskey,
  SyncRepository,
} from "./types.js";

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

  async push(device: AuthenticatedDevice, records: OpaqueSyncRecord[]): Promise<{ cursor: number; accepted: number }> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      let cursor = 0;
      let accepted = 0;
      for (const record of records) {
        if (record.accountId !== device.accountId || record.deviceId !== device.deviceId) throw new Error("Record ownership mismatch");
        const result = await client.query<{ cursor: string }>(`
          INSERT INTO sync_records(account_id, collection, record_id, device_id, clock, nonce, ciphertext, size, tombstone, version)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (account_id, collection, record_id) DO UPDATE SET
            device_id = EXCLUDED.device_id,
            clock = EXCLUDED.clock,
            nonce = EXCLUDED.nonce,
            ciphertext = EXCLUDED.ciphertext,
            size = EXCLUDED.size,
            tombstone = EXCLUDED.tombstone,
            version = EXCLUDED.version,
            cursor = nextval('sync_cursor'),
            updated_at = now()
          WHERE sync_records.clock < EXCLUDED.clock
          RETURNING cursor
        `, [record.accountId, record.collection, record.recordId, record.deviceId, record.clock, record.nonce, record.ciphertext, record.size, record.tombstone, record.version]);
        cursor = Math.max(cursor, Number(result.rows[0]?.cursor ?? 0));
        if (result.rowCount) accepted += 1;
      }
      if (!cursor) cursor = await currentCursor(client);
      await client.query("COMMIT");
      return { cursor, accepted };
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
      record_id: string; clock: string; nonce: string; ciphertext: string; tombstone: boolean; size: number; cursor: string; version: 1;
    }>(`
      SELECT account_id, device_id, collection, record_id, clock, nonce, ciphertext, tombstone, size, cursor, version
      FROM sync_records WHERE account_id = $1 AND cursor > $2 ORDER BY cursor ASC LIMIT $3
    `, [accountId, cursor, limit + 1]);
    const hasMore = result.rows.length > limit;
    const records = result.rows.slice(0, limit).map((row) => ({
      accountId: row.account_id,
      version: row.version,
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

  async createPasskeyCeremony(ceremony: PasskeyCeremony): Promise<void> {
    await this.#pool.query(`
      INSERT INTO passkey_ceremonies(
        id, kind, account_id, user_id, display_name, challenge, options_json,
        device_id, device_public_key, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,to_timestamp($10 / 1000.0))
    `, [
      ceremony.id,
      ceremony.kind,
      ceremony.accountId ?? null,
      ceremony.userId ?? null,
      ceremony.displayName ?? null,
      ceremony.challenge,
      ceremony.optionsJson,
      ceremony.deviceId,
      ceremony.devicePublicKey,
      ceremony.expiresAt,
    ]);
  }

  async passkeyCeremony(id: string): Promise<PasskeyCeremony | undefined> {
    const result = await this.#pool.query<{
      id: string; kind: PasskeyCeremony["kind"]; account_id: string | null; user_id: string | null;
      display_name: string | null; challenge: string; options_json: unknown; device_id: string;
      device_public_key: string; expires_at: Date;
    }>(`
      SELECT id, kind, account_id, user_id, display_name, challenge, options_json,
             device_id, device_public_key, expires_at
      FROM passkey_ceremonies WHERE id=$1 AND expires_at > now()
    `, [id]);
    const row = result.rows[0];
    return row ? {
      id: row.id,
      kind: row.kind,
      ...(row.account_id ? { accountId: row.account_id } : {}),
      ...(row.user_id ? { userId: row.user_id } : {}),
      ...(row.display_name ? { displayName: row.display_name } : {}),
      challenge: row.challenge,
      optionsJson: JSON.stringify(row.options_json),
      deviceId: row.device_id,
      devicePublicKey: row.device_public_key,
      expiresAt: row.expires_at.getTime(),
    } : undefined;
  }

  async consumePasskeyCeremony(id: string, kind: PasskeyCeremony["kind"]): Promise<PasskeyCeremony | undefined> {
    const result = await this.#pool.query<{
      id: string; kind: PasskeyCeremony["kind"]; account_id: string | null; user_id: string | null;
      display_name: string | null; challenge: string; options_json: unknown; device_id: string;
      device_public_key: string; expires_at: Date;
    }>(`
      DELETE FROM passkey_ceremonies
      WHERE id=$1 AND kind=$2 AND expires_at > now()
      RETURNING id, kind, account_id, user_id, display_name, challenge, options_json,
                device_id, device_public_key, expires_at
    `, [id, kind]);
    const row = result.rows[0];
    return row ? {
      id: row.id,
      kind: row.kind,
      ...(row.account_id ? { accountId: row.account_id } : {}),
      ...(row.user_id ? { userId: row.user_id } : {}),
      ...(row.display_name ? { displayName: row.display_name } : {}),
      challenge: row.challenge,
      optionsJson: JSON.stringify(row.options_json),
      deviceId: row.device_id,
      devicePublicKey: row.device_public_key,
      expiresAt: row.expires_at.getTime(),
    } : undefined;
  }

  async createAccountWithPasskey(accountId: string, passkey: StoredPasskey, device: RegisteredDevice): Promise<void> {
    if (passkey.accountId !== accountId || device.accountId !== accountId) throw new Error("Passkey account mismatch");
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO accounts(id) VALUES ($1)", [accountId]);
      await client.query(`
        INSERT INTO passkeys(credential_id, account_id, user_id, public_key, counter, device_type, backed_up, transports)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      `, [
        passkey.credentialId,
        accountId,
        passkey.userId,
        passkey.publicKey,
        passkey.counter,
        passkey.deviceType,
        passkey.backedUp,
        JSON.stringify(passkey.transports),
      ]);
      await client.query(`
        INSERT INTO devices(id, account_id, public_key, token_hash)
        VALUES ($1,$2,$3,$4)
      `, [device.deviceId, accountId, device.publicKey, device.tokenHash]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async passkey(credentialId: string): Promise<StoredPasskey | undefined> {
    const result = await this.#pool.query<{
      credential_id: string; account_id: string; user_id: string; public_key: string;
      counter: string; device_type: string; backed_up: boolean; transports: string[];
    }>(`
      SELECT credential_id, account_id, user_id, public_key, counter, device_type, backed_up, transports
      FROM passkeys WHERE credential_id=$1
    `, [credentialId]);
    const row = result.rows[0];
    return row ? {
      credentialId: row.credential_id,
      accountId: row.account_id,
      userId: row.user_id,
      publicKey: row.public_key,
      counter: Number(row.counter),
      deviceType: row.device_type,
      backedUp: row.backed_up,
      transports: row.transports,
    } : undefined;
  }

  async authenticateWithPasskey(credentialId: string, counter: number, device: RegisteredDevice): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(`
        UPDATE passkeys SET counter=$1, last_used_at=now()
        WHERE credential_id=$2 AND account_id=$3 RETURNING credential_id
      `, [counter, credentialId, device.accountId]);
      if (!updated.rowCount) throw new Error("Passkey is unavailable");
      const inserted = await client.query(`
        INSERT INTO devices(id, account_id, public_key, token_hash)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (id) DO UPDATE SET
          public_key=EXCLUDED.public_key, token_hash=EXCLUDED.token_hash, revoked_at=NULL
        WHERE devices.account_id=EXCLUDED.account_id
        RETURNING id
      `, [device.deviceId, device.accountId, device.publicKey, device.tokenHash]);
      if (!inserted.rowCount) throw new Error("Device identity collision");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createPasskeyClaim(claim: PasskeyClaim): Promise<void> {
    await this.#pool.query(`
      INSERT INTO passkey_claims(id, code_hash, account_id, device_id, device_token, expires_at)
      VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0))
    `, [claim.id, claim.codeHash, claim.accountId, claim.deviceId, claim.deviceToken, claim.expiresAt]);
  }

  async cleanupExpired(now: number): Promise<void> {
    const timestamp = new Date(now);
    await this.#pool.query("DELETE FROM device_enrollments WHERE expires_at < $1", [timestamp]);
    await this.#pool.query("DELETE FROM passkey_ceremonies WHERE expires_at < $1", [timestamp]);
    await this.#pool.query("DELETE FROM passkey_claims WHERE expires_at < $1", [timestamp]);
    await this.#pool.query("DELETE FROM sync_records WHERE tombstone=true AND updated_at < $1", [new Date(now - 90 * 24 * 60 * 60 * 1_000)]);
  }

  async takePasskeyClaim(id: string, codeHash: string) {
    const result = await this.#pool.query<{ account_id: string; device_id: string; device_token: string }>(`
      DELETE FROM passkey_claims
      WHERE id=$1 AND code_hash=$2 AND expires_at > now()
      RETURNING account_id, device_id, device_token
    `, [id, codeHash]);
    const row = result.rows[0];
    return row ? { accountId: row.account_id, deviceId: row.device_id, deviceToken: row.device_token } : undefined;
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
