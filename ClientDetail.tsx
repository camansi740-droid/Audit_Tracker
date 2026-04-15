import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, ArrowLeft, Bot, Paperclip, Eye, Clock, Download, Trash2, Plus, Edit2, Check, X, ChevronDown, ChevronRight, CornerDownRight, FileSpreadsheet, Link2 } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { clsx } from 'clsx';
import SharePortalModal from '../components/SharePortalModal';
import * as XLSX from 'xlsx';

interface Procedure {
  id: string;
  sr_no: string;
  area: string;
  procedure_text: string;
  risk_flag: string;
  allotted_to: string;
  status: 'Pending' | 'In Progress' | 'Done' | 'Not Applicable';
  document_path: string;
  document_original_name: string;
  documents?: Array<{ path: string; name: string }>;
  ai_result: string;
  client_remarks: string;
  team_remarks: string;
  updated_at: string;
  custom_fields?: string;
  parent_id?: string;
  category?: string;
  // Audit Trail
  status_changed_by?: string;
  status_changed_at?: string;
  status_history?: string;
  status_flags?: string;
}

interface Client {
  id: string;
  name: string;
  custom_columns?: string;
  entity_type?: string;
  nature_of_business?: string;
  business_model?: string;
}

interface PreviewRow {
  sr_no: string;
  area: string;
  procedure_text: string;
  risk_flag: string;
  allotted_to: string;
  action: 'new' | 'update' | 'duplicate';
  existing_id?: string;
  selected: boolean;
  category?: string;
}

const CATEGORIES = ['Initial Documents', 'Analytical Procedures', 'Audit Procedures', 'GST', 'TDS', 'Income Tax', 'PF & ESI', 'Other'];

