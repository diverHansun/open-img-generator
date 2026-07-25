import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyPrivateDirectoryPermissions,
  applyPrivateFilePermissions,
} from '../runtime-paths/preflight.js';
import { getCredentialsFilePath, getUserConfigDirectory } from './paths';
import type { ProviderCredentialName, StoredCredentials } from './types';

type EncryptedEnvelope = {
  version: 1;
  algorithm: 'aes-256-gcm';
  kdf: 'scrypt';
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

const KNOWN_KEYS = new Set<ProviderCredentialName>([
  'FAL_KEY',
  'ZENMUX_API_KEY',
  'SILICONFLOW_API_KEY',
  'ZHIPU_API_KEY',
  'ARK_API_KEY',
  'DASHSCOPE_API_KEY',
]);

// Ignore the retired provider key when loading existing encrypted stores so
// users can continue using their remaining credentials after this upgrade.
const RETIRED_CREDENTIAL_KEYS = new Set(['KLING_API_KEY']);

function getMasterSecret(): string {
  const secret = process.env.USER_CONFIG_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('USER_CONFIG_ENCRYPTION_KEY is required for encrypted credentials');
  }
  return secret;
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, 32);
}

export function normalizeCredentials(value: unknown): StoredCredentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Encrypted credentials payload must be an object');
  }
  const result: StoredCredentials = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (RETIRED_CREDENTIAL_KEYS.has(key)) continue;
    if (!KNOWN_KEYS.has(key as ProviderCredentialName)) {
      throw new Error(`Unknown provider credential: ${key}`);
    }
    if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
      throw new Error(`Provider credential ${key} must be a non-empty string`);
    }
    result[key as ProviderCredentialName] = rawValue;
  }
  return result;
}

function parseEnvelope(raw: string): EncryptedEnvelope {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid credential envelope');
  const envelope = parsed as Partial<EncryptedEnvelope>;
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== 'aes-256-gcm' ||
    envelope.kdf !== 'scrypt' ||
    typeof envelope.salt !== 'string' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.tag !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw new Error('Unsupported credential envelope');
  }
  return envelope as EncryptedEnvelope;
}

export function readEncryptedCredentials(): StoredCredentials {
  const filePath = getCredentialsFilePath();
  if (!fs.existsSync(filePath)) return {};
  const envelope = parseEnvelope(fs.readFileSync(filePath, 'utf8'));
  const key = deriveKey(getMasterSecret(), Buffer.from(envelope.salt, 'base64'));
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return normalizeCredentials(JSON.parse(plaintext));
}

export function writeEncryptedCredentials(credentials: StoredCredentials): void {
  const normalized = normalizeCredentials(credentials);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(getMasterSecret(), salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(normalized), 'utf8'),
    cipher.final(),
  ]);
  const envelope: EncryptedEnvelope = {
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };

  const directory = getUserConfigDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  applyPrivateDirectoryPermissions(directory);
  const filePath = getCredentialsFilePath();
  const tempPath = path.join(
    directory,
    `.credentials.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(envelope)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    applyPrivateFilePermissions(tempPath);
    fs.renameSync(tempPath, filePath);
    applyPrivateFilePermissions(filePath);
  } finally {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best-effort cleanup of an interrupted atomic write.
    }
  }
}
