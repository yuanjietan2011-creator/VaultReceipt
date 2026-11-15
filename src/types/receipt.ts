export const EXPENSE_CATEGORIES = [
  'Software',
  'Transport',
  'Meals',
  'Office Supplies',
  'Utilities',
  'Travel',
  'Professional Services',
  'Equipment',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface VaultUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
}

export interface ExtractedReceiptFields {
  merchant_name: string;
  receipt_date: string; // YYYY-MM-DD
  currency: string; // ISO 4217 e.g. USD, AUD, SGD, EUR
  subtotal: number;
  gst_amount: number;
  total_amount: number;
  category: string;
}

export interface ReceiptRecord extends ExtractedReceiptFields {
  id: string;
  userId: string;
  sha256Hash: string;
  uploadedAtUtc: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  imageUrl: string;
}

export interface ScanReceiptResponse {
  receipt: ReceiptRecord;
  duplicate: boolean;
}

export interface VerificationResult {
  verified: boolean;
  computedHash: string;
  checkedAtUtc: string;
  fileName: string;
  fileSizeBytes: number;
  matchedReceipt: ReceiptRecord | null;
}
