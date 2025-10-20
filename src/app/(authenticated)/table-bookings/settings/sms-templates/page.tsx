'use client'

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { PencilIcon, DevicePhoneMobileIcon } from '@heroicons/react/24/outline';
import { getSMSTemplates, updateSMSTemplate, testSMSTemplate } from '@/app/actions/table-booking-sms';
import { TableBookingSMSTemplate } from '@/types/table-bookings';

// UI v2 Components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Modal } from '@/components/ui-v2/overlay/Modal';
import { toast } from '@/components/ui-v2/feedback/Toast';

export default function SMSTemplatesPage() {
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [templates, setTemplates] = useState<TableBookingSMSTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<TableBookingSMSTemplate | null>(null);
  const [templateText, setTemplateText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testingTemplate, setTestingTemplate] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success?: boolean; message?: string; preview?: string } | null>(null);

  const canManage = hasPermission('table_bookings', 'manage');

  useEffect(() => {
    if (canManage) {
      loadTemplates();
    }
  }, [canManage]);

  async function loadTemplates() {
    try {
      setLoading(true);
      setError(null);

      const result = await getSMSTemplates();
      
      if (result.error) throw new Error(result.error);
      
      // If no templates exist, create defaults
      if (!result.data || result.data.length === 0) {
        const defaultTemplates = [
          {
            template_key: 'booking_confirmation_regular',
            booking_type: 'regular',
            template_text: 'Hi {{customer_name}}, your table for {{party_size}} at The Anchor on {{date}} at {{time}} is confirmed. Reference: {{reference}}. Questions? Reply to this message or call {{contact_phone}}.',
            is_active: true,
          },
          {
            template_key: 'booking_confirmation_sunday_lunch',
            booking_type: 'sunday_lunch',
            template_text: 'Hi {{customer_name}}, your Sunday Lunch booking for {{party_size}} on {{date}} at {{time}} is confirmed & paid. Ref: {{reference}}. Reply to this message if you need anything or call {{contact_phone}}.',
            is_active: true,
          },
          {
            template_key: 'reminder_regular',
            booking_type: 'regular',
            template_text: 'Reminder: Your table for {{party_size}} at The Anchor is tomorrow at {{time}}. Ref: {{reference}}. Reply to this message if you need anything. See you then!',
            is_active: true,
          },
          {
            template_key: 'reminder_sunday_lunch',
            booking_type: 'sunday_lunch',
            template_text: 'Reminder: Your Sunday Lunch at The Anchor is tomorrow at {{time}}. {{roast_summary}}. Allergies noted: {{allergies}}. Reply to this message if you need anything. See you then!',
            is_active: true,
          },
          {
            template_key: 'cancellation',
            booking_type: null,
            template_text: 'Your booking {{reference}} has been cancelled. {{refund_message}} Reply to this message if you need any help or call {{contact_phone}}.',
            is_active: true,
          },
          {
            template_key: 'review_request',
            booking_type: null,
            template_text: 'Thanks for dining at The Anchor! We hope you enjoyed your visit. Please leave a review: {{review_link}}. Reply to this message if you need anything.',
            is_active: true,
          },
        ];

        // Create default templates
        for (const template of defaultTemplates) {
          await (supabase
            .from('table_booking_sms_templates') as any)
            .insert(template);
        }
        
        // Reload after creating defaults
        await loadTemplates();
        return;
      }
      
      setTemplates(result.data);
    } catch (err: any) {
      console.error('Error loading templates:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTemplate) return;
    
    try {
      setProcessing(true);
      setError(null);

      const formData = new FormData();
      formData.append('template_key', editingTemplate.template_key);
      formData.append('booking_type', editingTemplate.booking_type || '');
      formData.append('template_text', templateText);
      formData.append('is_active', editingTemplate.is_active.toString());

      const result = await updateSMSTemplate(editingTemplate.id, formData);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        await loadTemplates();
        setEditingTemplate(null);
        setTemplateText('');
        toast.success('Template updated successfully');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleTestTemplate(templateId: string) {
    if (!testPhone) {
      toast.error('Please enter a phone number for testing');
      return;
    }
    
    try {
      setTestingTemplate(templateId);
      setTestResult(null);
      setError(null);

      const result = await testSMSTemplate(templateId, testPhone);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        setTestResult(result);
        if (result.success) {
          toast.success('Test SMS sent successfully');
        }
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setTestingTemplate(null);
    }
  }

  function getTemplateDisplayName(template: TableBookingSMSTemplate): string {
    const names: Record<string, string> = {
      'booking_confirmation_regular': 'Booking Confirmation (Regular)',
      'booking_confirmation_sunday_lunch': 'Booking Confirmation (Sunday Lunch)',
      'reminder_regular': 'Reminder (Regular)',
      'reminder_sunday_lunch': 'Reminder (Sunday Lunch)',
      'cancellation': 'Cancellation',
      'review_request': 'Review Request',
    };
    return names[template.template_key] || template.template_key;
  }

  function getAvailableVariables(templateKey: string): string {
    const variables: Record<string, string> = {
      'booking_confirmation_regular': '{{customer_name}}, {{party_size}}, {{date}}, {{time}}, {{reference}}, {{contact_phone}}',
      'booking_confirmation_sunday_lunch': '{{customer_name}}, {{party_size}}, {{date}}, {{time}}, {{reference}}, {{contact_phone}}',
      'reminder_regular': '{{customer_name}}, {{party_size}}, {{time}}, {{reference}}',
      'reminder_sunday_lunch': '{{customer_name}}, {{time}}, {{roast_summary}}, {{allergies}}',
      'cancellation': '{{reference}}, {{refund_message}}, {{contact_phone}}',
      'review_request': '{{review_link}}',
    };
    return variables[templateKey] || '';
  }

  const layoutProps = {
    title: 'SMS Templates',
    subtitle: 'Customize SMS messages for table bookings and reminders',
    backButton: { label: 'Back to Settings', href: '/table-bookings/settings' },
  };

  if (!canManage) {
    return (
      <PageLayout {...layoutProps}>
        <Alert variant="error" description="You do not have permission to manage SMS templates." />
      </PageLayout>
    );
  }

  if (loading) {
    return (
      <PageLayout {...layoutProps} loading loadingLabel="Loading SMS templates...">
        {null}
      </PageLayout>
    );
  }

  return (
    <PageLayout {...layoutProps}>
      <div className="space-y-6">
        {error && (
          <Alert variant="error" description={error} />
        )}

        {testResult && (
          <Alert variant={testResult.success ? 'success' : 'error'}>
            {testResult.message}
            {testResult.preview && (
              <div className="mt-2 rounded border bg-white p-2">
                <p className="font-mono text-sm">{testResult.preview}</p>
              </div>
            )}
          </Alert>
        )}

        <Alert variant="info">
          <h3 className="mb-2 font-medium">Template Variables</h3>
          <p className="text-sm">
            The <code className="rounded bg-gray-100 px-1 py-0.5">{'{{date}}'}</code> variable will display as the full
            date format: &quot;Sunday, March 10&quot; (day name, month name, day number)
          </p>
        </Alert>

        <Card>
          <div className="border-b p-4">
            <div className="flex items-start gap-3">
              <DevicePhoneMobileIcon className="mt-0.5 h-5 w-5 text-blue-600" />
              <div className="flex-1">
                <FormGroup label="Test Phone Number" help="Enter your phone number to test SMS templates">
                  <Input
                    type="tel"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="07700900000"
                  />
                </FormGroup>
              </div>
            </div>
          </div>
        </Card>

        <Section title="SMS Templates">
          <Card>
            <div className="divide-y">
              {templates.map((template) => (
                <div key={template.id} className="p-6">
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-medium">
                        {getTemplateDisplayName(template)}
                      </h3>
                      <p className="mt-1 text-sm text-gray-600">
                        Available variables: {getAvailableVariables(template.template_key)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleTestTemplate(template.id)}
                        disabled={!testPhone || testingTemplate === template.id}
                        loading={testingTemplate === template.id}
                        leftIcon={<DevicePhoneMobileIcon className="h-4 w-4" />}
                      >
                        Test
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setEditingTemplate(template);
                          setTemplateText(template.template_text);
                        }}
                        leftIcon={<PencilIcon className="h-4 w-4" />}
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                  <Card variant="bordered">
                    <p className="whitespace-pre-wrap font-mono text-sm">{template.template_text}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-xs text-gray-500">
                        {template.template_text.length} characters
                      </p>
                      <Badge variant={template.is_active ? 'success' : 'warning'}>
                        {template.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      </div>

      {/* Edit Template Modal */}
      <Modal
        open={!!editingTemplate}
        onClose={() => {
          setEditingTemplate(null);
          setTemplateText('');
        }}
        title={editingTemplate ? `Edit ${getTemplateDisplayName(editingTemplate)}` : ''}
        size="lg"
      >
        {editingTemplate && (
          <form onSubmit={handleUpdateTemplate} className="space-y-4">
            <FormGroup
              label="Template Text"
              help={`Available: ${getAvailableVariables(editingTemplate.template_key)}`}
              required
            >
              <Textarea
                value={templateText}
                onChange={(e) => setTemplateText(e.target.value)}
                rows={4}
                required
                maxLength={500}
                className="font-mono text-sm"
              />
              <div className="mt-1 flex justify-end text-xs text-gray-600">
                <span>{templateText.length}/500 characters</span>
              </div>
            </FormGroup>
            
            <Alert variant="warning">
              <strong>Note:</strong> SMS messages are limited to 160 characters. Messages longer than this will be split into multiple parts.
            </Alert>
            
            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                disabled={processing}
                loading={processing}
                fullWidth
              >
                Update Template
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditingTemplate(null);
                  setTemplateText('');
                }}
                fullWidth
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </PageLayout>
  );
}
