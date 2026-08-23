import { Pool, type PoolClient } from "pg";
import { OpaqueRecordStorage, type OpaqueBlobStore, type StoredOpaquePayload } from "./opaqueRecordStorage.js";
import type {
  AccountKeyWrap,
  AuthenticatedDevice,
  Enrollment,
  OpaqueSyncRecord,
  PasskeyCeremony,
  PasskeyClaim,
  RegisteredDevice,
  StoredPasskey,
  SyncDevice,
  SyncRepository,
} from "./types.js";

export class PostgresSyncRepository implements SyncRepository {
  readonly #pool: Pool;
  readonly #recordStorage: OpaqueRecordStorage;

  constructor(connectionString: string, blobStore?: OpaqueBlobStore) {
    this.#pool = new Pool({ connectionString, max: 12, idleTimeoutMillis: 30_000, statement_timeout: 10_000 });
    this.#recordStorage = new OpaqueRecordStorage(blobStore);
  }

  async bootstrap(tokenHash: string, device: AuthenticatedDevice): Promise<void> {
    await this.#pool.query(`
      INSERT INTO accounts(id, key_version) VALUES ($1, 1)
      ON CONFLICT (id) DO UPDATE SET key_version=GREATEST(accounts.key_version, 1)
    `, [device.accountId]);
    await this.#pool.query(`
      INSERT INTO devices(id, account_id, name, public_key, token_hash, key_version)
      VALUES ($1, $2, 'Development device', 'development-bootstrap', $3, 1)
      ON CONFLICT (id) DO UPDATE SET token_hash = EXCLUDED.token_hash, revoked_at = NULL, last_seen_at=now()
    `, [device.deviceId, device.accountId, tokenHash]);
  }

  async authenticate(tokenHash: string): Promise<AuthenticatedDevice | undefined> {
    const result = await this.#pool.query<{ account_id: string; id: string }>(
      "UPDATE devices SET last_seen_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING account_id, id",
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? { accountId: row.account_id, deviceId: row.id } : undefined;
  }

  async push(device: AuthenticatedDevice, keyVersion: number, records: OpaqueSyncRecord[]): Promise<{ cursor: number; accepted: number }> {
    if (records.some((record) => record.accountId !== device.accountId || record.deviceId !== device.deviceId)) {
      throw new Error("Record ownership mismatch");
    }
    const staged = await this.#recordStorage.stageBatch(records);
    const discardOnFailure = staged.map((payload) => payload.objectKey);
    const discardAfterCommit: Array<string | null> = [];
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query<{ key_version: number }>("SELECT key_version FROM accounts WHERE id=$1 FOR SHARE", [device.accountId]);
      if (account.rows[0]?.key_version !== keyVersion) throw new Error("Sync account key version changed");
      let cursor = 0;
      let accepted = 0;
      for (const [index, record] of records.entries()) {
        const payload = staged[index]!;
        const previous = await client.query<{ object_key: string | null }>(`
          SELECT object_key FROM sync_records WHERE account_id=$1 AND collection=$2 AND record_id=$3
        `, [record.accountId, record.collection, record.recordId]);
        const result = await client.query<{ cursor: string }>(`
          INSERT INTO sync_records(account_id, collection, record_id, device_id, clock, nonce, ciphertext, object_key, size, tombstone, version)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (account_id, collection, record_id) DO UPDATE SET
            device_id = EXCLUDED.device_id,
            clock = EXCLUDED.clock,
            nonce = EXCLUDED.nonce,
            ciphertext = EXCLUDED.ciphertext,
            object_key = EXCLUDED.object_key,
            size = EXCLUDED.size,
            tombstone = EXCLUDED.tombstone,
            version = EXCLUDED.version,
            cursor = nextval('sync_cursor'),
            updated_at = now()
          WHERE sync_records.clock < EXCLUDED.clock
          RETURNING cursor
        `, [record.accountId, record.collection, record.recordId, record.deviceId, record.clock, record.nonce,
          payload.ciphertext, payload.objectKey, record.size, record.tombstone, record.version]);
        cursor = Math.max(cursor, Number(result.rows[0]?.cursor ?? 0));
        if (result.rowCount) {
          accepted += 1;
          const previousKey = previous.rows[0]?.object_key;
          if (previousKey && previousKey !== payload.objectKey) discardAfterCommit.push(previousKey);
        } else if (payload.objectKey) {
          discardAfterCommit.push(payload.objectKey);
        }
      }
      if (!cursor) cursor = await currentCursor(client);
      await client.query("COMMIT");
      await this.#recordStorage.discard(discardAfterCommit).catch(() => undefined);
      return { cursor, accepted };
    } catch (error) {
      await client.query("ROLLBACK");
      await this.#recordStorage.discard(discardOnFailure).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async pull(accountId: string, cursor: number, limit: number) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
      account_id: string; device_id: string; collection: OpaqueSyncRecord["collection"];
      record_id: string; clock: string; nonce: string; ciphertext: string | null; object_key: string | null;
      tombstone: boolean; size: number; cursor: string; version: 1;
    }>(`
      SELECT account_id, device_id, collection, record_id, clock, nonce, ciphertext, object_key, tombstone, size, cursor, version
      FROM sync_records WHERE account_id = $1 AND cursor > $2 ORDER BY cursor ASC LIMIT $3 FOR SHARE
    `, [accountId, cursor, limit + 1]);
      const hasMore = result.rows.length > limit;
      const records = await Promise.all(result.rows.slice(0, limit).map(async (row) => {
        const ciphertext = await this.#recordStorage.hydrate(storedPayload(row));
        if (Buffer.byteLength(ciphertext, "base64url") !== row.size) throw new Error("Opaque sync object size mismatch");
        return {
          accountId: row.account_id,
          version: row.version,
          deviceId: row.device_id,
          collection: row.collection,
          recordId: row.record_id,
          clock: row.clock,
          nonce: row.nonce,
          ciphertext,
          tombstone: row.tombstone,
          size: row.size,
          cursor: Number(row.cursor),
        };
      }));
      await client.query("COMMIT");
      return { records, cursor: records.at(-1)?.cursor ?? cursor, hasMore };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createEnrollment(enrollment: Enrollment): Promise<void> {
    await this.#pool.query(`
      INSERT INTO device_enrollments(id, device_id, device_name, public_key, code_hash, expires_at)
      VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0))
    `, [enrollment.id, enrollment.deviceId, enrollment.deviceName, enrollment.publicKey, enrollment.codeHash, enrollment.expiresAt]);
  }

  async enrollmentDetails(enrollmentId: string, codeHash: string) {
    const result = await this.#pool.query<{
      device_id: string; device_name: string; public_key: string; expires_at: Date;
    }>(`
      SELECT device_id, device_name, public_key, expires_at FROM device_enrollments
      WHERE id=$1 AND code_hash=$2 AND expires_at>now() AND claimed_at IS NULL
        AND wrapped_account_key IS NULL
    `, [enrollmentId, codeHash]);
    const row = result.rows[0];
    return row ? { deviceId: row.device_id, deviceName: row.device_name, publicKey: row.public_key, expiresAt: row.expires_at.getTime() } : undefined;
  }

  async approveEnrollment(accountId: string, enrollmentId: string, codeHash: string, wrappedAccountKey: string, deviceToken: string, tokenHash: string): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query<{ key_version: number }>("SELECT key_version FROM accounts WHERE id=$1 FOR UPDATE", [accountId]);
      const keyVersion = account.rows[0]?.key_version ?? 0;
      if (!keyVersion) throw new Error("Sync account key is not initialized");
      const enrollment = await client.query<{ device_id: string; device_name: string; public_key: string }>(`
        UPDATE device_enrollments SET account_id=$1, wrapped_account_key=$2, device_token=$3, token_hash=$4
        WHERE id=$5 AND code_hash=$6 AND account_id IS NULL AND expires_at > now() AND claimed_at IS NULL
        RETURNING device_id, device_name, public_key
      `, [accountId, wrappedAccountKey, deviceToken, tokenHash, enrollmentId, codeHash]);
      const row = enrollment.rows[0];
      if (!row) throw new Error("Enrollment is unavailable");
      const inserted = await client.query(`
        INSERT INTO devices(id, account_id, name, public_key, token_hash, wrapped_account_key, key_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, public_key=EXCLUDED.public_key,
          token_hash=EXCLUDED.token_hash, wrapped_account_key=EXCLUDED.wrapped_account_key,
          key_version=EXCLUDED.key_version, revoked_at=NULL, last_seen_at=now()
        WHERE devices.account_id=EXCLUDED.account_id
        RETURNING id
      `, [row.device_id, accountId, row.device_name, row.public_key, tokenHash, wrappedAccountKey, keyVersion]);
      if (!inserted.rowCount) throw new Error("Device identity collision");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async takeEnrollment(enrollmentId: string, codeHash: string) {
    const result = await this.#pool.query<{
      account_id: string; device_id: string; wrapped_account_key: string; device_token: string; key_version: number;
    }>(`
      UPDATE device_enrollments SET claimed_at=now()
      WHERE id=$1 AND code_hash=$2 AND expires_at > now() AND claimed_at IS NULL
        AND account_id IS NOT NULL AND wrapped_account_key IS NOT NULL AND device_token IS NOT NULL
      RETURNING account_id, device_id, wrapped_account_key, device_token,
        (SELECT key_version FROM accounts WHERE id=device_enrollments.account_id) AS key_version
    `, [enrollmentId, codeHash]);
    const row = result.rows[0];
    return row ? {
      accountId: row.account_id,
      deviceId: row.device_id,
      wrappedAccountKey: row.wrapped_account_key,
      deviceToken: row.device_token,
      keyVersion: row.key_version,
    } : undefined;
  }

  async createPasskeyCeremony(ceremony: PasskeyCeremony): Promise<void> {
    await this.#pool.query(`
      INSERT INTO passkey_ceremonies(
        id, kind, account_id, user_id, display_name, challenge, options_json,
        device_id, device_name, device_public_key, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,to_timestamp($11 / 1000.0))
    `, [
      ceremony.id,
      ceremony.kind,
      ceremony.accountId ?? null,
      ceremony.userId ?? null,
      ceremony.displayName ?? null,
      ceremony.challenge,
      ceremony.optionsJson,
      ceremony.deviceId,
      ceremony.deviceName,
      ceremony.devicePublicKey,
      ceremony.expiresAt,
    ]);
  }

  async passkeyCeremony(id: string): Promise<PasskeyCeremony | undefined> {
    const result = await this.#pool.query<{
      id: string; kind: PasskeyCeremony["kind"]; account_id: string | null; user_id: string | null;
      display_name: string | null; challenge: string; options_json: unknown; device_id: string; device_name: string;
      device_public_key: string; expires_at: Date;
    }>(`
      SELECT id, kind, account_id, user_id, display_name, challenge, options_json,
             device_id, device_name, device_public_key, expires_at
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
      deviceName: row.device_name,
      devicePublicKey: row.device_public_key,
      expiresAt: row.expires_at.getTime(),
    } : undefined;
  }

  async consumePasskeyCeremony(id: string, kind: PasskeyCeremony["kind"]): Promise<PasskeyCeremony | undefined> {
    const result = await this.#pool.query<{
      id: string; kind: PasskeyCeremony["kind"]; account_id: string | null; user_id: string | null;
      display_name: string | null; challenge: string; options_json: unknown; device_id: string; device_name: string;
      device_public_key: string; expires_at: Date;
    }>(`
      DELETE FROM passkey_ceremonies
      WHERE id=$1 AND kind=$2 AND expires_at > now()
      RETURNING id, kind, account_id, user_id, display_name, challenge, options_json,
                device_id, device_name, device_public_key, expires_at
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
      deviceName: row.device_name,
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
        INSERT INTO devices(id, account_id, name, public_key, token_hash, wrapped_account_key, key_version, created_at, last_seen_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8 / 1000.0),to_timestamp($9 / 1000.0))
      `, [device.deviceId, accountId, device.name, device.publicKey, device.tokenHash,
        device.wrappedAccountKey ?? null, device.keyVersion, device.createdAt, device.lastSeenAt]);
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
        INSERT INTO devices(id, account_id, name, public_key, token_hash, wrapped_account_key, key_version, created_at, last_seen_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8 / 1000.0),to_timestamp($9 / 1000.0))
        ON CONFLICT (id) DO UPDATE SET
          name=EXCLUDED.name, public_key=EXCLUDED.public_key, token_hash=EXCLUDED.token_hash,
          wrapped_account_key=EXCLUDED.wrapped_account_key, key_version=EXCLUDED.key_version,
          revoked_at=NULL, last_seen_at=EXCLUDED.last_seen_at
        WHERE devices.account_id=EXCLUDED.account_id
        RETURNING id
      `, [device.deviceId, device.accountId, device.name, device.publicKey, device.tokenHash,
        device.wrappedAccountKey ?? null, device.keyVersion, device.createdAt, device.lastSeenAt]);
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

  async listDevices(accountId: string): Promise<SyncDevice[]> {
    const result = await this.#pool.query<{
      id: string; name: string; public_key: string; key_version: number; created_at_ms: string; last_seen_at_ms: string;
    }>(`
      SELECT id, name, public_key, key_version,
        floor(extract(epoch FROM created_at) * 1000)::bigint AS created_at_ms,
        floor(extract(epoch FROM last_seen_at) * 1000)::bigint AS last_seen_at_ms
      FROM devices WHERE account_id=$1 AND revoked_at IS NULL
      ORDER BY last_seen_at DESC, created_at DESC
    `, [accountId]);
    return result.rows.map((row) => ({
      deviceId: row.id,
      name: row.name,
      publicKey: row.public_key,
      keyVersion: row.key_version,
      createdAt: Number(row.created_at_ms),
      lastSeenAt: Number(row.last_seen_at_ms),
    }));
  }

  async accountKeyState(accountId: string, deviceId: string): Promise<{ version: number; wrappedAccountKey?: string }> {
    const result = await this.#pool.query<{ key_version: number; wrapped_account_key: string | null; device_key_version: number }>(`
      SELECT accounts.key_version, devices.wrapped_account_key, devices.key_version AS device_key_version
      FROM accounts JOIN devices ON devices.account_id=accounts.id
      WHERE accounts.id=$1 AND devices.id=$2 AND devices.revoked_at IS NULL
    `, [accountId, deviceId]);
    const row = result.rows[0];
    if (!row) throw new Error("Device is unavailable");
    return {
      version: row.key_version,
      ...(row.device_key_version === row.key_version && row.wrapped_account_key ? { wrappedAccountKey: row.wrapped_account_key } : {}),
    };
  }

  async initializeAccountKey(accountId: string, expectedVersion: number, version: number, wraps: AccountKeyWrap[]): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query<{ key_version: number }>("SELECT key_version FROM accounts WHERE id=$1 FOR UPDATE", [accountId]);
      if (account.rows[0]?.key_version !== expectedVersion || version !== expectedVersion + 1) throw new Error("Sync account key version changed");
      const devices = await activeDeviceIds(client, accountId);
      assertCompleteWrapSet(devices, wraps);
      for (const wrap of wraps) await client.query(`
        UPDATE devices SET wrapped_account_key=$1, key_version=$2
        WHERE account_id=$3 AND id=$4 AND revoked_at IS NULL
      `, [wrap.wrappedAccountKey, version, accountId, wrap.deviceId]);
      await client.query("UPDATE accounts SET key_version=$1 WHERE id=$2", [version, accountId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setDeviceWrappedKey(accountId: string, deviceId: string, version: number, wrappedAccountKey: string): Promise<void> {
    const result = await this.#pool.query(`
      UPDATE devices SET wrapped_account_key=$1, key_version=$2
      WHERE account_id=$3 AND id=$4 AND revoked_at IS NULL
        AND $2=(SELECT key_version FROM accounts WHERE id=$3)
    `, [wrappedAccountKey, version, accountId, deviceId]);
    if (!result.rowCount) throw new Error("Sync account key version changed");
  }

  async rotateAccountKey(device: AuthenticatedDevice, expectedVersion: number, version: number, wraps: AccountKeyWrap[], records: OpaqueSyncRecord[]): Promise<{ cursor: number }> {
    if (records.some((record) => record.accountId !== device.accountId || record.deviceId !== device.deviceId)) throw new Error("Record ownership mismatch");
    const staged = await this.#recordStorage.stageBatch(records);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query<{ key_version: number }>("SELECT key_version FROM accounts WHERE id=$1 FOR UPDATE", [device.accountId]);
      if (account.rows[0]?.key_version !== expectedVersion || version !== expectedVersion + 1) throw new Error("Sync account key version changed");
      const devices = await activeDeviceIds(client, device.accountId);
      assertCompleteWrapSet(devices, wraps);
      const existing = await client.query<{ collection: string; record_id: string; object_key: string | null }>(
        "SELECT collection, record_id, object_key FROM sync_records WHERE account_id=$1 FOR UPDATE",
        [device.accountId],
      );
      const existingKeys = new Set(existing.rows.map((record) => `${record.collection}:${record.record_id}`));
      const replacementKeys = new Set(records.map((record) => `${record.collection}:${record.recordId}`));
      if (replacementKeys.size !== records.length || existingKeys.size !== replacementKeys.size || [...existingKeys].some((key) => !replacementKeys.has(key))) {
        throw new Error("Key rotation must replace every sync record");
      }
      await client.query("DELETE FROM sync_records WHERE account_id=$1", [device.accountId]);
      let cursor = 0;
      for (const [index, record] of records.entries()) {
        const payload = staged[index]!;
        const inserted = await client.query<{ cursor: string }>(`
          INSERT INTO sync_records(account_id, collection, record_id, device_id, clock, nonce, ciphertext, object_key, size, tombstone, version)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING cursor
        `, [record.accountId, record.collection, record.recordId, record.deviceId, record.clock,
          record.nonce, payload.ciphertext, payload.objectKey, record.size, record.tombstone, record.version]);
        cursor = Math.max(cursor, Number(inserted.rows[0]?.cursor ?? 0));
      }
      for (const wrap of wraps) await client.query(`
        UPDATE devices SET wrapped_account_key=$1, key_version=$2
        WHERE account_id=$3 AND id=$4 AND revoked_at IS NULL
      `, [wrap.wrappedAccountKey, version, device.accountId, wrap.deviceId]);
      await client.query("UPDATE accounts SET key_version=$1 WHERE id=$2", [version, device.accountId]);
      await client.query("COMMIT");
      await this.#recordStorage.discard(existing.rows.map((row) => row.object_key)).catch(() => undefined);
      return { cursor };
    } catch (error) {
      await client.query("ROLLBACK");
      await this.#recordStorage.discard(staged.map((payload) => payload.objectKey)).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeDevice(accountId: string, deviceId: string): Promise<void> {
    await this.#pool.query("UPDATE devices SET revoked_at=now() WHERE account_id=$1 AND id=$2", [accountId, deviceId]);
  }

  async deleteCloudData(accountId: string): Promise<void> {
    const objectKeys = await this.#deleteRecordsWithAccountLock(accountId, false);
    await this.#recordStorage.discard(objectKeys).catch(() => undefined);
  }

  async deleteAccount(accountId: string): Promise<void> {
    const objectKeys = await this.#deleteRecordsWithAccountLock(accountId, true);
    await this.#recordStorage.discard(objectKeys).catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #deleteRecordsWithAccountLock(accountId: string, deleteAccount: boolean): Promise<Array<string | null>> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [accountId]);
      const existing = await client.query<{ object_key: string | null }>("SELECT object_key FROM sync_records WHERE account_id=$1", [accountId]);
      if (deleteAccount) {
        await client.query("UPDATE accounts SET deleted_at=now() WHERE id=$1", [accountId]);
        await client.query("DELETE FROM accounts WHERE id=$1", [accountId]);
      } else {
        await client.query("DELETE FROM sync_records WHERE account_id=$1", [accountId]);
      }
      await client.query("COMMIT");
      return existing.rows.map((row) => row.object_key);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function storedPayload(row: { ciphertext: string | null; object_key: string | null }): StoredOpaquePayload {
  return { ciphertext: row.ciphertext, objectKey: row.object_key };
}

async function currentCursor(client: PoolClient): Promise<number> {
  const result = await client.query<{ cursor: string }>("SELECT last_value AS cursor FROM sync_cursor");
  return Number(result.rows[0]?.cursor ?? 0);
}

async function activeDeviceIds(client: PoolClient, accountId: string): Promise<string[]> {
  const result = await client.query<{ id: string }>("SELECT id FROM devices WHERE account_id=$1 AND revoked_at IS NULL ORDER BY id FOR UPDATE", [accountId]);
  return result.rows.map((row) => row.id);
}

function assertCompleteWrapSet(deviceIds: string[], wraps: AccountKeyWrap[]): void {
  const wrapIds = new Set(wraps.map((wrap) => wrap.deviceId));
  if (wrapIds.size !== wraps.length || deviceIds.length !== wrapIds.size || deviceIds.some((id) => !wrapIds.has(id))) {
    throw new Error("Every active device requires exactly one wrapped account key");
  }
}
