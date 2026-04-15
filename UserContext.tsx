import React, { createContext, useContext, useState, useEffect } from 'react';

type Role = 'Manager' | 'Team Member';

interface UserContextType {
  role: Role;
  setRole: (role: Role) => void;
  currentUser: string;
  setCurrentUser: (user: string) => void;
  teamMembers: string[];
  refreshTeamMembers: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>('Manager');
  const [currentUser, setCurrentUser] = useState('Manager');
  const [teamMembers, setTeamMembers] = useState<string[]>([]);

  const refreshTeamMembers = async () => {
    try {
     const response = await fetch('/api/auth/verify');
if (!response.ok) {
  console.error('Server error:', response.status);
  return;
}
const text = await response.text();
        if (!text) return;
        const data = JSON.parse(text);
        // aage ka code...
    } catch (error) {
        console.error('Failed to fetch team members:', error);    }
  };

  useEffect(() => {
    refreshTeamMembers();
  }, []);

  return (
    <UserContext.Provider value={{ role, setRole, currentUser, setCurrentUser, teamMembers, refreshTeamMembers }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
