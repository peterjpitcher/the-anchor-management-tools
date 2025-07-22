'use client';

import { useState, useEffect } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import { LoyaltySettingsService, type LoyaltySettings } from '@/lib/config/loyalty-settings';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { 
  CheckCircleIcon, 
  XCircleIcon,
  InformationCircleIcon,
  ChartBarIcon,
  GiftIcon,
  TrophyIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

// Import ui-v2 components
import { Page } from '@/components/ui-v2/layout/Page';
import { Section } from '@/components/ui-v2/layout/Section';
import { Card, CardTitle, CardDescription } from '@/components/ui-v2/layout/Card';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Toggle } from '@/components/ui-v2/forms/Toggle';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';

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
    <Page
      title="Loyalty Program Settings"
      description="Configure and manage The Anchor VIP Club"
      breadcrumbs={[
        { label: 'Settings', href: '/settings' },
        { label: 'Loyalty' }
      ]}
      loading={saving}
    >

      {/* Configuration Status - Always Available */}
      <Alert variant="info"
        title="Configuration Access: Always Available"
        description="You can configure rewards, tiers, and settings at any time, even when the program is not operational."
        className="mb-6"
      />

      {/* Operational Toggle */}
      <Card className="mb-6">
        <Toggle
          label="Operational Status"
          description="Control whether customers can earn points and receive loyalty messages"
          checked={settings.operationalEnabled || false}
          onChange={(e) => handleOperationalToggle(e.target.checked)}
          disabled={!canManage || saving}
          variant="primary"
          labelPosition="left"
          containerClassName="flex-row-reverse justify-between"
        />
        {settings.lastUpdated && (
          <p className="mt-3 text-xs text-gray-500">
            Last updated: {new Date(settings.lastUpdated).toLocaleString('en-GB')}
            {settings.updatedBy && ` by ${settings.updatedBy}`}
          </p>
        )}
      </Card>

      {/* Status Banner */}
      <Alert
        variant={settings.operationalEnabled ? 'success' : 'warning'}
        title={
          settings.operationalEnabled 
            ? 'Loyalty program is LIVE - Customers are earning points'
            : 'Configuration mode - No points or messages being processed'
        }
        className="mb-6"
      />

      {/* Feature Status Grid */}
      <Section
        title="Feature Status"
        variant="gray"
        className="mb-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Configuration Features - Always On */}
          <Card variant="bordered">
            <CardTitle>Configuration Features</CardTitle>
            <div className="space-y-2 mt-3">
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
          </Card>

          {/* Operational Features - Controlled by Toggle */}
          <Card variant="bordered">
            <CardTitle>Operational Features</CardTitle>
            <div className="space-y-2 mt-3">
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
          </Card>
        </div>
      </Section>

      {/* Quick Links - Always Available */}
      <Section
        title="Management Tools (Always Available)"
        variant="gray"
        className="mb-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/loyalty/admin">
            <Card
              variant="bordered"
              interactive
              className="h-full hover:border-amber-300 hover:bg-amber-50"
            >
              <div className="flex items-center">
                <ChartBarIcon className="h-8 w-8 text-amber-600 mr-3" />
                <div>
                  <p className="font-medium text-gray-900">Admin Dashboard</p>
                  <p className="text-sm text-gray-600">Configure & monitor</p>
                </div>
              </div>
            </Card>
          </Link>
          
          <Link href="/loyalty/admin/rewards">
            <Card
              variant="bordered"
              interactive
              className="h-full hover:border-amber-300 hover:bg-amber-50"
            >
              <div className="flex items-center">
                <GiftIcon className="h-8 w-8 text-amber-600 mr-3" />
                <div>
                  <p className="font-medium text-gray-900">Manage Rewards</p>
                  <p className="text-sm text-gray-600">Set up reward catalog</p>
                </div>
              </div>
            </Card>
          </Link>
          
          <Link href="/loyalty/admin/achievements">
            <Card
              variant="bordered"
              interactive
              className="h-full hover:border-amber-300 hover:bg-amber-50"
            >
              <div className="flex items-center">
                <TrophyIcon className="h-8 w-8 text-amber-600 mr-3" />
                <div>
                  <p className="font-medium text-gray-900">Achievements</p>
                  <p className="text-sm text-gray-600">Configure milestones</p>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </Section>

      {/* Info Box */}
      <Alert variant="info"
        title="Why separate configuration from operations?"
        description="This allows you to fully set up rewards, tiers, and achievements before launching. When you're ready, simply toggle the operational status to start awarding points and sending messages."
      />
    </Page>
  );
}