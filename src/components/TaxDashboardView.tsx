import React, { useMemo, useState } from 'react';
import {
  Search,
  Download,
  Copy,
  Check,
  Trash2,
  Eye,
  X,
  Plus,
  Calendar,
  Pencil,
  AlertCircle,
  TrendingUp,
} from 'lucide-react';
import {
  EARNING_CATEGORIES,
  type EarningInput,
  type EarningRecord,
  type ExtractedReceiptFields,
  type ReceiptRecord,
  type VaultUser,
} from '../types/receipt';
import {
  exportReceiptsToCsv,
  formatBytes,
  formatCurrency,
  formatMonthLabel,
  formatUtcTimestamp,
  getMonthKey,
  truncateHash,
} from '../utils/formatters';

interface TaxDashboardViewProps {
  user: VaultUser;
  receipts: ReceiptRecord[];
  earnings: EarningRecord[];
  isLoading: boolean;
  onDeleteReceipt: (id: string) => Promise<void>;
  onUpdateReceipt: (id: string, fields: ExtractedReceiptFields) => Promise<void>;
  onAddEarning: (input: EarningInput) => Promise<void>;
  onDeleteEarning: (id: string) => Promise<void>;
  onNavigateCapture: () => void;
}

type LedgerTab = 'receipts' | 'manual';

const createDefaultEarningForm = (defaultCurrency = 'USD'): EarningInput => ({
  client_name: '',
  description: '',
  earned_date: new Date().toISOString().slice(0, 10),
  currency: defaultCurrency,
  amount: 0,
  gst_collected: 0,
});

