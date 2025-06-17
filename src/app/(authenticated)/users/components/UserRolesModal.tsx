'use client';

import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { User } from '@supabase/supabase-js';
import { Role } from '@/types/rbac';
import { getUserRoles, assignRolesToUser } from '@/app/actions/rbac';
import { useRouter } from 'next/navigation';

interface UserRolesModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  allRoles: Role[];
}

export default function UserRolesModal({
  isOpen,
  onClose,
  user,
  allRoles
}: UserRolesModalProps) {
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (isOpen) {
      loadUserRoles();
    }
  }, [isOpen, user.id]);

  const loadUserRoles = async () => {
    setLoading(true);
    const result = await getUserRoles(user.id);
    if (result.success && result.data) {
      const roleIds = result.data.map((r: any) => r.role_id);
      setSelectedRoles(new Set(roleIds));
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const result = await assignRolesToUser(user.id, Array.from(selectedRoles));
    
    if (result.error) {
      alert(result.error);
    } else {
      router.refresh();
      onClose();
    }
    setSaving(false);
  };

  const toggleRole = (roleId: string) => {
    const newSelected = new Set(selectedRoles);
    if (newSelected.has(roleId)) {
      newSelected.delete(roleId);
    } else {
      newSelected.add(roleId);
    }
    setSelectedRoles(newSelected);
  };

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
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                <div className="absolute right-0 top-0 hidden pr-4 pt-4 sm:block">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    onClick={onClose}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>

                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left w-full">
                    <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-gray-900">
                      Manage User Roles
                    </Dialog.Title>
                    <p className="mt-2 text-sm text-gray-600">
                      {user.email}
                    </p>

                    <div className="mt-4">
                      {loading ? (
                        <div className="text-center py-4">Loading roles...</div>
                      ) : (
                        <div className="space-y-3">
                          {allRoles.map((role) => (
                            <label
                              key={role.id}
                              className="flex items-start space-x-3 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                                checked={selectedRoles.has(role.id)}
                                onChange={() => toggleRole(role.id)}
                              />
                              <div className="flex-1">
                                <div className="text-sm font-medium text-gray-900">
                                  {role.name}
                                  {role.is_system && (
                                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                                      System
                                    </span>
                                  )}
                                </div>
                                {role.description && (
                                  <p className="text-sm text-gray-500">{role.description}</p>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    disabled={saving || loading}
                    onClick={handleSave}
                    className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 sm:ml-3 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving...' : 'Save Roles'}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}