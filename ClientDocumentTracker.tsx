// FILE: src/components/ClientDocumentTracker.tsx
// Import in ClientDetail:
// import ClientDocumentTracker from '../components/ClientDocumentTracker';

import React, { useState, useEffect } from 'react';
import {
  X, CheckCircle, Clock, AlertCircle, FileText,
  Send, RefreshCw, ChevronDown, ChevronRight,
  User, Calendar, FileCheck, FileClock, Eye, Search,
  Edit3, Save, XCircle, TrendingUp, Inbox
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
  category?: string;
  custom_fields?: string;
  updated_at?: string;
}

interface PortalLink {
  id: string;
  client_id: string;
  client_name: string;
  client_email: string;
  created_at: string;
  expires_at: string;
  is_active: boolean;
}

interface TrackingRow {
  proc: Procedure;
  docReceived: boolean;
  docPending: boolean;
  reviewedByAuditor: boolean;
  reviewedBy: string;
  reviewedAt: string;
  sentAt: string;
  clientRespondedAt: string;
  notes: string;
}

interface Props {
  clientId: string;
  clientName: string;
  procedures: Procedure[];
  onClose: () => void;
}

const CATEGORIES = [
  'Initial Documents', 'Analytical Procedures', 'Audit Procedures',
  'GST', 'TDS', 'Income Tax', 'PF & ESI', 'Other'
];

function parseDocs(p: Procedure): string[] {
  if (!p.document_path) return [];
  try {
    const paths = JSON.parse(p.document_path);
    const names = JSON.parse(p.document_original_name || '[]');
    if (Array.isArray(paths)) return names.length ? names : paths.map((x: string) => x.split('/').pop() || x);
  } catch {}
  return p.document_original_name ? [p.document_original_name] : [];
}

function getCustomField(proc: Procedure, key: string): string {
  try { return JSON.parse(proc.custom_fields || '{}')[key] || ''; } catch { return ''; }
}

