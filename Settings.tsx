import React, { useState, useEffect, useRef } from 'react';
import { useUser } from '../context/UserContext';
import { Save, Plus, Trash2, Database, CheckCircle, XCircle, Loader2, Download, Upload, ArchiveRestore } from 'lucide-react';

export default function Settings() {
  const { role, refreshTeamMembers } = useUser();

  // Supabase config state
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [supabaseKeySet, setSupabaseKeySet] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [supabaseMsg, setSupabaseMsg] = useState('');

  // App settings state
  const [settings, setSettings] = useState({
    gemini_key: '',
    openai_key: '',
    claude_key: '',
    groq_key: '',
    active_provider: 'gemini',
    team_members: [] as string[],
  });
  const [newMember, setNewMember] = useState('');
  const [message, setMessage] = useState('');

  // Backup & Restore state
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [restorePreview, setRestorePreview] = useState<any>(null);
  const [pendingRestore, setPendingRestore] = useState<any>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchConfig();
    fetchSettings();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setSupabaseUrl(data.supabase_url || '');
      setSupabaseConnected(data.connected);
      setSupabaseKeySet(data.supabase_key_set);
    } catch {}
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = await res.json();
      setSettings(prev => ({ ...prev, ...data }));
    } catch {}
  };

  const handleConnectSupabase = async () => {
    if (!supabaseUrl || !supabaseKey) {
      setSupabaseMsg('Please enter both URL and Service Role Key');
      return;
    }
    setConnecting(true);
    setSupabaseMsg('');
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supabase_url: supabaseUrl, supabase_key: supabaseKey }),
      });
      const data = await res.json();
      if (data.success) {
        setSupabaseConnected(true);
        setSupabaseKeySet(true);
        setSupabaseKey('');
        setSupabaseMsg('✅ ' + data.message);
        fetchSettings(); // Reload settings now that Supabase is connected
      } else {
        setSupabaseMsg('❌ ' + data.message);
      }
    } catch {
      setSupabaseMsg('❌ Could not connect to server');
    } finally {
      setConnecting(false);
    }
  };

  const handleSave = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setMessage('Settings saved successfully!');
        refreshTeamMembers();
        setTimeout(() => setMessage(''), 3000);
      }
    } catch {
      setMessage('Failed to save settings.');
    }
  };

  const handleDownloadBackup = async () => {
    setBackupLoading(true);
    setBackupMsg('');
    try {
      const res = await fetch('/api/backup');
      if (!res.ok) throw new Error('Backup download failed');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `auditflow_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMsg('✅ Backup downloaded successfully!');
    } catch (e: any) {
      setBackupMsg('❌ Backup failed: ' + e.message);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestoreFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBackupMsg('');
    setRestorePreview(null);
    setPendingRestore(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        // ✅ FIXED: Accept both 'AuditFlow AI' and 'auditflow-ai' formats
        const validApp = json.app === 'AuditFlow AI' || json.app === 'auditflow-ai';
        const validVersion = json.version === '1.0' || json.version === 1 || json.version === '1';
        if (!validApp || !json.clients || !validVersion) {
          setBackupMsg('❌ Invalid backup file. Please select a valid JSON file.');
          return;
        }
        const totalProcs = json.clients.reduce((sum: number, c: any) => sum + (c.procedures?.length || 0), 0);
        setRestorePreview({
          clients: json.clients.length,
          procedures: totalProcs,
          exported_at: json.exported_at,
        });
        setPendingRestore(json);
      } catch {
        setBackupMsg('❌ Failed to parse JSON file. The file may be corrupted.');
      }
    };
    reader.readAsText(file);
    if (restoreInputRef.current) restoreInputRef.current.value = '';
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore) return;
    setRestoreLoading(true);
    setBackupMsg('');
    try {
      const res = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingRestore),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');
      setBackupMsg(`✅ Restore complete! ${data.clients_restored} clients, ${data.procedures_restored} procedures restore ho gaye.`);
      setRestorePreview(null);
      setPendingRestore(null);
    } catch (e: any) {
      setBackupMsg('❌ Restore failed: ' + e.message);
    } finally {
      setRestoreLoading(false);
    }
  };

  const addMember = () => {
    if (newMember.trim() && !settings.team_members.includes(newMember.trim())) {
      setSettings(prev => ({ ...prev, team_members: [...prev.team_members, newMember.trim()] }));
      setNewMember('');
    }
  };

  const removeMember = (member: string) => {
    setSettings(prev => ({ ...prev, team_members: prev.team_members.filter(m => m !== member) }));
  };

  if (role !== 'Manager') {
    return <div className="text-center py-12 text-gray-500">Access Denied. Manager only.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Connect Supabase, configure AI providers and manage your team.</p>
      </div>

      {/* ── Supabase Configuration ── */}
      <div className="bg-white shadow rounded-lg p-6 space-y-5 border-2 border-indigo-200">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Supabase Configuration</h2>
          </div>
          {supabaseConnected ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 bg-green-50 px-3 py-1 rounded-full border border-green-200">
              <CheckCircle className="h-4 w-4" /> Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 bg-red-50 px-3 py-1 rounded-full border border-red-200">
              <XCircle className="h-4 w-4" /> Not Connected
            </span>
          )}
        </div>

        <p className="text-sm text-gray-500 bg-indigo-50 border border-indigo-100 rounded-md p-3">
          <strong>How to set up:</strong> Supabase.com → your project → Settings → API → 
          Copy your "Project URL" and "service_role" key and paste them here.
        </p>

        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supabase Project URL</label>
            <input
              type="text"
              value={supabaseUrl}
              onChange={e => setSupabaseUrl(e.target.value)}
              placeholder="https://xxxxxxxxxxxx.supabase.co"
              className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Service Role Key {supabaseKeySet && <span className="text-green-600 font-normal">(already saved — enter a new key to update)</span>}
            </label>
            <input
              type="password"
              value={supabaseKey}
              onChange={e => setSupabaseKey(e.target.value)}
              placeholder={supabaseKeySet ? '••••••••••••••••' : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'}
              className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm font-mono"
            />
          </div>
        </div>

        {supabaseMsg && (
          <p className={`text-sm font-medium ${supabaseMsg.startsWith('✅') ? 'text-green-700' : 'text-red-600'}`}>
            {supabaseMsg}
          </p>
        )}

        <button
          onClick={handleConnectSupabase}
          disabled={connecting}
          className="inline-flex items-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {connecting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Connecting...</> : <><Database className="h-4 w-4 mr-2" />Connect & Save</>}
        </button>
      </div>

      {/* Show rest of settings only when connected */}
      {supabaseConnected ? (
        <>
          {message && (
            <div className={`p-4 rounded-md ${message.includes('Failed') || message.includes('not') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {message}
            </div>
          )}

          {/* AI Configuration */}
          <div className="bg-white shadow rounded-lg p-6 space-y-6 border border-gray-200">
            <h2 className="text-lg font-medium text-gray-900 border-b pb-2">AI Configuration</h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700">Active Provider</label>
                <select
                  value={settings.active_provider}
                  onChange={e => setSettings({ ...settings, active_provider: e.target.value })}
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md border"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="claude">Anthropic Claude</option>
                  <option value="groq">Groq</option>
                </select>
              </div>
              {[
                { label: 'Google Gemini API Key', key: 'gemini_key', placeholder: 'AIza...' },
                { label: 'OpenAI API Key',         key: 'openai_key', placeholder: 'sk-...' },
                { label: 'Anthropic Claude API Key', key: 'claude_key', placeholder: 'sk-ant-...' },
                { label: 'Groq API Key',            key: 'groq_key',   placeholder: 'gsk_...' },
              ].map(({ label, key, placeholder }) => (
                <div key={key} className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700">{label}</label>
                  <input
                    type="password"
                    value={(settings as any)[key]}
                    onChange={e => setSettings({ ...settings, [key]: e.target.value })}
                    className="mt-1 block w-full shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border-gray-300 rounded-md p-2 border"
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Team Management */}
          <div className="bg-white shadow rounded-lg p-6 space-y-6 border border-gray-200">
            <h2 className="text-lg font-medium text-gray-900 border-b pb-2">Team Management</h2>
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMember}
                  onChange={e => setNewMember(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addMember()}
                  placeholder="Team member ka naam"
                  className="flex-1 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border-gray-300 rounded-md p-2 border"
                />
                <button
                  onClick={addMember}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add
                </button>
              </div>
              <ul className="divide-y divide-gray-200">
                {settings.team_members.map(member => (
                  <li key={member} className="py-3 flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-900">{member}</span>
                    <button onClick={() => removeMember(member)} className="text-red-600 hover:text-red-900">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
                {settings.team_members.length === 0 && (
                  <li className="py-3 text-sm text-gray-500 italic">No team members added yet.</li>
                )}
              </ul>
            </div>
          </div>

          {/* Backup & Restore */}
          <div className="bg-white shadow rounded-lg p-6 space-y-5 border border-gray-200">
            <div className="flex items-center gap-2 border-b pb-3">
              <ArchiveRestore className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-medium text-gray-900">Backup &amp; Restore</h2>
            </div>

            {backupMsg && (
              <div className={`p-3 rounded-md text-sm font-medium ${backupMsg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {backupMsg}
              </div>
            )}

            {/* Download Backup */}
            <div className="flex items-center justify-between bg-indigo-50 rounded-lg p-4">
              <div>
                <p className="font-medium text-gray-800">Full Backup Download</p>
                <p className="text-sm text-gray-500 mt-0.5">All clients, procedures and settings will be saved to a JSON file.</p>
              </div>
              <button
                onClick={handleDownloadBackup}
                disabled={backupLoading}
                className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm disabled:opacity-50 whitespace-nowrap ml-4"
              >
                {backupLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                Download Backup
              </button>
            </div>

            {/* Restore from Backup */}
            <div className="bg-yellow-50 rounded-lg p-4 space-y-3">
              <div>
                <p className="font-medium text-gray-800 flex items-center gap-2">
                  <Upload className="h-4 w-4 text-yellow-600" /> Restore from Backup
                </p>
                <p className="text-sm text-gray-500 mt-0.5">Select a file first — a preview will appear, then confirm to restore.</p>
              </div>

              <label className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer shadow-sm">
                <Upload className="h-4 w-4" />
                Choose backup file (.json)
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleRestoreFileSelect}
                />
              </label>

              {/* Preview before restore */}
              {restorePreview && (
                <div className="bg-white border border-yellow-300 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-semibold text-gray-700">📋 Backup Preview:</p>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>📁 Clients: <strong>{restorePreview.clients}</strong></p>
                    <p>📄 Procedures: <strong>{restorePreview.procedures}</strong></p>
                    <p>🕐 Backup Date: <strong>{new Date(restorePreview.exported_at).toLocaleString('en-IN')}</strong></p>
                  </div>
                  <p className="text-xs text-red-600 font-medium">⚠️ Warning: Existing data may be overwritten — duplicate clients may be created.</p>
                  <button
                    onClick={handleConfirmRestore}
                    disabled={restoreLoading}
                    className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg shadow-sm disabled:opacity-50"
                  >
                    {restoreLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                    {restoreLoading ? 'Restoring...' : 'Confirm Restore'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none"
            >
              <Save className="h-5 w-5 mr-2" /> Save Settings
            </button>
          </div>
        </>
      ) : (
        <div className="text-center py-10 text-gray-400 bg-white rounded-lg border border-dashed border-gray-300">
          <Database className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">Please connect Supabase first</p>
          <p className="text-sm mt-1">Enter your Supabase URL and Service Key above, then click "Connect & Save".</p>
        </div>
      )}
    </div>
  );
}
