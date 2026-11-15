import React, { useRef, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Upload,
  Camera,
  Loader2,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { auth } from '../firebase';
import type { VerificationResult } from '../types/receipt';
import {
  formatBytes,
  formatCurrency,
  formatUtcTimestamp,
  truncateHash,
} from '../utils/formatters';

export const VerifyView: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<VerificationResult | null>(null);
  const [history, setHistory] = useState<VerificationResult[]>([]);
  const [copiedHash, setCopiedHash] = useState(false);

  const verifyFile = async (file: File) => {
    const looksLikeImage =
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(file.name);
    if (!looksLikeImage) {
      setVerifyError('Please drop a valid image file (PNG, JPG, WEBP, or HEIC).');
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setVerifyError('Please sign in to verify receipts against your Firestore vault.');
      return;
    }

    setVerifyError(null);
    setIsVerifying(true);
    try {
      const idToken = await currentUser.getIdToken();
      const formData = new FormData();
      formData.append('receipt', file);

      const response = await fetch('/api/receipts/verify', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Verification request failed.');
      }

      const result = payload as VerificationResult;
      setLatestResult(result);
      setHistory((prev) => [result, ...prev].slice(0, 8));
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Unable to verify image.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void verifyFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void verifyFile(file);
    }
  };

  const handleCopyHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-8 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-xl font-bold text-slate-900">
              Receipt Tamper-Verification Tool
            </h2>
            <p className="text-sm text-slate-600 max-w-2xl">
              Drop any receipt or invoice image to compute its raw-byte SHA-256 hash on the server
              and verify whether it matches an authentic record in Cloud Firestore.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              disabled={isVerifying}
              onClick={() => cameraInputRef.current?.click()}
              className="min-h-[44px] px-4 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Camera className="w-4 h-4 text-slate-600" />
              <span>Verify via Camera</span>
            </button>
            <button
              type="button"
              disabled={isVerifying}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Select Receipt to Check</span>
            </button>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => !isVerifying && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !isVerifying) {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`min-h-[190px] rounded-xl border-2 border-dashed transition-colors flex flex-col items-center justify-center p-6 text-center cursor-pointer ${
            isDragging
              ? 'border-teal-700 bg-teal-50/40'
              : 'border-slate-300 bg-slate-50/60 hover:border-slate-400 hover:bg-slate-50'
          }`}
        >
          {isVerifying ? (
            <div className="space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-teal-700 mx-auto" />
              <p className="text-sm font-medium text-slate-900">
                Computing SHA-256 digest &amp; querying Cloud Firestore…
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-w-md">
              <ShieldCheck className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-sm font-medium text-slate-900">
                Drop an invoice image here to audit byte integrity
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Even a 1-pixel edit, crop, or metadata rewrite alters the SHA-256 fingerprint and
                triggers a tamper mismatch.
              </p>
            </div>
          )}
        </div>

        {verifyError && (
          <div
            role="alert"
            className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-start gap-3 text-red-800"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="text-sm">{verifyError}</p>
          </div>
        )}
      </div>

      {latestResult && (
        <div
          className={`bg-white border rounded-xl p-5 sm:p-8 space-y-6 ${
            latestResult.verified ? 'border-emerald-300' : 'border-red-300'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
            <div className="flex items-start gap-3">
              {latestResult.verified ? (
                <ShieldCheck className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <h3
                  className={`font-display text-lg font-bold ${
                    latestResult.verified ? 'text-emerald-800' : 'text-red-700'
                  }`}
                >
                  {latestResult.verified
                    ? 'Verified Authentic — Exact Hash Match in Firestore'
                    : 'Unverified — No Matching SHA-256 Record'}
                </h3>
                <p className="text-xs text-slate-600 font-mono tabular-nums">
                  Inspected {latestResult.fileName} · {formatBytes(latestResult.fileSizeBytes)} ·{' '}
                  {formatUtcTimestamp(latestResult.checkedAtUtc)}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">
                Computed SHA-256 Digest of Uploaded File
              </span>
              <button
                type="button"
                onClick={() => void handleCopyHash(latestResult.computedHash)}
                className="text-xs font-medium text-teal-700 hover:text-teal-800 flex items-center gap-1 cursor-pointer"
              >
                {copiedHash ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Digest</span>
                  </>
                )}
              </button>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs text-slate-900 break-all select-all">
              {latestResult.computedHash}
            </div>
          </div>

          {latestResult.matchedReceipt ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 pt-2 border-t border-slate-100">
              <div>
                <p className="text-xs text-slate-500">Matched Merchant</p>
                <p className="text-sm font-semibold text-slate-900 mt-1">
                  {latestResult.matchedReceipt.merchant_name}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Receipt Date &amp; Category</p>
                <p className="text-sm font-medium text-slate-900 mt-1">
                  <span className="font-mono tabular-nums">
                    {latestResult.matchedReceipt.receipt_date}
                  </span>{' '}
                  · {latestResult.matchedReceipt.category}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Total / GST</p>
                <p className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-1">
                  {formatCurrency(
                    latestResult.matchedReceipt.total_amount,
                    latestResult.matchedReceipt.currency
                  )}{' '}
                  <span className="text-xs font-normal text-slate-500">
                    (GST{' '}
                    {formatCurrency(
                      latestResult.matchedReceipt.gst_amount,
                      latestResult.matchedReceipt.currency
                    )}
                    )
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Original Vault Seal UTC</p>
                <p className="text-xs font-mono tabular-nums text-slate-900 mt-1">
                  {formatUtcTimestamp(latestResult.matchedReceipt.uploadedAtUtc)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600 leading-relaxed pt-2 border-t border-slate-100">
              No receipt in your Cloud Firestore vault matches the SHA-256 fingerprint above. Either
              this image was never sealed in your account, or the image bytes were modified after
              the original seal.
            </p>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Recent Verification Checks (Current Session)
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {history.map((item, idx) => (
              <div
                key={`${item.computedHash}-${idx}`}
                className="px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {item.verified ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                  )}
                  <span className="font-medium text-slate-900 truncate">{item.fileName}</span>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {item.verified ? 'Authentic Match' : 'Hash Mismatch'}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-500 shrink-0">
                  <span>{truncateHash(item.computedHash)}</span>
                  <span>{formatUtcTimestamp(item.checkedAtUtc)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
