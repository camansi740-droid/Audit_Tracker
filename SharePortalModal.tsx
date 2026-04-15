// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/SharePortalModal.tsx
// Import in ClientDetail: import SharePortalModal from '../components/SharePortalModal';
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { X, Link2, Mail, Copy, CheckCircle, Loader2, Trash2, ExternalLink, Clock, Send } from 'lucide-react';
import { clsx } from 'clsx';

interface Procedure {
  id: string;
  sr_no: string;
  area: string;
  procedure_text: string;
  status: string;
  category: string;
}

interface ExistingLink {
  id: string;
  client_email: string;
  client_name: string;
  expires_at: string;
  created_at: string;
  is_active: boolean;
  token: string;
}

interface Props {
  clientId: string;
  clientName: string;
  procedures: Procedure[];
  onClose: () => void;
}

export default function SharePortalModal({ clientId, clientName, procedures, onClose }: Props) {
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [expiresDays, setExpiresDays] = useState(7);
  const [selectedProcs, setSelectedProcs] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [existingLinks, setExistingLinks] = useState<ExistingLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [error, setError] = useState('');

  // Show only pending / in-progress procedures
  const relevantProcs = procedures.filter(p => p.status !== 'Done' && p.status !== 'Not Applicable');

  useEffect(() => {
    fetchExistingLinks();
  }, []);

  const fetchExistingLinks = async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/portal-links`);
      const data = await res.json();
      setExistingLinks(Array.isArray(data) ? data.filter((l: ExistingLink) => l.is_active) : []);
    } catch {} finally {
      setLoadingLinks(false);
    }
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedProcs([]);
      setSelectAll(false);
    } else {
      setSelectedProcs(relevantProcs.map(p => p.id));
      setSelectAll(true);
    }
  };

  const toggleProc = (id: string) => {
    setSelectedProcs(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleGenerate = async () => {
    if (!email.trim() || !name.trim()) {
      setError('Email and name are both required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/portal-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_email: email.trim(),
          client_name: name.trim(),
          message: message.trim(),
          expires_days: expiresDays,
          procedure_ids: selectedProcs,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate link');
      setGeneratedUrl(data.portal_url);
      setEmailSent(data.email_sent);
      setStep('success');
      fetchExistingLinks();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const deactivateLink = async (linkId: string) => {
    if (!confirm('Are you sure you want to deactivate this link?')) return;
    await fetch(`/api/portal-links/${linkId}`, { method: 'DELETE' });
    fetchExistingLinks();
  };

  const appBase = window.location.origin;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
              <Link2 className="h-4 w-4 text-indigo-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base">Client Upload Portal</h2>
              <p className="text-xs text-slate-500">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">

          {/* Existing Active Links */}
          {!loadingLinks && existingLinks.length > 0 && (
            <div className="px-6 pt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Active Links</p>
              <div className="space-y-2 mb-4">
                {existingLinks.map(link => {
                  const expired = new Date(link.expires_at) < new Date();
                  const url = `${appBase}/portal/${link.token}`;
                  return (
                    <div key={link.id} className="bg-slate-50 rounded-xl p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-800 truncate">{link.client_name}</p>
                          <span className={clsx(
                            "text-xs px-2 py-0.5 rounded-full font-medium",
                            expired ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700"
                          )}>
                            {expired ? 'Expired' : 'Active'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 truncate">{link.client_email}</p>
                        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(link.expires_at).toLocaleDateString('en-IN')} tak valid
                        </p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => copyLink(url)}
                          className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition-all text-slate-400 hover:text-indigo-600"
                          title="Copy link"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition-all text-slate-400 hover:text-indigo-600"
                          title="Open portal"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <button
                          onClick={() => deactivateLink(link.id)}
                          className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition-all text-slate-400 hover:text-red-500"
                          title="Deactivate"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-slate-200 mb-4" />
            </div>
          )}

          {/* Form / Success */}
          {step === 'form' ? (
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-slate-600">Send the client a secure link where they can directly upload their documents.</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Client ka Naam *</label>
                  <input
                    type="text"
                    placeholder="Ramesh Kumar"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address *</label>
                  <input
                    type="email"
                    placeholder="ramesh@company.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Message (optional)</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Please upload GST returns, bank statements..."
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Link Validity</label>
                <div className="flex gap-2">
                  {[3, 7, 14, 30].map(d => (
                    <button
                      key={d}
                      onClick={() => setExpiresDays(d)}
                      className={clsx(
                        "flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors",
                        expiresDays === d
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
                      )}
                    >
                      {d} Days
                    </button>
                  ))}
                </div>
              </div>

              {/* Select Procedures */}
              {relevantProcs.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-700">
                      Select Documents ({selectedProcs.length} selected)
                    </label>
                    <button
                      onClick={handleSelectAll}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      {selectAll ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-44 overflow-y-auto">
                    {relevantProcs.map((proc, i) => (
                      <label
                        key={proc.id}
                        className={clsx(
                          "flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors",
                          i > 0 && "border-t border-slate-100"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedProcs.includes(proc.id)}
                          onChange={() => toggleProc(proc.id)}
                          className="mt-0.5 accent-indigo-600"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-700 truncate">{proc.procedure_text || proc.area}</p>
                          <p className="text-xs text-slate-400">{proc.category}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Selected documents will be specifically requested from the client
                  </p>
                </div>
              )}

              {error && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}
            </div>
          ) : (
            /* Success Step */
            <div className="px-6 py-6 text-center space-y-4">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="h-8 w-8 text-emerald-500" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Link Ready Hai! 🎉</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {emailSent ? (
                    <span className="flex items-center justify-center gap-1.5 text-emerald-600">
                      <Mail className="h-4 w-4" /> Email sent successfully — {email}
                    </span>
                  ) : (
                    <span className="text-amber-600">Email not sent (SMTP not configured). Please copy the link and share manually.</span>
                  )}
                </p>
              </div>

              <div className="bg-slate-50 rounded-xl p-3 text-left">
                <p className="text-xs text-slate-500 mb-1 font-medium">Portal Link:</p>
                <p className="text-xs text-slate-700 break-all font-mono leading-relaxed">{generatedUrl}</p>
              </div>

              <button
                onClick={() => copyLink(generatedUrl)}
                className={clsx(
                  "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all",
                  copied ? "bg-emerald-500 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white"
                )}
              >
                {copied ? <><CheckCircle className="h-4 w-4" /> Copied!</> : <><Copy className="h-4 w-4" /> Copy Link</>}
              </button>

              <a
                href={generatedUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                <ExternalLink className="h-4 w-4" /> Preview Portal
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'form' && (
          <div className="px-6 py-4 border-t border-slate-200 flex-shrink-0 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-xl text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
              ) : (
                <><Send className="h-4 w-4" /> Generate Link</>
              )}
            </button>
          </div>
        )}
        {step === 'success' && (
          <div className="px-6 py-4 border-t border-slate-200 flex-shrink-0">
            <button
              onClick={() => { setStep('form'); setEmail(''); setName(''); setMessage(''); setSelectedProcs([]); setSelectAll(false); }}
              className="w-full py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Naya Link Banao
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
