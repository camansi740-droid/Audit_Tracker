import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Upload, CheckCircle, Clock, AlertCircle, FileText,
  Loader2, Download, Briefcase, ChevronLeft, ChevronRight,
  Eye, Paperclip, Send, Calendar, User, FileCheck, FileClock,
  Inbox, ClipboardList, TrendingUp, ChevronDown, ChevronUp, Trash2
} from 'lucide-react';
import { clsx } from 'clsx';

interface Procedure {
  id: string;
  sr_no: string;
  area: string;
  procedure_text: string;
  status: string;
  document_path: string;
  document_original_name: string;
  client_requested: boolean;
  client_uploaded_at: string | null;
  client_upload_note: string | null;
  category: string;
  custom_fields?: string;
  updated_at?: string;
}

interface PortalData {
  client: { id: string; name: string; entity_type: string };
  client_name: string;
  message: string;
  expires_at: string;
  sent_at?: string;
  procedures: Procedure[];
}

type TabKey = 'required' | 'received' | 'pending' | 'auditor_review' | 'timestamps';

const TAB_CONFIG = [
  { key: 'required' as TabKey,       label: 'Required',      Icon: ClipboardList, activeColor: 'border-slate-800 text-slate-900',    countBg: 'bg-slate-800 text-white' },
  { key: 'received' as TabKey,       label: 'Received',      Icon: Inbox,         activeColor: 'border-emerald-600 text-emerald-700', countBg: 'bg-emerald-600 text-white' },
  { key: 'pending' as TabKey,        label: 'Pending',       Icon: FileClock,     activeColor: 'border-amber-500 text-amber-700',    countBg: 'bg-amber-500 text-white' },
  { key: 'auditor_review' as TabKey, label: 'Auditor Review',Icon: User,          activeColor: 'border-violet-600 text-violet-700',  countBg: 'bg-violet-600 text-white' },
  { key: 'timestamps' as TabKey,     label: 'Timestamps',    Icon: Calendar,      activeColor: 'border-blue-600 text-blue-700',      countBg: 'bg-blue-600 text-white' },
];

const CATEGORY_ORDER = ['Initial Documents','Analytical Procedures','Audit Procedures','GST','TDS','Income Tax','PF & ESI','Other'];
const CATEGORY_LABELS: Record<string, string> = {
  'Initial Documents': '1. Initial Documents',
  'Analytical Procedures': '2. Analytical Procedures',
  'Audit Procedures': '3. Audit Procedures',
  'GST': '4a. GST',
  'TDS': '4b. TDS',
  'Income Tax': '4c. Income Tax',
  'PF & ESI': '4d. PF & ESI',
  'Other': '4e. Other',
};

function parseDocs(p: Procedure): Array<{ path: string; name: string }> {
  let paths: string[] = [];
  let names: string[] = [];
  try { paths = JSON.parse(p.document_path || '[]'); } catch { if (p.document_path) paths = [p.document_path]; }
  try { names = JSON.parse(p.document_original_name || '[]'); } catch { if (p.document_original_name) names = [p.document_original_name]; }
  return paths.map((path, i) => ({ path, name: names[i] || `Document ${i + 1}` }));
}

function getField(proc: Procedure, key: string): string {
  try { return JSON.parse(proc.custom_fields || '{}')[key] || ''; } catch { return ''; }
}

