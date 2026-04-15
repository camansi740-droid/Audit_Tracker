import express from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import multer from 'multer';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import archiver from 'archiver';

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// ─── Supabase Config (stored locally in supabase.config.json) ─────────────────

const CONFIG_PATH = path.resolve('supabase.config.json');

function readConfig(): { supabase_url?: string; supabase_key?: string } {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

function writeConfig(config: object) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

let supabase: SupabaseClient | null = null;

function initSupabase(url: string, key: string): boolean {
  try {
    supabase = createClient(url, key);
    return true;
  } catch {
    return false;
  }
}

// Auto-init on startup from saved config
const savedConfig = readConfig();
if (savedConfig.supabase_url && savedConfig.supabase_key) {
  initSupabase(savedConfig.supabase_url, savedConfig.supabase_key);
  console.log('✅ Supabase initialized from saved config');
} else {
  console.log('⚠️  Supabase not configured. Go to Settings → Supabase to connect.');
}

// Middleware: require Supabase to be connected
function requireSupabase(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not connected. Please go to Settings and enter your Supabase credentials.' });
  }
  next();
}

const upload = multer({ storage: multer.memoryStorage() });

// ─── App Authentication ────────────────────────────────────────────────────────

// In-memory session store: token → expiry timestamp
const sessions = new Map<string, number>();

function parseCookies(cookieHeader: string): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k.trim(), v.join('=').trim()];
    })
  );
}

// Global auth middleware — all /api routes EXCEPT portal, auth, config
app.use('/api', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const openPaths = ['/portal/', '/auth/', '/config'];
  if (openPaths.some(p => req.path.startsWith(p))) return next();

  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies['af_session'];
  if (!token) return res.status(401).json({ error: 'Please login first' });

  const expiry = sessions.get(token);
  if (!expiry || Date.now() > expiry) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Session expired, please login again' });
  }
  next();
});

// POST /api/auth/login
app.post('/api/auth/login', (req: express.Request, res: express.Response) => {
  const { password } = req.body;
  const appPassword = process.env.APP_PASSWORD || 'audit123';
  if (password !== appPassword) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const token = uuidv4() + uuidv4().replace(/-/g, '');
  sessions.set(token, Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  res.setHeader('Set-Cookie', `af_session=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`);
  res.json({ success: true });
});

// GET /api/auth/verify
app.get('/api/auth/verify', (req: express.Request, res: express.Response) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies['af_session'];
  if (!token) return res.json({ valid: false });
  const expiry = sessions.get(token);
  if (!expiry || Date.now() > expiry) {
    sessions.delete(token);
    return res.json({ valid: false });
  }
  res.json({ valid: true });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req: express.Request, res: express.Response) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies['af_session'];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'af_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict');
  res.json({ success: true });
});

// ─── LOCAL PORTAL LINKS STORAGE (no Supabase table needed) ──
// ============================================================

const PORTAL_LINKS_FILE = path.resolve('portal-links.json');

interface PortalLink {
  id: string;
  client_id: string;
  token: string;
  client_email: string;
  client_name: string;
  message: string;
  expires_at: string;
  is_active: boolean;
  created_at: string;
}

