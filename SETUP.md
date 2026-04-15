# AuditFlow AI — Local Setup Guide

## Step 1: Supabase Project Banao

1. [supabase.com](https://supabase.com) → New Project
2. Project URL aur **service_role** key copy kar lo  
   _(Settings → API mein milega)_
3. **SQL Editor** mein jao → `supabase-schema.sql` ka poora content paste karo → Run karo
4. **Storage** → New Bucket → Name: `auditflow` → Private

---

## Step 2: App Install Karo

```bash
npm install
```

---

## Step 3: App Chalao

```bash
npm run dev
```

Yeh dono ek saath start hoga:
- **Backend server** → http://localhost:3001  
- **Frontend (Vite)** → http://localhost:5173

Browser mein `http://localhost:5173` kholo.

---

## Step 4: Supabase Connect Karo (App ke andar)

1. App mein **Settings** page kholo
2. **Supabase Configuration** section mein:
   - **Project URL** daalo: `https://xxxx.supabase.co`
   - **Service Role Key** daalo
3. **Connect & Save** click karo
4. "✅ Supabase se connect ho gaya!" dikhega

Ab app ready hai! 🎉

---

## Features

| Feature | Details |
|---|---|
| Clients | Add/edit/delete audit clients |
| Procedures | 8 categories (GST, TDS, Income Tax, etc.) |
| Sub-tasks | Procedures ke andar sub-procedures |
| File Upload | Documents Supabase Storage mein save |
| AI Check | Match/Partial/Mismatch — Gemini/OpenAI/Claude/Groq |
| Excel Import | Template download → fill → import |
| Custom Columns | Client-wise custom fields |
| Role Simulation | Manager vs Team Member |

