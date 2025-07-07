'use client';

import { Fragment, useEffect, useState, useCallback } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Role, Permission } from '@/types/rbac';
import { getRolePermissions, assignPermissionsToRole } from '@/app/actions/rbac';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

interface RolePermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: Role;
  allPermissions: Permission[];
}

interface GroupedPermissions {
  [module: string]: Permission[];
}

export default function RolePermissionsModal({
  isOpen,
  onClose,
  role,
  allPermissions
}: RolePermissionsModalProps) {
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const loadRolePermissions = useCallback(async () => {
    setLoading(true);
    const result = await getRolePermissions(role.id);
    if (result.success && result.data) {
      const permissionIds = result.data.map((rp: { permission_id: string }) => rp.permission_id);
      setSelectedPermissions(new Set(permissionIds));
    }
    setLoading(false);
  }, [role.id]);

  useEffect(() => {
    if (isOpen) {
      loadRolePermissions();
    }
  }, [isOpen, loadRolePermissions]);

  const handleSave = async () => {
    setSaving(true);
    const result = await assignPermissionsToRole(role.id, Array.from(selectedPermissions));
    
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success('Permissions updated successfully');
      router.refresh();
      onClose();
    }
    setSaving(false);
  };

  const togglePermission = (permissionId: string) => {
    const newSelected = new Set(selectedPermissions);
    if (newSelected.has(permissionId)) {
      newSelected.delete(permissionId);
    } else {
      newSelected.add(permissionId);
    }
    setSelectedPermissions(newSelected);
  };

  const toggleModule = (modulePermissions: Permission[]) => {
    const modulePermissionIds = modulePermissions.map(p => p.id);
    const allSelected = modulePermissionIds.every(id => selectedPermissions.has(id));
    
    const newSelected = new Set(selectedPermissions);
    if (allSelected) {
      modulePermissionIds.forEach(id => newSelected.delete(id));
    } else {
      modulePermissionIds.forEach(id => newSelected.add(id));
    }
    setSelectedPermissions(newSelected);
  };

  // Group permissions by module
  const groupedPermissions = allPermissions.reduce<GroupedPermissions>((acc, permission) => {
    if (!acc[permission.module_name]) {
      acc[permission.module_name] = [];
    }
    acc[permission.module_name].push(permission);
    return acc;
  }, {});

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl sm:p-6">
                <div className="absolute right-0 top-0 hidden pr-4 pt-4 sm:block">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                    onClick={onClose}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>

                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left w-full">
                    <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-gray-900">
                      Manage Permissions: {role.name}
                    </Dialog.Title>

                    <div className="mt-4">
                      {loading ? (
                        <div className="text-center py-4">Loading permissions...</div>
                      ) : (
                        <div className="space-y-4 max-h-96 overflow-y-auto">
                          {Object.entries(groupedPermissions).map(([module, permissions]) => (
                            <div key={module} className="border rounded-lg p-4">
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="font-medium text-gray-900 capitalize">
                                  {module.replace('_', ' ')}
                                </h4>
                                <button
                                  type="button"
                                  onClick={() => toggleModule(permissions)}
                                  className="text-sm text-blue-600 hover:text-blue-500"
                                >
                                  {permissions.every(p => selectedPermissions.has(p.id))
                                    ? 'Deselect all'
                                    : 'Select all'}
                                </button>
                              </div>
                              <div className="space-y-2">
                                {permissions.map((permission) => (
                                  <label
                                    key={permission.id}
                                    className="flex items-center space-x-3"
                                  >
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                                      checked={selectedPermissions.has(permission.id)}
                                      onChange={() => togglePermission(permission.id)}
                                      disabled={role.is_system}
                                    />
                                    <span className="text-sm text-gray-700">
                                      {permission.description || permission.action}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    disabled={saving || loading || role.is_system}
                    onClick={handleSave}
                    className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 sm:ml-3 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving...' : 'Save Permissions'}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>

                {role.is_system && (
                  <p className="mt-2 text-sm text-gray-500 text-center">
                    System roles cannot be modified
                  </p>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}