const fmt = (iso: string) => {
  if (!iso) return '—';
  const normalized = iso.length === 16 ? iso + ':00+05:30' : iso;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const normalized = iso.length === 16 ? iso + ':00+05:30' : iso;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function ClientDocumentTracker({ clientId, clientName, procedures, onClose }: Props) {
  const [portalLinks, setPortalLinks] = useState<PortalLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(CATEGORIES));
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'received' | 'pending' | 'reviewed'>('all');
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editData, setEditData] = useState<{
    reviewedBy: string;
    reviewedAt: string;
    notes: string;
    reviewedByAuditor: boolean;
    clientRespondedAt: string;
  }>({ reviewedBy: '', reviewedAt: '', notes: '', reviewedByAuditor: false, clientRespondedAt: '' });

  useEffect(() => { fetchPortalLinks(); }, []);

  const fetchPortalLinks = async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/portal-links`);
      const data = await res.json();
      setPortalLinks(Array.isArray(data) ? data : []);
    } catch {} finally { setLoading(false); }
  };

  const latestSentAt = portalLinks.length > 0
    ? portalLinks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]?.created_at
    : '';

  const buildRows = (procs: Procedure[]): TrackingRow[] =>
    procs.map(proc => {
      const docs = parseDocs(proc);
      const docReceived = docs.length > 0;
      const reviewedByAuditor = getCustomField(proc, '_tracked_reviewed') === 'true';
      const reviewedBy = getCustomField(proc, '_tracked_reviewed_by');
      const reviewedAt = getCustomField(proc, '_tracked_reviewed_at');
      const clientRespondedAt = getCustomField(proc, '_tracked_client_responded') || (docReceived ? proc.updated_at || '' : '');
      const notes = getCustomField(proc, '_tracked_notes');
      return {
        proc, docReceived, docPending: !docReceived,
        reviewedByAuditor, reviewedBy, reviewedAt,
        sentAt: latestSentAt, clientRespondedAt, notes,
      };
    });

  // datetime-local input needs "YYYY-MM-DDTHH:MM" format
  const toInputDT = (iso?: string) => {
    if (!iso) return '';
    // already truncated
    if (iso.length === 16) return iso;
    // full ISO → convert to local IST for display
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const offset = 5.5 * 60; // IST +5:30
    const local = new Date(d.getTime() + offset * 60000);
    return local.toISOString().slice(0, 16);
  };

  const startEdit = (row: TrackingRow) => {
    setEditingRow(row.proc.id);
    setEditData({
      reviewedBy: row.reviewedBy,
      reviewedAt: toInputDT(row.reviewedAt) || toInputDT(new Date().toISOString()),
      notes: row.notes,
      reviewedByAuditor: row.reviewedByAuditor,
      clientRespondedAt: toInputDT(row.clientRespondedAt) || '',
    });
  };

  const saveEdit = async (procId: string, currentCustomFields: string) => {
    setSaving(procId);
    try {
      let fields: any = {};
      try { fields = JSON.parse(currentCustomFields || '{}'); } catch {}
      fields['_tracked_reviewed'] = String(editData.reviewedByAuditor);
      fields['_tracked_reviewed_by'] = editData.reviewedBy;
      // Convert datetime-local format (YYYY-MM-DDTHH:MM) to full ISO if needed
      fields['_tracked_reviewed_at'] = editData.reviewedAt
        ? (editData.reviewedAt.length === 16 ? editData.reviewedAt + ':00+05:30' : editData.reviewedAt)
        : '';
      fields['_tracked_notes'] = editData.notes;
      fields['_tracked_client_responded'] = editData.clientRespondedAt
        ? (editData.clientRespondedAt.length === 16 ? editData.clientRespondedAt + ':00+05:30' : editData.clientRespondedAt)
        : '';

      const res = await fetch(`/api/procedures/${procId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ custom_fields: JSON.stringify(fields) }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${res.status}`);
      }

      // Update local procedures so tracker UI reflects immediately
      const proc = procedures.find(p => p.id === procId);
      if (proc) proc.custom_fields = JSON.stringify(fields);
    } catch (e: any) {
      alert(`Save failed: ${e.message || 'Please try again.'}`);
    }
    finally { setSaving(null); setEditingRow(null); }
  };

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const filterProcs = (procs: Procedure[]) => {
    const rows = buildRows(procs);
    return rows.filter(row => {
      if (search && !row.proc.procedure_text.toLowerCase().includes(search.toLowerCase()) &&
        !row.proc.area.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus === 'received' && !row.docReceived) return false;
      if (filterStatus === 'pending' && !row.docPending) return false;
      if (filterStatus === 'reviewed' && !row.reviewedByAuditor) return false;
      return true;
    });
  };

  const allProcs = procedures.filter(p => !(p as any).parent_id);
  const allRows = buildRows(allProcs);
  const totalSent = allProcs.length;
  const totalReceived = allRows.filter(r => r.docReceived).length;
  const totalPending = allRows.filter(r => r.docPending).length;
  const totalReviewed = allRows.filter(r => r.reviewedByAuditor).length;
  const completionPct = totalSent > 0 ? Math.round((totalReceived / totalSent) * 100) : 0;

  const FILTERS: { key: typeof filterStatus; label: string; count: number; color: string }[] = [
    { key: 'all', label: 'All', count: totalSent, color: 'bg-slate-700 text-white' },
    { key: 'received', label: '✓ Received', count: totalReceived, color: 'bg-emerald-600 text-white' },
    { key: 'pending', label: '⏳ Pending', count: totalPending, color: 'bg-amber-500 text-white' },
    { key: 'reviewed', label: '● Reviewed', count: totalReviewed, color: 'bg-violet-600 text-white' },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1400px] max-h-[96vh] flex flex-col overflow-hidden border border-slate-200">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 rounded-t-2xl shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <FileCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-white text-base tracking-tight">Document Tracking Dashboard</h2>
              <p className="text-slate-400 text-xs mt-0.5 font-medium">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Stats Bar ── */}
        <div className="grid grid-cols-5 gap-0 border-b border-slate-200 shrink-0 bg-slate-50">
          {[
            { label: 'Total Sent', value: totalSent, icon: Send, color: 'text-slate-700', accent: 'border-slate-300' },
            { label: 'Doc Received', value: totalReceived, icon: Inbox, color: 'text-emerald-700', accent: 'border-emerald-200' },
            { label: 'Doc Pending', value: totalPending, icon: FileClock, color: 'text-amber-700', accent: 'border-amber-200' },
            { label: 'Reviewed', value: totalReviewed, icon: FileCheck, color: 'text-violet-700', accent: 'border-violet-200' },
            { label: 'Completion', value: `${completionPct}%`, icon: TrendingUp, color: 'text-blue-700', accent: 'border-blue-200' },
          ].map(stat => (
            <div key={stat.label} className={`flex items-center gap-3 px-5 py-3.5 border-r border-slate-200 last:border-r-0 border-t-2 ${stat.accent}`}>
              <stat.icon className={`h-5 w-5 ${stat.color} shrink-0`} />
              <div>
                <p className={`text-xl font-black ${stat.color}`}>{stat.value}</p>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Toolbar ── */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-200 bg-white shrink-0 gap-3 flex-wrap">
          {/* Left: sent info + filters */}
          <div className="flex items-center gap-3 flex-wrap">
            {latestSentAt && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">
                <Send className="h-3 w-3 text-slate-400" />
                <span className="font-medium text-slate-600">Last Link Sent:</span>
                <span className="font-bold text-slate-800">{fmt(latestSentAt)}</span>
              </div>
            )}
            <div className="flex gap-1">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilterStatus(f.key)}
                  className={clsx(
                    'px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5',
                    filterStatus === f.key
                      ? f.color + ' shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  )}
                >
                  {f.label}
                  <span className={clsx(
                    'text-[10px] font-black px-1.5 py-0.5 rounded-full',
                    filterStatus === f.key ? 'bg-white/20' : 'bg-slate-300 text-slate-600'
                  )}>{f.count}</span>
                </button>
              ))}
            </div>
          </div>
          {/* Right: search */}
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search procedure or area..."
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 w-52 bg-slate-50"
            />
          </div>
        </div>

        {/* ── Table ── */}
        <div className="flex-1 overflow-auto">
          {CATEGORIES.map(cat => {
            const catProcs = procedures.filter(p => !(p as any).parent_id && (p.category || 'Audit Procedures') === cat);
            const rows = filterProcs(catProcs);
            if (rows.length === 0) return null;

            const isExpanded = expandedCats.has(cat);
            const catReceived = rows.filter(r => r.docReceived).length;
            const catPct = rows.length > 0 ? Math.round((catReceived / rows.length) * 100) : 0;

            return (
              <div key={cat} className="border-b border-slate-100">
                {/* Category Header */}
                <button
                  onClick={() => toggleCat(cat)}
                  className="w-full flex items-center justify-between px-5 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors sticky top-0 z-10 border-b border-slate-200"
                >
                  <div className="flex items-center gap-2.5">
                    {isExpanded
                      ? <ChevronDown className="h-4 w-4 text-slate-400" />
                      : <ChevronRight className="h-4 w-4 text-slate-400" />}
                    <span className="text-sm font-bold text-slate-800">{cat}</span>
                    <span className="text-xs font-semibold text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200">
                      {rows.length} items
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-emerald-600">{catReceived}/{rows.length} received</span>
                    <div className="w-28 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-emerald-500 h-1.5 rounded-full transition-all" style={{ width: `${catPct}%` }} />
                    </div>
                    <span className="text-xs font-black text-slate-600 w-10 text-right">{catPct}%</span>
                  </div>
                </button>

                {isExpanded && (
                  <table className="w-full" style={{ minWidth: '1100px' }}>
                    <thead>
                      <tr className="bg-slate-800 text-white">
                        <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider w-10">Sr.</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider w-28">Area</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider">Procedure / Document</th>

                        {/* Column 1: Sent On */}
                        <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider w-32">
                          <div className="flex flex-col items-center gap-0.5">
                            <Send className="h-3 w-3 text-blue-300" />
                            <span>Sent On</span>
                            <span className="text-[9px] font-normal text-slate-400 normal-case">When link was shared</span>
                          </div>
                        </th>

                        {/* Column 2: Doc Received */}
                        <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider w-32">
                          <div className="flex flex-col items-center gap-0.5">
                            <Inbox className="h-3 w-3 text-emerald-300" />
                            <span>Doc Received</span>
                            <span className="text-[9px] font-normal text-slate-400 normal-case">Client uploaded</span>
                          </div>
                        </th>

                        {/* Column 3: Doc Pending */}
                        <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider w-32">
                          <div className="flex flex-col items-center gap-0.5">
                            <FileClock className="h-3 w-3 text-amber-300" />
                            <span>Doc Pending</span>
                            <span className="text-[9px] font-normal text-slate-400 normal-case">Awaiting response</span>
                          </div>
                        </th>

                        {/* Column 4: Reviewed By Auditor */}
                        <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider w-40">
                          <div className="flex flex-col items-center gap-0.5">
                            <User className="h-3 w-3 text-violet-300" />
                            <span>Reviewed By Auditor</span>
                            <span className="text-[9px] font-normal text-slate-400 normal-case">Internal review status</span>
                          </div>
                        </th>

                        {/* Column 5: Client Responded At */}
                        <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider w-36">
                          <div className="flex flex-col items-center gap-0.5">
                            <Calendar className="h-3 w-3 text-sky-300" />
                            <span>Client Responded</span>
                            <span className="text-[9px] font-normal text-slate-400 normal-case">Response timestamp</span>
                          </div>
                        </th>

                        <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider w-36">Notes</th>
                        <th className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider w-16">Action</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {rows.map((row, idx) => {
                        const isEditing = editingRow === row.proc.id;
                        const isSaving = saving === row.proc.id;
                        const docNames = parseDocs(row.proc);

                        return (
                          <tr
                            key={row.proc.id}
                            className={clsx(
                              'transition-colors',
                              isEditing ? 'bg-indigo-50/60' : idx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/60 hover:bg-slate-100/60',
                              row.reviewedByAuditor && !isEditing && 'bg-emerald-50/40'
                            )}
                          >
                            {/* Sr No */}
                            <td className="px-4 py-3 text-xs text-slate-400 font-bold">{row.proc.sr_no}</td>

                            {/* Area */}
                            <td className="px-4 py-3">
                              <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">{row.proc.area}</span>
                            </td>

                            {/* Procedure */}
                            <td className="px-4 py-3">
                              <p className="text-xs text-slate-800 font-medium line-clamp-2 leading-relaxed">{row.proc.procedure_text}</p>
                              {docNames.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {docNames.slice(0, 2).map((n, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
                                      <FileText className="h-2.5 w-2.5" />
                                      {n.length > 18 ? n.slice(0, 18) + '…' : n}
                                    </span>
                                  ))}
                                  {docNames.length > 2 && (
                                    <span className="text-[10px] text-slate-400 font-medium">+{docNames.length - 2} more</span>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* ── Col 1: Sent On ── */}
                            <td className="px-3 py-3 text-center">
                              {row.sentAt ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="inline-flex items-center gap-1 text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold border border-blue-200">
                                    <Send className="h-2.5 w-2.5" /> Sent
                                  </span>
                                  <span className="text-[10px] text-slate-500 mt-0.5 font-medium">{fmtDate(row.sentAt)}</span>
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-300 font-medium">Not sent yet</span>
                              )}
                            </td>

                            {/* ── Col 2: Doc Received ── */}
                            <td className="px-3 py-3 text-center">
                              {row.docReceived ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                                  <span className="text-[10px] text-emerald-700 font-bold">Received</span>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-0.5">
                                  <div className="h-5 w-5 rounded-full border-2 border-dashed border-slate-300" />
                                  <span className="text-[10px] text-slate-400 font-medium">Not yet</span>
                                </div>
                              )}
                            </td>

                            {/* ── Col 3: Doc Pending ── */}
                            <td className="px-3 py-3 text-center">
                              {row.docPending ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <AlertCircle className="h-5 w-5 text-amber-500" />
                                  <span className="text-[10px] text-amber-700 font-bold">Pending</span>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-0.5">
                                  <CheckCircle className="h-5 w-5 text-slate-200" />
                                  <span className="text-[10px] text-slate-300 font-medium">Done</span>
                                </div>
                              )}
                            </td>

                            {/* ── Col 4: Reviewed By Auditor ── */}
                            <td className="px-3 py-3 text-center">
                              {isEditing ? (
                                <div className="flex flex-col gap-1.5 text-left">
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={editData.reviewedByAuditor}
                                      onChange={e => setEditData(d => ({ ...d, reviewedByAuditor: e.target.checked }))}
                                      className="accent-violet-600 h-3.5 w-3.5"
                                    />
                                    <span className="text-[11px] font-semibold text-slate-700">Mark as Reviewed</span>
                                  </label>
                                  <input
                                    type="text"
                                    placeholder="Auditor name"
                                    value={editData.reviewedBy}
                                    onChange={e => setEditData(d => ({ ...d, reviewedBy: e.target.value }))}
                                    className="text-[11px] border border-slate-200 rounded-md px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-violet-300 bg-white"
                                  />
                                  <input
                                    type="datetime-local"
                                    value={editData.reviewedAt}
                                    onChange={e => setEditData(d => ({ ...d, reviewedAt: e.target.value }))}
                                    className="text-[11px] border border-slate-200 rounded-md px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-violet-300 bg-white"
                                  />
                                </div>
                              ) : row.reviewedByAuditor ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="inline-flex items-center gap-1 text-[10px] bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-bold border border-violet-200">
                                    <User className="h-2.5 w-2.5" /> {row.reviewedBy || 'Auditor'}
                                  </span>
                                  {row.reviewedAt && <span className="text-[10px] text-slate-400 mt-0.5">{fmtDate(row.reviewedAt)}</span>}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                                  <Clock className="h-2.5 w-2.5" /> Pending Review
                                </span>
                              )}
                            </td>

                            {/* ── Col 5: Client Responded At ── */}
                            <td className="px-3 py-3 text-center">
                              {isEditing ? (
                                <div className="flex flex-col gap-1">
                                  <label className="text-[10px] font-semibold text-slate-500 text-left">Client responded at:</label>
                                  <input
                                    type="datetime-local"
                                    value={editData.clientRespondedAt}
                                    onChange={e => setEditData(d => ({ ...d, clientRespondedAt: e.target.value }))}
                                    className="text-[11px] border border-slate-200 rounded-md px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-sky-300 bg-white"
                                  />
                                </div>
                              ) : row.clientRespondedAt ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="inline-flex items-center gap-1 text-[10px] bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-bold border border-sky-200">
                                    <Calendar className="h-2.5 w-2.5" /> Responded
                                  </span>
                                  <span className="text-[10px] text-slate-400 mt-0.5">{fmtDate(row.clientRespondedAt)}</span>
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-300 font-medium">—</span>
                              )}
                            </td>

                            {/* Notes */}
                            <td className="px-3 py-3">
                              {isEditing ? (
                                <textarea
                                  placeholder="Add notes..."
                                  value={editData.notes}
                                  onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))}
                                  rows={3}
                                  className="text-[11px] border border-slate-200 rounded-md px-2 py-1 w-full resize-none focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-white"
                                />
                              ) : (
                                <span className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{row.notes || '—'}</span>
                              )}
                            </td>

                            {/* Action */}
                            <td className="px-3 py-3 text-center">
                              {isEditing ? (
                                <div className="flex flex-col gap-1">
                                  <button
                                    onClick={() => saveEdit(row.proc.id, row.proc.custom_fields || '{}')}
                                    disabled={isSaving}
                                    className="text-[11px] bg-emerald-600 text-white px-2.5 py-1.5 rounded-lg font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1 justify-center shadow-sm"
                                  >
                                    {isSaving
                                      ? <RefreshCw className="h-3 w-3 animate-spin" />
                                      : <Save className="h-3 w-3" />}
                                    {isSaving ? 'Saving...' : 'Save'}
                                  </button>
                                  <button
                                    onClick={() => setEditingRow(null)}
                                    className="text-[11px] text-slate-500 hover:text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1 justify-center"
                                  >
                                    <XCircle className="h-3 w-3" /> Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => startEdit(row)}
                                  className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors group"
                                  title="Edit tracking info"
                                >
                                  <Edit3 className="h-4 w-4 group-hover:scale-110 transition-transform" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}

          {/* Empty state */}
          {procedures.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <FileText className="h-12 w-12 mb-3 text-slate-200" />
              <p className="text-sm font-semibold">No procedures found</p>
              <p className="text-xs text-slate-400 mt-1">Add procedures to start tracking documents</p>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <p className="text-xs text-slate-400">
            💡 Click the <strong>edit icon</strong> on any row to update review status, auditor name, client response time, and notes.
          </p>
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-900 transition-colors shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
