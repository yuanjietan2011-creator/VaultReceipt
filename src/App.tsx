import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Camera, FileSpreadsheet, ShieldCheck, LogOut, AlertCircle, Loader2 } from 'lucide-react';
import { CaptureView } from './components/CaptureView';
import { TaxDashboardView } from './components/TaxDashboardView';
import { VaultAuthScreen } from './components/VaultAuthScreen';
import { VerifyView } from './components/VerifyView';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import type {
  EarningInput,
  EarningRecord,
  ExtractedReceiptFields,
  ReceiptRecord,
  VaultUser,
} from './types/receipt';

type ActiveTab = 'capture' | 'dashboard' | 'verify';

export default function App() {
  const [user, setUser] = useState<VaultUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('capture');
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [earnings, setEarnings] = useState<EarningRecord[]>([]);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(false);
  const [isLoadingEarnings, setIsLoadingEarnings] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);

  // Listen to Firebase Auth state and sync user profile in Firestore
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setReceipts([]);
        setEarnings([]);
        setVaultError(null);
        setIsAuthReady(true);
        return;
      }

      const vaultUser: VaultUser = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName || firebaseUser.email || 'User',
        photoURL: firebaseUser.photoURL,
      };
      setUser(vaultUser);
      setIsAuthReady(true);

      const userPath = `users/${firebaseUser.uid}`;
      try {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          await setDoc(userRef, {
            uid: firebaseUser.uid,
            email: vaultUser.email,
            displayName: vaultUser.displayName.slice(0, 100),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, userPath);
        } catch (wrappedErr) {
          setVaultError(
            wrappedErr instanceof Error ? wrappedErr.message : 'Unable to sync user profile.'
          );
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Attach real-time Firestore listeners ONLY once auth is ready and user is signed in
  useEffect(() => {
    if (!isAuthReady || !user) {
      return;
    }

    setIsLoadingReceipts(true);
    setIsLoadingEarnings(true);
    setVaultError(null);

    const receiptsQuery = query(
      collection(db, 'receipts'),
      where('userId', '==', user.uid)
    );

    const unsubscribeReceipts = onSnapshot(
      receiptsQuery,
      (snapshot) => {
        const list = snapshot.docs.map((d) => d.data() as ReceiptRecord);
        list.sort((a, b) => (b.uploadedAtUtc || '').localeCompare(a.uploadedAtUtc || ''));
        setReceipts(list);
        setIsLoadingReceipts(false);
      },
      (error) => {
        setIsLoadingReceipts(false);
        try {
          handleFirestoreError(error, OperationType.LIST, 'receipts');
        } catch (wrappedErr) {
          setVaultError(
            wrappedErr instanceof Error ? wrappedErr.message : 'Firestore read permission denied.'
          );
        }
      }
    );

    const earningsQuery = query(
      collection(db, 'earnings'),
      where('userId', '==', user.uid)
    );

    const unsubscribeEarnings = onSnapshot(
      earningsQuery,
      (snapshot) => {
        const list = snapshot.docs.map((d) => d.data() as EarningRecord);
        list.sort((a, b) => {
          const dateDiff = (b.earned_date || '').localeCompare(a.earned_date || '');
          if (dateDiff !== 0) return dateDiff;
          return (a.client_name || '').localeCompare(b.client_name || '');
        });
        setEarnings(list);
        setIsLoadingEarnings(false);
      },
      (error) => {
        setIsLoadingEarnings(false);
        try {
          handleFirestoreError(error, OperationType.LIST, 'earnings');
        } catch (wrappedErr) {
          setVaultError(
            wrappedErr instanceof Error ? wrappedErr.message : 'Firestore read permission denied.'
          );
        }
      }
    );

    return () => {
      unsubscribeReceipts();
      unsubscribeEarnings();
    };
  }, [isAuthReady, user]);

  const handleSignOut = async () => {
    await signOut(auth);
    setActiveTab('capture');
  };

  const handleUpdateReceiptFields = async (id: string, fields: ExtractedReceiptFields) => {
    const receiptPath = `receipts/${id}`;
    try {
      await updateDoc(doc(db, 'receipts', id), {
        merchant_name: fields.merchant_name.trim().slice(0, 140),
        receipt_date: fields.receipt_date,
        currency: fields.currency.trim().toUpperCase().slice(0, 3),
        subtotal: Math.round(Number(fields.subtotal) * 100) / 100,
        gst_amount: Math.round(Number(fields.gst_amount) * 100) / 100,
        total_amount: Math.round(Number(fields.total_amount) * 100) / 100,
        category: fields.category.trim().slice(0, 60),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, receiptPath);
    }
  };

  const handleDeleteReceipt = async (id: string) => {
    const target = receipts.find((r) => r.id === id);
    const receiptPath = `receipts/${id}`;
    try {
      await deleteDoc(doc(db, 'receipts', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, receiptPath);
    }

    if (target && auth.currentUser) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        await fetch(`/api/receipts/${encodeURIComponent(id)}/image?hash=${target.sha256Hash}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });
      } catch {
        // Non-blocking image cleanup
      }
    }
  };

  const handleAddEarning = async (input: EarningInput) => {
    if (!user) {
      throw new Error('You must be signed in to record company earnings.');
    }

    const client_name = input.client_name.trim().slice(0, 140);
    if (!client_name) {
      throw new Error('Client or income source name is required.');
    }

    const earned_date = input.earned_date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(earned_date)) {
      throw new Error('Earned date must be in YYYY-MM-DD format.');
    }

    const currency = input.currency.trim().toUpperCase().slice(0, 3);
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error('Currency must be a 3-letter ISO code (e.g. USD, SGD, AUD).');
    }

    const amount = Math.round(Number(input.amount) * 100) / 100;
    const gst_collected = Math.round(Number(input.gst_collected || 0) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Earned amount must be 0 or greater.');
    }
    if (!Number.isFinite(gst_collected) || gst_collected < 0) {
      throw new Error('GST collected must be 0 or greater.');
    }

    const net_revenue = Math.round((amount - gst_collected) * 100) / 100;
    const description = input.description.trim().slice(0, 200);
    const id = crypto.randomUUID();
    const earningPath = `earnings/${id}`;

    try {
      await setDoc(doc(db, 'earnings', id), {
        id,
        userId: user.uid,
        client_name,
        description,
        earned_date,
        currency,
        amount,
        gst_collected,
        net_revenue,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, earningPath);
    }
  };

  const handleDeleteEarning = async (id: string) => {
    const earningPath = `earnings/${id}`;
    try {
      await deleteDoc(doc(db, 'earnings', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, earningPath);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
          <span>Connecting to Cloud Firestore…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <VaultAuthScreen />;
  }

  const navItems: { id: ActiveTab; label: string; shortLabel: string; icon: typeof Camera }[] = [
    { id: 'capture', label: 'Scan Receipt', shortLabel: 'Scan', icon: Camera },
    { id: 'dashboard', label: 'Earnings Ledger', shortLabel: 'Earnings', icon: FileSpreadsheet },
    { id: 'verify', label: 'Verify Integrity', shortLabel: 'Verify', icon: ShieldCheck },
  ];

  const pageTitle =
    activeTab === 'capture'
      ? 'Receipt Capture & Earnings Sealing'
      : activeTab === 'dashboard'
        ? 'Company Earnings & Monthly Totals'
        : 'Tamper-Verification Audit';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Tablet & Desktop Sidebar Navigation */}
      <aside className="hidden md:flex md:flex-col md:w-56 lg:w-60 md:fixed md:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-16 px-5 lg:px-6 flex items-center border-b border-slate-200">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            VaultReceipt
          </span>
        </div>

        <nav className="flex-1 p-3 lg:p-4 space-y-1" aria-label="Primary workspace navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="px-2">
            <p className="text-xs font-semibold text-slate-900 truncate">{user.displayName}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="w-full min-h-[40px] px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <div className="flex-1 md:pl-56 lg:pl-60 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-14 md:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="md:hidden font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              VaultReceipt
            </span>
            <span className="hidden md:inline text-sm font-medium text-slate-500 whitespace-nowrap">
              Firestore Vault
            </span>
            <span className="hidden md:inline text-slate-300" aria-hidden="true">
              /
            </span>
            <h1 className="hidden md:block text-sm font-semibold text-slate-900 truncate">
              {pageTitle}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeTab !== 'capture' && (
              <button
                type="button"
                onClick={() => setActiveTab('capture')}
                className="min-h-[38px] px-3.5 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5 shrink-0" />
                <span>Scan Receipt</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSignOut()}
              aria-label="Sign out"
              className="md:hidden min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-600 hover:text-slate-900 rounded-lg cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24 md:pb-10 max-w-7xl w-full mx-auto space-y-6">
          {vaultError && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2.5 text-sm text-red-800"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="break-all">{vaultError}</span>
            </div>
          )}

          {activeTab === 'capture' && (
            <CaptureView
              receipts={receipts}
              earnings={earnings}
              onUpdateReceipt={handleUpdateReceiptFields}
              onOpenLedger={() => setActiveTab('dashboard')}
            />
          )}

          {activeTab === 'dashboard' && (
            <TaxDashboardView
              user={user}
              receipts={receipts}
              earnings={earnings}
              isLoading={isLoadingReceipts || isLoadingEarnings}
              onDeleteReceipt={handleDeleteReceipt}
              onUpdateReceipt={handleUpdateReceiptFields}
              onAddEarning={handleAddEarning}
              onDeleteEarning={handleDeleteEarning}
              onNavigateCapture={() => setActiveTab('capture')}
            />
          )}

          {activeTab === 'verify' && <VerifyView />}
        </main>
      </div>

      {/* Phone Bottom Tab Bar (Thumb-Zone Ergonomics) */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 pb-[env(safe-area-inset-bottom)] bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-3 items-center"
        aria-label="Mobile navigation"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`h-full min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                isActive ? 'text-teal-700 font-semibold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[11px] leading-none tracking-tight">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
