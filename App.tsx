/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { UserProvider } from './context/UserContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import ClientDetail from './pages/ClientDetail';
import Settings from './pages/Settings';
import ClientPortal from './pages/ClientPortal';
import Login from './pages/Login';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Client portal routes need no auth
  const isPortalRoute = window.location.pathname.startsWith('/portal/');

  useEffect(() => {
    if (isPortalRoute) {
      setAuthChecked(true);
      return;
    }
    fetch('/api/auth/verify')
      .then(r => r.json())
      .then(data => { setIsLoggedIn(!!data.valid); setAuthChecked(true); })
      .catch(() => { setIsLoggedIn(false); setAuthChecked(true); });
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setIsLoggedIn(false);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-10 w-10 text-indigo-500 animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <UserProvider>
      <Router>
        <Routes>
          {/* Client Portal — public, no auth needed */}
          <Route path="/portal/:token" element={<ClientPortal />} />

          {/* Main App — password protected */}
          <Route path="/*" element={
            isLoggedIn
              ? <Layout onLogout={handleLogout}>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/clients/:id" element={<ClientDetail />} />
                    <Route path="/settings" element={<Settings />} />
                  </Routes>
                </Layout>
              : <Login onLogin={() => setIsLoggedIn(true)} />
          } />
        </Routes>
      </Router>
    </UserProvider>
  );
}
