import React, { useState, useRef } from 'react';
import { Download, Upload, CheckCircle, AlertCircle, Loader2, Database, RotateCcw, Info, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BackupSummary {
  exported_at:       string;
  total_clients:     number;
  total_procedures:  number;
  has_settings:      boolean;
  conflicts:         string[]; // client names that already exist in DB
  new_clients:       string[]; // brand-new clients
}

interface RestoreOptions {
  restore_clients:    boolean;
  restore_procedures: boolean;
  restore_settings:   boolean;
}

type Phase = 'idle' | 'previewing' | 'preview_ready' | 'restoring' | 'done' | 'error';

// ─── Component ────────────────────────────────────────────────────────────────

export default function BackupRestore() {
  // Backup state
  const [backingUp, setBackingUp] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');

  // Restore state
  const [phase,      setPhase]      = useState<Phase>('idle');
  const [summary,    setSummary]    = useState<BackupSummary | null>(null);
  const [backupData, setBackupData] = useState<any>(null);
  const [errorMsg,   setErrorMsg]   = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [options, setOptions] = useState<RestoreOptions>({
    restore_clients:    true,
    restore_procedures: true,
    restore_settings:   false,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Backup Handler ─────────────────────────────────────────────────────────

  const handleBackup = async () => {
    try {
      setBackingUp(true);
      setBackupMsg('');

      const res = await fetch('/api/backup');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Backup failed');
      }

      const blob    = await res.blob();
      const url     = URL.createObjectURL(blob);
      const a       = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      a.href        = url;
      a.download    = `auditflow_backup_${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setBackupMsg('✅ Backup downloaded successfully!');
    } catch (err: any) {
      setBackupMsg('❌ ' + err.message);
    } finally {
      setBackingUp(false);
    }
  };

  // ─── Restore: Step 1 — File Select & Preview ────────────────────────────────

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset state
    setSummary(null);
    setBackupData(null);
    setErrorMsg('');
    setSuccessMsg('');
    setPhase('previewing');

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      // Validate basic structure
      if (!parsed.version || !Array.isArray(parsed.clients)) {
        throw new Error('Invalid backup file. Please upload a valid AuditFlow AI .json backup.');
      }

      // Ask server for preview/summary
      const res = await fetch('/api/backup/preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');

      setBackupData(parsed);
      setSummary(data.summary);
      setPhase('preview_ready');
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase('error');
    } finally {
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ─── Restore: Step 2 — Confirm & Execute ────────────────────────────────────

  const handleConfirmRestore = async () => {
    if (!backupData) return;
    setPhase('restoring');
    setErrorMsg('');

    try {
      const res = await fetch('/api/backup/restore', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ backup: backupData, options }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');

      setSuccessMsg(data.message);
      setPhase('done');
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase('error');
    }
  };

  const resetRestore = () => {
    setPhase('idle');
    setSummary(null);
    setBackupData(null);
    setErrorMsg('');
    setSuccessMsg('');
    setOptions({ restore_clients: true, restore_procedures: true, restore_settings: false });
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Backup Section ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg">
            <Database className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Full Backup</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Saare clients, procedures aur settings ek JSON file mein download karo
            </p>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-lg p-4 mb-5">
            <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-700 leading-relaxed">
              Backup mein shaamil hoga: Saare clients ka data, procedures (status, remarks, AI results),
              team members list, aur AI API keys. <strong>Note:</strong> Uploaded documents (PDFs/images)
              are not included in backup — only their names are saved.
            </p>
          </div>

          <button
            onClick={handleBackup}
            disabled={backingUp}
            className="inline-flex items-center px-5 py-2.5 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {backingUp
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Backup in progress...</>
              : <><Download className="h-4 w-4 mr-2" /> Download Backup</>
            }
          </button>

          {backupMsg && (
            <p className={`mt-3 text-sm font-medium ${backupMsg.startsWith('✅') ? 'text-emerald-600' : 'text-red-600'}`}>
              {backupMsg}
            </p>
          )}
        </div>
      </div>

      {/* ── Restore Section ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="p-2 bg-amber-50 rounded-lg">
            <RotateCcw className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Restore from Backup</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Pehle preview dikhega, phir confirm karne par restore hoga
            </p>
          </div>
        </div>

        <div className="px-6 py-5">

          {/* ── IDLE: Upload button ── */}
          {(phase === 'idle' || phase === 'error') && (
            <>
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-lg p-4 mb-5">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 leading-relaxed">
                  <strong>Dhyan do:</strong> Restore karne se existing data overwrite ho sakta hai.
                  Pehle ek fresh backup lena recommended hai. Only AuditFlow AI ka .json backup accept hoga.
                </p>
              </div>

              {phase === 'error' && errorMsg && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-700">{errorMsg}</p>
                </div>
              )}

              <input
                type="file"
                accept=".json"
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileSelect}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center px-5 py-2.5 border border-amber-300 rounded-lg shadow-sm text-sm font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-colors"
              >
                <Upload className="h-4 w-4 mr-2" />
                Backup File Select Karo (.json)
              </button>
            </>
          )}

          {/* ── PREVIEWING: Loading ── */}
          {phase === 'previewing' && (
            <div className="flex items-center gap-3 py-6 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
              <span className="text-sm font-medium">Backup file analyze ho rahi hai...</span>
            </div>
          )}

          {/* ── PREVIEW_READY: Show summary + options ── */}
          {phase === 'preview_ready' && summary && (
            <div className="space-y-5">
              {/* Summary Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
                <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  Backup File Analysis
                </h4>

                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
                    <p className="text-2xl font-bold text-slate-900">{summary.total_clients}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Clients</p>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
                    <p className="text-2xl font-bold text-slate-900">{summary.total_procedures}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Procedures</p>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
                    <p className={`text-sm font-bold mt-1 ${summary.has_settings ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {summary.has_settings ? '✓ Hai' : '✗ Nahi'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">Settings</p>
                  </div>
                </div>

                <p className="text-xs text-slate-500">
                  Exported: {summary.exported_at ? new Date(summary.exported_at).toLocaleString('en-IN') : 'Unknown'}
                </p>

                {/* Conflicts Warning */}
                {summary.conflicts.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-amber-700 mb-1">
                      ⚠️ {summary.conflicts.length} Client(s) already exist — overwrite ho jayenge:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {summary.conflicts.map((name, i) => (
                        <li key={i} className="text-xs text-amber-600">{name}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* New clients */}
                {summary.new_clients.length > 0 && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-emerald-700 mb-1">
                      ✅ {summary.new_clients.length} New Client(s) add honge:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {summary.new_clients.map((name, i) => (
                        <li key={i} className="text-xs text-emerald-600">{name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Restore Options */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700">Kya restore karna chahte ho?</p>

                <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={options.restore_clients}
                    onChange={e => setOptions(o => ({ ...o, restore_clients: e.target.checked }))}
                    className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-800">Clients</span>
                    <p className="text-xs text-slate-500">Client names, entity type, business info</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={options.restore_procedures}
                    onChange={e => setOptions(o => ({ ...o, restore_procedures: e.target.checked }))}
                    className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-800">Procedures & Data</span>
                    <p className="text-xs text-slate-500">Saare procedures, status, remarks, AI results</p>
                  </div>
                </label>

                {summary.has_settings && (
                  <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={options.restore_settings}
                      onChange={e => setOptions(o => ({ ...o, restore_settings: e.target.checked }))}
                      className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-slate-800">Settings</span>
                      <p className="text-xs text-slate-500">Team members, AI API keys — current settings overwrite honge</p>
                    </div>
                  </label>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleConfirmRestore}
                  disabled={!options.restore_clients && !options.restore_procedures && !options.restore_settings}
                  className="inline-flex items-center px-5 py-2.5 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restore Karo
                </button>
                <button
                  onClick={resetRestore}
                  className="inline-flex items-center px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                >
                  <X className="h-4 w-4 mr-1.5" />
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── RESTORING: Loading ── */}
          {phase === 'restoring' && (
            <div className="flex items-center gap-3 py-6 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
              <span className="text-sm font-medium">Restore in progress... please wait</span>
            </div>
          )}

          {/* ── DONE: Success ── */}
          {phase === 'done' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <CheckCircle className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-800">Restore Successfully Complete!</p>
                  <p className="text-sm text-emerald-700 mt-0.5">{successMsg}</p>
                </div>
              </div>
              <button
                onClick={resetRestore}
                className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors"
              >
                Restore Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
