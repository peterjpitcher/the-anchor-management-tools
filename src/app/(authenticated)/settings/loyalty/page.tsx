'use client';

import { useState, useEffect } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import { LoyaltySettingsService, type LoyaltySettings } from '@/lib/config/loyalty-settings';
import { Switch } from '@headlessui/react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { 
  CheckCircleIcon, 
  XCircleIcon,
  InformationCircleIcon,
  CogIcon,
  ChartBarIcon,
  UserGroupIcon,
  GiftIcon,
  TrophyIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

export default function LoyaltySettingsPage() {
  const { hasPermission } = usePermissions();
  const [settings, setSettings] = useState<LoyaltySettings>({ 
    configurationEnabled: true,
    operationalEnabled: false 
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Load current settings
    const currentSettings = LoyaltySettingsService.getSettings();
    setSettings(currentSettings);

    // Listen for changes from other tabs/windows
    const handleSettingsChange = (event: CustomEvent) => {
      setSettings(event.detail);
    };

    window.addEventListener('loyalty-settings-changed' as any, handleSettingsChange);
    return () => {
      window.removeEventListener('loyalty-settings-changed' as any, handleSettingsChange);
    };
  }, []);

  const canManage = hasPermission('settings', 'manage');

  const handleOperationalToggle = async (enabled: boolean) => {
    if (!canManage) {
      toast.error('You do not have permission to change this setting');
      return;
    }

    setSaving(true);
    try {
      // In production, this would save to database
      LoyaltySettingsService.setOperationalEnabled(enabled, 'current-user');
      
      toast.success(
        enabled 
          ? 'Loyalty program is now live! Customers can earn points and receive messages.' 
          : 'Loyalty program operations paused. Configuration remains available.'
      );
    } catch (error) {
      toast.error('Failed to update settings');
      console.error('Error updating loyalty settings:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Loyalty Program Settings</h1>
        <p className="mt-2 text-gray-600">
          Configure and manage The Anchor VIP Club
        </p>
      </div>

      {/* Configuration Status - Always Available */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-center">
          <InformationCircleIcon className="h-5 w-5 text-blue-600 mr-2 flex-shrink-0" />
          <div>
            <p className="text-blue-800 font-medium">Configuration Access: Always Available</p>
            <p className="text-sm text-blue-700 mt-1">
              You can configure rewards, tiers, and settings at any time, even when the program is not operational.
            </p>
          </div>
        </div>
      </div>

      {/* Operational Toggle */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900">
              Operational Status
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Control whether customers can earn points and receive loyalty messages
            </p>
            {settings.lastUpdated && (
              <p className="mt-2 text-xs text-gray-500">
                Last updated: {new Date(settings.lastUpdated).toLocaleString('en-GB')}
                {settings.updatedBy && ` by ${settings.updatedBy}`}
              </p>
            )}
          </div>
          <Switch
            checked={settings.operationalEnabled || false}
            onChange={handleOperationalToggle}
            disabled={!canManage || saving}
            className={`${
              settings.operationalEnabled ? 'bg-amber-600' : 'bg-gray-200'
            } relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              !canManage || saving ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <span className="sr-only">Enable loyalty operations</span>
            <span
              className={`${
                settings.operationalEnabled ? 'translate-x-6' : 'translate-x-1'
              } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
            />
          </Switch>
        </div>
      </div>

      {/* Status Banner */}
      <div className={`rounded-lg p-4 mb-6 ${
        settings.operationalEnabled 
          ? 'bg-green-50 border border-green-200' 
          : 'bg-yellow-50 border border-yellow-200'
      }`}>
        <div className="flex items-center">
          {settings.operationalEnabled ? (
            <>
              <CheckCircleIcon className="h-5 w-5 text-green-600 mr-2" />
              <span className="text-green-800 font-medium">
                Loyalty program is LIVE - Customers are earning points
              </span>
            </>
          ) : (
            <>
              <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 mr-2" />
              <span className="text-yellow-800 font-medium">
                Configuration mode - No points or messages being processed
              </span>
            </>
          )}
        </div>
      </div>

      {/* Feature Status Grid */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Feature Status
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Configuration Features - Always On */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Configuration Features</h4>
            <div className="space-y-2">
              <div className="flex items-center text-sm">
                <CheckCircleIcon className="h-4 w-4 text-green-500 mr-2" />
                <span>Reward Management</span>
              </div>
              <div className="flex items-center text-sm">
                <CheckCircleIcon className="h-4 w-4 text-green-500 mr-2" />
                <span>Member Management</span>
              </div>
              <div className="flex items-center text-sm">
                <CheckCircleIcon className="h-4 w-4 text-green-500 mr-2" />
                <span>Analytics & Reporting</span>
              </div>
              <div className="flex items-center text-sm">
                <CheckCircleIcon className="h-4 w-4 text-green-500 mr-2" />
                <span>Settings & Configuration</span>
              </div>
            </div>
          </div>

          {/* Operational Features - Controlled by Toggle */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Operational Features</h4>
            <div className="space-y-2">
              <div className="flex items-center text-sm">
                {settings.operationalEnabled ? (
                  <CheckCircleIcon className="h-4 w-4 text-green-500 mr-2" />
                ) : (
                  <XCircleIcon className="h-4 w-4 text-gray-400 mr-2" />
                )}
                <span className={settings.operationalEnabled ? '' : 'text-gray-500'}>
                  Point Earning on Check-in
                </span>
              </div>
              <div className="flex items-center text-sm">
                {settings.operationalEnabled ? (
                  <CheckCircleIcon className="h-4 w-4 text-green-500 mr-2" />
                ) : (
                  <XCircleIcon className="h-4 w-4 text-gray-400 mr-2" />
                )}
                <span className={settings.operationalEnabled ? '' : 'text-gray-500'}>
                  SMS Notifications
                </span>
              </div>
              <div className="flex items-center text-sm">
                {settings.operationalEnabled ? (
                  <CheckCircleIcon className="h-4 w-4 text-green-500 mr-2" />
                ) : (
                  <XCircleIcon className="h-4 w-4 text-gray-400 mr-2" />
                )}
                <span className={settings.operationalEnabled ? '' : 'text-gray-500'}>
                  Auto-enrollment
                </span>
              </div>
              <div className="flex items-center text-sm">
                {settings.operationalEnabled ? (
                  <CheckCircleIcon className="h-4 w-4 text-green-500 mr-2" />
                ) : (
                  <XCircleIcon className="h-4 w-4 text-gray-400 mr-2" />
                )}
                <span className={settings.operationalEnabled ? '' : 'text-gray-500'}>
                  Achievement Tracking
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Links - Always Available */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Management Tools (Always Available)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/loyalty/admin"
            className="flex items-center p-4 border border-gray-200 rounded-lg hover:border-amber-300 hover:bg-amber-50 transition-colors"
          >
            <ChartBarIcon className="h-8 w-8 text-amber-600 mr-3" />
            <div>
              <p className="font-medium text-gray-900">Admin Dashboard</p>
              <p className="text-sm text-gray-600">Configure & monitor</p>
            </div>
          </Link>
          
          <Link
            href="/loyalty/admin/rewards"
            className="flex items-center p-4 border border-gray-200 rounded-lg hover:border-amber-300 hover:bg-amber-50 transition-colors"
          >
            <GiftIcon className="h-8 w-8 text-amber-600 mr-3" />
            <div>
              <p className="font-medium text-gray-900">Manage Rewards</p>
              <p className="text-sm text-gray-600">Set up reward catalog</p>
            </div>
          </Link>
          
          <Link
            href="/loyalty/admin/achievements"
            className="flex items-center p-4 border border-gray-200 rounded-lg hover:border-amber-300 hover:bg-amber-50 transition-colors"
          >
            <TrophyIcon className="h-8 w-8 text-amber-600 mr-3" />
            <div>
              <p className="font-medium text-gray-900">Achievements</p>
              <p className="text-sm text-gray-600">Configure milestones</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Info Box */}
      <div className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="flex">
          <InformationCircleIcon className="h-5 w-5 text-gray-600 mt-0.5 mr-2 flex-shrink-0" />
          <div className="text-sm text-gray-700">
            <p className="font-medium mb-1">Why separate configuration from operations?</p>
            <p>
              This allows you to fully set up rewards, tiers, and achievements before launching. 
              When you're ready, simply toggle the operational status to start awarding points and sending messages.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}