function readPortalLinks(): PortalLink[] {
  try {
    if (fs.existsSync(PORTAL_LINKS_FILE)) {
      return JSON.parse(fs.readFileSync(PORTAL_LINKS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function writePortalLinks(links: PortalLink[]) {
  fs.writeFileSync(PORTAL_LINKS_FILE, JSON.stringify(links, null, 2));
}

function savePortalLink(link: PortalLink) {
  const links = readPortalLinks();
  links.push(link);
  writePortalLinks(links);
}

function getPortalLinkByToken(token: string): PortalLink | null {
  return readPortalLinks().find(l => l.token === token && l.is_active) || null;
}

function deactivatePortalLink(id: string) {
  const links = readPortalLinks();
  const updated = links.map(l => l.id === id ? { ...l, is_active: false } : l);
  writePortalLinks(updated);
}

// ─── CLIENT PORTAL ROUTES ────────────────────────────────────

// Helper: get email config from settings
async function getEmailConfig() {
  if (!supabase) return null;
  const { data } = await supabase.from('settings').select('key, value').in('key', ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'firm_name']);
  if (!data) return null;
  const cfg: any = {};
  for (const row of data) cfg[row.key] = row.value;
  return cfg;
}

// POST /api/clients/:id/portal-link — Generate portal link aur email bhejo
app.post('/api/clients/:id/portal-link', requireSupabase, async (req, res) => {
  try {
    const { client_email, client_name, message, expires_days = 7, procedure_ids } = req.body;
    if (!client_email || !client_name) {
      return res.status(400).json({ error: 'client_email and client_name are required' });
    }

    const clientId = req.params.id;

    // Verify client exists
    const { data: client, error: ce } = await supabase!.from('clients').select('id, name').eq('id', clientId).single();
    if (ce || !client) return res.status(404).json({ error: 'Client not found' });

    const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    const tokenId = uuidv4();
    const expiresAt = new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000).toISOString();

    // Save token LOCALLY (no Supabase table needed)
    savePortalLink({
      id: tokenId,
      client_id: clientId,
      token,
      client_email,
      client_name,
      message: message || '',
      expires_at: expiresAt,
      is_active: true,
      created_at: new Date().toISOString(),
    });

    // Mark procedures as client_requested if provided
    if (procedure_ids && procedure_ids.length > 0) {
      try {
        await supabase!.from('procedures').update({ client_requested: true }).in('id', procedure_ids).eq('client_id', clientId);
      } catch (colErr: any) {
        console.warn('⚠️  client_requested column does not exist — skipping.');
      }
    }

    const appBase = process.env.APP_URL || `http://localhost:5173`;
    const portalUrl = `${appBase}/portal/${token}`;

    // Send email if SMTP configured
    let emailSent = false;
    try {
      const emailCfg = await getEmailConfig();
      if (emailCfg?.smtp_host && emailCfg?.smtp_user && emailCfg?.smtp_pass) {
        const transporter = nodemailer.createTransport({
          host: emailCfg.smtp_host,
          port: parseInt(emailCfg.smtp_port || '587'),
          secure: emailCfg.smtp_port === '465',
          auth: { user: emailCfg.smtp_user, pass: emailCfg.smtp_pass },
        });

        const firmName = emailCfg.firm_name || 'AuditFlow AI';
        const fromEmail = emailCfg.smtp_from || emailCfg.smtp_user;

        await transporter.sendMail({
          from: `"${firmName}" <${fromEmail}>`,
          to: `"${client_name}" <${client_email}>`,
          subject: `📄 Documents Required — ${client.name} | ${firmName}`,
          html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 700;">📋 Document Request</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">${firmName}</p>
    </div>
    <div style="padding: 32px;">
      <p style="color: #374151; font-size: 16px; margin: 0 0 16px;">Dear <strong>${client_name}</strong>,</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
        ${message || `Some documents are required for the audit. Please click the link below to upload your documents.`}
      </p>
      <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="color: #64748b; font-size: 13px; margin: 0 0 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Client Name</p>
        <p style="color: #0f172a; font-size: 15px; font-weight: 600; margin: 0;">${client.name}</p>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${portalUrl}" style="background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
          📤 Upload Documents
        </a>
      </div>
      <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="color: #64748b; font-size: 12px; margin: 0 0 6px; font-weight: 600;">Direct Link:</p>
        <p style="color: #4f46e5; font-size: 12px; word-break: break-all; margin: 0;">${portalUrl}</p>
      </div>
      <p style="color: #94a3b8; font-size: 12px; margin: 24px 0 0; text-align: center;">
        ⏰ Yeh link ${expires_days} din mein expire hoga (${new Date(expiresAt).toLocaleDateString('en-IN')} tak valid hai)
      </p>
    </div>
    <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">${firmName} • Powered by AuditFlow AI</p>
    </div>
  </div>
</body>
</html>`,
        });
        emailSent = true;
      }
    } catch (emailErr: any) {
      console.error('⚠️  Email send failed:', emailErr.message);
    }

    res.json({ success: true, token, portal_url: portalUrl, email_sent: emailSent, expires_at: expiresAt });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id/portal-links — Client ke saare portal links
app.get('/api/clients/:id/portal-links', requireSupabase, async (req, res) => {
  try {
    const allLinks = readPortalLinks();
    const clientLinks = allLinks
      .filter(l => l.client_id === req.params.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(clientLinks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/portal-links/:id — Link deactivate karo
app.delete('/api/portal-links/:id', requireSupabase, async (req, res) => {
  try {
    deactivatePortalLink(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUBLIC PORTAL ROUTES (no Supabase middleware — token se auth hoga) ─────────

// GET /api/portal/:token — Token validate karo + client info do
app.get('/api/portal/:token', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Server not ready' });
  try {
    const tokenData = getPortalLinkByToken(req.params.token);
    if (!tokenData) return res.status(404).json({ error: 'Link is invalid or has expired' });
    if (new Date(tokenData.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This link has expired. Please contact your CA firm for a new link.' });
    }

    const { data: clientInfo, error: ce } = await supabase!.from('clients').select('id, name, entity_type').eq('id', tokenData.client_id).single();
    if (ce || !clientInfo) return res.status(404).json({ error: 'Client not found' });

    const { data: procedures, error: pe } = await supabase
      .from('procedures')
      .select('id, sr_no, area, procedure_text, status, document_path, document_original_name, category, custom_fields, updated_at')
      .eq('client_id', tokenData.client_id)
      .is('parent_id', null)
      .order('sr_no');

    if (pe) throw pe;

    res.json({
      client: clientInfo,
      client_name: tokenData.client_name,
      message: tokenData.message,
      expires_at: tokenData.expires_at,
      sent_at: tokenData.created_at,
      procedures: procedures || [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/portal/:token/upload/:procId — Client se document upload
app.post('/api/portal/:token/upload/:procId', upload.array('files', 20), async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Server not ready' });
  try {
    const tokenData = getPortalLinkByToken(req.params.token);
    if (!tokenData || !tokenData.is_active) return res.status(403).json({ error: 'Invalid link' });
    if (new Date(tokenData.expires_at) < new Date()) return res.status(410).json({ error: 'Link expired' });

    const { data: proc, error: pe } = await supabase
      .from('procedures')
      .select('id, document_path, document_original_name, custom_fields')
      .eq('id', req.params.procId)
      .eq('client_id', tokenData.client_id)
      .single();

    if (pe || !proc) return res.status(404).json({ error: 'Procedure not found' });

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: 'No file selected' });

    let existingPaths: string[] = [];
    let existingNames: string[] = [];
    try { existingPaths = JSON.parse(proc.document_path || '[]'); } catch { if (proc.document_path) existingPaths = [proc.document_path]; }
    try { existingNames = JSON.parse(proc.document_original_name || '[]'); } catch { if (proc.document_original_name) existingNames = [proc.document_original_name]; }

    for (const file of files) {
      const ext = path.extname(file.originalname);
      const safeName = `${uuidv4()}${ext}`;
      const storagePath = `client-portal/${tokenData.client_id}/${req.params.procId}/${safeName}`;
      const { error: ue } = await supabase!.storage.from('auditflow').upload(storagePath, file.buffer, { contentType: file.mimetype });
      if (ue) throw ue;
      existingPaths.push(storagePath);
      existingNames.push(file.originalname);
    }

    let existingCustomFields: any = {};
    try { existingCustomFields = JSON.parse((proc as any).custom_fields || '{}'); } catch {}
    existingCustomFields['_tracked_client_responded'] = new Date().toISOString();

    const { error: upe } = await supabase!.from('procedures').update({
      document_path: JSON.stringify(existingPaths),
      document_original_name: JSON.stringify(existingNames),
      status: 'In Progress',
      updated_at: new Date().toISOString(),
      custom_fields: JSON.stringify(existingCustomFields),
    }).eq('id', req.params.procId);

    if (upe) throw upe;

    res.json({ success: true, uploaded: files.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/portal/:token/document/:procId/:docIndex — Client portal se document download
app.get('/api/portal/:token/document/:procId/:docIndex', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Server not ready' });
  try {
    const tokenData = getPortalLinkByToken(req.params.token);
    if (!tokenData || !tokenData.is_active) return res.status(403).json({ error: 'Invalid link' });

    const { data: proc } = await supabase.from('procedures').select('document_path, document_original_name').eq('id', req.params.procId).eq('client_id', tokenData.client_id).single();
    if (!proc) return res.status(404).json({ error: 'Not found' });

    let paths: string[] = [];
    let names: string[] = [];
    try { paths = JSON.parse(proc.document_path || '[]'); } catch { if (proc.document_path) paths = [proc.document_path]; }
    try { names = JSON.parse(proc.document_original_name || '[]'); } catch { if (proc.document_original_name) names = [proc.document_original_name]; }

    const idx = parseInt(req.params.docIndex);
    if (isNaN(idx) || idx >= paths.length) return res.status(404).json({ error: 'Document not found' });

    const { data: signedUrl } = await supabase!.storage.from('auditflow').createSignedUrl(paths[idx], 60);
    if (!signedUrl?.signedUrl) return res.status(500).json({ error: 'Could not generate download link' });

    res.redirect(signedUrl.signedUrl);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/portal/:token/document/:procId/:docIndex — Client portal se file delete
app.delete('/api/portal/:token/document/:procId/:docIndex', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Server not ready' });
  try {
    const tokenData = getPortalLinkByToken(req.params.token);
    if (!tokenData || !tokenData.is_active) return res.status(403).json({ error: 'Invalid or expired link' });

    // Expiry check
    if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date())
      return res.status(403).json({ error: 'Portal link has expired' });

    const { data: proc } = await supabase
      .from('procedures')
      .select('document_path, document_original_name')
      .eq('id', req.params.procId)
      .eq('client_id', tokenData.client_id)
      .single();
    if (!proc) return res.status(404).json({ error: 'Procedure not found' });

    let paths: string[] = [];
    let names: string[] = [];
    try { paths = JSON.parse(proc.document_path || '[]'); } catch { if (proc.document_path) paths = [proc.document_path]; }
    try { names = JSON.parse(proc.document_original_name || '[]'); } catch { if (proc.document_original_name) names = [proc.document_original_name]; }

    const idx = parseInt(req.params.docIndex);
    if (isNaN(idx) || idx >= paths.length) return res.status(404).json({ error: 'File not found' });

    const pathToDelete = paths[idx];

    // Remove from storage
    await supabase.storage.from('auditflow').remove([pathToDelete]);

    // Update arrays
    paths.splice(idx, 1);
    names.splice(idx, 1);

    await supabase.from('procedures').update({
      document_path: paths.length ? JSON.stringify(paths) : null,
      document_original_name: names.length ? JSON.stringify(names) : null,
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.procId);

    res.json({ success: true, remaining: paths.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Supabase Config Endpoints ─────────────────────────────────────────────────

// GET /api/config — return current config status (key is masked)
app.get('/api/config', (req, res) => {
  const cfg = readConfig();
  res.json({
    supabase_url: cfg.supabase_url || '',
    supabase_key_set: !!cfg.supabase_key,
    connected: !!supabase,
  });
});

// POST /api/config — save Supabase credentials and connect
app.post('/api/config', (req, res) => {
  const { supabase_url, supabase_key } = req.body;
  if (!supabase_url || !supabase_key) {
    return res.status(400).json({ success: false, message: 'Both URL and Key are required' });
  }

  const success = initSupabase(supabase_url, supabase_key);
  if (success) {
    writeConfig({ supabase_url, supabase_key });
    console.log('✅ Supabase connected and config saved');
    res.json({ success: true, message: 'Connected to Supabase successfully!' });
  } else {
    res.status(500).json({ success: false, message: 'Connection failed. Please check your URL and Key.' });
  }
});

// ─── App Settings ──────────────────────────────────────────────────────────────

app.get('/api/settings', requireSupabase, async (req, res) => {
  try {
    const { data, error } = await supabase!.from('settings').select('key, value');
    if (error) throw error;

    const result: any = { team_members: [] };
    for (const row of data || []) {
      result[row.key] = row.key === 'team_members' ? JSON.parse(row.value || '[]') : row.value;
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', requireSupabase, async (req, res) => {
  try {
    const { gemini_key, openai_key, claude_key, groq_key, active_provider, team_members } = req.body;
    const upserts = [
      { key: 'gemini_key',      value: gemini_key || '' },
      { key: 'openai_key',      value: openai_key || '' },
      { key: 'claude_key',      value: claude_key || '' },
      { key: 'groq_key',        value: groq_key || '' },
      { key: 'active_provider', value: active_provider || 'gemini' },
      { key: 'team_members',    value: JSON.stringify(team_members || []) },
    ];
    for (const u of upserts) {
      await supabase!.from('settings').upsert({ key: u.key, value: u.value }, { onConflict: 'key' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Clients ───────────────────────────────────────────────────────────────────

app.get('/api/clients', requireSupabase, async (req, res) => {
  try {
    const { data, error } = await supabase!
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { return res.status(503).json({ error: error.message }); }
    const parsed = (data || []).map((c: any) => ({
      ...c,
      assigned_to: (() => {
        try { return JSON.parse(c.assigned_to || '[]'); }
        catch { return c.assigned_to ? [c.assigned_to] : []; }
      })()
    }));
    res.json(parsed);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', requireSupabase, async (req, res) => {
  try {
    const { name, entity_type, nature_of_business, business_model, assigned_to } = req.body;
    const assignedArr = Array.isArray(assigned_to) ? assigned_to : [];
    const { data, error } = await supabase!
      .from('clients')
      .insert({ id: uuidv4(), name, entity_type, nature_of_business, business_model, assigned_to: JSON.stringify(assignedArr), custom_columns: '[]' })
      .select()
      .single();
    if (error) throw error;
    res.json({ ...data, assigned_to: assignedArr });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/clients/:id', requireSupabase, async (req, res) => {
  try {
    const body = { ...req.body };
    if (Array.isArray(body.assigned_to)) {
      body.assigned_to = JSON.stringify(body.assigned_to);
    }
    const { data, error } = await supabase!
      .from('clients').update(body).eq('id', req.params.id).select().single();
    if (error) throw error;
    const assignedParsed = (() => {
      try { return JSON.parse(data.assigned_to || '[]'); }
      catch { return []; }
    })();
    res.json({ ...data, assigned_to: assignedParsed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', requireSupabase, async (req, res) => {
  try {
    const { error } = await supabase!.from('clients').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Custom Columns
app.post('/api/clients/:id/columns', requireSupabase, async (req, res) => {
  try {
    const { id } = req.params;
    const { columnName } = req.body;
    const { data: client, error: fe } = await supabase!.from('clients').select('custom_columns').eq('id', id).single();
    if (fe) throw fe;
    const cols: string[] = JSON.parse(client.custom_columns || '[]');
    if (!cols.includes(columnName)) cols.push(columnName);
    const { error } = await supabase!.from('clients').update({ custom_columns: JSON.stringify(cols) }).eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Procedures ────────────────────────────────────────────────────────────────

app.get('/api/clients/:id/procedures', requireSupabase, async (req, res) => {
  try {
    const { data, error } = await supabase!
      .from('procedures').select('*').eq('client_id', req.params.id).order('sr_no');
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients/:id/procedures', requireSupabase, async (req, res) => {
  try {
    const { sr_no, area, procedure_text, risk_flag, allotted_to, parent_id, category } = req.body;
    const { data, error } = await supabase!.from('procedures').insert({
      id: uuidv4(), client_id: req.params.id,
      sr_no, area, procedure_text, risk_flag, allotted_to,
      parent_id: parent_id || null,
      category: category || 'Audit Procedures',
      status: 'Pending',
      updated_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE all procedures for a client (bulk clear)
app.delete('/api/clients/:id/procedures', requireSupabase, async (req, res) => {
  try {
    const { error } = await supabase!.from('procedures').delete().eq('client_id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/procedures/:id', requireSupabase, async (req, res) => {
  try {
    const { changed_by, ...rest } = req.body;
    const updates: any = { ...rest, updated_at: new Date().toISOString() };

    // ── Audit Trail: if status is being changed, log it ──────────────────
    if (rest.status) {
      const { data: current } = await supabase!
        .from('procedures').select('status, status_history').eq('id', req.params.id).single();

      if (current && current.status !== rest.status) {
        const now = new Date().toISOString();
        const actor = changed_by || 'Unknown';

        // Parse existing history
        let history: any[] = [];
        try { history = JSON.parse(current.status_history || '[]'); } catch {}

        // Append new entry
        history.push({
          from:       current.status,
          to:         rest.status,
          by:         actor,
          at:         now,
          has_doc:    !!rest.document_path,       // had evidence?
        });

        updates.status_changed_by = actor;
        updates.status_changed_at = now;
        updates.status_history    = JSON.stringify(history);

        // ── Flag suspicious patterns ──────────────────────────────────
        const flags: string[] = [];
        const hour = new Date(now).getHours();
        if (hour < 6 || hour >= 22) flags.push('unusual_time');

        // Count how many this user changed in last 60 min
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const recentInHistory = history.filter(
          h => h.by === actor && h.at >= oneHourAgo
        ).length;
        if (recentInHistory >= 10) flags.push('bulk_update');

        if (rest.status === 'Done' && !rest.document_path && !current.status_history?.includes('"has_doc":true')) {
          flags.push('no_evidence');
        }

        if (flags.length > 0) updates.status_flags = JSON.stringify(flags);
      }
    }

    const { data, error } = await supabase!
      .from('procedures').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/procedures/:id', requireSupabase, async (req, res) => {
  try {
    const { error } = await supabase!.from('procedures').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── File Upload → Supabase Storage ───────────────────────────────────────────

// ─── ZIP Extractor (pure Node.js, no extra deps) ─────────────────────────────

function extractZip(buffer: Buffer): Array<{ name: string; data: Buffer }> {
  const files: Array<{ name: string; data: Buffer }> = [];
  const inflateSync = require('zlib').inflateRawSync;
  let offset = 0;

  while (offset < buffer.length - 4) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break; // Local file header signature

    const flags        = buffer.readUInt16LE(offset + 6);
    const compression  = buffer.readUInt16LE(offset + 8);
    const compSize     = buffer.readUInt32LE(offset + 18);
    const uncompSize   = buffer.readUInt32LE(offset + 22);
    const nameLen      = buffer.readUInt16LE(offset + 26);
    const extraLen     = buffer.readUInt16LE(offset + 28);
    const name         = buffer.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart    = offset + 30 + nameLen + extraLen;
    const compData     = buffer.slice(dataStart, dataStart + compSize);

    // Skip directories and __MACOSX
    if (!name.endsWith('/') && !name.startsWith('__MACOSX') && !name.includes('/.')) {
      try {
        const data = compression === 0 ? compData : inflateSync(compData);
        files.push({ name: name.includes('/') ? name.split('/').pop()! : name, data });
      } catch {}
    }
    offset = dataStart + compSize;
  }
  return files;
}

// ─── Helper: parse stored documents JSON (backward compat) ───────────────────

function parseDocuments(docPath: string | null, docName: string | null): Array<{ path: string; name: string }> {
  if (!docPath) return [];
  try {
    const parsedPaths = JSON.parse(docPath);
    if (Array.isArray(parsedPaths)) {
      // Could be array of strings ["path1","path2"] or array of objects [{path,name}]
      if (typeof parsedPaths[0] === 'string') {
        // New format: paths stored as JSON array, names stored separately
        let names: string[] = [];
        try { names = JSON.parse(docName || '[]'); } catch {}
        return parsedPaths.map((p: string, i: number) => ({
          path: p,
          name: names[i] || p.split('/').pop() || p,
        }));
      } else if (typeof parsedPaths[0] === 'object') {
        // Object array format
        return parsedPaths.map((d: any) => ({ path: d.path || d, name: d.name || String(d).split('/').pop() || String(d) }));
      }
    }
  } catch {}
  // Old single-file format (plain string)
  return [{ path: docPath, name: docName || path.basename(docPath) }];
}

// ─── Multi-file Upload ────────────────────────────────────────────────────────

app.post('/api/procedures/:id/upload', requireSupabase, upload.array('files', 100), async (req, res) => {
  try {
    const { id } = req.params;
    const source = (req.query.source as string) || ''; // 'client' | 'auditor' | ''
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files provided' });

    // Helper: upload files to storage and return doc objects
    const uploadFilesToStorage = async (folderPrefix: string): Promise<Array<{ path: string; name: string }>> => {
      const result: Array<{ path: string; name: string }> = [];
      for (const file of files) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.zip') {
          const extracted = extractZip(file.buffer);
          if (extracted.length === 0) {
            const storagePath = `${folderPrefix}/${id}_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            const { error } = await supabase!.storage.from('auditflow').upload(storagePath, file.buffer, { contentType: 'application/zip', upsert: true });
            if (!error) result.push({ path: storagePath, name: file.originalname });
          } else {
            for (const zf of extracted) {
              const safeName = zf.name.replace(/[^a-zA-Z0-9._-]/g, '_');
              const storagePath = `${folderPrefix}/${id}_${Date.now()}_${safeName}`;
              const mimeType = getMimeTypeFromExt(path.extname(zf.name));
              const { error } = await supabase!.storage.from('auditflow').upload(storagePath, zf.data, { contentType: mimeType, upsert: true });
              if (!error) result.push({ path: storagePath, name: zf.name });
            }
          }
        } else {
          const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
          const storagePath = `${folderPrefix}/${id}_${Date.now()}_${safeName}`;
          const { error } = await supabase!.storage.from('auditflow').upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true });
          if (!error) result.push({ path: storagePath, name: file.originalname });
        }
      }
      return result;
    };

    // ── SOURCE-TAGGED upload (client_docs / auditor_docs in custom_fields) ──
    if (source === 'client' || source === 'auditor') {
      const { data: proc } = await supabase!.from('procedures').select('custom_fields').eq('id', id).single();
      let cf: any = {};
      try { cf = JSON.parse(proc?.custom_fields || '{}'); } catch {}

      const fieldKey = source === 'client' ? 'client_docs' : 'auditor_docs';
      const folderPrefix = source === 'client' ? 'client-docs' : 'auditor-docs';
      const existingDocs: Array<{ path: string; name: string }> = cf[fieldKey] || [];
      const newDocs = await uploadFilesToStorage(folderPrefix);

      cf[fieldKey] = [...existingDocs, ...newDocs];

      await supabase!.from('procedures').update({
        custom_fields: JSON.stringify(cf),
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      return res.json({ documents: cf[fieldKey], added: newDocs.length, source });
    }

    // ── LEGACY upload (document_path / document_original_name) ──
    const { data: proc } = await supabase!.from('procedures').select('document_path, document_original_name').eq('id', id).single();
    const existingDocs = parseDocuments(proc?.document_path, proc?.document_original_name);
    const newDocs = await uploadFilesToStorage('documents');
    const allDocs = [...existingDocs, ...newDocs];

    await supabase!.from('procedures').update({
      document_path: JSON.stringify(allDocs.map(d => d.path)),
      document_original_name: JSON.stringify(allDocs.map(d => d.name)),
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    res.json({ documents: allDocs, added: newDocs.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete a single document from a procedure ───────────────────────────────

app.delete('/api/procedures/:id/document', requireSupabase, async (req, res) => {
  try {
    const { id } = req.params;
    const { docPath, source } = req.body; // source: 'client' | 'auditor' | undefined

    // Delete from storage
    await supabase!.storage.from('auditflow').remove([docPath]);

    // ── SOURCE-TAGGED delete (client_docs / auditor_docs in custom_fields) ──
    if (source === 'client' || source === 'auditor') {
      const { data: proc } = await supabase!.from('procedures').select('custom_fields').eq('id', id).single();
      let cf: any = {};
      try { cf = JSON.parse(proc?.custom_fields || '{}'); } catch {}
      const fieldKey = source === 'client' ? 'client_docs' : 'auditor_docs';
      const docs: Array<{ path: string; name: string }> = (cf[fieldKey] || []).filter((d: any) => d.path !== docPath);
      cf[fieldKey] = docs;
      await supabase!.from('procedures').update({
        custom_fields: JSON.stringify(cf),
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      return res.json({ success: true, remaining: docs.length });
    }

    // ── LEGACY delete (document_path / document_original_name) ──
    const { data: proc } = await supabase!.from('procedures').select('document_path, document_original_name').eq('id', id).single();
    let docs = parseDocuments(proc?.document_path, proc?.document_original_name);
    docs = docs.filter(d => d.path !== docPath);

    await supabase!.from('procedures').update({
      document_path: docs.length ? JSON.stringify(docs.map(d => d.path)) : null,
      document_original_name: docs.length ? JSON.stringify(docs.map(d => d.name)) : null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    res.json({ success: true, remaining: docs.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function getMimeTypeFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel', '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain', '.zip': 'application/zip',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

// ─── Document Download (single file by storagePath) ──────────────────────────

app.get('/api/procedures/:id/document', requireSupabase, async (req, res) => {
  try {
    const { id } = req.params;
    const mode       = req.query.mode as string || 'download';
    const storagePath = req.query.path as string; // optional: specific file path

    const { data: proc, error: pe } = await supabase!.from('procedures').select('document_path, document_original_name').eq('id', id).single();
    if (pe || !proc?.document_path) return res.status(404).json({ error: 'Document not found' });

    const docs = parseDocuments(proc.document_path, proc.document_original_name);
    if (docs.length === 0) return res.status(404).json({ error: 'No documents' });

    // Pick specific file or first file
    const doc = storagePath ? docs.find(d => d.path === storagePath) || docs[0] : docs[0];

    const { data: fileBlob, error: fe } = await supabase!.storage.from('auditflow').download(doc.path);
    if (fe) throw new Error('Storage download failed: ' + fe.message);

    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const ext = path.extname(doc.path).toLowerCase();
    const contentType = getMimeTypeFromExt(ext);
    const filename = doc.name || path.basename(doc.path);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `${mode === 'preview' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── List documents for a procedure ──────────────────────────────────────────

app.get('/api/procedures/:id/documents', requireSupabase, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: proc } = await supabase!.from('procedures').select('document_path, document_original_name').eq('id', id).single();
    const docs = parseDocuments(proc?.document_path || null, proc?.document_original_name || null);
    res.json(docs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk Download — All documents for a client as ZIP ───────────────────────

app.get('/api/clients/:id/download-all', requireSupabase, async (req, res) => {
  try {
    const { id } = req.params;
    const category = req.query.category as string | undefined; // optional filter

    // Fetch client name
    const { data: client } = await supabase!.from('clients').select('name').eq('id', id).single();
    const clientName = (client?.name || 'Client').replace(/[^a-zA-Z0-9_\- ]/g, '_');

    // Fetch procedures with documents
    let query = supabase!.from('procedures')
      .select('id, sr_no, area, procedure_text, document_path, document_original_name, category, status')
      .eq('client_id', id)
      .is('parent_id', null);
    if (category) query = query.eq('category', category);
    const { data: procedures } = await query.order('sr_no');

    if (!procedures || procedures.length === 0)
      return res.status(404).json({ error: 'No procedures found' });

    // Collect all docs
    const allDocs: Array<{ storagePath: string; fileName: string; folder: string }> = [];
    for (const proc of procedures) {
      const docs = parseDocuments(proc.document_path, proc.document_original_name);
      if (docs.length === 0) continue;
      const folderName = (proc.category || 'Other').replace(/[^a-zA-Z0-9_\- ]/g, '_');
      docs.forEach((doc, i) => {
        const ext = doc.path.split('.').pop() || '';
        const baseName = doc.name.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
        const fileName = `${proc.sr_no}_${baseName}`;
        allDocs.push({ storagePath: doc.path, fileName, folder: folderName });
      });
    }

    if (allDocs.length === 0)
      return res.status(404).json({ error: 'No documents found to download' });

    // Buffer entire ZIP in memory first to avoid chunked encoding issues
    const archive = archiver('zip', { zlib: { level: 6 } });

    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    const zipReady = new Promise<Buffer>((resolve, reject) => {
      archive.on('finish', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });

    // Download each file from Supabase and append to ZIP
    for (const doc of allDocs) {
      try {
        const { data, error } = await supabase!.storage.from('auditflow').download(doc.storagePath);
        if (error || !data) continue;
        const buffer = Buffer.from(await data.arrayBuffer());
        archive.append(buffer, { name: `${doc.folder}/${doc.fileName}` });
      } catch {
        // skip failed files
      }
    }

    await archive.finalize();
    const zipBuffer = await zipReady;

    // Send complete ZIP with Content-Length (no chunked encoding issues)
    const zipName = `${clientName}_${category ? category.replace(/[^a-zA-Z0-9]/g, '_') + '_' : ''}Documents.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.end(zipBuffer);

  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─── AI Verification ───────────────────────────────────────────────────────────

// ─── File Type Detection ──────────────────────────────────────────────────────

function getFileExt(filePath: string): string {
  return (filePath.toLowerCase().split('.').pop() || '');
}

function isExcelFile(filePath: string): boolean {
  const ext = getFileExt(filePath);
  return ext === 'xlsx' || ext === 'xls' || ext === 'csv';
}

function isImageFile(filePath: string): boolean {
  const ext = getFileExt(filePath);
  return ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
}

function isPdfFile(filePath: string): boolean {
  return getFileExt(filePath) === 'pdf';
}

function getImageMime(filePath: string): string {
  const ext = getFileExt(filePath);
  const map: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  return map[ext] || 'image/jpeg';
}

// Convert Excel buffer to readable text for AI — handles merged cells, formatting
function excelToText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: false, raw: false, cellDates: true });
  let text = '';

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue; // skip truly empty sheets

    text += `=== Sheet: ${sheetName} ===\n`;

    // Method 1: sheet_to_csv handles merged cells better than sheet_to_json
    try {
      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      const lines = csv.split('\n')
        .map(l => l.replace(/,+$/, '').trim()) // remove trailing commas
        .filter(l => l.length > 0 && l.replace(/,/g, '').trim().length > 0); // skip blank rows
      if (lines.length > 0) {
        text += lines.join('\n') + '\n\n';
        continue;
      }
    } catch {}

    // Method 2: fallback — read each cell individually (catches edge cases)
    const ref = ws['!ref'];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      for (let r = range.s.r; r <= range.e.r; r++) {
        const rowVals: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[cellAddr];
          if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim()) {
            rowVals.push(String(cell.v).trim());
          }
        }
        if (rowVals.length > 0) text += rowVals.join(' | ') + '\n';
      }
      text += '\n';
    }
  }

  return text.trim().slice(0, 20000); // increased from 12k to 20k for larger agreements
}

app.post('/api/procedures/:id/verify', requireSupabase, async (req, res) => {
  try {
    const { id } = req.params;

    // Step 1: Fetch procedure
    const { data: proc, error: pe } = await supabase!.from('procedures').select('*').eq('id', id).single();
    if (pe) throw new Error('Procedure not found: ' + pe.message);
    if (!proc.document_path) return res.status(400).json({ error: 'Please upload a document for this procedure first' });

    const allDocs = parseDocuments(proc.document_path, proc.document_original_name);
    if (allDocs.length === 0) return res.status(400).json({ error: 'No document found' });

    // Step 2: Fetch AI provider settings
    const { data: settingRows, error: se } = await supabase!.from('settings').select('key, value');
    if (se) throw new Error('Settings fetch failed: ' + se.message);
    const s: any = {};
    for (const r of settingRows || []) s[r.key] = r.value;
    const provider = s.active_provider || 'gemini';

    // Step 3: Download ALL documents and prepare content
    const docLabel = allDocs.length > 1
      ? `${allDocs.length} documents (reconcile all together)`
      : `1 document`;

    // Build combined text content (for Excel/CSV files) + collect binary files
    let combinedTextContent = '';
    const binaryDocs: Array<{ name: string; mimeType: string; base64: string; isImage: boolean; isPdf: boolean }> = [];

    for (const doc of allDocs) {
      const { data: blob, error: fe } = await supabase!.storage.from('auditflow').download(doc.path);
      if (fe) { console.warn('Could not download', doc.path, fe.message); continue; }
      const buf = Buffer.from(await blob.arrayBuffer());

      if (isExcelFile(doc.path)) {
        const text = excelToText(buf);
        combinedTextContent += `\n\n=== Document: ${doc.name} ===\n${text}`;
      } else if (isImageFile(doc.path) || isPdfFile(doc.path)) {
        const mime = isPdfFile(doc.path) ? 'application/pdf' : getImageMime(doc.path);
        binaryDocs.push({ name: doc.name, mimeType: mime, base64: buf.toString('base64'), isImage: isImageFile(doc.path), isPdf: isPdfFile(doc.path) });
      }
    }

    // Step 4: Build prompt
    const basePrompt = `You are an audit assistant. Analyze the following document(s) against this audit procedure.

Procedure: ${proc.procedure_text}
Area: ${proc.area}
Documents provided: ${docLabel}

${allDocs.length > 1 ? 'IMPORTANT: Reconcile ALL provided documents together. Cross-check them against each other and against the procedure.' : ''}

Do the document(s) satisfy this audit procedure?
Respond with exactly one of: "Match", "Partial Match", or "Mismatch"
Then on a new line: "Reason: [brief explanation under 80 words]"`;

    let result = '';

    // ── All text content (Excel/CSV) — works with every provider ──────────────
    if (combinedTextContent && binaryDocs.length === 0) {
      const fullPrompt = basePrompt + combinedTextContent;

      if (provider === 'gemini') {
        const apiKey = s.gemini_key;
        if (!apiKey) throw new Error('Gemini API key not configured in Settings');
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error('Gemini error: ' + (d.error?.message || JSON.stringify(d)));
        result = d.candidates?.[0]?.content?.parts?.[0]?.text || 'Unable to analyze';

      } else if (provider === 'openai') {
        const apiKey = s.openai_key;
        if (!apiKey) throw new Error('OpenAI API key not configured in Settings');
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: fullPrompt }] }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error('OpenAI error: ' + (d.error?.message || JSON.stringify(d)));
        result = d.choices?.[0]?.message?.content || 'Unable to analyze';

      } else if (provider === 'claude') {
        const apiKey = s.claude_key;
        if (!apiKey) throw new Error('Claude API key not configured in Settings');
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 800, messages: [{ role: 'user', content: fullPrompt }] }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error('Claude error: ' + (d.error?.message || JSON.stringify(d)));
        result = d.content?.[0]?.text || 'Unable to analyze';

      } else if (provider === 'groq') {
        const apiKey = s.groq_key;
        if (!apiKey) throw new Error('Groq API key not configured in Settings');
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: fullPrompt }] }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error('Groq error: ' + (d.error?.message || JSON.stringify(d)));
        result = d.choices?.[0]?.message?.content || 'Unable to analyze';
      }

    // ── Mixed: some binary + some text — send binary docs + embed text ────────
    } else {
      // Embed any extracted text into the prompt
      const fullPrompt = combinedTextContent
        ? basePrompt + '\n\nAdditional document content (text-extracted):\n' + combinedTextContent
        : basePrompt;

      if (provider === 'gemini') {
        const apiKey = s.gemini_key;
        if (!apiKey) throw new Error('Gemini API key not configured in Settings');
        // Gemini supports multiple inline_data parts
        const parts: any[] = [{ text: fullPrompt }];
        for (const bd of binaryDocs) {
          parts.push({ inline_data: { mime_type: bd.mimeType, data: bd.base64 } });
        }
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }] }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error('Gemini error: ' + (d.error?.message || JSON.stringify(d)));
        result = d.candidates?.[0]?.content?.parts?.[0]?.text || 'Unable to analyze';

      } else if (provider === 'openai') {
        const apiKey = s.openai_key;
        if (!apiKey) throw new Error('OpenAI API key not configured in Settings');
        const contentParts: any[] = [{ type: 'text', text: fullPrompt }];
        for (const bd of binaryDocs) {
          if (bd.isPdf) throw new Error('OpenAI does not support PDF. Please use Gemini or Claude.');
          contentParts.push({ type: 'image_url', image_url: { url: `data:${bd.mimeType};base64,${bd.base64}` } });
        }
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: contentParts }] }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error('OpenAI error: ' + (d.error?.message || JSON.stringify(d)));
        result = d.choices?.[0]?.message?.content || 'Unable to analyze';

      } else if (provider === 'claude') {
        const apiKey = s.claude_key;
        if (!apiKey) throw new Error('Claude API key not configured in Settings');
        // Claude supports multiple image/document blocks
        const contentBlocks: any[] = [];
        for (const bd of binaryDocs) {
          contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: bd.mimeType, data: bd.base64 } });
        }
        contentBlocks.push({ type: 'text', text: fullPrompt });
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 800, messages: [{ role: 'user', content: contentBlocks }] }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error('Claude error: ' + (d.error?.message || JSON.stringify(d)));
        result = d.content?.[0]?.text || 'Unable to analyze';

      } else if (provider === 'groq') {
        const apiKey = s.groq_key;
        if (!apiKey) throw new Error('Groq API key not configured in Settings');
        const contentParts: any[] = [{ type: 'text', text: fullPrompt }];
        for (const bd of binaryDocs) {
          if (bd.isPdf) throw new Error('Groq does not support PDF. Please use Gemini or Claude.');
          contentParts.push({ type: 'image_url', image_url: { url: `data:${bd.mimeType};base64,${bd.base64}` } });
        }
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: 'llama-3.2-11b-vision-preview', messages: [{ role: 'user', content: contentParts }] }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error('Groq error: ' + (d.error?.message || JSON.stringify(d)));
        result = d.choices?.[0]?.message?.content || 'Unable to analyze';
      } else {
        throw new Error('No AI provider selected. Please configure one in Settings.');
      }
    }

    await supabase!.from('procedures').update({ ai_result: result, updated_at: new Date().toISOString() }).eq('id', id);
    res.json({ result });
  } catch (err: any) {
    console.error('❌ AI Verify Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// ─── Category Normalization ────────────────────────────────────────────────────

const VALID_CATEGORIES = ['Initial Documents', 'Analytical Procedures', 'Audit Procedures', 'GST', 'TDS', 'Income Tax', 'PF & ESI', 'Other'];

function normalizeCategory(raw: string): string {
  if (!raw || !raw.trim()) return 'Audit Procedures';
  const trimmed = raw.trim();

  // Exact match first
  const exact = VALID_CATEGORIES.find(c => c === trimmed);
  if (exact) return exact;

  // Case-insensitive match
  const lower = trimmed.toLowerCase();
  const caseMatch = VALID_CATEGORIES.find(c => c.toLowerCase() === lower);
  if (caseMatch) return caseMatch;

  // Partial / keyword match
  if (lower.includes('initial') || lower.includes('document')) return 'Initial Documents';
  if (lower.includes('analytical')) return 'Analytical Procedures';
  if (lower.includes('gst') || lower.includes('goods') || lower.includes('service tax')) return 'GST';
  if (lower.includes('tds') || lower.includes('tax deduct')) return 'TDS';
  if (lower.includes('income tax') || lower.includes('itr')) return 'Income Tax';
  if (lower.includes('pf') || lower.includes('esi') || lower.includes('provident') || lower.includes('esic')) return 'PF & ESI';
  if (lower.includes('audit')) return 'Audit Procedures';

  // Unknown category → fallback to Audit Procedures
  console.warn(`⚠️  Unknown category "${raw}" → defaulting to "Audit Procedures"`);
  return 'Audit Procedures';
}

// ─── Excel Import ──────────────────────────────────────────────────────────────

app.post('/api/clients/:id/import-preview', requireSupabase, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'No file provided' });

    // cellFormula:false + raw:false forces SheetJS to use cached/formatted values, not formula strings
    const wb = XLSX.read(file.buffer, { type: 'buffer', cellFormula: false, raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];

    const { data: existing } = await supabase!.from('procedures').select('*').eq('client_id', req.params.id);
    const existingMap = new Map((existing || []).map((p: any) => [String(p.sr_no), p]));

    // Resolve Sr. No — handles plain numbers AND formula strings like =A11+1
    const resolveSrNo = (raw: any, rowIndex: number): string => {
      const s = String(raw || '').trim();
      if (s === '' || s.startsWith('=')) return String(rowIndex + 1);
      if (!isNaN(Number(s))) return String(Number(s));
      return String(rowIndex + 1);
    };

    const preview = rows.map((row: any, idx: number) => {
      const sr_no = resolveSrNo(row['Sr. No'] || row['sr_no'] || row['Sr No'] || '', idx);
      const area     = row['Area/Head'] || row['area'] || row['Area'] || '';
      const procedure_text = row['Procedure'] || row['procedure_text'] || row['Procedure Text'] || '';
      const risk_flag = row['Risk'] || row['risk_flag'] || row['Risk Flag'] || 'Low';
      const allotted_to = row['Allotted To'] || row['allotted_to'] || '';
      const rawCategory = row['Category'] || row['category'] || row['Tab'] || row['tab'] || row['Section'] || '';
      const category = normalizeCategory(rawCategory);

      const ex = existingMap.get(sr_no);
      let action: 'new' | 'update' | 'duplicate' = 'new';
      let existing_id;
      if (ex) {
        if (ex.procedure_text === procedure_text && ex.area === area) { action = 'duplicate'; }
        else { action = 'update'; existing_id = ex.id; }
      }
      return { sr_no, area, procedure_text, risk_flag, allotted_to, category, action, existing_id, selected: action !== 'duplicate' };
    });

    res.json({ success: true, preview });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/clients/:id/import-confirm', requireSupabase, async (req, res) => {
  try {
    const { procedures: toImport } = req.body;
    for (const proc of toImport) {
      if (proc.action === 'update' && proc.existing_id) {
        await supabase!.from('procedures').update({
          area: proc.area, procedure_text: proc.procedure_text,
          risk_flag: proc.risk_flag, allotted_to: proc.allotted_to,
          category: proc.category, updated_at: new Date().toISOString(),
        }).eq('id', proc.existing_id);
      } else if (proc.action === 'new') {
        await supabase!.from('procedures').insert({
          id: uuidv4(), client_id: req.params.id,
          sr_no: proc.sr_no, area: proc.area, procedure_text: proc.procedure_text,
          risk_flag: proc.risk_flag, allotted_to: proc.allotted_to,
          category: proc.category || 'Audit Procedures',
          status: 'Pending', updated_at: new Date().toISOString(),
        });
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Excel Template Download ───────────────────────────────────────────────────

app.get('/api/template/download', (req, res) => {
  const templateData = [
    { 'Sr. No': '1', 'Area/Head': 'Sales', 'Procedure': 'Verify sales invoices against delivery challans', 'Risk': 'High',   'Allotted To': '', 'Category': 'Audit Procedures' },
    { 'Sr. No': '2', 'Area/Head': 'Purchase', 'Procedure': 'Check purchase orders with invoices',         'Risk': 'Medium', 'Allotted To': '', 'Category': 'Audit Procedures' },
    { 'Sr. No': '3', 'Area/Head': 'Bank',     'Procedure': 'Obtain bank reconciliation statement',        'Risk': 'Low',    'Allotted To': '', 'Category': 'Initial Documents' },
  ];
  const ws = XLSX.utils.json_to_sheet(templateData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Procedures');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=audit_template.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ─── Backup & Restore ──────────────────────────────────────────────────────────

app.get('/api/backup', requireSupabase, async (req, res) => {
  try {
    const { data: clients, error: ce } = await supabase!.from('clients').select('*').order('created_at');
    if (ce) throw ce;

    const { data: procedures, error: pe } = await supabase!.from('procedures').select('*').order('sr_no');
    if (pe) throw pe;

    const { data: settingRows } = await supabase!.from('settings').select('key, value');
    const settings: any = {};
    for (const r of settingRows || []) settings[r.key] = r.key === 'team_members' ? JSON.parse(r.value || '[]') : r.value;

    // Nest procedures inside clients
    const clientsWithProcs = (clients || []).map((c: any) => ({
      ...c,
      procedures: (procedures || []).filter((p: any) => p.client_id === c.id),
    }));

    res.json({
      version: '1.0',
      app: 'AuditFlow AI',
      exported_at: new Date().toISOString(),
      clients: clientsWithProcs,
      settings,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/restore', requireSupabase, async (req, res) => {
  try {
    const backup = req.body;
    // Validate backup format — accept both app name variants
    const validApp = backup.app === 'AuditFlow AI' || backup.app === 'auditflow-ai';
    const validVersion = backup.version === '1.0' || backup.version === 1 || backup.version === '1';
    if (!validApp || !validVersion || !Array.isArray(backup.clients)) {
      return res.status(400).json({ error: 'Invalid backup file format' });
    }

    let clientsRestored = 0;
    let proceduresRestored = 0;

    for (const client of backup.clients) {
      const { procedures, ...clientData } = client;
      // Upsert client (by id)
      const { error: ce } = await supabase!.from('clients').upsert(clientData, { onConflict: 'id' });
      if (ce) throw new Error('Client restore failed: ' + ce.message);
      clientsRestored++;

      // Upsert procedures for this client
      for (const proc of (procedures || [])) {
        const { error: pe } = await supabase!.from('procedures').upsert(proc, { onConflict: 'id' });
        if (pe) throw new Error('Procedure restore failed: ' + pe.message);
        proceduresRestored++;
      }
    }

    res.json({ success: true, clients_restored: clientsRestored, procedures_restored: proceduresRestored });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Global Error Handler (prevents silent crashes) ───────────────────────────
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Catch unhandled promise rejections so server doesn't crash
process.on('unhandledRejection', (reason: any) => {
  console.error('⚠️  Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err: any) => {
  console.error('⚠️  Uncaught Exception:', err);
});

// ─── Start Server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 AuditFlow AI Server running on http://localhost:${PORT}`);
  console.log(`   Supabase: ${supabase ? '✅ Connected' : '❌ Not configured (go to Settings)'}\n`);
});

// ─── Audit Instructions ────────────────────────────────────────────────────────

const INSTRUCTION_KEYS: Record<string, string> = {
  'Trading & Services': 'instructions_trading_services',
  'Services': 'instructions_services',
  'Cost Plus Entity': 'instructions_cost_plus',
};

app.get('/api/instructions/:entityType', requireSupabase, async (req, res) => {
  try {
    const key = INSTRUCTION_KEYS[decodeURIComponent(req.params.entityType)];
    if (!key) return res.status(400).json({ error: 'Invalid entity type' });
    const { data, error } = await supabase!.from('settings').select('value').eq('key', key).single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ content: data?.value || '' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/instructions/:entityType', requireSupabase, async (req, res) => {
  try {
    const key = INSTRUCTION_KEYS[decodeURIComponent(req.params.entityType)];
    if (!key) return res.status(400).json({ error: 'Invalid entity type' });
    const { content } = req.body;
    await supabase!.from('settings').upsert({ key, value: content }, { onConflict: 'key' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
