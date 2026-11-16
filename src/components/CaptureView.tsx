import React, { useEffect, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  Camera,
  Upload,
  CheckCircle2,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Download,
  FileText,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { computeFileSha256, getApiUrl, parseApiJson, StaticHostError } from '../utils/api';
import {
  EARNING_CATEGORIES,
  type EarningRecord,
  type ExtractedReceiptFields,
  type ReceiptRecord,
  type ScanReceiptResponse,
} from '../types/receipt';
import {
  formatBytes,
  formatCurrency,
  formatUtcTimestamp,
  generateSampleReceiptBlob,
} from '../utils/formatters';

interface CaptureViewProps {
  receipts: ReceiptRecord[];
  earnings: EarningRecord[];
  onUpdateReceipt: (id: string, fields: ExtractedReceiptFields) => Promise<void>;
  onOpenLedger: () => void;
}

export const CaptureView: React.FC<CaptureViewProps> = ({
  receipts,
  earnings,
  onUpdateReceipt,
  onOpenLedger,
}) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFileMeta, setSelectedFileMeta] = useState<{
    name: string;
    size: number;
  } | null>(null);

  const [sealedResult, setSealedResult] = useState<ScanReceiptResponse | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  const [editFields, setEditFields] = useState<ExtractedReceiptFields | null>(null);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const processReceiptFile = async (file: File) => {
    const looksLikeImage =
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(file.name);
    if (!looksLikeImage) {
      setScanError('Please select a valid image file (PNG, JPG, WEBP, or HEIC).');
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setScanError('Please sign in before scanning receipts.');
      return;
    }

    setScanError(null);
    setSaveMessage(null);
    setSealedResult(null);
    setEditFields(null);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setSelectedFileMeta({ name: file.name, size: file.size });

    setIsScanning(true);
    try {
      const idToken = await currentUser.getIdToken();
      const formData = new FormData();
      formData.append('receipt', file);

      let data: ScanReceiptResponse;
      let usedStaticFallback = false;

      try {
        const response = await fetch(getApiUrl('/api/receipts/scan'), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          body: formData,
        });
        data = await parseApiJson<ScanReceiptResponse>(response);
      } catch (apiErr) {
        if (!(apiErr instanceof StaticHostError) && !(apiErr instanceof TypeError)) {
          throw apiErr;
        }
        // Static host fallback (e.g., GitHub Pages without Express backend):
        // compute SHA-256 in the browser and seal straight to Cloud Firestore.
        usedStaticFallback = true;
        const sha256Hash = await computeFileSha256(file);
        const existing = receipts.find((r) => r.sha256Hash === sha256Hash);
        if (existing) {
          data = { receipt: existing, duplicate: true };
        } else {
          const baseName = file.name.replace(/\.[^.]+$/, '').trim() || 'Scanned Receipt';
          data = {
            duplicate: false,
            receipt: {
              id: crypto.randomUUID(),
              userId: currentUser.uid,
              sha256Hash,
              uploadedAtUtc: new Date().toISOString(),
              fileName: (file.name || 'receipt.png').slice(0, 255),
              fileSizeBytes: Math.max(1, file.size),
              mimeType: (file.type || 'image/jpeg').slice(0, 64),
              imageUrl: 'client-sha256://sealed',
              merchant_name: baseName.slice(0, 140),
              receipt_date: new Date().toISOString().slice(0, 10),
              currency: 'USD',
              subtotal: 0,
              gst_amount: 0,
              total_amount: 0,
              category: 'Client Services',
            },
          };
        }
      }

      // Persist newly sealed receipt to Cloud Firestore
      if (!data.duplicate) {
        const receiptPath = `receipts/${data.receipt.id}`;
        try {
          await setDoc(doc(db, 'receipts', data.receipt.id), {
            id: data.receipt.id,
            userId: currentUser.uid,
            sha256Hash: data.receipt.sha256Hash,
            uploadedAtUtc: data.receipt.uploadedAtUtc,
            fileName: data.receipt.fileName,
            fileSizeBytes: data.receipt.fileSizeBytes,
            mimeType: data.receipt.mimeType,
            imageUrl: data.receipt.imageUrl,
            merchant_name: data.receipt.merchant_name,
            receipt_date: data.receipt.receipt_date,
            currency: data.receipt.currency,
            subtotal: data.receipt.subtotal,
            gst_amount: data.receipt.gst_amount,
            total_amount: data.receipt.total_amount,
            category: data.receipt.category,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (fsError) {
          handleFirestoreError(fsError, OperationType.CREATE, receiptPath);
        }
      }

      setSealedResult(data);
      if (usedStaticFallback && !data.duplicate) {
        setSaveMessage(
          'Static host mode: SHA-256 sealed in browser. Enter Client, Earned (Without GST), and GST below, then click Save Field Adjustments.'
        );
      }
      setEditFields({
        merchant_name: data.receipt.merchant_name,
        receipt_date: data.receipt.receipt_date,
        currency: data.receipt.currency,
        subtotal: data.receipt.subtotal,
        gst_amount: data.receipt.gst_amount,
        total_amount: data.receipt.total_amount,
        category: data.receipt.category,
      });
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Unable to process receipt image.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processReceiptFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processReceiptFile(file);
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

  const handleSaveAdjustments = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sealedResult || !editFields) return;

    setIsSavingEdits(true);
    setSaveMessage(null);
    try {
      await onUpdateReceipt(sealedResult.receipt.id, editFields);
      const updated: ReceiptRecord = {
        ...sealedResult.receipt,
        ...editFields,
      };
      setSealedResult({ ...sealedResult, receipt: updated });
      setSaveMessage('Saved to Cloud Firestore. Cryptographic SHA-256 seal unchanged.');
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'Could not save changes.');
    } finally {
      setIsSavingEdits(false);
    }
  };

  const handleDownloadSampleReceipt = async () => {
    try {
      const sampleFile = await generateSampleReceiptBlob();
      const url = URL.createObjectURL(sampleFile);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', sampleFile.name);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Could not generate sample image.');
    }
  };

  const totalsByCurrency = receipts.reduce<Record<string, number>>((acc, r) => {
    const curr = r.currency || 'USD';
    acc[curr] = (acc[curr] ?? 0) + r.subtotal;
    return acc;
  }, {});
  for (const e of earnings) {
    const curr = e.currency || 'USD';
    totalsByCurrency[curr] = (totalsByCurrency[curr] ?? 0) + e.net_revenue;
  }
  const currencyList = Object.keys(totalsByCurrency);
  const grandTotalEarned = Object.values(totalsByCurrency).reduce((sum, val) => sum + val, 0);
  const displayCurr =
    currencyList.length === 0
      ? 'USD'
      : currencyList.length === 1
        ? currencyList[0]
        : currencyList.includes('USD')
          ? 'USD'
          : currencyList.sort((a, b) => totalsByCurrency[b] - totalsByCurrency[a])[0];

  return (
    <div className="space-y-6">
      {/* Live Company Total Earned Banner (Without GST) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:px-6 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Company Total Earned (Without GST)
          </p>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-0.5">
            <p className="font-display text-2xl font-bold font-mono tabular-nums text-emerald-800">
              {formatCurrency(grandTotalEarned, displayCurr)}
            </p>
            <span className="text-xs text-slate-500">
              From {receipts.length} {receipts.length === 1 ? 'receipt' : 'receipts'} recorded
              {currencyList.length > 1
                ? ` (${currencyList.map((c) => `${c} ${totalsByCurrency[c].toFixed(2)}`).join(' · ')})`
                : ''}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenLedger}
          className="min-h-[40px] px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
        >
          View Earnings Ledger
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 space-y-5">
            <div className="space-y-1.5">
              <h2 className="font-display text-xl font-bold text-slate-900">
                Capture &amp; Record Receipt
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Snap a receipt photo or upload a sales invoice. Every receipt is sealed via SHA-256,
                parsed by Gemini, and added into your company&apos;s total earnings in Cloud Firestore.
              </p>
            </div>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
              aria-label="Snap receipt photo using rear camera"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
              aria-label="Upload receipt image file"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              <button
                type="button"
                disabled={isScanning}
                onClick={() => cameraInputRef.current?.click()}
                className="w-full min-h-[48px] px-5 py-3 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>Snap Receipt Photo</span>
              </button>

              <button
                type="button"
                disabled={isScanning}
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-[48px] px-5 py-3 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-900 border border-slate-300 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
              >
                <Upload className="w-4 h-4 shrink-0 text-slate-600" />
                <span>Upload Image File</span>
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                PNG, JPG, WEBP, HEIC up to 15 MB
              </span>
              <button
                type="button"
                onClick={() => void handleDownloadSampleReceipt()}
                className="text-xs font-medium text-teal-700 hover:text-teal-800 underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Sample receipt PNG</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => !isScanning && fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !isScanning) {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={`min-h-[240px] sm:min-h-[260px] rounded-xl border-2 border-dashed transition-colors flex flex-col items-center justify-center p-6 text-center cursor-pointer ${
                isDragging
                  ? 'border-teal-700 bg-teal-50/40'
                  : 'border-slate-300 bg-slate-50/60 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              {previewUrl ? (
                <div className="w-full flex flex-col sm:flex-row items-center gap-6 text-left">
                  <div className="w-36 h-44 bg-white border border-slate-200 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                    <img
                      src={previewUrl}
                      alt={selectedFileMeta?.name || 'Captured receipt preview'}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {selectedFileMeta?.name}
                      </p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        {selectedFileMeta ? formatBytes(selectedFileMeta.size) : ''}
                      </p>
                    </div>

                    {isScanning ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-teal-800">
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          <span>Hashing raw bytes &amp; saving to Firestore…</span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Computing SHA-256 digest, extracting tax fields with Gemini, and writing to Firestore.
                        </p>
                      </div>
                    ) : sealedResult ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>
                            {sealedResult.duplicate
                              ? 'Already sealed in Firestore'
                              : 'Sealed & saved to Cloud Firestore'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          Drop another image anytime to scan a new receipt.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5 max-w-sm">
                  <div className="w-11 h-11 rounded-lg bg-white border border-slate-200 flex items-center justify-center mx-auto text-slate-600">
                    <FileText className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-medium text-slate-900">
                    Drag and drop a receipt image here
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Or tap here to choose a photo from your device. Original raw bytes are encrypted
                    and preserved for tamper verification.
                  </p>
                </div>
              )}
            </div>

            {scanError && (
              <div
                role="alert"
                className="mt-4 p-4 rounded-lg bg-red-50 border border-red-200 flex items-start gap-3 text-red-800"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="text-sm leading-snug">
                  <p className="font-semibold">Scan failed</p>
                  <p className="text-xs text-red-700 mt-0.5">{scanError}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {sealedResult && editFields && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  {sealedResult.duplicate
                    ? 'Already Added to Company Earnings'
                    : 'Added to Company Earnings in Firestore'}
                </span>
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                {sealedResult.receipt.merchant_name}
              </h3>
              <p className="text-xs text-slate-500 font-mono tabular-nums">
                Sealed {formatUtcTimestamp(sealedResult.receipt.uploadedAtUtc)} ·{' '}
                {formatBytes(sealedResult.receipt.fileSizeBytes)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {sealedResult.receipt.imageUrl &&
                !sealedResult.receipt.imageUrl.startsWith('client-sha256://') && (
                  <a
                    href={getApiUrl(`${sealedResult.receipt.imageUrl}&download=1`)}
                    className="min-h-[42px] px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Sealed Original</span>
                  </a>
                )}
              <button
                type="button"
                onClick={onOpenLedger}
                className="min-h-[42px] px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                View Earnings Ledger
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                Server SHA-256 Cryptographic Digest (Immutable)
              </span>
              <button
                type="button"
                onClick={() => void handleCopyHash(sealedResult.receipt.sha256Hash)}
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
                    <span>Copy Full Hash</span>
                  </>
                )}
              </button>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs text-slate-800 break-all select-all">
              {sealedResult.receipt.sha256Hash}
            </div>
          </div>

          <form onSubmit={handleSaveAdjustments} className="space-y-5 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between gap-4">
              <h4 className="text-sm font-semibold text-slate-900">
                Extracted Receipt Earnings (Gemini Structured Output)
              </h4>
              <span className="text-xs font-mono tabular-nums font-semibold text-emerald-800">
                Earned (Excl. GST): {formatCurrency(editFields.subtotal, editFields.currency)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="sm:col-span-2 space-y-1.5">
                <label className="block text-xs font-medium text-slate-600">
                  Client / Receipt Source
                </label>
                <input
                  type="text"
                  required
                  value={editFields.merchant_name}
                  onChange={(e) =>
                    setEditFields({ ...editFields, merchant_name: e.target.value })
                  }
                  className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600">Receipt Date</label>
                <input
                  type="date"
                  required
                  value={editFields.receipt_date}
                  onChange={(e) =>
                    setEditFields({ ...editFields, receipt_date: e.target.value })
                  }
                  className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600">Category</label>
                <select
                  value={editFields.category}
                  onChange={(e) => setEditFields({ ...editFields, category: e.target.value })}
                  className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
                >
                  {EARNING_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                  {!EARNING_CATEGORIES.includes(
                    editFields.category as (typeof EARNING_CATEGORIES)[number]
                  ) && <option value={editFields.category}>{editFields.category}</option>}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600">Currency (ISO)</label>
                <input
                  type="text"
                  maxLength={3}
                  required
                  value={editFields.currency}
                  onChange={(e) =>
                    setEditFields({ ...editFields, currency: e.target.value.toUpperCase() })
                  }
                  className="w-full h-10 px-3 text-sm font-mono uppercase bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600">
                  Earned (Without GST)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editFields.subtotal}
                  onChange={(e) =>
                    setEditFields({ ...editFields, subtotal: Number(e.target.value) || 0 })
                  }
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600">
                  GST / Tax (For Gov)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editFields.gst_amount}
                  onChange={(e) =>
                    setEditFields({ ...editFields, gst_amount: Number(e.target.value) || 0 })
                  }
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600">
                  Receipt Total (Incl. GST)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editFields.total_amount}
                  onChange={(e) =>
                    setEditFields({ ...editFields, total_amount: Number(e.target.value) || 0 })
                  }
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <p className="text-xs text-slate-500">
                {saveMessage || 'Adjust extracted values if needed before exporting your earnings report.'}
              </p>
              <button
                type="submit"
                disabled={isSavingEdits}
                className="min-h-[42px] px-4 py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isSavingEdits ? 'Saving…' : 'Save Field Adjustments'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
