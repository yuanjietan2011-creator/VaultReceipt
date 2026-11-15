import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import type { ExtractedReceiptFields, ReceiptRecord } from './src/types/receipt.ts';

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.cwd(), '.vault-data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const MASTER_KEY_FILE = path.join(DATA_DIR, '.master.key');
const FIREBASE_CONFIG_FILE = path.resolve(process.cwd(), 'firebase-applet-config.json');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

const firebaseConfig: FirebaseAppletConfig = JSON.parse(
  fs.readFileSync(FIREBASE_CONFIG_FILE, 'utf8')
) as FirebaseAppletConfig;

function loadOrCreateMasterKey(): Buffer {
  const envKey = process.env.VAULT_MASTER_KEY?.trim();
  if (envKey) {
    return crypto.createHash('sha256').update(envKey, 'utf8').digest();
  }
  if (fs.existsSync(MASTER_KEY_FILE)) {
    const hex = fs.readFileSync(MASTER_KEY_FILE, 'utf8').trim();
    const buf = Buffer.from(hex, 'hex');
    if (buf.length === 32) return buf;
  }
  const fresh = crypto.randomBytes(32);
  fs.writeFileSync(MASTER_KEY_FILE, fresh.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  return fresh;
}

const MASTER_KEY = loadOrCreateMasterKey();

function deriveUserKey(userId: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      MASTER_KEY,
      Buffer.from(userId, 'utf8'),
      Buffer.from('vaultreceipt-user-vault-v1', 'utf8'),
      32
    )
  );
}

function encryptBuffer(plaintext: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptBuffer(payload: Buffer, key: Buffer): Buffer {
  if (payload.length < 28) {
    throw new Error('Encrypted payload is corrupted or truncated.');
  }
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function signMediaAccess(userId: string, receiptId: string, sha256Hash: string): string {
  return crypto
    .createHmac('sha256', MASTER_KEY)
    .update(`media:${userId}:${receiptId}:${sha256Hash}`)
    .digest('base64url');
}

function verifyMediaAccess(
  userId: string,
  receiptId: string,
  sha256Hash: string,
  providedSig: string
): boolean {
  const expected = signMediaAccess(userId, receiptId, sha256Hash);
  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getSafeUserFileSlug(userId: string): string {
  return crypto.createHash('sha256').update(userId, 'utf8').digest('hex').slice(0, 32);
}

function getUserUploadPath(userId: string, sha256Hash: string): string {
  return path.join(UPLOADS_DIR, `${getSafeUserFileSlug(userId)}_${sha256Hash}.enc`);
}

function attachSignedImageUrl(record: ReceiptRecord): ReceiptRecord {
  const sig = signMediaAccess(record.userId, record.id, record.sha256Hash);
  return {
    ...record,
    imageUrl: `/api/receipts/${encodeURIComponent(record.id)}/image?uid=${encodeURIComponent(
      record.userId
    )}&hash=${encodeURIComponent(record.sha256Hash)}&sig=${encodeURIComponent(sig)}`,
  };
}

function normalizeImageMimeType(file: Express.Multer.File): string | null {
  const rawMime = (file.mimetype || '').toLowerCase();
  if (rawMime === 'image/jpg') return 'image/jpeg';
  if (rawMime.startsWith('image/')) return rawMime;

  const ext = path.extname(file.originalname || '').toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    default:
      return null;
  }
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  displayName: string;
  idToken: string;
}

function extractBearerToken(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        firebaseConfig.apiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!response.ok) return null;
    const data = (await response.json()) as {
      users?: Array<{
        localId: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
      }>;
    };
    const user = data.users?.[0];
    if (!user || !user.localId || !user.emailVerified) {
      return null;
    }

    return {
      uid: user.localId,
      email: user.email || '',
      displayName: user.displayName || user.email || 'User',
      idToken,
    };
  } catch {
    return null;
  }
}