// Helper: parse document_path/document_original_name into array (backward compat)
function parseDocs(p: Procedure): Array<{ path: string; name: string }> {
  if (!p.document_path) return [];
  try {
    const paths = JSON.parse(p.document_path);
    const names = JSON.parse(p.document_original_name || '[]');
    if (Array.isArray(paths)) return paths.map((path: string, i: number) => ({ path, name: names[i] || path.split('/').pop() || path }));
  } catch {}
  return [{ path: p.document_path, name: p.document_original_name || p.document_path.split('/').pop() || 'Document' }];
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { role, currentUser, teamMembers } = useUser();
  const [client, setClient] = useState<Client | null>(null);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [historyModal, setHistoryModal] = useState<Procedure | null>(null);
  const [activeTab, setActiveTab] = useState('Audit Procedures');

  // Document Preview Modal
  const [docPreview, setDocPreview] = useState<{ url: string; name: string; type: string } | null>(null); // Default to most common tab
  
  // Preview Modal State
  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  
  // Delete Modal State
  const [procedureToDelete, setProcedureToDelete] = useState<string | null>(null);
  
  // Add Row/Column State
  const [showAddRowModal, setShowAddRowModal] = useState(false);
  const [newRowData, setNewRowData] = useState({ sr_no: '', area: '', procedure_text: '', risk_flag: '' });
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  
  // Edit Mode State
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});

  // Sub-row State
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [parentForNewRow, setParentForNewRow] = useState<string | null>(null);

  // Edit Client State
  const [showEditClientModal, setShowEditClientModal] = useState(false);
  const [editClientData, setEditClientData] = useState({ name: '', entity_type: '', nature_of_business: '', business_model: '' });

  // Clear All State
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  // Export Dropdown State
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Client Portal Modal State
  const [showPortalModal, setShowPortalModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (id) {
      fetchClient();
      fetchProcedures();
    }
  }, [id]);

  // Close export menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDownloadAll = async (category?: string) => {
    const url = category
      ? `/api/clients/${id}/download-all?category=${encodeURIComponent(category)}`
      : `/api/clients/${id}/download-all`;
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const errText = await res.text();
        alert('Download failed: ' + errText);
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="(.+)"/);
      a.download = match ? match[1] : 'Documents.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert('Download error: ' + err);
    }
  };

  const fetchClient = async () => {
    try {
      const res = await fetch('/api/clients');
      const data = await res.json();
      const found = data.find((c: any) => c.id === id);
      setClient(found || null);
    } catch (error) {
      console.error('Failed to fetch client', error);
    }
  };

  const fetchProcedures = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/clients/${id}/procedures`);
      const data = await res.json();
      setProcedures(data);
    } catch (error) {
      console.error('Failed to fetch procedures', error);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      setLoading(true);
      const res = await fetch(`/api/clients/${id}/import-preview`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        const previewWithSelection = data.preview.map((row: any) => ({
          ...row,
          selected: row.action !== 'duplicate' // Auto-select new and update, ignore exact duplicates
        }));
        setPreviewData(previewWithSelection);
        setShowPreviewModal(true);
      } else {
        alert('Import failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Import error', error);
      alert('Import error');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
      setLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!id) return;
    const selectedProcedures = previewData.filter(p => p.selected);
    
    if (selectedProcedures.length === 0) {
      setShowPreviewModal(false);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/clients/${id}/import-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ procedures: selectedProcedures }),
      });
      
      if (response.ok) {
        setShowPreviewModal(false);
        fetchProcedures();
      } else {
        alert('Failed to save imported data');
      }
    } catch (error) {
      console.error('Failed to confirm import:', error);
      alert('Failed to save imported data');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProcedure = (procId: string) => {
    setProcedureToDelete(procId);
  };

  const confirmDelete = async () => {
    if (!procedureToDelete) return;
    try {
      const response = await fetch(`/api/procedures/${procedureToDelete}`, { method: 'DELETE' });
      if (response.ok) {
        fetchProcedures();
      }
    } catch (error) {
      console.error('Failed to delete procedure:', error);
    } finally {
      setProcedureToDelete(null);
    }
  };

  const handleUpdate = async (procId: string, field: string, value: string) => {
    // Optimistic update
    setProcedures(prev => prev.map(p => p.id === procId ? { ...p, [field]: value } : p));
    try {
      const res = await fetch(`/api/procedures/${procId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const updated = await res.json();
      // Sync with actual DB value
      setProcedures(prev => prev.map(p => p.id === procId ? { ...p, ...updated } : p));
    } catch (error) {
      console.error('Update error', error);
      // Revert on error
      setProcedures(prev => prev.map(p => p.id === procId ? { ...p, [field]: (field === 'allotted_to' ? '' : p[field as keyof typeof p]) } : p));
    }
  };

  const startEditing = (proc: Procedure) => {
    setEditingRowId(proc.id);
    setEditFormData({
      status: proc.status,
      client_remarks: proc.client_remarks || '',
      team_remarks: proc.team_remarks || '',
      custom_fields: proc.custom_fields || '{}'
    });
  };

  const cancelEditing = () => {
    setEditingRowId(null);
    setEditFormData({});
  };

  const saveEditing = async (procId: string) => {
    const proc = procedures.find(p => p.id === procId);
    if (!proc) return;

    // Capture from editFormData — use String() to avoid any falsy issues
    const savedStatus        = editFormData.status        !== undefined ? editFormData.status        : proc.status;
    const savedClientRemarks = editFormData.client_remarks !== undefined ? editFormData.client_remarks : (proc.client_remarks || '');
    const savedTeamRemarks   = editFormData.team_remarks   !== undefined ? editFormData.team_remarks   : (proc.team_remarks   || '');
    const savedCustomFields  = editFormData.custom_fields  !== undefined ? editFormData.custom_fields  : (proc.custom_fields  || '{}');

    // Close edit mode immediately for UX
    setEditingRowId(null);
    setEditFormData({});

    // Update UI optimistically with captured values
    setProcedures(prev => prev.map(p =>
      p.id === procId
        ? { ...p, status: savedStatus, client_remarks: savedClientRemarks, team_remarks: savedTeamRemarks, custom_fields: savedCustomFields }
        : p
    ));

    try {
      const res = await fetch(`/api/procedures/${procId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:          savedStatus,
          client_remarks:  savedClientRemarks,
          team_remarks:    savedTeamRemarks,
          custom_fields:   savedCustomFields,
          changed_by:      currentUser,           // audit trail
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      // ✅ Update state with actual DB response — single source of truth
      const updated = await res.json();
      setProcedures(prev => prev.map(p => p.id === procId ? { ...p, ...updated } : p));

    } catch (error: any) {
      console.error('Save failed:', error.message);
      // Revert to original on failure
      setProcedures(prev => prev.map(p => p.id === procId ? proc : p));
      alert('Save failed: ' + error.message);
    }
  };

  const handleEditFormChange = (field: string, value: string) => {
    setEditFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleEditCustomFieldChange = (colName: string, value: string) => {
    setEditFormData((prev: any) => {
      let currentFields = {};
      try {
        currentFields = JSON.parse(prev.custom_fields || '{}');
      } catch (e) {}
      
      return {
        ...prev,
        custom_fields: JSON.stringify({ ...currentFields, [colName]: value })
      };
    });
  };

  const handleCustomFieldUpdate = async (procId: string, customFieldName: string, value: string) => {
    const proc = procedures.find(p => p.id === procId);
    if (!proc) return;

    let currentFields = {};
    try {
      currentFields = JSON.parse(proc.custom_fields || '{}');
    } catch (e) {}

    const updatedFields = { ...currentFields, [customFieldName]: value };
    const updatedFieldsStr = JSON.stringify(updatedFields);

    // Optimistic update
    setProcedures(prev => prev.map(p => p.id === procId ? { ...p, custom_fields: updatedFieldsStr } : p));

    try {
      await fetch(`/api/procedures/${procId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_fields: updatedFieldsStr }),
      });
    } catch (error) {
      console.error('Update custom field error', error);
    }
  };

  const handleAddSubTask = (parentId: string) => {
    const parentProc = procedures.find(p => p.id === parentId);
    if (parentProc) {
      setParentForNewRow(parentId);
      setNewRowData({ 
        sr_no: '', 
        area: parentProc.area, 
        procedure_text: '', 
        risk_flag: parentProc.risk_flag,
        allotted_to: parentProc.allotted_to
      });
      setShowAddRowModal(true);
    }
  };

  const handleAddRow = async () => {
    if (!id || !newRowData.procedure_text) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/clients/${id}/procedures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newRowData, parent_id: parentForNewRow, category: activeTab }),
      });
      if (res.ok) {
        setShowAddRowModal(false);
        setNewRowData({ sr_no: '', area: '', procedure_text: '', risk_flag: '' });
        setParentForNewRow(null);
        if (parentForNewRow) {
          setExpandedRows(prev => new Set(prev).add(parentForNewRow));
        }
        fetchProcedures();
      } else {
        alert('Failed to add procedure');
      }
    } catch (error) {
      console.error('Add row error', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (procId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(procId)) {
        next.delete(procId);
      } else {
        next.add(procId);
      }
      return next;
    });
  };

  const handleAddColumn = async () => {
    if (!id || !newColumnName.trim()) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/clients/${id}/columns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnName: newColumnName.trim() }),
      });
      if (res.ok) {
        setShowAddColumnModal(false);
        setNewColumnName('');
        fetchClient(); // Refresh client to get new columns
      } else {
        alert('Failed to add column');
      }
    } catch (error) {
      console.error('Add column error', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (procId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    Array.from(files).forEach(file => formData.append('files', file));

    try {
      setUploading(procId);
      const res = await fetch(`/api/procedures/${procId}/upload`, { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        // Build new document_path and document_original_name as JSON arrays
        const paths = data.documents.map((d: any) => d.path);
        const names = data.documents.map((d: any) => d.name);
        setProcedures(prev => prev.map(p => p.id === procId ? {
          ...p,
          document_path: JSON.stringify(paths),
          document_original_name: JSON.stringify(names),
        } : p));
      }
    } catch (error) {
      console.error('Upload error', error);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(null);
    }
  };

  const handleDeleteDoc = async (procId: string, docPath: string) => {
    if (!confirm('Is document ko delete karna chahte ho?')) return;
    try {
      const res = await fetch(`/api/procedures/${procId}/document`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docPath }),
      });
      if (res.ok) {
        const data = await res.json();
        // Refresh this procedure's docs from remaining
        setProcedures(prev => prev.map(p => {
          if (p.id !== procId) return p;
          const docs = parseDocs(p).filter(d => d.path !== docPath);
          return {
            ...p,
            document_path: docs.length ? JSON.stringify(docs.map(d => d.path)) : '',
            document_original_name: docs.length ? JSON.stringify(docs.map(d => d.name)) : '',
          };
        }));
      }
    } catch (err) {
      alert('Delete failed.');
    }
  };

  const handleAICheck = async (procId: string, docIndex?: number) => {
    try {
      setVerifying(procId);
      const url = docIndex !== undefined
        ? `/api/procedures/${procId}/verify?docIndex=${docIndex}`
        : `/api/procedures/${procId}/verify`;
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setProcedures(prev => prev.map(p => p.id === procId ? { ...p, ai_result: data.result } : p));
      } else {
        alert(`AI Check Failed: ${data.error}`);
      }
    } catch (error) {
      console.error('AI Check error', error);
      alert('AI Check failed to run.');
    } finally {
      setVerifying(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Done': return 'bg-green-100 text-green-800';
      case 'In Progress': return 'bg-blue-100 text-blue-800';
      case 'Not Applicable': return 'bg-gray-100 text-gray-800';
      default: return 'bg-yellow-100 text-yellow-800';
    }
  };

  const customColumnsList = React.useMemo(() => {
    if (!client?.custom_columns) return [];
    try {
      return JSON.parse(client.custom_columns);
    } catch (e) {
      return [];
    }
  }, [client?.custom_columns]);

  const getAIResultBadge = (result: string) => {
    if (!result) return <span className="text-gray-400 text-xs">Not Run</span>;
    if (result.includes('Mismatch')) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Mismatch</span>;
    if (result.includes('Partial')) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Partial</span>;
    if (result.includes('Match')) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Match</span>;
    return <span className="text-xs text-gray-500 truncate max-w-[100px]">{result.substring(0, 20)}...</span>;
  };

  const getAIRemarks = (result: string) => {
    if (!result) return <span className="text-gray-400 text-xs">-</span>;
    const match = result.match(/Reason:\s*(.*)/is);
    const text = match && match[1] ? match[1].trim() : result;
    return <span className="text-xs text-gray-700">{text}</span>;
  };

  const handleClearAll = async () => {
    if (!id) return;
    setClearingAll(true);
    try {
      const res = await fetch(`/api/clients/${id}/procedures`, { method: 'DELETE' });
      if (res.ok) {
        setProcedures([]);
        setShowClearAllModal(false);
      } else {
        alert('Failed to delete procedures');
      }
    } catch (error) {
      console.error('Clear all error:', error);
      alert('Failed to delete procedures');
    } finally {
      setClearingAll(false);
    }
  };

  // ─── Excel Export Helpers ────────────────────────────────────────────────────
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

  const buildSheetData = (procs: Procedure[]) => {
    const headers = ['Sr. No', 'Area / Head', 'Procedure', 'Risk', 'Allotted To', 'Status', 'Document', 'AI Result', 'Client Remarks', 'Team Remarks', ...customColumnsList];
    const rows = procs
      .filter(p => !p.parent_id)
      .map(p => {
        const customVals = customColumnsList.map((col: string) => {
          try { return p.custom_fields ? JSON.parse(p.custom_fields)[col] ?? '' : ''; } catch { return ''; }
        });
        return [
          p.sr_no, p.area, p.procedure_text, p.risk_flag, p.allotted_to,
          p.status, p.document_original_name || '', p.ai_result || '', p.client_remarks || '', p.team_remarks || '',
          ...customVals,
        ];
      });

    // Summary rows at bottom
    const total = procs.filter(p => !p.parent_id).length;
    const done = procs.filter(p => !p.parent_id && p.status === 'Done').length;
    const inProgress = procs.filter(p => !p.parent_id && p.status === 'In Progress').length;
    const pending = procs.filter(p => !p.parent_id && p.status === 'Pending').length;

    return [
      headers,
      ...rows,
      [],
      ['Summary', '', '', '', '', '', '', '', '', ''],
      ['Total', total, 'Done', done, 'In Progress', inProgress, 'Pending', pending, '', ''],
    ];
  };

  const applySheetStyles = (ws: XLSX.WorkSheet, rowCount: number, colCount: number) => {
    // Column widths
    ws['!cols'] = [
      { wch: 6 }, { wch: 18 }, { wch: 40 }, { wch: 10 }, { wch: 18 },
      { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 25 }, { wch: 25 },
      ...customColumnsList.map(() => ({ wch: 18 })),
    ];
    return ws;
  };

  const handleExportCurrentTab = () => {
    setShowExportMenu(false);
    const tabProcs = procedures.filter(p => !p.parent_id && (p.category || 'Audit Procedures') === activeTab);
    const sheetData = buildSheetData(tabProcs);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    applySheetStyles(ws, tabProcs.length, 10 + customColumnsList.length);
    const sheetName = (CATEGORY_LABELS[activeTab] || activeTab).substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const fileName = `${client?.name || 'Audit'}_${activeTab}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleExportAllTabs = () => {
    setShowExportMenu(false);
    const wb = XLSX.utils.book_new();

    // Summary sheet first
    const summaryRows: any[][] = [
      ['AuditFlow Export', '', '', ''],
      ['Client', client?.name || '', '', ''],
      ['Exported On', new Date().toLocaleString(), '', ''],
      [],
      ['Tab', 'Total', 'Done', 'Pending', 'In Progress'],
    ];
    CATEGORIES.forEach(cat => {
      const catProcs = procedures.filter(p => !p.parent_id && (p.category || 'Audit Procedures') === cat);
      if (catProcs.length > 0) {
        summaryRows.push([
          CATEGORY_LABELS[cat] || cat,
          catProcs.length,
          catProcs.filter(p => p.status === 'Done').length,
          catProcs.filter(p => p.status === 'Pending').length,
          catProcs.filter(p => p.status === 'In Progress').length,
        ]);
      }
    });
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
    summaryWs['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

    // One sheet per category
    CATEGORIES.forEach(cat => {
      const catProcs = procedures.filter(p => !p.parent_id && (p.category || 'Audit Procedures') === cat);
      if (catProcs.length === 0) return;
      const sheetData = buildSheetData(catProcs);
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      applySheetStyles(ws, catProcs.length, 10 + customColumnsList.length);
      const sheetName = (CATEGORY_LABELS[cat] || cat).substring(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    const fileName = `${client?.name || 'Audit'}_AllTabs_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // ─── Team Member: Export My Assigned Procedures ──────────────────────────────
  const handleExportMyWork = () => {
    const myName = teamMembers.find(m =>
      procedures.some(p => p.allotted_to === m)
    ) || 'Team Member';

    // Filter only procedures assigned to current team member context
    // Since we don't have logged-in user identity, export all assigned procedures for the client
    const myProcedures = procedures.filter(p => p.allotted_to !== '' && p.allotted_to !== null);

    const exportData = {
      version: '1.0',
      app: 'AuditFlow AI',
      export_type: 'team_member_procedures',
      exported_at: new Date().toISOString(),
      client: {
        id: client?.id,
        name: client?.name,
        entity_type: client?.entity_type,
        nature_of_business: client?.nature_of_business,
      },
      procedures: myProcedures.map(p => ({
        sr_no:                  p.sr_no,
        area:                   p.area,
        procedure_text:         p.procedure_text,
        risk_flag:              p.risk_flag,
        allotted_to:            p.allotted_to,
        status:                 p.status,
        category:               p.category,
        client_remarks:         p.client_remarks,
        team_remarks:           p.team_remarks,
        document_original_name: p.document_original_name,
        ai_result:              p.ai_result,
        updated_at:             p.updated_at,
      })),
    };

    const blob    = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href        = url;
    a.download    = `my_procedures_${client?.name?.replace(/\s+/g, '_')}_${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleEditClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !editClientData.name.trim()) return;
    
    try {
      setLoading(true);
      const res = await fetch(`/api/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editClientData),
      });
      if (res.ok) {
        setShowEditClientModal(false);
        fetchClient();
      } else {
        alert('Failed to update client details');
      }
    } catch (error) {
      console.error('Failed to update client:', error);
      alert('Failed to update client details');
    } finally {
      setLoading(false);
    }
  };

  if (!client) return <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto" /></div>;

  const activeProcedures = procedures.filter(p => !p.parent_id && (p.category || 'Audit Procedures') === activeTab);
  const totalProcs = activeProcedures.length;
  const doneProcs = activeProcedures.filter(p => p.status === 'Done').length;
  const inProgressProcs = activeProcedures.filter(p => p.status === 'In Progress').length;
  const pendingProcs = totalProcs - doneProcs - inProgressProcs;

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-slate-500 hover:text-slate-700 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 leading-tight tracking-tight">{client.name}</h1>
              {role === 'Manager' && (
                <button 
                  onClick={() => {
                    setEditClientData({
                      name: client.name,
                      entity_type: client.entity_type || '',
                      nature_of_business: client.nature_of_business || '',
                      business_model: client.business_model || ''
                    });
                    setShowEditClientModal(true);
                  }}
                  className="text-slate-400 hover:text-indigo-600 transition-colors p-1 rounded-md hover:bg-slate-100"
                  title="Edit Client Details"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 font-medium uppercase tracking-wider">
              <span>Audit Programme</span>
              {(client.entity_type || client.nature_of_business || client.business_model) && (
                <>
                  <span className="text-slate-300">•</span>
                  <span className="text-indigo-600/80 lowercase capitalize-first">
                    {[client.entity_type, client.nature_of_business, client.business_model].filter(Boolean).join(' • ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={() => setShowAddRowModal(true)}
            className="inline-flex items-center px-3 py-1.5 border border-slate-300 rounded-md shadow-sm text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            <Plus className="-ml-0.5 mr-1.5 h-4 w-4 text-slate-500" />
            Add Procedure
          </button>
          <button
            onClick={() => setShowAddColumnModal(true)}
            className="inline-flex items-center px-3 py-1.5 border border-slate-300 rounded-md shadow-sm text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            <Plus className="-ml-0.5 mr-1.5 h-4 w-4 text-slate-500" />
            Add Column
          </button>
          {/* Team Member: Export My Assigned Procedures */}
          {role === 'Team Member' && procedures.some(p => p.allotted_to) && (
            <button
              onClick={handleExportMyWork}
              className="inline-flex items-center px-3 py-1.5 border border-emerald-200 rounded-md shadow-sm text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-colors"
              title="Export your assigned procedures"
            >
              <Download className="-ml-0.5 mr-1.5 h-4 w-4 text-emerald-500" />
              Export My Work
            </button>
          )}

          {role === 'Manager' && (
            <>
              {/* Client Portal Button */}
              <button
                onClick={() => setShowPortalModal(true)}
                className="inline-flex items-center px-3 py-1.5 border border-purple-200 rounded-md shadow-sm text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors"
                title="Send client a secure document upload link"
              >
                <Link2 className="-ml-0.5 mr-1.5 h-4 w-4 text-purple-500" />
                Client Portal
              </button>

              {/* Export Dropdown */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportMenu(prev => !prev)}
                  className="inline-flex items-center px-3 py-1.5 border border-green-200 rounded-md shadow-sm text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
                >
                  <FileSpreadsheet className="-ml-0.5 mr-1.5 h-4 w-4 text-green-600" />
                  Export
                  <ChevronDown className="ml-1 h-3 w-3" />
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-md shadow-lg z-50">
                    <button
                      onClick={handleExportCurrentTab}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-green-50 flex items-center gap-2 rounded-t-md"
                    >
                      <FileSpreadsheet className="h-4 w-4 text-green-600" />
                      Current Tab Export
                    </button>
                    <div className="border-t border-gray-100" />
                    <button
                      onClick={handleExportAllTabs}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-green-50 flex items-center gap-2 rounded-b-md"
                    >
                      <FileSpreadsheet className="h-4 w-4 text-green-600" />
                      All Tabs Export
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={() => window.open('/api/template/download', '_blank')}
                className="inline-flex items-center px-3 py-1.5 border border-indigo-200 rounded-md shadow-sm text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
              >
                <Download className="-ml-0.5 mr-1.5 h-4 w-4 text-indigo-500" />
                Template
              </button>

              {/* Bulk Download All Documents */}
              {procedures.some(p => p.document_path) && (
                <div className="relative group">
                  <button
                    onClick={() => handleDownloadAll()}
                    className="inline-flex items-center px-3 py-1.5 border border-teal-200 rounded-md shadow-sm text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 transition-colors"
                    title="Download all uploaded documents as ZIP"
                  >
                    <Download className="-ml-0.5 mr-1.5 h-4 w-4 text-teal-500" />
                    Download All
                  </button>
                  {/* Dropdown for current tab only */}
                  <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50 hidden group-hover:block">
                    <button
                      onClick={() => handleDownloadAll()}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-teal-50 flex items-center gap-2 rounded-t-md"
                    >
                      <Download className="h-4 w-4 text-teal-600" />
                      All Categories
                    </button>
                    <div className="border-t border-gray-100" />
                    <button
                      onClick={() => handleDownloadAll(activeTab)}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-teal-50 flex items-center gap-2 rounded-b-md"
                    >
                      <Download className="h-4 w-4 text-teal-600" />
                      Current Tab Only
                    </button>
                  </div>
                </div>
              )}
              <input
                type="file"
                accept=".xlsx"
                ref={importInputRef}
                className="hidden"
                onChange={handleImport}
              />
              <button
                onClick={() => importInputRef.current?.click()}
                className="inline-flex items-center px-3 py-1.5 border border-slate-300 rounded-md shadow-sm text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
              >
                <Upload className="-ml-0.5 mr-1.5 h-4 w-4 text-slate-500" />
                Import
              </button>
              {procedures.length > 0 && (
                <button
                  onClick={() => setShowClearAllModal(true)}
                  className="inline-flex items-center px-3 py-1.5 border border-red-200 rounded-md shadow-sm text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
                >
                  <Trash2 className="-ml-0.5 mr-1.5 h-4 w-4 text-red-400" />
                  Clear All
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="px-4 sm:px-6 py-4 shrink-0 bg-slate-50/50">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{totalProcs}</p>
            </div>
            <div className="p-3 bg-slate-100 rounded-lg"><FileText className="h-6 w-6 text-slate-600" /></div>
          </div>
          <div className="bg-white rounded-xl border border-emerald-100 p-4 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
            <div>
              <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Done</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">{doneProcs}</p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-lg"><CheckCircle className="h-6 w-6 text-emerald-500" /></div>
          </div>
          <div className="bg-white rounded-xl border border-blue-100 p-4 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
            <div>
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">In Progress</p>
              <p className="mt-1 text-2xl font-bold text-blue-700">{inProgressProcs}</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg"><Loader2 className="h-6 w-6 text-blue-500" /></div>
          </div>
          <div className="bg-white rounded-xl border border-amber-100 p-4 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
            <div>
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Pending</p>
              <p className="mt-1 text-2xl font-bold text-amber-700">{pendingProcs}</p>
            </div>
            <div className="p-3 bg-amber-50 rounded-lg"><Clock className="h-6 w-6 text-amber-500" /></div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-y border-slate-200 px-4 sm:px-6 shrink-0 shadow-sm z-10">
        <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
          {CATEGORIES.map((category, index) => {
            // Determine the display label based on the category name
            let displayLabel = category;
            if (category === 'Initial Documents') displayLabel = '1. Initial Documents';
            else if (category === 'Analytical Procedures') displayLabel = '2. Analytical Procedures';
            else if (category === 'Audit Procedures') displayLabel = '3. Audit Procedures';
            else if (category === 'GST') displayLabel = '4a. GST';
            else if (category === 'TDS') displayLabel = '4b. TDS';
            else if (category === 'Income Tax') displayLabel = '4c. Income Tax';
            else if (category === 'PF & ESI') displayLabel = '4d. PF & ESI';
            else if (category === 'Other') displayLabel = '4e. Other';

            const tabCount = procedures.filter(p => !p.parent_id && (p.category || 'Audit Procedures') === category).length;

            return (
              <button
                key={category}
                onClick={() => setActiveTab(category)}
                className={clsx(
                  activeTab === category
                    ? 'border-indigo-500 text-indigo-600 bg-indigo-50/50'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                  'whitespace-nowrap py-3 px-3 border-b-2 font-medium text-sm transition-all duration-200 flex items-center gap-1.5'
                )}
              >
                {displayLabel}
                {tabCount > 0 && (
                  <span className={clsx(
                    'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold',
                    activeTab === category ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
                  )}>
                    {tabCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Table Area */}
      <div className="flex-1 overflow-hidden p-4 sm:p-6 flex flex-col bg-slate-50">
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl flex-1 flex flex-col overflow-hidden">
          <div className="overflow-x-auto overflow-y-auto flex-1">
            <table className="min-w-full divide-y divide-slate-200 relative">
              <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-16 bg-slate-50">Sr.</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-48 bg-slate-50">Area/Head</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-64 bg-slate-50">Procedure</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-24 bg-slate-50">Risk</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-32 bg-slate-50">Allotted To</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-32 bg-slate-50">Status</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-32 bg-slate-50">Document</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-28 bg-slate-50">Doc Source</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-32 bg-slate-50">AI Check</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-32 bg-slate-50">AI Result</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-64 bg-slate-50">AI Remarks</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-48 bg-slate-50">Client Remarks</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-48 bg-slate-50">Team Remarks</th>
                  {customColumnsList.map((col: string) => (
                    <th key={col} scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-48 bg-slate-50">{col}</th>
                  ))}
                  <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider w-24 bg-slate-50">Overall</th>
                  <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider w-24 bg-slate-50">Action</th>
                </tr>
              </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {procedures.filter(p => !p.parent_id && (p.category || 'Audit Procedures') === activeTab).map((proc) => {
              const isEditing = editingRowId === proc.id;
              const hasSubTasks = procedures.some(p => p.parent_id === proc.id);
              const isExpanded = expandedRows.has(proc.id);
              
              const renderRow = (p: Procedure, isSubRow: boolean = false) => {
                const rowIsEditing = editingRowId === p.id;
                return (
              <tr key={p.id} className={clsx("hover:bg-slate-50 transition-colors", isSubRow && "bg-slate-50/50")}>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-500">
                  <div className="flex items-center gap-2">
                    {!isSubRow && hasSubTasks && (
                      <button onClick={() => toggleRow(p.id)} className="text-slate-400 hover:text-slate-600 transition-colors">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    )}
                    {!isSubRow && !hasSubTasks && <div className="w-4" />}
                    {isSubRow && <CornerDownRight className="h-4 w-4 text-slate-300 ml-4" />}
                    <span className="font-medium">{p.sr_no}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700 font-semibold whitespace-nowrap">{p.area}</td>
                <td className="px-4 py-3 text-sm text-slate-900 min-w-[200px] whitespace-normal leading-relaxed">{p.procedure_text}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm">
                  <span className={clsx(
                    "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                    p.risk_flag === 'High' ? 'bg-red-100 text-red-800' :
                    p.risk_flag === 'Medium' ? 'bg-amber-100 text-amber-800' :
                    'bg-emerald-100 text-emerald-800'
                  )}>
                    {p.risk_flag}
                  </span>
                </td>
                
                {/* Allotted To */}
                <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-500">
                  <select
                    value={p.allotted_to || ''}
                    onChange={(e) => handleUpdate(p.id, 'allotted_to', e.target.value)}
                    disabled={role !== 'Manager'}
                    className="block w-full text-sm border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 border p-1.5 bg-white"
                  >
                    <option value="">Unassigned</option>
                    {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </td>

                {/* Status */}
                <td className="px-4 py-3 whitespace-nowrap text-sm">
                  {rowIsEditing ? (
                    <select
                      value={editFormData.status || 'Pending'}
                      onChange={(e) => handleEditFormChange('status', e.target.value)}
                      className={clsx(
                        "block w-full text-xs font-semibold rounded-full px-3 py-1.5 border-0 focus:ring-2 focus:ring-indigo-500 shadow-sm",
                        getStatusColor(editFormData.status || 'Pending')
                      )}
                    >
                      <option value="Pending">Pending</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Done">Done</option>
                      <option value="Not Applicable">N/A</option>
                    </select>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <span className={clsx(
                        "inline-flex text-xs font-semibold rounded-full px-3 py-1 shadow-sm",
                        getStatusColor(p.status)
                      )}>
                        {p.status || 'Pending'}
                      </span>

                      {/* Audit trail — who changed + when */}
                      {p.status_changed_by && p.status_changed_at && (
                        <button
                          onClick={() => setHistoryModal(p)}
                          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors mt-0.5 text-left"
                          title="Click to see full history"
                        >
                          <svg className="h-2.5 w-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <circle cx="12" cy="12" r="9"/><path strokeLinecap="round" d="M12 7v5l3 3"/>
                          </svg>
                          <span className="truncate max-w-[90px]">{p.status_changed_by}</span>
                          <span className="shrink-0">{new Date(p.status_changed_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                        </button>
                      )}

                      {/* Red flags */}
                      {p.status_flags && (() => {
                        let flags: string[] = [];
                        try { flags = JSON.parse(p.status_flags); } catch {}
                        return flags.length > 0 ? (
                          <div className="flex flex-wrap gap-0.5 mt-0.5">
                            {flags.includes('no_evidence')    && <span className="text-[9px] bg-red-100 text-red-600 rounded px-1 py-0.5 font-semibold" title="Done without document">⚠ No Doc</span>}
                            {flags.includes('bulk_update')    && <span className="text-[9px] bg-orange-100 text-orange-600 rounded px-1 py-0.5 font-semibold" title="10+ changes in 1 hour">⚠ Bulk</span>}
                            {flags.includes('unusual_time')   && <span className="text-[9px] bg-yellow-100 text-yellow-700 rounded px-1 py-0.5 font-semibold" title="Changed outside working hours">⚠ Odd Time</span>}
                          </div>
                        ) : null;
                      })()}
                    </div>
                  )}
                </td>

                {/* Document Upload — multi-file */}
                <td className="px-4 py-3 text-sm text-slate-500">
                  <div className="flex flex-col gap-1.5 min-w-[160px]">
                    {/* List all uploaded docs */}
                    {parseDocs(p).map((doc, di) => {
                      const ext = doc.path.split('.').pop()?.toLowerCase() || '';
                      const previewable = ['pdf','png','jpg','jpeg','webp','gif'].includes(ext);
                      const previewUrl = `/api/procedures/${p.id}/document?mode=preview&path=${encodeURIComponent(doc.path)}&t=${Date.now()}`;
                      const downloadUrl = `/api/procedures/${p.id}/document?mode=download&path=${encodeURIComponent(doc.path)}`;
                      return (
                        <div key={di} className="flex items-center gap-1 group/doc">
                          <span className="flex items-center text-indigo-600 truncate max-w-[100px] bg-indigo-50 px-2 py-0.5 rounded text-xs font-medium" title={doc.name}>
                            <Paperclip className="h-3 w-3 mr-1 shrink-0" />
                            <span className="truncate">{doc.name}</span>
                          </span>
                          {/* Preview */}
                          <button title="Preview" onClick={() => {
                            if (previewable) {
                              setDocPreview({ url: previewUrl, name: doc.name, type: ext });
                            } else {
                              window.location.href = downloadUrl;
                            }
                          }} className="p-0.5 rounded text-slate-300 hover:text-indigo-600 transition-colors">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {/* Download */}
                          <a href={downloadUrl} download={doc.name} title="Download" className="p-0.5 rounded text-slate-300 hover:text-emerald-600 transition-colors">
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          {/* Delete */}
                          <button title="Delete" onClick={() => handleDeleteDoc(p.id, doc.path)} className="p-0.5 rounded text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover/doc:opacity-100">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    {parseDocs(p).length === 0 && (
                      <span className="text-slate-300 text-xs italic">No files</span>
                    )}
                    {/* Upload button — multiple + folder + ZIP */}
                    <div className="flex items-center gap-1 mt-0.5">
                      {uploading === p.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                      ) : (
                        <>
                          {/* Multiple files */}
                          <label title="Upload files" className="cursor-pointer p-0.5 rounded text-slate-400 hover:text-indigo-600 transition-colors">
                            <Upload className="h-3.5 w-3.5" />
                            <input type="file" className="hidden" multiple
                              accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.doc,.docx,.txt,.zip"
                              onChange={(e) => handleFileUpload(p.id, e)} />
                          </label>
                          {/* Folder upload */}
                          <label title="Upload folder" className="cursor-pointer p-0.5 rounded text-slate-400 hover:text-purple-600 transition-colors">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                            </svg>
                            <input type="file" className="hidden" multiple
                              {...({ webkitdirectory: '' } as any)}
                              onChange={(e) => handleFileUpload(p.id, e)} />
                          </label>
                        </>
                      )}
                    </div>
                  </div>
                </td>

                {/* Doc Source Toggle */}
                {(() => {
                  let cf: Record<string, string> = {};
                  try { cf = JSON.parse(p.custom_fields || '{}'); } catch {}
                  const src = cf['doc_source'] || 'client';
                  const isClient = src === 'client';
                  return (
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => handleCustomFieldUpdate(p.id, 'doc_source', isClient ? 'auditor' : 'client')}
                          title={isClient ? 'Currently set to Client — Switch to Auditor' : 'Currently set to Auditor — Switch to Client'}
                          className={clsx(
                            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all',
                            isClient
                              ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                              : 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'
                          )}
                        >
                          {isClient ? (
                            <><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zm-4 7a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>Client</>
                          ) : (
                            <><svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>Auditor</>
                          )}
                        </button>
                        <span className="text-[9px] text-slate-400 pl-0.5">
                          {isClient ? '📤 Client upload karega' : '🔧 Auditor banayega'}
                        </span>
                      </div>
                    </td>
                  );
                })()}

                {/* AI Check */}
                <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-500">
                  {role === 'Manager' ? (
                    <button
                      onClick={() => handleAICheck(p.id)}
                      disabled={parseDocs(p).length === 0 || verifying === p.id}
                      className="inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-semibold rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                    >
                      {verifying === p.id
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Checking...</>
                        : <><Bot className="h-3.5 w-3.5 mr-1" />Check</>
                      }
                    </button>
                  ) : (
                    <span className="text-slate-400 text-xs italic">Manager Only</span>
                  )}
                </td>

                {/* AI Result */}
                <td className="px-4 py-3 text-sm text-slate-500">
                  {getAIResultBadge(p.ai_result)}
                </td>

                {/* AI Remarks */}
                <td className="px-4 py-3 text-sm text-slate-600 min-w-[200px] whitespace-normal leading-relaxed">
                  {getAIRemarks(p.ai_result)}
                </td>

                {/* Remarks */}
                <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-500">
                  {rowIsEditing ? (
                    <input
                      type="text"
                      value={editFormData.client_remarks || ''}
                      onChange={(e) => handleEditFormChange('client_remarks', e.target.value)}
                      className="block w-full text-sm border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 border p-1.5"
                      placeholder="Client remarks..."
                    />
                  ) : (
                    <span className="text-slate-700">{p.client_remarks || '-'}</span>
                  )}
                </td>
                {/* Team Remarks */}
                <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-500">
                  {rowIsEditing ? (
                    <input
                      type="text"
                      value={editFormData.team_remarks || ''}
                      onChange={(e) => handleEditFormChange('team_remarks', e.target.value)}
                      className="block w-full text-sm border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 border p-1.5"
                      placeholder="Team remarks..."
                    />
                  ) : (
                    <span className="text-slate-700">{p.team_remarks || '-'}</span>
                  )}
                </td>

                {/* Custom Columns */}
                {customColumnsList.map((col: string) => {
                  let val = '';
                  try {
                    if (rowIsEditing) {
                      val = JSON.parse(editFormData.custom_fields || '{}')[col] || '';
                    } else {
                      val = JSON.parse(p.custom_fields || '{}')[col] || '';
                    }
                  } catch (e) {}
                  return (
                    <td key={col} className="px-4 py-3 whitespace-nowrap text-sm text-slate-500">
                      {rowIsEditing ? (
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => handleEditCustomFieldChange(col, e.target.value)}
                          className="block w-full text-sm border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 border p-1.5"
                          placeholder={`${col}...`}
                        />
                      ) : (
                        <span className="text-slate-700">{val || '-'}</span>
                      )}
                    </td>
                  );
                })}

                {/* Overall Status */}
                <td className="px-4 py-3 whitespace-nowrap text-center">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    {p.status === 'Done' ? (
                      <CheckCircle className="h-5 w-5 text-emerald-500" />
                    ) : p.status === 'In Progress' ? (
                      <Clock className="h-5 w-5 text-blue-500" />
                    ) : p.status === 'Not Applicable' ? (
                      <span className="text-slate-400 text-xs font-medium bg-slate-100 px-2 py-0.5 rounded">N/A</span>
                    ) : (
                      <AlertCircle className="h-5 w-5 text-slate-300" />
                    )}
                    {p.updated_at && (
                      <span className="text-[10px] text-slate-400 font-medium" title={new Date(p.updated_at).toLocaleString()}>
                        {new Date(p.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </td>

                {/* Action */}
                <td className="px-4 py-3 whitespace-nowrap text-center">
                  <div className="flex items-center justify-center gap-2">
                    {rowIsEditing ? (
                      <>
                        <button
                          onClick={() => saveEditing(p.id)}
                          className="text-emerald-600 hover:text-emerald-800 transition-colors p-1.5 rounded-md hover:bg-emerald-50"
                          title="Save Changes"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded-md hover:bg-slate-100"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => startEditing(p)}
                        className="text-indigo-600 hover:text-indigo-800 transition-colors p-1.5 rounded-md hover:bg-indigo-50"
                        title="Edit Row"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    )}
                    
                    {role === 'Manager' && !isSubRow && (
                      <button
                        onClick={() => handleAddSubTask(p.id)}
                        className="text-indigo-400 hover:text-indigo-600 transition-colors p-1.5 rounded-md hover:bg-indigo-50"
                        title="Add Sub-Task"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}

                    {role === 'Manager' && p.status === 'Pending' && !p.document_path && !rowIsEditing && (
                      <button
                        onClick={() => handleDeleteProcedure(p.id)}
                        className="text-red-400 hover:text-red-600 transition-colors p-1.5 rounded-md hover:bg-red-50"
                        title="Delete Procedure"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
                );
              };

              return (
                <React.Fragment key={proc.id}>
                  {renderRow(proc)}
                  {isExpanded && procedures.filter(p => p.parent_id === proc.id && (p.category || 'Audit Procedures') === activeTab).map(subProc => renderRow(subProc, true))}
                </React.Fragment>
              );
            })}
            {procedures.filter(p => !p.parent_id && (p.category || 'Audit Procedures') === activeTab).length === 0 && !loading && (
              <tr>
                <td colSpan={role === 'Manager' ? 14 + customColumnsList.length : 13 + customColumnsList.length} className="px-6 py-12 text-center text-gray-500">
                  No procedures found in {activeTab}. Import an audit programme Excel file or add a procedure manually to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  {/* Preview Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden p-4 sm:p-6" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setShowPreviewModal(false)}></div>
          <div className="relative bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all w-full max-w-6xl">
            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                      Import Preview
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500 mb-4">
                        Review the data before importing. Duplicates are highlighted. You can choose to update existing records or skip them.
                      </p>
                      <div className="max-h-[60vh] overflow-y-auto border border-gray-200 rounded-md">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50 sticky top-0 z-10">
                            <tr>
                              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                  checked={previewData.length > 0 && previewData.every(p => p.selected)}
                                  onChange={(e) => setPreviewData(previewData.map(p => ({ ...p, selected: e.target.checked })))}
                                />
                              </th>
                              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sr.</th>
                              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Area/Head</th>
                              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Procedure</th>
                              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk</th>
                              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Allotted To</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {previewData.map((row, idx) => (
                              <tr key={idx} className={clsx(
                                row.action === 'duplicate' ? 'bg-red-50' : row.action === 'update' ? 'bg-yellow-50' : 'bg-green-50'
                              )}>
                                <td className="px-3 py-4 whitespace-nowrap">
                                  <input
                                    type="checkbox"
                                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    checked={row.selected}
                                    onChange={(e) => {
                                      const newData = [...previewData];
                                      newData[idx].selected = e.target.checked;
                                      setPreviewData(newData);
                                    }}
                                  />
                                </td>
                                <td className="px-3 py-4 whitespace-nowrap text-xs font-medium">
                                  {row.action === 'new' && <span className="text-green-600">New</span>}
                                  {row.action === 'update' && <span className="text-yellow-600">Update</span>}
                                  {row.action === 'duplicate' && <span className="text-red-600">Duplicate</span>}
                                </td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-500">{row.sr_no}</td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900">{row.area}</td>
                                <td className="px-3 py-4 text-sm text-gray-900 max-w-xs truncate" title={row.procedure_text}>{row.procedure_text}</td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-500">{row.risk_flag}</td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-500">{row.allotted_to}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={loading || !previewData.some(p => p.selected)}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm disabled:bg-indigo-300"
                >
                  {loading ? 'Importing...' : 'Confirm Import'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
      )}
      {procedureToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden p-4 sm:p-6" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setProcedureToDelete(null)}></div>
          <div className="relative bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all w-full max-w-lg">
            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <AlertCircle className="h-6 w-6 text-red-600" aria-hidden="true" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                      Delete Procedure
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to delete this procedure? This action cannot be undone.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setProcedureToDelete(null)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
      )}
      {showAddRowModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden p-4 sm:p-6" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setShowAddRowModal(false)}></div>
          <div className="relative bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all w-full max-w-lg">
            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                  <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                    {parentForNewRow ? 'Add Sub-Task' : 'Add Manual Procedure'}
                  </h3>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Sr. No</label>
                      <input type="text" value={newRowData.sr_no} onChange={e => setNewRowData({...newRowData, sr_no: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                    </div>
                    {!parentForNewRow && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Area/Head</label>
                        <input type="text" value={newRowData.area} onChange={e => setNewRowData({...newRowData, area: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Procedure Text *</label>
                      <textarea value={newRowData.procedure_text} onChange={e => setNewRowData({...newRowData, procedure_text: e.target.value})} rows={3} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                    </div>
                    {!parentForNewRow && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Risk Flag</label>
                        <input type="text" value={newRowData.risk_flag} onChange={e => setNewRowData({...newRowData, risk_flag: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                      </div>
                    )}
                    {parentForNewRow && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Allotted To</label>
                        <select
                          value={newRowData.allotted_to || ''}
                          onChange={(e) => setNewRowData({...newRowData, allotted_to: e.target.value})}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        >
                          <option value="">Unassigned</option>
                          {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleAddRow}
                  disabled={loading || !newRowData.procedure_text}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm disabled:bg-indigo-300"
                >
                  {loading ? 'Saving...' : 'Add Procedure'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddRowModal(false);
                    setParentForNewRow(null);
                  }}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
      )}
      {showAddColumnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden p-4 sm:p-6" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setShowAddColumnModal(false)}></div>
          <div className="relative bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all w-full max-w-lg">
            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                  <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                    Add Custom Column
                  </h3>
                  <div className="mt-4">
                    <p className="text-sm text-gray-500 mb-2">
                      This will add a new column to the table for this client. You can use it to track specific details like "Sample Size", "Voucher Number", etc.
                    </p>
                    <label className="block text-sm font-medium text-gray-700">Column Name</label>
                    <input 
                      type="text" 
                      value={newColumnName} 
                      onChange={e => setNewColumnName(e.target.value)} 
                      placeholder="e.g., Sample Size"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" 
                    />
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleAddColumn}
                  disabled={loading || !newColumnName.trim()}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm disabled:bg-indigo-300"
                >
                  {loading ? 'Adding...' : 'Add Column'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddColumnModal(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
      )}
      {/* Clear All Modal */}
      {showClearAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
          <div className="fixed inset-0 bg-slate-900/50" onClick={() => setShowClearAllModal(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-6 border border-slate-200">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-red-100 rounded-full">
                <Trash2 className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Saare Procedures Delete Karo</h3>
                <p className="text-sm text-slate-500">This action cannot be undone</p>
              </div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-700 font-medium">⚠️ Warning: <span className="font-bold">{procedures.length} procedures</span> will be permanently deleted — including all documents and AI results.</p>
              <p className="text-sm text-red-600 mt-1">Iske baad fresh import kar sakte ho.</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowClearAllModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                disabled={clearingAll}
                className="px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {clearingAll ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting...</> : <><Trash2 className="h-4 w-4" /> Haan, Sab Delete Karo</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Client Modal */}
      {showEditClientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity" onClick={() => setShowEditClientModal(false)}></div>
          
          <div className="relative bg-white rounded-xl px-4 pt-5 pb-4 text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:max-w-lg sm:w-full sm:p-6 border border-slate-200">
            <div className="absolute top-0 right-0 pt-4 pr-4">
              <button
                type="button"
                className="bg-white rounded-md text-slate-400 hover:text-slate-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                onClick={() => setShowEditClientModal(false)}
              >
                <span className="sr-only">Close</span>
                <X className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>
            <div className="sm:flex sm:items-start">
              <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 sm:mx-0 sm:h-10 sm:w-10">
                <Edit2 className="h-5 w-5 text-indigo-600" aria-hidden="true" />
              </div>
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                <h3 className="text-lg leading-6 font-semibold text-slate-900">Edit Client Details</h3>
                <form onSubmit={handleEditClientSubmit} className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Client Name *</label>
                    <input
                      type="text"
                      required
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-slate-300 rounded-lg p-2.5 border bg-slate-50"
                      value={editClientData.name}
                      onChange={(e) => setEditClientData({ ...editClientData, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Entity Type</label>
                    <input
                      type="text"
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-slate-300 rounded-lg p-2.5 border bg-slate-50"
                      placeholder="e.g., Private Limited, LLP"
                      value={editClientData.entity_type}
                      onChange={(e) => setEditClientData({ ...editClientData, entity_type: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nature of Business</label>
                    <input
                      type="text"
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-slate-300 rounded-lg p-2.5 border bg-slate-50"
                      placeholder="e.g., Manufacturing, Trading"
                      value={editClientData.nature_of_business}
                      onChange={(e) => setEditClientData({ ...editClientData, nature_of_business: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Business Model</label>
                    <input
                      type="text"
                      className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-slate-300 rounded-lg p-2.5 border bg-slate-50"
                      placeholder="e.g., B2B, B2C"
                      value={editClientData.business_model}
                      onChange={(e) => setEditClientData({ ...editClientData, business_model: e.target.value })}
                    />
                  </div>
                  <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                    <button
                      type="submit"
                      className="w-full inline-flex justify-center rounded-lg border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm transition-colors"
                    >
                      Save Changes
                    </button>
                    <button
                      type="button"
                      className="mt-3 w-full inline-flex justify-center rounded-lg border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:w-auto sm:text-sm transition-colors"
                      onClick={() => setShowEditClientModal(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Status History Modal ── */}
      {historyModal && (() => {
        let history: Array<{ from: string; to: string; by: string; at: string; has_doc: boolean }> = [];
        try { history = JSON.parse(historyModal.status_history || '[]'); } catch {}
        const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setHistoryModal(null)} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg z-10 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <h3 className="font-semibold text-slate-800 text-sm">Status History</h3>
                  <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{historyModal.procedure_text || historyModal.area}</p>
                </div>
                <button onClick={() => setHistoryModal(null)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-5 py-4 max-h-96 overflow-y-auto">
                {history.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No history found</p>
                ) : (
                  <div className="space-y-3">
                    {[...history].reverse().map((h, i) => {
                      const hour = new Date(h.at).getHours();
                      const isOddTime = hour < 6 || hour >= 22;
                      return (
                        <div key={i} className="flex gap-3 items-start">
                          <div className="mt-0.5 shrink-0">
                            <div className="h-7 w-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xs">
                              {h.by?.charAt(0).toUpperCase() || '?'}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-slate-700">{h.by}</span>
                              <span className={clsx("text-[10px] font-medium px-1.5 py-0.5 rounded-full", getStatusColor(h.from))}>{h.from}</span>
                              <span className="text-slate-300 text-xs">→</span>
                              <span className={clsx("text-[10px] font-medium px-1.5 py-0.5 rounded-full", getStatusColor(h.to))}>{h.to}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-[10px] text-slate-400">{fmt(h.at)}</span>
                              {!h.has_doc && h.to === 'Done' && (
                                <span className="text-[9px] bg-red-100 text-red-600 rounded px-1 py-0.5 font-semibold">No Evidence</span>
                              )}
                              {isOddTime && (
                                <span className="text-[9px] bg-yellow-100 text-yellow-700 rounded px-1 py-0.5 font-semibold">Odd Time</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 text-right">
                <span className="text-xs text-slate-400">{history.length} change{history.length !== 1 ? 's' : ''} total</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Document Preview Modal ── */}
      {docPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setDocPreview(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-slate-200">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip className="h-4 w-4 text-indigo-500 shrink-0" />
                <span className="text-sm font-semibold text-slate-800 truncate">{docPreview.name}</span>
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                <a
                  href={docPreview.url.replace('mode=preview', 'mode=download')}
                  download={docPreview.name}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
                <button
                  onClick={() => setDocPreview(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto bg-slate-50 rounded-b-xl">
              {['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(docPreview.type) ? (
                <div className="flex items-center justify-center p-6 min-h-[400px]">
                  <img
                    src={docPreview.url}
                    alt={docPreview.name}
                    className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-md"
                  />
                </div>
              ) : docPreview.type === 'pdf' ? (
                <iframe
                  src={docPreview.url}
                  title={docPreview.name}
                  className="w-full rounded-b-xl"
                  style={{ height: '75vh' }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <FileText className="h-16 w-16 text-slate-300" />
                  <p className="text-slate-500 text-sm">This file cannot be previewed in the browser.</p>
                  <a
                    href={docPreview.url.replace('mode=preview', 'mode=download')}
                    download={docPreview.name}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    <Download className="h-4 w-4" /> Download to view
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Client Portal Modal */}
      {showPortalModal && (
        <SharePortalModal
          clientId={id!}
          clientName={client?.name || ''}
          procedures={procedures}
          onClose={() => setShowPortalModal(false)}
        />
      )}
    </div>
  );
}
