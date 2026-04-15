import React, { useState } from 'react';
import { Briefcase, Lock, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }

      onLogin();
    } catch {
      setError('Unable to connect to server. Please check if the server is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl shadow-lg mb-4">
            <Briefcase className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">AuditFlow AI</h1>
          <p className="text-slate-500 text-sm mt-1">CA Audit Management System</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Login</h2>
          <p className="text-sm text-slate-500 mb-6">
            Enter your app password to continue
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Password field */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                App Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Password dalein..."
                  className="w-full pl-10 pr-10 py-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none transition-all"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-3 rounded-xl transition-colors text-sm shadow-sm"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Logging in...</>
              ) : (
                'Login →'
              )}
            </button>
          </form>

          {/* Hint */}
          <p className="text-xs text-slate-400 text-center mt-5">
            Default password: <span className="font-mono font-semibold text-slate-500">audit123</span>
            <br />
            <span className="text-xs">(To change, set APP_PASSWORD in your .env file)</span>
          </p>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          This portal is for authorized CA staff only
        </p>
      </div>
    </div>
  );
}
