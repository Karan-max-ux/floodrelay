'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOperatorAuth } from '@/lib/auth/OperatorAuthContext';

function OperatorLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading, login } = useOperatorAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = searchParams.get('from') || '/operator';

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(from);
    }
  }, [isAuthenticated, isLoading, router, from]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!username.trim() || !password) {
      setErrorMessage('Please enter both operator username and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await login(username.trim(), password);
      if (result.success) {
        router.replace(from);
      } else {
        setErrorMessage(result.error || 'Authentication failed. Please verify credentials.');
      }
    } catch (err) {
      setErrorMessage((err as Error).message || 'An unexpected authentication error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1c2f] text-on-surface font-inter flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Command Insignia & Brand Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary-container text-on-primary flex items-center justify-center shadow-lg mb-3">
            <span className="material-symbols-outlined text-[32px]">tsunami</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">FloodRelay Command</h1>
          <p className="text-xs font-mono font-semibold text-primary-fixed tracking-wider mt-1">
            DELHI FLOOD OPERATIONS CENTRE • OPERATOR PORTAL
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Operator Sign In</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Authenticate with your emergency responder credentials to access sector dispatch and
              distress management.
            </p>
          </div>

          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800 text-red-200 text-xs flex items-start gap-2.5">
              <span className="material-symbols-outlined text-red-400 text-[18px] shrink-0 mt-0.5">
                error
              </span>
              <div className="space-y-0.5">
                <span className="font-semibold block">Authentication Error</span>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label
                className="block text-xs font-semibold text-on-surface mb-1.5"
                htmlFor="operator-username"
              >
                Operator Username
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant text-[20px]">
                  badge
                </span>
                <input
                  autoCapitalize="none"
                  autoComplete="username"
                  autoFocus
                  className="w-full pl-10 pr-3 py-2.5 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all font-mono"
                  id="operator-username"
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. operator or commander"
                  required
                  type="text"
                  value={username}
                />
              </div>
            </div>

            <div>
              <label
                className="block text-xs font-semibold text-on-surface mb-1.5"
                htmlFor="operator-password"
              >
                Passphrase
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant text-[20px]">
                  lock
                </span>
                <input
                  autoComplete="current-password"
                  className="w-full pl-10 pr-3 py-2.5 bg-surface-container-low border border-outline-variant rounded-xl text-xs text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  id="operator-password"
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  type="password"
                  value={password}
                />
              </div>
            </div>

            <button
              className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-bold text-xs uppercase tracking-wider transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Verifying Session...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">vpn_key</span>
                  <span>Sign In to Command Center</span>
                </>
              )}
            </button>
          </form>

          {/* Security Notice */}
          <div className="pt-4 border-t border-outline-variant/30 flex items-start gap-2 text-[11px] text-on-surface-variant leading-relaxed">
            <span className="material-symbols-outlined text-outline text-[16px] shrink-0 mt-0.5">
              verified_user
            </span>
            <span>
              Authorized Emergency Personnel Only. All session access is cryptographically verified
              and logged for disaster provenance.
            </span>
          </div>
        </div>

        {/* Footer Sector Status */}
        <div className="text-center mt-6 text-[11px] text-white/50 font-mono">
          FloodRelay Decision Support • Delhi NCR
        </div>
      </div>
    </div>
  );
}

export default function OperatorLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0d1c2f] flex items-center justify-center text-white/60 font-mono text-xs">
          Loading Operator Portal...
        </div>
      }
    >
      <OperatorLoginForm />
    </Suspense>
  );
}