function fmtDate(iso?: string | null) {
  if (!iso) return null;
  // Handle truncated "YYYY-MM-DDTHH:MM" (no seconds/timezone) by appending IST offset
  const normalized = iso.length === 16 ? iso + ':00+05:30' : iso;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return null;
  const normalized = iso.length === 16 ? iso + ':00+05:30' : iso;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── CategoryPanel (same logic, auditor portal table format) ──────────────────
function CategoryPanel({ category, procs, token, onUploadDone, sentAt }: {
  category: string; procs: Procedure[]; token: string; onUploadDone: () => void; sentAt: string;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('required');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<Record<string, string>>({});
  const [uploadSuccess, setUploadSuccess] = useState<Record<string, boolean>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<string | null>(null); // "procId-docIndex"
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleDeleteDoc = async (procId: string, docIndex: number, docName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = window.confirm(
      `⚠️ File Delete Confirmation\n\nAre you sure you want to delete "${docName}" will be permanently deleted.\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;
    const key = `${procId}-${docIndex}`;
    setDeletingDoc(key);
    try {
      const res = await fetch(`/api/portal/${token}/document/${procId}/${docIndex}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Delete failed');
      onUploadDone();
    } catch (err: any) {
      alert('❌ Delete failed: ' + err.message);
    } finally {
      setDeletingDoc(null);
    }
  };

  const received = procs.filter(p => parseDocs(p).length > 0);
  const pending   = procs.filter(p => parseDocs(p).length === 0);
  const reviewed  = procs.filter(p => p.status === 'Done');
  const counts: Record<TabKey, number> = {
    required: procs.length, received: received.length,
    pending: pending.length, auditor_review: reviewed.length, timestamps: procs.length,
  };
  const completionPct = procs.length > 0 ? Math.round((received.length / procs.length) * 100) : 0;

  const handleUpload = async (procId: string, files: FileList) => {
    if (!files || files.length === 0) return;
    setUploadingId(procId);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      fd.append('note', uploadNote[procId] || '');
      const res = await fetch(`/api/portal/${token}/upload/${procId}`, { method: 'POST', body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setUploadSuccess(p => ({ ...p, [procId]: true }));
      setTimeout(() => { setUploadSuccess(p => ({ ...p, [procId]: false })); onUploadDone(); }, 2000);
    } catch (e: any) { alert('Upload failed: ' + e.message); }
    finally { setUploadingId(null); }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

      {/* ── Tab Bar — auditor portal style ── */}
      <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto">
        {TAB_CONFIG.map(({ key, label, Icon, activeColor, countBg }) => {
          const isActive = activeTab === key;
          return (
            <button key={key} onClick={() => setActiveTab(key)}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-all flex-shrink-0',
                isActive ? `${activeColor} bg-white` : 'border-transparent text-gray-500 hover:bg-white hover:border-gray-200'
              )}>
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className={clsx('text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5',
                isActive ? countBg : 'bg-gray-200 text-gray-600')}>
                {counts[key]}
              </span>
            </button>
          );
        })}
        {/* Progress in tab bar right side */}
        <div className="ml-auto flex items-center gap-2 px-4">
          <div className="w-20 bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div className="bg-emerald-500 h-1.5 rounded-full transition-all" style={{ width: `${completionPct}%` }} />
          </div>
          <span className="text-xs font-bold text-gray-600">{completionPct}%</span>
        </div>
      </div>

      {/* ── Table Header ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">SR.</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">AREA/HEAD</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">PROCEDURE</th>
              {activeTab === 'required' && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-72">DOCUMENT / UPLOAD</th>}
              {activeTab === 'received' && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-72">UPLOADED FILES</th>}
              {activeTab === 'pending' && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-48">STATUS</th>}
              {activeTab === 'auditor_review' && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-72">REVIEW STATUS</th>}
              {activeTab === 'timestamps' && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-80">TIMELINE</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">

            {/* ── REQUIRED TAB ── */}
            {activeTab === 'required' && procs.map(proc => {
              const docs = parseDocs(proc);
              const hasDoc = docs.length > 0;
              const isUploading = uploadingId === proc.id;
              const isSuccess = uploadSuccess[proc.id];
              const isExpanded = expandedId === proc.id;
              return (
                <React.Fragment key={proc.id}>
                  <tr className={clsx('hover:bg-gray-50 transition-colors cursor-pointer', hasDoc ? '' : 'bg-amber-50/20')}
                    onClick={() => setExpandedId(isExpanded ? null : proc.id)}>
                    <td className="px-4 py-4 text-gray-500 font-medium">{proc.sr_no}</td>
                    <td className="px-4 py-4 text-gray-700 font-medium">{proc.area}</td>
                    <td className="px-4 py-4">
                      <p className="text-gray-800">{proc.procedure_text}</p>
                      {hasDoc
                        ? <p className="text-xs text-emerald-600 mt-1 font-medium">✅ {docs.length} file{docs.length > 1 ? 's' : ''} uploaded{proc.updated_at ? ` · ${fmtDate(proc.updated_at)}` : ''}</p>
                        : <p className="text-xs text-amber-500 mt-1">⏳ Not uploaded yet</p>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        {/* File chips */}
                        {hasDoc && (
                          <div className="flex flex-wrap gap-1 mb-1">
                            {docs.map((doc, i) => (
                              <div key={i} className="flex items-center gap-1 bg-white border border-gray-200 rounded px-2 py-1">
                                <Paperclip className="h-3 w-3 text-indigo-400 flex-shrink-0" />
                                <span className="text-xs text-indigo-600 truncate max-w-[100px]" title={doc.name}>{doc.name.length > 12 ? doc.name.slice(0,12)+'…' : doc.name}</span>
                                <a href={`/api/portal/${token}/document/${proc.id}/${i}`} target="_blank" rel="noreferrer"
                                  onClick={e => e.stopPropagation()} className="text-gray-400 hover:text-indigo-600 ml-0.5">
                                  <Eye className="h-3 w-3" />
                                </a>
                                <a href={`/api/portal/${token}/document/${proc.id}/${i}`} download
                                  onClick={e => e.stopPropagation()} className="text-gray-400 hover:text-indigo-600">
                                  <Download className="h-3 w-3" />
                                </a>
                                <button
                                  onClick={e => handleDeleteDoc(proc.id, i, doc.name, e)}
                                  disabled={deletingDoc === `${proc.id}-${i}`}
                                  title="Delete this file"
                                  className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40 ml-0.5">
                                  {deletingDoc === `${proc.id}-${i}`
                                    ? <Loader2 className="h-3 w-3 animate-spin text-red-400" />
                                    : <Trash2 className="h-3 w-3" />}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400 ml-auto" /> : <ChevronDown className="h-4 w-4 text-gray-400 ml-auto" />}
                      </div>
                    </td>
                  </tr>
                  {/* Expanded upload row */}
                  {isExpanded && (
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <td colSpan={4} className="px-6 py-4">
                        <div className="flex flex-col gap-3 max-w-lg" onClick={e => e.stopPropagation()}>
                          <label className="text-xs font-semibold text-gray-600">Note (optional)</label>
                          <input type="text" placeholder="Any remarks for the auditor..."
                            value={uploadNote[proc.id] || ''}
                            onChange={e => setUploadNote(p => ({ ...p, [proc.id]: e.target.value }))}
                            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-300 outline-none w-full" />
                          <input ref={el => { fileInputRefs.current[proc.id] = el; }} type="file" multiple
                            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx,.zip" className="hidden"
                            onChange={e => { if (e.target.files) handleUpload(proc.id, e.target.files); }} />
                          <button disabled={isUploading} onClick={() => fileInputRefs.current[proc.id]?.click()}
                            className={clsx('inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all w-fit',
                              isSuccess ? 'bg-emerald-500 text-white'
                              : isUploading ? 'bg-indigo-300 text-white cursor-not-allowed'
                              : 'bg-indigo-600 hover:bg-indigo-700 text-white')}>
                            {isSuccess ? <><CheckCircle className="h-4 w-4" /> Uploaded!</>
                              : isUploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</>
                              : <><Upload className="h-4 w-4" /> {hasDoc ? 'Upload More Files' : 'Upload Files'}</>}
                          </button>
                          <p className="text-xs text-gray-400">PDF, Image, Excel, Word, ZIP — Multiple files allowed</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {/* ── RECEIVED TAB ── */}
            {activeTab === 'received' && (
              received.length === 0
                ? <tr><td colSpan={4} className="text-center py-10 text-gray-400"><Inbox className="h-8 w-8 mx-auto mb-2 text-gray-200" /><p className="text-sm">No documents received yet</p></td></tr>
                : received.map(proc => {
                    const docs = parseDocs(proc);
                    return (
                      <tr key={proc.id} className="hover:bg-emerald-50/20 transition-colors">
                        <td className="px-4 py-4 text-gray-500 font-medium">{proc.sr_no}</td>
                        <td className="px-4 py-4 text-gray-700 font-medium">{proc.area}</td>
                        <td className="px-4 py-4 text-gray-800">{proc.procedure_text}</td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-1.5">
                            {docs.map((doc, i) => (
                              <div key={i} className="inline-flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-semibold">
                                <a href={`/api/portal/${token}/document/${proc.id}/${i}`} target="_blank" rel="noreferrer"
                                  className="inline-flex items-center gap-1 hover:text-emerald-900 transition-colors">
                                  <FileText className="h-3 w-3" />
                                  {doc.name.length > 20 ? doc.name.slice(0,20)+'…' : doc.name}
                                  <Download className="h-2.5 w-2.5 ml-0.5" />
                                </a>
                                <button
                                  onClick={e => handleDeleteDoc(proc.id, i, doc.name, e)}
                                  disabled={deletingDoc === `${proc.id}-${i}`}
                                  title="Delete this file"
                                  className="text-emerald-300 hover:text-red-500 transition-colors disabled:opacity-40 ml-1">
                                  {deletingDoc === `${proc.id}-${i}`
                                    ? <Loader2 className="h-3 w-3 animate-spin text-red-400" />
                                    : <Trash2 className="h-3 w-3" />}
                                </button>
                              </div>
                            ))}
                          </div>
                          {proc.updated_at && (
                            <p className="text-[11px] text-gray-400 mt-1.5 flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Received: <span className="font-semibold text-gray-600 ml-1">{fmtDateTime(proc.updated_at)}</span>
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })
            )}

            {/* ── PENDING TAB ── */}
            {activeTab === 'pending' && (
              pending.length === 0
                ? <tr><td colSpan={4} className="text-center py-10"><CheckCircle className="h-8 w-8 mx-auto mb-2 text-emerald-400" /><p className="text-sm font-bold text-emerald-600">All documents received! 🎉</p></td></tr>
                : pending.map(proc => (
                    <tr key={proc.id} className="bg-amber-50/20 hover:bg-amber-50/40 transition-colors">
                      <td className="px-4 py-4 text-gray-500 font-medium">{proc.sr_no}</td>
                      <td className="px-4 py-4 text-gray-700 font-medium">{proc.area}</td>
                      <td className="px-4 py-4 text-gray-800">{proc.procedure_text}</td>
                      <td className="px-4 py-4">
                        <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-semibold border border-amber-200">
                          <AlertCircle className="h-3 w-3" /> Pending
                        </span>
                      </td>
                    </tr>
                  ))
            )}

            {/* ── AUDITOR REVIEW TAB ── */}
            {activeTab === 'auditor_review' && procs.map(proc => {
              const docs = parseDocs(proc);
              const hasDoc = docs.length > 0;
              const isReviewed = proc.status === 'Done';
              const reviewedBy = getField(proc, '_tracked_reviewed_by');
              const reviewedAt = proc.updated_at || getField(proc, '_tracked_reviewed_at');
              return (
                <tr key={proc.id} className={clsx('transition-colors', isReviewed ? 'bg-violet-50/30' : 'hover:bg-gray-50')}>
                  <td className="px-4 py-4 text-gray-500 font-medium">{proc.sr_no}</td>
                  <td className="px-4 py-4 text-gray-700 font-medium">{proc.area}</td>
                  <td className="px-4 py-4 text-gray-800">{proc.procedure_text}</td>
                  <td className="px-4 py-4">
                    {isReviewed ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1 text-[11px] bg-violet-100 text-violet-700 px-2.5 py-1 rounded-full font-bold border border-violet-200">
                          <User className="h-3 w-3" /> Reviewed by {reviewedBy || 'Auditor'}
                        </span>
                        {reviewedAt && <p className="text-[11px] text-gray-400">on {fmtDate(reviewedAt)}</p>}
                      </div>
                    ) : hasDoc ? (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full font-semibold">
                        <Clock className="h-3 w-3" /> Awaiting auditor review
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-amber-50 text-amber-600 px-2.5 py-1 rounded-full font-semibold border border-amber-100">
                        <FileClock className="h-3 w-3" /> Document not uploaded
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* ── TIMESTAMPS TAB ── */}
            {activeTab === 'timestamps' && procs.map(proc => {
              const docs = parseDocs(proc);
              const hasDoc = docs.length > 0;
              const clientRespondedAt = getField(proc, '_tracked_client_responded') || (hasDoc ? proc.updated_at : null);
              const isReviewed = proc.status === 'Done';
              const reviewedAt = isReviewed ? proc.updated_at : null;
              return (
                <tr key={proc.id} className="hover:bg-blue-50/10 transition-colors">
                  <td className="px-4 py-4 text-gray-500 font-medium">{proc.sr_no}</td>
                  <td className="px-4 py-4 text-gray-700 font-medium">{proc.area}</td>
                  <td className="px-4 py-4 text-gray-800">{proc.procedure_text}</td>
                  <td className="px-4 py-4">
                    <div className="flex gap-2">
                      <div className="flex items-center gap-1.5 bg-blue-50 rounded-lg px-2.5 py-1.5 border border-blue-100">
                        <Send className="h-3 w-3 text-blue-400" />
                        <div>
                          <p className="text-[9px] font-bold text-blue-400 uppercase">Sent</p>
                          <p className="text-[10px] font-bold text-blue-900">{sentAt ? fmtDate(sentAt) : '—'}</p>
                        </div>
                      </div>
                      <div className={clsx('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 border', hasDoc ? 'bg-emerald-50 border-emerald-100' : 'bg-gray-50 border-gray-100')}>
                        <Inbox className={clsx('h-3 w-3', hasDoc ? 'text-emerald-400' : 'text-gray-300')} />
                        <div>
                          <p className={clsx('text-[9px] font-bold uppercase', hasDoc ? 'text-emerald-500' : 'text-gray-400')}>Responded</p>
                          <p className={clsx('text-[10px] font-bold', hasDoc ? 'text-emerald-900' : 'text-gray-400')}>{hasDoc && clientRespondedAt ? fmtDate(clientRespondedAt) : '—'}</p>
                        </div>
                      </div>
                      <div className={clsx('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 border', isReviewed ? 'bg-violet-50 border-violet-100' : 'bg-gray-50 border-gray-100')}>
                        <User className={clsx('h-3 w-3', isReviewed ? 'text-violet-400' : 'text-gray-300')} />
                        <div>
                          <p className={clsx('text-[9px] font-bold uppercase', isReviewed ? 'text-violet-500' : 'text-gray-400')}>Reviewed</p>
                          <p className={clsx('text-[10px] font-bold', isReviewed ? 'text-violet-900' : 'text-gray-400')}>{isReviewed && reviewedAt ? fmtDate(reviewedAt) : '—'}</p>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}

          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main ClientPortal ─────────────────────────────────────────────────────────
export default function ClientPortal() {
  const { token } = useParams<{ token: string }>();
  const [portalData, setPortalData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchPortal(); }, [token]);

  const fetchPortal = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/portal/${token}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong'); return; }
      setPortalData(data);
    } catch { setError('Cannot connect to server. Please try again later.'); }
    finally { setLoading(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="h-10 w-10 text-indigo-500 animate-spin mx-auto mb-4" />
        <p className="text-gray-600 font-medium">Loading portal...</p>
      </div>
    </div>
  );

  if (error || !portalData) return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="h-8 w-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Link Invalid or Expired</h2>
        <p className="text-gray-500 text-sm">{error}</p>
        <p className="text-gray-400 text-xs mt-4">Please contact your CA firm for a new link.</p>
      </div>
    </div>
  );

  const { client, client_name, message, expires_at, procedures: allProcedures } = portalData;
  const sentAt = portalData.sent_at || '';

  // Show only procedures meant for the client (doc_source = 'client' or unset)
  const procedures = allProcedures.filter(p => {
    try {
      const cf = JSON.parse(p.custom_fields || '{}');
      return (cf['doc_source'] || 'client') === 'client';
    } catch { return true; }
  });

  const presentCats = CATEGORY_ORDER.filter(cat => procedures.some(p => (p.category || 'Other') === cat));
  const otherCats = Array.from(new Set(procedures.map(p => p.category || 'Other'))).filter(c => !CATEGORY_ORDER.includes(c));
  const categories = [...presentCats, ...otherCats];
  const currentCategory = activeCategory || categories[0] || '';

  const received    = procedures.filter(p => parseDocs(p).length > 0);
  const uploaded    = received;
  const pendingAll  = procedures.filter(p => parseDocs(p).length === 0);
  const auditorReviewed = procedures.filter(p => p.status === 'Done');
  const daysLeft = Math.ceil((new Date(expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const pct = procedures.length > 0 ? Math.round((received.length / procedures.length) * 100) : 0;

  const scrollTabs = (dir: 'left' | 'right') => {
    if (tabsRef.current) tabsRef.current.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  return (
    <div className="flex h-screen bg-gray-50 flex-col">

      {/* ── Header — same as Auditor portal ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 font-bold text-xl text-indigo-600">
              <Briefcase className="w-6 h-6" />
              <span>AuditFlow AI</span>
            </div>
            <span className="text-gray-300 text-xl">|</span>
            <div>
              <h1 className="font-bold text-gray-900 text-base">{client.name}</h1>
              <p className="text-xs text-gray-400">
                AUDIT PROGRAMME &nbsp;&middot;&nbsp;
                {client.entity_type || 'service'} &nbsp;&middot;&nbsp;
                <span className="text-indigo-500">Document Upload Portal</span>
              </p>
            </div>
          </div>
          <div className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold',
            daysLeft <= 2 ? 'bg-red-100 text-red-700' : daysLeft <= 5 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
            <Clock className="h-3.5 w-3.5" />
            {daysLeft > 0 ? `${daysLeft} days left` : 'Expired'}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto space-y-5">

          {/* ── Welcome message ── */}
          {message && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-4">
              <p className="text-sm text-indigo-800 font-medium">👋 Hello, {client_name}! &nbsp;—&nbsp; {message}</p>
            </div>
          )}

          {/* ── Stats Cards ── */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'REQUIRED',       value: procedures.length,       color: 'text-gray-800',    icon: <ClipboardList className="h-9 w-9 text-gray-300" /> },
              { label: 'RECEIVED',       value: received.length,         color: 'text-emerald-600', icon: <Inbox className="h-9 w-9 text-emerald-300" /> },
              { label: 'PENDING',        value: pendingAll.length,       color: 'text-amber-600',   icon: <FileClock className="h-9 w-9 text-amber-300" /> },
              { label: 'AUDITOR REVIEW', value: auditorReviewed.length,  color: 'text-violet-600',  icon: <User className="h-9 w-9 text-violet-300" /> },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between shadow-sm">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{s.label}</p>
                  <p className={`text-4xl font-bold ${s.color}`}>{s.value}</p>
                </div>
                {s.icon}
              </div>
            ))}
          </div>

          {/* ── Progress bar ── */}
          {procedures.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex justify-between text-xs text-gray-600 mb-2 font-semibold">
                <span className="flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5 text-indigo-400" /> Overall Progress</span>
                <span className={clsx('font-black', pct === 100 ? 'text-emerald-600' : 'text-gray-700')}>{pct}% complete</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                <div className={clsx('h-2.5 rounded-full transition-all duration-500', pct === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-indigo-500 to-violet-500')}
                  style={{ width: `${pct}%` }} />
              </div>
              {pct === 100 && (
                <p className="text-xs text-emerald-600 font-bold mt-2 flex items-center gap-1">
                  <CheckCircle className="h-3.5 w-3.5" /> All documents uploaded! Thank you 🎉
                </p>
              )}
            </div>
          )}

          {/* ── Category Tabs — same as Auditor portal ── */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center border-b border-gray-200">
              <button onClick={() => scrollTabs('left')} className="p-2 text-gray-400 hover:text-gray-600 flex-shrink-0">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div ref={tabsRef} className="flex overflow-x-auto flex-1" style={{ scrollbarWidth: 'none' }}>
                {categories.map(cat => {
                  const catProcs = procedures.filter(p => (p.category || 'Other') === cat);
                  const isActive = currentCategory === cat;
                  return (
                    <button key={cat} onClick={() => setActiveCategory(cat)}
                      className={clsx(
                        'flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0',
                        isActive
                          ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      )}>
                      {CATEGORY_LABELS[cat] || cat}
                      <span className={clsx('text-xs font-bold px-2 py-0.5 rounded-full',
                        isActive ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-600')}>
                        {catProcs.length}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => scrollTabs('right')} className="p-2 text-gray-400 hover:text-gray-600 flex-shrink-0">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Category Panel with tabs + table */}
            {categories.map(cat => {
              const catProcs = procedures.filter(p => (p.category || 'Other') === cat);
              if (cat !== currentCategory || catProcs.length === 0) return null;
              return (
                <CategoryPanel
                  key={cat}
                  category={cat}
                  procs={catProcs}
                  token={token!}
                  onUploadDone={fetchPortal}
                  sentAt={sentAt}
                />
              );
            })}
          </div>

          {/* Footer */}
          <div className="text-center py-2">
            <p className="text-xs text-gray-400">
              Valid until {new Date(expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              &nbsp;·&nbsp; Powered by AuditFlow AI
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
