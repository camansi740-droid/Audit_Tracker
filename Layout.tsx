import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Settings, LogOut, Briefcase } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { clsx } from 'clsx';

export default function Layout({ children, onLogout }: { children: React.ReactNode; onLogout?: () => void }) {
  const location = useLocation();
  const { role, setRole, currentUser, setCurrentUser, teamMembers } = useUser();

  const navItems = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Settings', href: '/settings', icon: Settings, managerOnly: true },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-2 font-bold text-xl text-indigo-600">
            <Briefcase className="w-6 h-6" />
            <span>AuditFlow AI</span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            if (item.managerOnly && role !== 'Manager') return null;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
              Simulate Role
            </label>
            <select
              value={role}
              onChange={(e) => {
                  const newRole = e.target.value as any;
                  setRole(newRole);
                  // Auto-switch user based on role
                  if (newRole === 'Manager') {
                      setCurrentUser('Manager');
                  } else if (teamMembers.length > 0) {
                      setCurrentUser(teamMembers[0]);
                  }
              }}
              className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border"
            >
              <option value="Manager">Manager</option>
              <option value="Team Member">Team Member</option>
            </select>
          </div>
          
          <div>
             <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
              Current User
            </label>
            <select
              value={currentUser}
              onChange={(e) => setCurrentUser(e.target.value)}
              disabled={role === 'Manager'}
              className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border disabled:bg-gray-100 disabled:text-gray-500"
            >
              {role === 'Manager' ? (
                  <option value="Manager">Manager</option>
              ) : (
                  teamMembers.map(u => (
                      <option key={u} value={u}>{u}</option>
                  ))
              )}
            </select>
          </div>
        </div>

          {/* Logout Button */}
          {onLogout && (
            <div className="px-4 pb-4">
              <button
                onClick={onLogout}
                className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          )}
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-7xl mx-auto">
            {children}
        </div>
      </main>
    </div>
  );
}
