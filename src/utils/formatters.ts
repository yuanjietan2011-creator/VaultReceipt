import type { EarningRecord, ReceiptRecord } from '../types/receipt';

export function truncateHash(hash: string): string {
  if (!hash || hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatUtcTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} UTC`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function getMonthKey(dateStr: string): string {
  if (/^\d{4}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 7);
  }
  return 'Unknown';
}

export function formatMonthLabel(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey;
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportReceiptsToCsv(
  receipts: ReceiptRecord[],
  userEmail: string,
  earnings: EarningRecord[] = []
): void {
  const headers = [
    'Entry Type',
    'Record ID',
    'Date',
    'Client / Receipt Source',
    'Category / Notes',
    'Currency',
    'Pre-Tax Earned (Without GST)',
    'GST / Tax (Gov)',
    'Receipt Total (Incl. GST)',
    'SHA-256 Hash',
    'UTC Upload Timestamp',
    'Original Filename',
  ];

  const receiptRows = receipts.map((r) => [
    'RECEIPT_EARNING',
    r.id,
    r.receipt_date,
    r.merchant_name,
    r.category,
    r.currency,
    r.subtotal.toFixed(2),
    r.gst_amount.toFixed(2),
    r.total_amount.toFixed(2),
    r.sha256Hash,
    r.uploadedAtUtc,
    r.fileName,
  ]);

  const manualEarningRows = earnings.map((e) => [
    'MANUAL_EARNING',
    e.id,
    e.earned_date,
    e.client_name,
    e.description || 'Manual Company Earning',
    e.currency,
    e.net_revenue.toFixed(2),
    e.gst_collected.toFixed(2),
    e.amount.toFixed(2),
    '',
    '',
    '',
  ]);

  const totalReceiptEarned = receipts.reduce((sum, r) => sum + r.total_amount, 0);
  const totalReceiptNet = receipts.reduce((sum, r) => sum + r.subtotal, 0);
  const totalReceiptGst = receipts.reduce((sum, r) => sum + r.gst_amount, 0);

  const totalManualEarned = earnings.reduce((sum, e) => sum + e.amount, 0);
  const totalManualNet = earnings.reduce((sum, e) => sum + e.net_revenue, 0);
  const totalManualGst = earnings.reduce((sum, e) => sum + e.gst_collected, 0);

  const grandTotalEarned = totalReceiptEarned + totalManualEarned;
  const grandTotalNet = totalReceiptNet + totalManualNet;
  const grandTotalGst = totalReceiptGst + totalManualGst;

  const summaryRows = [
    [
      'SUMMARY_COMPANY_TOTAL_EARNED_WITHOUT_GST',
      '',
      '',
      `Vault Owner: ${userEmail}`,
      `${receipts.length} Receipts${earnings.length > 0 ? ` + ${earnings.length} Manual Entries` : ''}`,
      'MULTI',
      grandTotalNet.toFixed(2),
      grandTotalGst.toFixed(2),
      grandTotalEarned.toFixed(2),
      '',
      new Date().toISOString(),
      '',
    ],
  ];

  const csvContent = [headers, ...receiptRows, ...manualEarningRows, ...summaryRows]
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
    .join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.setAttribute('download', `vaultreceipt-earnings-report-${dateStamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function generateSampleReceiptBlob(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 960;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable.');
  }

  // Clean thermal receipt paper background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 34px monospace';
  ctx.fillText('HARBORVIEW DESIGN CLIENT', 60, 96);

  ctx.fillStyle = '#475569';
  ctx.font = '20px monospace';
  ctx.fillText('PAID SALES RECEIPT · REF 48 912 304', 60, 134);
  ctx.fillText('410 Market Street, Suite 800', 60, 164);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, 195);
  ctx.lineTo(660, 195);
  ctx.stroke();

  const today = new Date().toISOString().slice(0, 10);
  ctx.fillStyle = '#0f172a';
  ctx.font = '22px monospace';
  ctx.fillText(`DATE: ${today}`, 60, 240);
  ctx.fillText('RECEIPT NO: REC-2026-8419', 60, 276);
  ctx.fillText('CURRENCY: USD', 60, 312);

  ctx.beginPath();
  ctx.moveTo(60, 345);
  ctx.lineTo(660, 345);
  ctx.stroke();

  ctx.font = 'bold 22px monospace';
  ctx.fillText('SERVICE / ITEM SOLD', 60, 390);
  ctx.fillText('AMOUNT', 550, 390);

  ctx.font = '21px monospace';
  ctx.fillText('Monthly Design & Support Retainer', 60, 445);
  ctx.fillText('$840.00', 540, 445);

  ctx.fillText('Brand Asset Setup Package', 60, 490);
  ctx.fillText('$360.00', 540, 490);

  ctx.beginPath();
  ctx.moveTo(60, 540);
  ctx.lineTo(660, 540);
  ctx.stroke();

  ctx.fillText('NET EARNINGS (PRE-TAX)', 60, 595);
  ctx.fillText('$1,200.00', 520, 595);

  ctx.fillText('GST / TAX COLLECTED (10%)', 60, 638);
  ctx.fillText('$120.00', 540, 638);

  ctx.font = 'bold 28px monospace';
  ctx.fillText('TOTAL RECEIVED', 60, 700);
  ctx.fillText('$1,320.00', 505, 700);

  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(60, 750);
  ctx.lineTo(660, 750);
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = '18px monospace';
  ctx.fillText('PAYMENT SETTLED · VISA •••• 4242', 60, 800);
  ctx.fillText('RECORDED TO COMPANY EARNINGS', 60, 836);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Failed to encode sample receipt image.'));
    }, 'image/png');
  });

  return new File([blob], `sample-sales-receipt-${today}.png`, { type: 'image/png' });
}
