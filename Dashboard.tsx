import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Briefcase, CheckCircle, Clock, AlertCircle, Loader2, Trash2, Search, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { useUser } from '../context/UserContext';

interface Client {
  id: string;
  name: string;
  entity_type?: string;
  nature_of_business?: string;
  business_model?: string;
  created_at: string;
}

interface ClientStats {
  total: number;
  done: number;
  inProgress: number;
  pending: number;
  notApplicable: number;
}

type SortField = 'name' | 'entity_type' | 'nature_of_business' | 'progress' | 'done' | 'pending' | 'created_at';
type SortDir = 'asc' | 'desc';

export default function Dashboard() {
  const { role } = useUser();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', entity_type: '', nature_of_business: '', business_model: '' });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [clientStats, setClientStats] = useState<Record<string, ClientStats>>({});
  const [supabaseError, setSupabaseError] = useState(false);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => { fetchClients(); }, []);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/clients');
      if (res.status === 503 || res.status === 500 || !res.ok) { setSupabaseError(true); return; }
      const data = await res.json();
      if (!Array.isArray(data)) { setSupabaseError(true); return; }
      setClients(data);
      setSupabaseError(false);
      data.forEach((c: Client) => fetchClientStats(c.id));
    } catch {
      setSupabaseError(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchClientStats = async (clientId: string) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/procedures`);
      const procs = await res.json();
      const rootProcs = procs.filter((p: any) => !p.parent_id);
      setClientStats(prev => ({
        ...prev,
        [clientId]: {
          total: rootProcs.length,
          done: rootProcs.filter((p: any) => p.status === 'Done').length,
          inProgress: rootProcs.filter((p: any) => p.status === 'In Progress').length,
          pending: rootProcs.filter((p: any) => p.status === 'Pending').length,
          notApplicable: rootProcs.filter((p: any) => p.status === 'Not Applicable').length,
        }
      }));
    } catch {}
  };

  const handleAddClient = async () => {
    if (!newClient.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newClient),
      });
      if (res.ok) {
        setShowAddModal(false);
        setNewClient({ name: '', entity_type: '', nature_of_business: '', business_model: '' });
        fetchClients();
      }
    } catch {} finally { setSaving(false); }
  };

  const handleDeleteClient = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm('Is client ko delete karna chahte ho? Saare procedures bhi delete ho jayenge.')) return;
    try {
      await fetch(`/api/clients/${id}`, { method: 'DELETE' });
      fetchClients();
    } catch {}
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const getProgress = (id: string) => {
    const s = clientStats[id];
    if (!s || s.total === 0) return 0;
    return Math.round((s.done / s.total) * 100);
  };

  const filtered = clients
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.entity_type || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.nature_of_business || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortField === 'progress')      { aVal = getProgress(a.id); bVal = getProgress(b.id); }
      else if (sortField === 'done')     { aVal = clientStats[a.id]?.done ?? -1; bVal = clientStats[b.id]?.done ?? -1; }
      else if (sortField === 'pending')  { aVal = clientStats[a.id]?.pending ?? -1; bVal = clientStats[b.id]?.pending ?? -1; }
      else if (sortField === 'created_at') { aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime(); }
      else { aVal = (a[sortField as keyof Client] || '').toString().toLowerCase(); bVal = (b[sortField as keyof Client] || '').toString().toLowerCase(); }
      return sortDir === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
    });

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-300 ml-1 inline" />;
    return sortDir === 'asc'
      ? <ChevronUp className="h-3.5 w-3.5 text-indigo-500 ml-1 inline" />
      : <ChevronDown className="h-3.5 w-3.5 text-indigo-500 ml-1 inline" />;
  };

  if (supabaseError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 max-w-md">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-red-800 mb-2">Supabase Connected Nahi Hai</h2>
          <p className="text-red-600 text-sm mb-5">Supabase setup is required to use this app.</p>
          <Link to="/settings" className="inline-flex items-center px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors">
            Settings mein jao →
          </Link>
        </div>
      </div>
    );
  }

  // Summary totals
  const totalDone    = Object.values(clientStats).reduce((s, c) => s + c.done, 0);
  const totalPending = Object.values(clientStats).reduce((s, c) => s + c.pending, 0);
  const totalInProg  = Object.values(clientStats).reduce((s, c) => s + c.inProgress, 0);
  const totalProcs   = Object.values(clientStats).reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
          <p className="text-slate-500 text-sm mt-0.5">{clients.length} total client{clients.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white w-52"
            />
          </div>
          {role === 'Manager' && (
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4 mr-1.5" /> New Client
            </button>
          )}
        </div>
      </div>

      {/* ── Summary Cards ── */}
      {!loading && clients.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Clients',    value: clients.length,  color: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
            { label: 'Total Procedures', value: totalProcs,      color: 'bg-slate-50 text-slate-700 border-slate-200' },
            { label: 'Done',             value: totalDone,       color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
            { label: 'Pending',          value: totalPending,    color: 'bg-amber-50 text-amber-700 border-amber-100' },
          ].map(({ label, value, color }) => (
            <div key={label} className={`rounded-xl border p-4 ${color}`}>
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs font-semibold uppercase tracking-wide mt-0.5 opacity-70">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-xl border border-dashed border-slate-300">
          <Briefcase className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="font-medium text-slate-500">{search ? 'No clients found' : 'No clients added yet'}</p>
          {!search && role === 'Manager' && (
            <button onClick={() => setShowAddModal(true)} className="mt-3 text-indigo-600 text-sm font-medium hover:underline">
              + Pehla client add karo
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-8">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-indigo-600 select-none" onClick={() => handleSort('name')}>
                    Company Name <SortIcon field="name" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-indigo-600 select-none" onClick={() => handleSort('entity_type')}>
                    Entity Type <SortIcon field="entity_type" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-indigo-600 select-none" onClick={() => handleSort('nature_of_business')}>
                    Nature of Business <SortIcon field="nature_of_business" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-indigo-600 select-none" onClick={() => handleSort('done')}>
                    Done <SortIcon field="done" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-indigo-600 select-none" onClick={() => handleSort('pending')}>
                    Pending <SortIcon field="pending" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-8">In Prog.</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-indigo-600 select-none min-w-[140px]" onClick={() => handleSort('progress')}>
                    Progress <SortIcon field="progress" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-indigo-600 select-none" onClick={() => handleSort('created_at')}>
                    Added On <SortIcon field="created_at" />
                  </th>
                  {role === 'Manager' && <th className="px-4 py-3 w-10"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((client, idx) => {
                  const stats = clientStats[client.id];
                  const progress = getProgress(client.id);
                  return (
                    <tr key={client.id} className="hover:bg-indigo-50/30 transition-colors group">
                      <td className="px-4 py-3 text-sm text-slate-400 font-medium">{idx + 1}</td>

                      <td className="px-4 py-3">
                        <Link to={`/clients/${client.id}`} className="flex items-center gap-2.5 group/link">
                          <div className="p-1.5 bg-indigo-50 rounded-lg shrink-0">
                            <Briefcase className="h-4 w-4 text-indigo-500" />
                          </div>
                          <span className="text-sm font-semibold text-slate-900 group-hover/link:text-indigo-700 transition-colors">
                            {client.name}
                          </span>
                        </Link>
                      </td>

                      <td className="px-4 py-3 text-sm text-slate-600">
                        {client.entity_type ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                            {client.entity_type}
                          </span>
                        ) : <span className="text-slate-300 text-xs italic">—</span>}
                      </td>

                      <td className="px-4 py-3 text-sm text-slate-600">
                        {client.nature_of_business || <span className="text-slate-300 text-xs italic">—</span>}
                      </td>

                      <td className="px-4 py-3">
                        {stats ? (
                          <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                            <CheckCircle className="h-3.5 w-3.5" /> {stats.done}
                          </span>
                        ) : <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
                      </td>

                      <td className="px-4 py-3">
                        {stats ? (
                          <span className="inline-flex items-center gap-1 text-sm font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full">
                            <AlertCircle className="h-3.5 w-3.5" /> {stats.pending}
                          </span>
                        ) : <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
                      </td>

                      <td className="px-4 py-3">
                        {stats ? (
                          <span className="inline-flex items-center gap-1 text-sm font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full">
                            <Clock className="h-3.5 w-3.5" /> {stats.inProgress}
                          </span>
                        ) : <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
                      </td>

                      <td className="px-4 py-3 min-w-[140px]">
                        {stats ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-100 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full transition-all ${progress === 100 ? 'bg-emerald-500' : progress > 50 ? 'bg-indigo-500' : 'bg-amber-400'}`}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-xs font-semibold text-slate-500 w-9 text-right">{progress}%</span>
                          </div>
                        ) : <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {new Date(client.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>

                      {role === 'Manager' && (
                        <td className="px-4 py-3">
                          <button
                            onClick={e => handleDeleteClient(client.id, e)}
                            className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all p-1 rounded"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Add Client Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
          <div className="fixed inset-0 bg-slate-900/50" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-6 border border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">New Client Add Karo</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Client Name *</label>
                <input type="text" autoFocus value={newClient.name}
                  onChange={e => setNewClient({ ...newClient, name: e.target.value })}
                  onKeyDown={e => e.key === 'Enter' && handleAddClient()}
                  className="block w-full border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g., ABC Pvt Ltd" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Entity Type</label>
                <input type="text" value={newClient.entity_type} onChange={e => setNewClient({ ...newClient, entity_type: e.target.value })}
                  className="block w-full border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g., Private Limited, LLP" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nature of Business</label>
                <input type="text" value={newClient.nature_of_business} onChange={e => setNewClient({ ...newClient, nature_of_business: e.target.value })}
                  className="block w-full border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g., Manufacturing, Trading" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Business Model</label>
                <input type="text" value={newClient.business_model} onChange={e => setNewClient({ ...newClient, business_model: e.target.value })}
                  className="block w-full border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g., B2B, B2C" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleAddClient} disabled={saving || !newClient.name.trim()}
                className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Add Client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