export const TaxDashboardView: React.FC<TaxDashboardViewProps> = ({
  user,
  receipts,
  earnings,
  isLoading,
  onDeleteReceipt,
  onUpdateReceipt,
  onAddEarning,
  onDeleteEarning,
  onNavigateCapture,
}) => {
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>('receipts');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [confirmDeleteEarningId, setConfirmDeleteEarningId] = useState<string | null>(null);
  const [isDeletingEarning, setIsDeletingEarning] = useState(false);

  // Record Earning modal state
  const [isAddEarningOpen, setIsAddEarningOpen] = useState(false);
  const [earningForm, setEarningForm] = useState<EarningInput>(() => createDefaultEarningForm());
  const [isSavingEarning, setIsSavingEarning] = useState(false);
  const [earningFormError, setEarningFormError] = useState<string | null>(null);

  // Inline editing inside inspection modal
  const [isEditingModal, setIsEditingModal] = useState(false);
  const [modalEditFields, setModalEditFields] = useState<ExtractedReceiptFields | null>(null);
  const [isSavingModal, setIsSavingModal] = useState(false);

  const inspectedReceipt = useMemo(
    () => (inspectedId ? receipts.find((r) => r.id === inspectedId) ?? null : null),
    [receipts, inspectedId]
  );

  const availableCategories = useMemo(() => {
    const set = new Set<string>(EARNING_CATEGORIES);
    for (const r of receipts) {
      if (r.category) set.add(r.category);
    }
    return Array.from(set);
  }, [receipts]);

  // Aggregate monthly company earnings across all receipts (plus any manual entries)
  const monthlySummary = useMemo(() => {
    const map = new Map<
      string,
      {
        monthKey: string;
        count: number;
        totalEarned: number;
        totalNet: number;
        totalGst: number;
        byCurrency: Record<string, { earned: number; net: number; gst: number }>;
      }
    >();

    for (const r of receipts) {
      const monthKey = getMonthKey(r.receipt_date);
      const curr = r.currency || 'USD';
      const entry = map.get(monthKey) ?? {
        monthKey,
        count: 0,
        totalEarned: 0,
        totalNet: 0,
        totalGst: 0,
        byCurrency: {},
      };
      entry.count += 1;
      entry.totalEarned += r.total_amount;
      entry.totalNet += r.subtotal;
      entry.totalGst += r.gst_amount;
      const bucket = entry.byCurrency[curr] ?? { earned: 0, net: 0, gst: 0 };
      bucket.earned += r.total_amount;
      bucket.net += r.subtotal;
      bucket.gst += r.gst_amount;
      entry.byCurrency[curr] = bucket;
      map.set(monthKey, entry);
    }

    for (const e of earnings) {
      const monthKey = getMonthKey(e.earned_date);
      const curr = e.currency || 'USD';
      const entry = map.get(monthKey) ?? {
        monthKey,
        count: 0,
        totalEarned: 0,
        totalNet: 0,
        totalGst: 0,
        byCurrency: {},
      };
      entry.count += 1;
      entry.totalEarned += e.amount;
      entry.totalNet += e.net_revenue;
      entry.totalGst += e.gst_collected;
      const bucket = entry.byCurrency[curr] ?? { earned: 0, net: 0, gst: 0 };
      bucket.earned += e.amount;
      bucket.net += e.net_revenue;
      bucket.gst += e.gst_collected;
      entry.byCurrency[curr] = bucket;
      map.set(monthKey, entry);
    }

    return Array.from(map.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [receipts, earnings]);

  const filteredReceipts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return receipts.filter((r) => {
      if (selectedMonth !== 'ALL' && getMonthKey(r.receipt_date) !== selectedMonth) {
        return false;
      }
      if (selectedCategory !== 'ALL' && r.category !== selectedCategory) {
        return false;
      }
      if (q) {
        const haystack =
          `${r.merchant_name} ${r.category} ${r.sha256Hash} ${r.receipt_date} ${r.currency}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [receipts, searchQuery, selectedCategory, selectedMonth]);

  const filteredEarnings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return earnings.filter((e) => {
      if (selectedMonth !== 'ALL' && getMonthKey(e.earned_date) !== selectedMonth) {
        return false;
      }
      if (q) {
        const haystack =
          `${e.client_name} ${e.description} ${e.earned_date} ${e.currency}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [earnings, searchQuery, selectedMonth]);

  const kpis = useMemo(() => {
    const byCurrency: Record<string, { earned: number; net: number; gst: number }> = {};
    let totalEarned = 0;
    let totalNet = 0;
    let totalGst = 0;

    const ensureBucket = (curr: string) => {
      if (!byCurrency[curr]) {
        byCurrency[curr] = { earned: 0, net: 0, gst: 0 };
      }
      return byCurrency[curr];
    };

    for (const r of filteredReceipts) {
      const curr = r.currency || 'USD';
      const bucket = ensureBucket(curr);
      bucket.earned += r.total_amount;
      bucket.net += r.subtotal;
      bucket.gst += r.gst_amount;
      totalEarned += r.total_amount;
      totalNet += r.subtotal;
      totalGst += r.gst_amount;
    }

    for (const e of filteredEarnings) {
      const curr = e.currency || 'USD';
      const bucket = ensureBucket(curr);
      bucket.earned += e.amount;
      bucket.net += e.net_revenue;
      bucket.gst += e.gst_collected;
      totalEarned += e.amount;
      totalNet += e.net_revenue;
      totalGst += e.gst_collected;
    }

    const currencies = Object.keys(byCurrency);
    const primaryCurrency =
      currencies.length === 0
        ? 'USD'
        : currencies.length === 1
          ? currencies[0]
          : currencies.includes('USD')
            ? 'USD'
            : currencies.sort((a, b) => byCurrency[b].net - byCurrency[a].net)[0];

    return {
      byCurrency,
      currencies,
      primaryCurrency,
      combinedTotals: { earned: totalEarned, net: totalNet, gst: totalGst },
      receiptCount: filteredReceipts.length,
      manualCount: filteredEarnings.length,
      totalCount: filteredReceipts.length + filteredEarnings.length,
    };
  }, [filteredReceipts, filteredEarnings]);

  const openInspector = (receipt: ReceiptRecord) => {
    setActionError(null);
    setConfirmDeleteId(null);
    setIsEditingModal(false);
    setModalEditFields({
      merchant_name: receipt.merchant_name,
      receipt_date: receipt.receipt_date,
      currency: receipt.currency,
      subtotal: receipt.subtotal,
      gst_amount: receipt.gst_amount,
      total_amount: receipt.total_amount,
      category: receipt.category,
    });
    setInspectedId(receipt.id);
  };

  const handleCopyHash = async (id: string, hash: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleConfirmDelete = async (id: string) => {
    setIsDeleting(true);
    setActionError(null);
    try {
      await onDeleteReceipt(id);
      if (inspectedId === id) {
        setInspectedId(null);
      }
      setConfirmDeleteId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete receipt.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveModalEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectedReceipt || !modalEditFields) return;
    setIsSavingModal(true);
    setActionError(null);
    try {
      await onUpdateReceipt(inspectedReceipt.id, modalEditFields);
      setIsEditingModal(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update receipt fields.');
    } finally {
      setIsSavingModal(false);
    }
  };

  const openAddEarningModal = () => {
    setEarningFormError(null);
    setEarningForm(createDefaultEarningForm(kpis.primaryCurrency));
    setIsAddEarningOpen(true);
  };

  const handleSaveEarning = async (e: React.FormEvent) => {
    e.preventDefault();
    setEarningFormError(null);
    setIsSavingEarning(true);
    try {
      await onAddEarning(earningForm);
      setIsAddEarningOpen(false);
      setLedgerTab('manual');
    } catch (err) {
      setEarningFormError(err instanceof Error ? err.message : 'Failed to record earning.');
    } finally {
      setIsSavingEarning(false);
    }
  };

  const handleConfirmDeleteEarning = async (id: string) => {
    setIsDeletingEarning(true);
    setActionError(null);
    try {
      await onDeleteEarning(id);
      setConfirmDeleteEarningId(null);
      if (earnings.length <= 1) {
        setLedgerTab('receipts');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete earning record.');
    } finally {
      setIsDeletingEarning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="h-3 w-24 bg-slate-200 rounded animate-pulse" />
              <div className="h-7 w-32 bg-slate-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 w-full bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {actionError && !inspectedReceipt && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2.5 text-sm text-red-800"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* 3-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Company Total Earned (Without GST)</p>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Excl. GST</span>
            </span>
          </div>
          <p className="font-display text-xl sm:text-2xl font-bold text-emerald-800 font-mono tabular-nums mt-1.5">
            {formatCurrency(kpis.combinedTotals.net, kpis.primaryCurrency)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            From {kpis.receiptCount} {kpis.receiptCount === 1 ? 'receipt' : 'receipts'}
            {kpis.manualCount > 0 ? ` + ${kpis.manualCount} manual` : ''}
            {selectedMonth !== 'ALL' ? ` · ${formatMonthLabel(selectedMonth)}` : ''}
            {kpis.currencies.length > 1
              ? ` (${kpis.currencies.map((c) => `${c} ${kpis.byCurrency[c].net.toFixed(2)}`).join(' · ')})`
              : ''}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">GST / Tax Collected (For Gov)</p>
          <p className="font-display text-xl sm:text-2xl font-bold text-teal-800 font-mono tabular-nums mt-1.5">
            {formatCurrency(kpis.combinedTotals.gst, kpis.primaryCurrency)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Owed to government · Gross {formatCurrency(kpis.combinedTotals.earned, kpis.primaryCurrency)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Receipts Recorded</p>
          <p className="font-display text-xl sm:text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1.5">
            {kpis.totalCount}
          </p>
          <p className="text-xs text-slate-500 mt-1">SHA-256 verified earnings records</p>
        </div>
      </div>

      {/* Monthly Earnings Breakdown */}
      {monthlySummary.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900">
                Monthly Company Earnings (Without GST)
              </h2>
            </div>
            {selectedMonth !== 'ALL' && (
              <button
                type="button"
                onClick={() => setSelectedMonth('ALL')}
                className="text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
              >
                Show all months
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {monthlySummary.map((m) => {
              const isSelected = selectedMonth === m.monthKey;
              const monthCurrencies = Object.keys(m.byCurrency);
              const displayCurr =
                monthCurrencies.length === 0
                  ? 'USD'
                  : monthCurrencies.length === 1
                    ? monthCurrencies[0]
                    : monthCurrencies.includes('USD')
                      ? 'USD'
                      : monthCurrencies.sort((a, b) => m.byCurrency[b].net - m.byCurrency[a].net)[0];
              return (
                <button
                  key={m.monthKey}
                  type="button"
                  onClick={() => setSelectedMonth(isSelected ? 'ALL' : m.monthKey)}
                  className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-teal-700 bg-teal-50/50'
                      : 'border-slate-200 bg-slate-50/40 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      {formatMonthLabel(m.monthKey)}
                    </span>
                    <span className="text-xs text-slate-500 font-mono tabular-nums">
                      {m.count} {m.count === 1 ? 'receipt' : 'receipts'}
                    </span>
                  </div>
                  <p className="text-base font-bold font-mono tabular-nums text-emerald-800 mt-1.5">
                    {formatCurrency(m.totalNet, displayCurr)}
                  </p>
                  <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                    GST {formatCurrency(m.totalGst, displayCurr)} (gov) · Gross{' '}
                    {formatCurrency(m.totalEarned, displayCurr)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Searchable Earnings Ledger & Export */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
            {earnings.length > 0 && (
              <div
                role="tablist"
                aria-label="Ledger view mode"
                className="inline-flex p-1 bg-slate-100 rounded-lg shrink-0"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={ledgerTab === 'receipts'}
                  onClick={() => setLedgerTab('receipts')}
                  className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    ledgerTab === 'receipts'
                      ? 'bg-white text-slate-900 border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Receipt Earnings ({filteredReceipts.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={ledgerTab === 'manual'}
                  onClick={() => setLedgerTab('manual')}
                  className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    ledgerTab === 'manual'
                      ? 'bg-white text-slate-900 border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Manual Entries ({filteredEarnings.length})
                </button>
              </div>
            )}

            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  ledgerTab === 'receipts'
                    ? 'Search client, source, category, or SHA-256 hash…'
                    : 'Search client, description, or currency…'
                }
                className="w-full h-10 pl-9 pr-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-teal-700"
              />
            </div>

            {ledgerTab === 'receipts' && (
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                aria-label="Filter by earnings category"
                className="h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-teal-700"
              >
                <option value="ALL">All Categories</option>
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={openAddEarningModal}
              className="flex-1 sm:flex-initial min-h-[42px] px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Manual Entry</span>
            </button>
            <button
              type="button"
              disabled={filteredReceipts.length === 0 && filteredEarnings.length === 0}
              onClick={() => exportReceiptsToCsv(filteredReceipts, user.email, filteredEarnings)}
              className="flex-1 sm:flex-initial min-h-[42px] px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Earnings Report</span>
            </button>
          </div>
        </div>

        {ledgerTab === 'manual' && earnings.length > 0 ? (
          earnings.length === 0 ? (
            <div className="p-10 sm:p-12 text-center space-y-3">
              <p className="text-base font-semibold text-slate-900">
                No company earnings recorded yet
              </p>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Log client invoices, retainers, or sales revenue to track total company earnings and
                calculate net profit against your sealed expense receipts.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={openAddEarningModal}
                  className="min-h-[44px] px-5 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Record First Earning</span>
                </button>
              </div>
            </div>
          ) : filteredEarnings.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-900">
                No earnings match your current filters
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedMonth('ALL');
                }}
                className="text-xs font-medium text-teal-700 hover:text-teal-800 underline underline-offset-4 cursor-pointer"
              >
                Clear search and filters
              </button>
            </div>
          ) : (
            <>
              {/* Tablet & PC Company Earnings Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                      <th className="py-3 px-5">Earned Date</th>
                      <th className="py-3 px-4">Client / Source &amp; Notes</th>
                      <th className="py-3 px-4 text-right">Earned (Excl. GST)</th>
                      <th className="py-3 px-4 text-right">GST (Gov)</th>
                      <th className="py-3 px-4 text-right">Total (Incl. GST)</th>
                      <th className="py-3 px-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredEarnings.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-5 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                          {item.earned_date}
                        </td>
                        <td className="py-3 px-4 max-w-[320px]">
                          <p className="font-medium text-slate-900 truncate">{item.client_name}</p>
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {item.description ? `${item.description} · ` : ''}
                            {item.currency}
                          </p>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-800 whitespace-nowrap">
                          {formatCurrency(item.net_revenue, item.currency)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-teal-800 whitespace-nowrap">
                          {formatCurrency(item.gst_collected, item.currency)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                          {formatCurrency(item.amount, item.currency)}
                        </td>
                        <td className="py-3 px-5 text-right whitespace-nowrap">
                          {confirmDeleteEarningId === item.id ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={isDeletingEarning}
                                onClick={() => void handleConfirmDeleteEarning(item.id)}
                                className="px-2.5 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded cursor-pointer"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteEarningId(null)}
                                className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteEarningId(item.id)}
                              aria-label={`Delete earning from ${item.client_name}`}
                              className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phone Responsive Company Earnings Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {filteredEarnings.map((item) => (
                  <div key={item.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-900 truncate">
                          {item.client_name}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                          <span className="font-mono tabular-nums">{item.earned_date}</span>
                          {item.description ? ` · ${item.description}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold font-mono tabular-nums text-emerald-800">
                          {formatCurrency(item.net_revenue, item.currency)}
                        </p>
                        <p className="text-xs font-mono tabular-nums text-slate-500">
                          GST {formatCurrency(item.gst_collected, item.currency)} (gov)
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-xs font-mono tabular-nums text-slate-500">
                        Total {formatCurrency(item.amount, item.currency)}
                      </span>
                      {confirmDeleteEarningId === item.id ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isDeletingEarning}
                            onClick={() => void handleConfirmDeleteEarning(item.id)}
                            className="min-h-[36px] px-3 py-1 text-xs font-medium bg-red-600 text-white rounded cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteEarningId(null)}
                            className="min-h-[36px] px-2.5 py-1 text-xs text-slate-600 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteEarningId(item.id)}
                          aria-label={`Delete earning from ${item.client_name}`}
                          className="min-h-[36px] px-2.5 text-xs text-slate-500 hover:text-red-600 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        ) : receipts.length === 0 ? (
          <div className="p-10 sm:p-12 text-center space-y-3">
            <p className="text-base font-semibold text-slate-900">
              No earnings receipts recorded yet
            </p>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Capture or upload your first receipt to add its amount to your company&apos;s total
              earnings with SHA-256 verification.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={onNavigateCapture}
                className="min-h-[44px] px-5 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Scan First Receipt</span>
              </button>
            </div>
          </div>
        ) : filteredReceipts.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-900">
              No receipts match your current filters
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('ALL');
                setSelectedMonth('ALL');
              }}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 underline underline-offset-4 cursor-pointer"
            >
              Clear search and filters
            </button>
          </div>
        ) : (
          <>
            {/* Tablet & PC High-Density Earnings Data Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-5">Receipt Date</th>
                    <th className="py-3 px-4">Client / Source &amp; Category</th>
                    <th className="py-3 px-4 text-right">Earned (Excl. GST)</th>
                    <th className="py-3 px-4 text-right">GST (Gov)</th>
                    <th className="py-3 px-4 text-right">Receipt Total</th>
                    <th className="py-3 px-4">SHA-256 Hash</th>
                    <th className="py-3 px-4">UTC Seal</th>
                    <th className="py-3 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredReceipts.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => openInspector(r)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-5 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                        {r.receipt_date}
                      </td>
                      <td className="py-3 px-4 max-w-[240px]">
                        <p className="font-medium text-slate-900 truncate">{r.merchant_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {r.category} · {r.currency}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-800 whitespace-nowrap">
                        {formatCurrency(r.subtotal, r.currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                        {formatCurrency(r.gst_amount, r.currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap">
                        {formatCurrency(r.total_amount, r.currency)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => void handleCopyHash(r.id, r.sha256Hash, e)}
                          title="Copy full 64-character SHA-256 digest"
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200/70 text-slate-800 font-mono text-xs transition-colors cursor-pointer"
                        >
                          <span>{truncateHash(r.sha256Hash)}</span>
                          {copiedId === r.id ? (
                            <Check className="w-3 h-3 text-emerald-700" />
                          ) : (
                            <Copy className="w-3 h-3 text-slate-500" />
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap">
                        {formatUtcTimestamp(r.uploadedAtUtc)}
                      </td>
                      <td
                        className="py-3 px-5 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openInspector(r)}
                            aria-label={`Inspect ${r.merchant_name}`}
                            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {confirmDeleteId === r.id ? (
                            <div className="inline-flex items-center gap-1.5 ml-1">
                              <button
                                type="button"
                                disabled={isDeleting}
                                onClick={() => void handleConfirmDelete(r.id)}
                                className="px-2.5 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded cursor-pointer"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(r.id)}
                              aria-label={`Delete ${r.merchant_name}`}
                              className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone Responsive Ledger Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredReceipts.map((r) => (
                <div
                  key={r.id}
                  onClick={() => openInspector(r)}
                  className="p-4 hover:bg-slate-50 transition-colors cursor-pointer space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900 truncate">
                        {r.merchant_name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {r.category} · <span className="font-mono tabular-nums">{r.receipt_date}</span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold font-mono tabular-nums text-emerald-800">
                        {formatCurrency(r.subtotal, r.currency)}
                      </p>
                      <p className="text-xs font-mono tabular-nums text-slate-500">
                        GST {formatCurrency(r.gst_amount, r.currency)} · Gross{' '}
                        {formatCurrency(r.total_amount, r.currency)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={(e) => void handleCopyHash(r.id, r.sha256Hash, e)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded bg-slate-100 text-slate-700 font-mono text-xs"
                    >
                      <span>{truncateHash(r.sha256Hash)}</span>
                      {copiedId === r.id ? (
                        <Check className="w-3 h-3 text-emerald-700" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-500" />
                      )}
                    </button>
                    <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                      {formatUtcTimestamp(r.uploadedAtUtc)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Record Company Earning Modal */}
      {isAddEarningOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4"
          onClick={() => setIsAddEarningOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white border border-slate-200 rounded-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Record Company Earning
                </h3>
                <p className="text-xs text-slate-500">
                  Saved privately to your Cloud Firestore vault
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddEarningOpen(false)}
                aria-label="Close record earning dialog"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEarning} className="p-5 sm:p-6 space-y-4">
              {earningFormError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-800"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{earningFormError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">
                  Client or Income Source
                </label>
                <input
                  type="text"
                  required
                  maxLength={140}
                  placeholder="e.g. Acme Corp — Q2 Consulting Retainer"
                  value={earningForm.client_name}
                  onChange={(e) =>
                    setEarningForm({ ...earningForm, client_name: e.target.value })
                  }
                  className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Earned Date
                  </label>
                  <input
                    type="date"
                    required
                    value={earningForm.earned_date}
                    onChange={(e) =>
                      setEarningForm({ ...earningForm, earned_date: e.target.value })
                    }
                    className="w-full h-10 px-3 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Currency (ISO)
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={3}
                    value={earningForm.currency}
                    onChange={(e) =>
                      setEarningForm({
                        ...earningForm,
                        currency: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-full h-10 px-3 text-sm font-mono uppercase border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Total Received (Incl. GST)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={earningForm.amount || ''}
                    placeholder="0.00"
                    onChange={(e) =>
                      setEarningForm({
                        ...earningForm,
                        amount: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full h-10 px-3 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    GST / Tax (For Gov)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={earningForm.gst_collected || ''}
                    placeholder="0.00"
                    onChange={(e) =>
                      setEarningForm({
                        ...earningForm,
                        gst_collected: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full h-10 px-3 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">
                  Invoice / Project Note (optional)
                </label>
                <input
                  type="text"
                  maxLength={200}
                  placeholder="e.g. Invoice #INV-1042"
                  value={earningForm.description}
                  onChange={(e) =>
                    setEarningForm({ ...earningForm, description: e.target.value })
                  }
                  className="w-full h-10 px-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-700"
                />
              </div>

              <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-200 flex items-center justify-between text-xs">
                <span className="text-slate-700 font-medium">Company Earned (Without GST)</span>
                <span className="font-mono tabular-nums font-bold text-emerald-800">
                  {formatCurrency(
                    (Number(earningForm.amount) || 0) - (Number(earningForm.gst_collected) || 0),
                    earningForm.currency || 'USD'
                  )}
                </span>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddEarningOpen(false)}
                  className="min-h-[42px] px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEarning}
                  className="min-h-[42px] px-5 py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
                >
                  {isSavingEarning ? 'Saving…' : 'Save Earning'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receipt Inspection & Edit Modal */}
      {inspectedReceipt && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4"
          onClick={() => setInspectedId(null)}
        >
          <div
            className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-slate-900 truncate">
                  {inspectedReceipt.merchant_name}
                </h3>
                <p className="text-xs text-slate-500">
                  {inspectedReceipt.category} · {inspectedReceipt.receipt_date}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    setIsEditingModal((prev) => !prev);
                  }}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>{isEditingModal ? 'View Summary' : 'Edit Fields'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInspectedId(null)}
                  aria-label="Close inspection dialog"
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
              {actionError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-800"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-start">
                <div className="sm:col-span-5 bg-slate-50 border border-slate-200 rounded-lg overflow-hidden aspect-[3/4] flex items-center justify-center">
                  <img
                    src={inspectedReceipt.imageUrl}
                    alt={inspectedReceipt.merchant_name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                </div>

                <div className="sm:col-span-7 space-y-4">
                  {isEditingModal && modalEditFields ? (
                    <form onSubmit={handleSaveModalEdit} className="space-y-3">
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-slate-600">
                          Client / Receipt Source
                        </label>
                        <input
                          type="text"
                          required
                          value={modalEditFields.merchant_name}
                          onChange={(e) =>
                            setModalEditFields({
                              ...modalEditFields,
                              merchant_name: e.target.value,
                            })
                          }
                          className="w-full h-9 px-3 text-sm border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-600">
                            Receipt Date
                          </label>
                          <input
                            type="date"
                            required
                            value={modalEditFields.receipt_date}
                            onChange={(e) =>
                              setModalEditFields({
                                ...modalEditFields,
                                receipt_date: e.target.value,
                              })
                            }
                            className="w-full h-9 px-2.5 text-sm font-mono border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-600">
                            Category
                          </label>
                          <select
                            value={modalEditFields.category}
                            onChange={(e) =>
                              setModalEditFields({
                                ...modalEditFields,
                                category: e.target.value,
                              })
                            }
                            className="w-full h-9 px-2.5 text-sm border border-slate-300 rounded-lg bg-white"
                          >
                            {availableCategories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-600">Curr</label>
                          <input
                            type="text"
                            maxLength={3}
                            required
                            value={modalEditFields.currency}
                            onChange={(e) =>
                              setModalEditFields({
                                ...modalEditFields,
                                currency: e.target.value.toUpperCase(),
                              })
                            }
                            className="w-full h-9 px-2.5 text-sm font-mono uppercase border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-600">
                            Earned (No GST)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={modalEditFields.subtotal}
                            onChange={(e) =>
                              setModalEditFields({
                                ...modalEditFields,
                                subtotal: Number(e.target.value) || 0,
                              })
                            }
                            className="w-full h-9 px-2.5 text-sm font-mono border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-600">GST (Gov)</label>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={modalEditFields.gst_amount}
                            onChange={(e) =>
                              setModalEditFields({
                                ...modalEditFields,
                                gst_amount: Number(e.target.value) || 0,
                              })
                            }
                            className="w-full h-9 px-2.5 text-sm font-mono border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-600">Receipt Total</label>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={modalEditFields.total_amount}
                            onChange={(e) =>
                              setModalEditFields({
                                ...modalEditFields,
                                total_amount: Number(e.target.value) || 0,
                              })
                            }
                            className="w-full h-9 px-2.5 text-sm font-mono border border-slate-300 rounded-lg"
                          />
                        </div>
                      </div>

                      <div className="pt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setIsEditingModal(false)}
                          className="min-h-[38px] px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isSavingModal}
                          className="min-h-[38px] px-4 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg cursor-pointer"
                        >
                          {isSavingModal ? 'Saving…' : 'Save Changes'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-100">
                        <div>
                          <p className="text-xs text-slate-500">Earned (Without GST)</p>
                          <p className="text-base font-bold font-mono tabular-nums text-emerald-800 mt-0.5">
                            {formatCurrency(
                              inspectedReceipt.subtotal,
                              inspectedReceipt.currency
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">GST / Tax (For Gov)</p>
                          <p className="text-sm font-semibold font-mono tabular-nums text-teal-800 mt-0.5">
                            {formatCurrency(
                              inspectedReceipt.gst_amount,
                              inspectedReceipt.currency
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Receipt Total (Incl. GST)</p>
                          <p className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                            {formatCurrency(
                              inspectedReceipt.total_amount,
                              inspectedReceipt.currency
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">File Size</p>
                          <p className="text-sm font-mono tabular-nums text-slate-700 mt-0.5">
                            {formatBytes(inspectedReceipt.fileSizeBytes)}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-xs text-slate-500">UTC Upload Seal</p>
                        <p className="text-xs font-mono tabular-nums text-slate-900">
                          {formatUtcTimestamp(inspectedReceipt.uploadedAtUtc)}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-slate-500">Full SHA-256 Digest</p>
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyHash(
                                inspectedReceipt.id,
                                inspectedReceipt.sha256Hash
                              )
                            }
                            className="text-xs font-medium text-teal-700 hover:text-teal-800 flex items-center gap-1 cursor-pointer"
                          >
                            {copiedId === inspectedReceipt.id ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                        <div className="p-2.5 bg-slate-50 border border-slate-200 rounded font-mono text-[11px] text-slate-800 break-all select-all">
                          {inspectedReceipt.sha256Hash}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
              {confirmDeleteId === inspectedReceipt.id ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => void handleConfirmDelete(inspectedReceipt.id)}
                    className="min-h-[38px] px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg cursor-pointer"
                  >
                    {isDeleting ? 'Deleting…' : 'Confirm Delete'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="min-h-[38px] px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(inspectedReceipt.id)}
                  className="min-h-[38px] px-3.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Record</span>
                </button>
              )}

              <a
                href={`${inspectedReceipt.imageUrl}&download=1`}
                className="min-h-[38px] px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Sealed Original</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
