'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { getUserPermissions } from '@/app/actions/rbac';
import type { UserPermission, ModuleName, ActionType } from '@/types/rbac';

interface PermissionContextType {
  permissions: UserPermission[];
  loading: boolean;
  hasPermission: (module: ModuleName, action: ActionType) => boolean;
  refreshPermissions: () => Promise<void>;
}

const PermissionContext = createContext<PermissionContextType | undefined>(undefined);

export function PermissionProvider({ 
  children, 
  initialPermissions 
}: { 
  children: React.ReactNode;
  initialPermissions?: UserPermission[];
}) {
  const [permissions, setPermissions] = useState<UserPermission[]>(initialPermissions || []);
  const [loading, setLoading] = useState(!initialPermissions);

  const fetchPermissions = async () => {
    try {
      const result = await getUserPermissions();
      if (result.success && result.data) {
        setPermissions(result.data);
      }
    } catch (error) {
      console.error('Error fetching permissions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialPermissions) {
      fetchPermissions();
    }
  }, [initialPermissions]);

  const hasPermission = (module: ModuleName, action: ActionType) => {
    return permissions.some(
      p => p.module_name === module && p.action === action
    );
  };

  const refreshPermissions = async () => {
    setLoading(true);
    await fetchPermissions();
  };

  return (
    <PermissionContext.Provider
      value={{
        permissions,
        loading,
        hasPermission,
        refreshPermissions,
      }}
    >
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions() {
  const context = useContext(PermissionContext);
  if (context === undefined) {
    throw new Error('usePermissions must be used within a PermissionProvider');
  }
  return context;
}