async function requireFirebaseAuth(
  req: express.Request,
  res: express.Response
): Promise<VerifiedFirebaseUser | null> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return null;
  }
  const verified = await verifyFirebaseIdToken(token);
  if (!verified) {
    res.status(401).json({ error: 'Firebase session expired or unverified. Please sign in again.' });
    return null;
  }
  return verified;
}

type FirestoreFieldVal = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
};

function readFsString(fields: Record<string, FirestoreFieldVal>, key: string, fallback = ''): string {
  return fields[key]?.stringValue ?? fallback;
}

function readFsNumber(fields: Record<string, FirestoreFieldVal>, key: string, fallback = 0): number {
  const val = fields[key];
  if (!val) return fallback;
  if (typeof val.doubleValue === 'number') return val.doubleValue;
  if (typeof val.integerValue === 'string') return Number(val.integerValue) || fallback;
  return fallback;
}

async function findReceiptInFirestoreByHash(
  idToken: string,
  uid: string,
  sha256Hash: string
): Promise<ReceiptRecord | null> {
  const databasePath = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
  const url = `https://firestore.googleapis.com/v1/${databasePath}:runQuery`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'receipts' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: 'userId' },
                  op: 'EQUAL',
                  value: { stringValue: uid },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: 'sha256Hash' },
                  op: 'EQUAL',
                  value: { stringValue: sha256Hash },
                },
              },
            ],
          },
        },
        limit: 1,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Firestore query failed (${response.status}): ${errText}`);
  }

  const results = (await response.json()) as Array<{
    document?: {
      name: string;
      fields?: Record<string, FirestoreFieldVal>;
    };
  }>;

  const doc = results.find((r) => r.document?.fields)?.document;
  if (!doc || !doc.fields) return null;

  const f = doc.fields;
  const record: ReceiptRecord = {
    id: readFsString(f, 'id'),
    userId: readFsString(f, 'userId'),
    sha256Hash: readFsString(f, 'sha256Hash'),
    uploadedAtUtc: readFsString(f, 'uploadedAtUtc'),
    fileName: readFsString(f, 'fileName'),
    fileSizeBytes: readFsNumber(f, 'fileSizeBytes'),
    mimeType: readFsString(f, 'mimeType', 'image/jpeg'),
    imageUrl: readFsString(f, 'imageUrl'),
    merchant_name: readFsString(f, 'merchant_name'),
    receipt_date: readFsString(f, 'receipt_date'),
    currency: readFsString(f, 'currency', 'USD'),
    subtotal: readFsNumber(f, 'subtotal'),
    gst_amount: readFsNumber(f, 'gst_amount'),
    total_amount: readFsNumber(f, 'total_amount'),
    category: readFsString(f, 'category', 'Other'),
  };

  return attachSignedImageUrl(record);
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

async function extractReceiptWithGemini(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractedReceiptFields> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: buffer.toString('base64'),
              },
            },
            {
              text: 'Analyze this invoice or receipt image and extract the tax accounting fields accurately.',
            },
          ],
        },
        config: {
          systemInstruction:
            'You are a precision tax accounting OCR parser for freelancers and small businesses. ' +
            'Extract merchant_name, receipt_date (formatted strictly as YYYY-MM-DD; if year or date is missing, use today UTC date), ' +
            'currency (3-letter ISO 4217 uppercase code such as USD, AUD, SGD, CAD, EUR, GBP; infer from symbol or address if unambiguous, default USD), ' +
            'subtotal (numeric pre-tax amount; if only total and tax are shown, compute total - gst_amount; if no tax is shown, equal to total_amount), ' +
            'gst_amount (numeric GST/VAT/sales tax amount; 0 if none shown), ' +
            'total_amount (numeric final total charged), and ' +
            'category (pick the single best match from: Software, Transport, Meals, Office Supplies, Utilities, Travel, Professional Services, Equipment, Other). ' +
            'Return numeric amounts as clean numbers rounded to 2 decimal places.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              merchant_name: {
                type: Type.STRING,
                description: 'The business or merchant name on the receipt or invoice.',
              },
              receipt_date: {
                type: Type.STRING,
                description: 'Date of the transaction in YYYY-MM-DD format.',
              },
              currency: {
                type: Type.STRING,
                description: 'Three-letter ISO 4217 currency code, e.g. USD, AUD, SGD, EUR.',
              },
              subtotal: {
                type: Type.NUMBER,
                description: 'Pre-tax subtotal amount.',
              },
              gst_amount: {
                type: Type.NUMBER,
                description: 'GST, VAT, or sales tax amount.',
              },
              total_amount: {
                type: Type.NUMBER,
                description: 'Final total amount paid.',
              },
              category: {
                type: Type.STRING,
                description:
                  'Expense category: Software, Transport, Meals, Office Supplies, Utilities, Travel, Professional Services, Equipment, or Other.',
              },
            },
            required: [
              'merchant_name',
              'receipt_date',
              'currency',
              'subtotal',
              'gst_amount',
              'total_amount',
              'category',
            ],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        throw new Error('Gemini returned an empty response.');
      }

      const parsed = JSON.parse(rawText) as Partial<ExtractedReceiptFields>;
      const total = Number(parsed.total_amount ?? 0);
      const gst = Number(parsed.gst_amount ?? 0);
      const subtotalRaw = parsed.subtotal !== undefined ? Number(parsed.subtotal) : total - gst;

      const todayUtc = new Date().toISOString().slice(0, 10);
      const dateStr =
        typeof parsed.receipt_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.receipt_date)
          ? parsed.receipt_date
          : todayUtc;

      return {
        merchant_name:
          typeof parsed.merchant_name === 'string' && parsed.merchant_name.trim()
            ? parsed.merchant_name.trim().slice(0, 140)
            : 'Unknown Merchant',
        receipt_date: dateStr,
        currency:
          typeof parsed.currency === 'string' && /^[A-Za-z]{3}$/.test(parsed.currency.trim())
            ? parsed.currency.trim().toUpperCase()
            : 'USD',
        subtotal: Number.isFinite(subtotalRaw) ? Math.round(subtotalRaw * 100) / 100 : 0,
        gst_amount: Number.isFinite(gst) ? Math.round(gst * 100) / 100 : 0,
        total_amount: Number.isFinite(total) ? Math.round(total * 100) / 100 : 0,
        category:
          typeof parsed.category === 'string' && parsed.category.trim()
            ? parsed.category.trim().slice(0, 60)
            : 'Other',
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * Math.pow(2, attempt - 1)));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to extract receipt fields.');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB
  },
  fileFilter: (_req, file, cb) => {
    const normalized = normalizeImageMimeType(file);
    if (!normalized) {
      cb(new Error('Only image files (PNG, JPG, WEBP, HEIC) are supported.'));
      return;
    }
    cb(null, true);
  },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      firestoreProject: firebaseConfig.projectId,
      timestampUtc: new Date().toISOString(),
    });
  });

  // Scan receipt: verify Firebase ID token, compute SHA-256 of raw bytes, check Firestore duplicates, extract via Gemini, encrypt image bytes
  app.post('/api/receipts/scan', upload.single('receipt'), async (req, res) => {
    const user = await requireFirebaseAuth(req, res);
    if (!user) return;

    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: 'No receipt image file received.' });
      return;
    }

    const mimeType = normalizeImageMimeType(req.file);
    if (!mimeType) {
      res.status(400).json({ error: 'Unsupported image format.' });
      return;
    }

    try {
      const rawBytes = req.file.buffer;
      const sha256Hash = crypto.createHash('sha256').update(rawBytes).digest('hex');
      const uploadedAtUtc = new Date().toISOString();

      const existing = await findReceiptInFirestoreByHash(user.idToken, user.uid, sha256Hash);
      if (existing) {
        res.status(200).json({ receipt: existing, duplicate: true });
        return;
      }

      const extracted = await extractReceiptWithGemini(rawBytes, mimeType);

      const id = crypto.randomUUID();
      const userKey = deriveUserKey(user.uid);
      const encryptedBytes = encryptBuffer(rawBytes, userKey);
      fs.writeFileSync(getUserUploadPath(user.uid, sha256Hash), encryptedBytes, { mode: 0o600 });

      const newRecord = attachSignedImageUrl({
        id,
        userId: user.uid,
        sha256Hash,
        uploadedAtUtc,
        fileName: (req.file.originalname || 'receipt.jpg').slice(0, 255),
        fileSizeBytes: rawBytes.length,
        mimeType,
        imageUrl: '',
        ...extracted,
      });

      res.status(201).json({ receipt: newRecord, duplicate: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Receipt scanning failed.';
      res.status(500).json({ error: message });
    }
  });

  // Serve decrypted receipt image bytes (authorized via HMAC signature)
  app.get('/api/receipts/:id/image', (req, res) => {
    const { id } = req.params;
    const uidParam = typeof req.query.uid === 'string' ? req.query.uid : '';
    const hashParam = typeof req.query.hash === 'string' ? req.query.hash : '';
    const sigParam = typeof req.query.sig === 'string' ? req.query.sig : '';

    if (
      !uidParam ||
      !/^[a-f0-9]{64}$/.test(hashParam) ||
      !sigParam ||
      !verifyMediaAccess(uidParam, id, hashParam, sigParam)
    ) {
      res.status(401).json({ error: 'Unauthorized receipt image access.' });
      return;
    }

    const encImagePath = getUserUploadPath(uidParam, hashParam);
    if (!fs.existsSync(encImagePath)) {
      res.status(404).json({ error: 'Encrypted receipt image file missing.' });
      return;
    }

    try {
      const encrypted = fs.readFileSync(encImagePath);
      const rawBytes = decryptBuffer(encrypted, deriveUserKey(uidParam));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, no-store');
      if (req.query.download === '1') {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="receipt-${hashParam.slice(0, 12)}.png"`
        );
      } else {
        res.setHeader('Content-Type', 'image/png');
      }
      res.send(rawBytes);
    } catch {
      res.status(500).json({ error: 'Failed to decrypt stored receipt image.' });
    }
  });

  // Clean up encrypted image file when user deletes receipt from Firestore
  app.delete('/api/receipts/:id/image', async (req, res) => {
    const user = await requireFirebaseAuth(req, res);
    if (!user) return;

    const hashParam = typeof req.query.hash === 'string' ? req.query.hash : '';
    if (!/^[a-f0-9]{64}$/.test(hashParam)) {
      res.status(400).json({ error: 'Invalid receipt hash.' });
      return;
    }

    const encImagePath = getUserUploadPath(user.uid, hashParam);
    if (fs.existsSync(encImagePath)) {
      fs.unlinkSync(encImagePath);
    }
    res.json({ deleted: true });
  });

  // Tamper-verification endpoint: compute SHA-256 of dropped image bytes and query Firestore
  app.post('/api/receipts/verify', upload.single('receipt'), async (req, res) => {
    const user = await requireFirebaseAuth(req, res);
    if (!user) return;

    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: 'No receipt image file received for verification.' });
      return;
    }

    try {
      const rawBytes = req.file.buffer;
      const computedHash = crypto.createHash('sha256').update(rawBytes).digest('hex');
      const checkedAtUtc = new Date().toISOString();

      const matched = await findReceiptInFirestoreByHash(user.idToken, user.uid, computedHash);

      res.json({
        verified: Boolean(matched),
        computedHash,
        checkedAtUtc,
        fileName: req.file.originalname || 'uploaded-image',
        fileSizeBytes: rawBytes.length,
        matchedReceipt: matched,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed.';
      res.status(500).json({ error: message });
    }
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError || err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VaultReceipt server listening on http://localhost:${PORT}`);
  });
}

startServer();
