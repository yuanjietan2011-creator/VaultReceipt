export const EARNING_CATEGORIES = [
  'Client Services',
  'Product Sales',
  'Consulting',
  'Subscriptions',
  'Project Milestone',
  'Retail / POS',
  'Other',
] as const;

export const EXPENSE_CATEGORIES = EARNING_CATEGORIES;

export type EarningCategory = (typeof EARNING_CATEGORIES)[number];
export type ExpenseCategory = EarningCategory;

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

export interface EarningInput {
  client_name: string;
  description: string;
  earned_date: string; // YYYY-MM-DD
  currency: string; // ISO 4217 e.g. USD
  amount: number;
  gst_collected: number;
}

export interface EarningRecord extends EarningInput {
  id: string;
  userId: string;
  net_revenue: number;
}

export interface ScanReceiptResponse {
  receipt: ReceiptRecord;
  duplicate: boolean;
}

export type VerificationStatus =
  | 'exact_match'
  | 'visual_match'
  | 'amount_mismatch'
  | 'unverified';

export interface VerificationResult {
  verified: boolean;
  status: VerificationStatus;
  computedHash: string;
  checkedAtUtc: string;
  fileName: string;
  fileSizeBytes: number;
  matchedReceipt: ReceiptRecord | null;
  extractedFields?: ExtractedReceiptFields;
}
