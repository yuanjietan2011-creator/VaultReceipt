import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { ShieldCheck, Lock, FileCheck2, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { auth, googleProvider } from '../firebase';

export const VaultAuthScreen: React.FC = () => {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign in.';
      if (message.includes('popup-closed-by-user')) {
        setError('Sign-in popup was closed before completing.');
      } else if (message.includes('popup-blocked')) {
        setError('Sign-in popup was blocked by your browser. Please allow popups and try again.');
      } else if (message.includes('unauthorized-domain')) {
        setError(
          `Add "${window.location.hostname}" to Firebase Console → Authentication → Settings → Authorized domains to sign in from this URL.`
        );
      } else {
        setError(message);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            VaultReceipt
          </span>
          <span className="text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
            Company Receipt &amp; Earnings Vault
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-12">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-medium text-teal-700 tracking-wide">
                Company earnings tracking from every receipt across phones, tablets, and PCs
              </p>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
                Track how much your company earns from every receipt with SHA-256 proof.
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                Snap sales receipts on your phone or upload invoices from your computer. Every
                receipt is extracted by Gemini, added straight into your company&apos;s total
                earnings in Cloud Firestore, and stored with AES-256-GCM encryption.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-200">
              <div className="pt-4 space-y-1.5">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                  <Lock className="w-4 h-4 text-teal-700 shrink-0" />
                  <span>Private Cloud Vault</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Zero-trust Firestore rules isolate every receipt strictly to your verified UID.
                </p>
              </div>
              <div className="pt-4 space-y-1.5">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                  <FileCheck2 className="w-4 h-4 text-teal-700 shrink-0" />
                  <span>Automatic Total Earned</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Every scanned receipt extracts client, date, net revenue, GST, and adds to your total.
                </p>
              </div>
              <div className="pt-4 space-y-1.5">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                  <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
                  <span>Tamper Verification</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Drop any receipt later to verify its SHA-256 hash against your Firestore ledger.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 flex items-center">
            <div className="w-full bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
              <div className="space-y-1.5">
                <h2 className="font-display text-xl font-bold text-slate-900">
                  Access Your Earnings Ledger
                </h2>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Sign in with your Google account to view your company&apos;s total receipt
                  earnings across phone, tablet, and PC.
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-800"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="button"
                disabled={isSigningIn}
                onClick={() => void handleGoogleSignIn()}
                className="w-full min-h-[48px] px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
              >
                {isSigningIn ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Opening Sign-In…</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#EA4335"
                        d="M12 5c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.09 14.97 0 12 0 7.39 0 3.41 2.65 1.49 6.51l3.66 2.84C6.01 6.77 8.76 5 12 5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58l3.7 2.87c2.16-1.99 3.72-4.93 3.72-8.69z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.15 14.65A7.01 7.01 0 0 1 4.78 12c0-.92.16-1.81.37-2.65L1.49 6.51A11.96 11.96 0 0 0 0 12c0 1.94.46 3.77 1.49 5.49l3.66-2.84z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.7-2.87c-1.08.72-2.45 1.16-4.23 1.16-3.24 0-5.99-1.77-6.85-4.35l-3.66 2.84C3.41 21.35 7.39 24 12 24z"
                      />
                    </svg>
                    <span>Sign in with Google</span>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </>
                )}
              </button>

              <p className="text-xs text-slate-500 leading-relaxed">
                Protected by Firebase Authentication, Cloud Firestore security rules, and AES-256-GCM
                file encryption.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
