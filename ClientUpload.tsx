import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Upload, CheckCircle, AlertCircle, Loader2, FileText, Clock } from 'lucide-react';

interface RequestInfo {
  procedure_area: string;
  procedure_text: string;
  client_name: string;
  expires_at: string;
  status: string;
  already_uploaded?: boolean;
  uploaded_at?: string;
  document_name?: string;
}

export default function ClientUpload() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<RequestInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploaderName, setUploaderName] = useState('');
  const [uploaderEmail, setUploaderEmail] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetchRequestInfo();
  }, [token]);

  const fetchRequestInfo = async () => {
    try {
      const res = await fetch(`/api/upload/${token}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid or expired link');
        return;
      }
      setInfo(data);
      if (data.already_uploaded) setUploadDone(true);
    } catch {
      setError('Unable to connect to server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    if (!uploaderName.trim()) { alert('Please enter your name'); return; }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uploader_name', uploaderName);
      formData.append('uploader_email', uploaderEmail);

      const res = await fetch(`/api/upload/${token}`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUploadDone(true);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="h-8 w-8 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Link Valid Nahi</h1>
          <p className="text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  if (uploadDone) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="h-8 w-8 text-emerald-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Document Upload Ho Gaya!</h1>
          <p className="text-slate-500 mb-4">
            Your document has been submitted successfully. Your CA firm has been notified.
          </p>
          {info?.already_uploaded && info.uploaded_at && (
            <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600">
              <p>Document: <span className="font-medium">{info.document_name}</span></p>
              <p>Time: <span className="font-medium">{new Date(info.uploaded_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const expiryDate = info ? new Date(info.expires_at) : null;
  const hoursLeft = expiryDate ? Math.max(0, Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60))) : 0;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-lg">
        {/* Header */}
        <div className="bg-indigo-600 rounded-t-2xl p-6 text-white">
          <p className="text-indigo-200 text-sm mb-1">Document Request</p>
          <h1 className="text-xl font-bold">{info?.client_name}</h1>
          <div className="flex items-center gap-1 mt-2 text-indigo-200 text-xs">
            <Clock className="h-3.5 w-3.5" />
            <span>{hoursLeft > 24 ? `${Math.floor(hoursLeft / 24)} day(s)` : `${hoursLeft} hour(s)`} remaining</span>
          </div>
        </div>

        {/* Procedure Info */}
        <div className="p-6 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Required Document</p>
          <p className="text-sm font-semibold text-slate-700 mb-1">{info?.procedure_area}</p>
          <p className="text-sm text-slate-600 leading-relaxed">{info?.procedure_text}</p>
        </div>

        {/* Upload Form */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Aapka naam <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={uploaderName}
              onChange={e => setUploaderName(e.target.value)}
              placeholder="Poora naam likhein"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email (optional)</label>
            <input
              type="email"
              value={uploaderEmail}
              onChange={e => setUploaderEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* File Drop Zone */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Document <span className="text-red-500">*</span></label>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-input')?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-indigo-400 bg-indigo-50' :
                file ? 'border-emerald-400 bg-emerald-50' :
                'border-slate-300 hover:border-indigo-300 hover:bg-slate-50'
              }`}
            >
              <input
                id="file-input"
                type="file"
                className="hidden"
                onChange={e => e.target.files?.[0] && setFile(e.target.files[0])}
              />
              {file ? (
                <div className="flex items-center justify-center gap-2 text-emerald-700">
                  <FileText className="h-5 w-5" />
                  <span className="text-sm font-medium">{file.name}</span>
                </div>
              ) : (
                <div>
                  <Upload className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-600">Click to select or drag a file here</p>
                  <p className="text-xs text-slate-400 mt-1">PDF, Excel, Image, Word — all formats accepted</p>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={handleUpload}
            disabled={!file || !uploaderName.trim() || uploading}
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {uploading
              ? <><Loader2 className="h-4 w-4 animate-spin" />Uploading...</>
              : <><Upload className="h-4 w-4" />Document Submit Karo</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
