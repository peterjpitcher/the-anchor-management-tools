'use client'

import { useRouter } from 'next/navigation';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { PencilIcon, DevicePhoneMobileIcon } from '@heroicons/react/24/outline';
import { getSMSTemplates, updateSMSTemplate, testSMSTemplate } from '@/app/actions/table-booking-sms';
import { TableBookingSMSTemplate } from '@/types/table-bookings';

// UI v2 Components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Modal } from '@/components/ui-v2/overlay/Modal';
import { toast } from '@/components/ui-v2/feedback/Toast';

import { BackButton } from '@/components/ui-v2/navigation/BackButton';
export default function SMSTemplatesPage() {
  const router = useRouter();
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
            template_text: 'Hi {{customer_name}}, your table for {{party_size}} at The Anchor on {{date}} at {{time}} is confirmed. Reference: {{reference}}. Questions? Call {{contact_phone}}',
            is_active: true,
          },
          {
            template_key: 'booking_confirmation_sunday_lunch',
            booking_type: 'sunday_lunch',
            template_text: 'Hi {{customer_name}}, your Sunday Lunch booking for {{party_size}} on {{date}} at {{time}} is confirmed & paid. Ref: {{reference}}. Call {{contact_phone}} if needed.',
            is_active: true,
          },
          {
            template_key: 'reminder_regular',
            booking_type: 'regular',
            template_text: 'Reminder: Your table for {{party_size}} at The Anchor is tomorrow at {{time}}. Ref: {{reference}}. See you then!',
            is_active: true,
          },
          {
            template_key: 'reminder_sunday_lunch',
            booking_type: 'sunday_lunch',
            template_text: 'Reminder: Your Sunday Lunch at The Anchor is tomorrow at {{time}}. {{roast_summary}}. Allergies noted: {{allergies}}. See you then!',
            is_active: true,
          },
          {
            template_key: 'cancellation',
            booking_type: null,
            template_text: 'Your booking {{reference}} has been cancelled. {{refund_message}} Questions? Call {{contact_phone}}',
            is_active: true,
          },
          {
            template_key: 'review_request',
            booking_type: null,
            template_text: 'Thanks for dining at The Anchor! We hope you enjoyed your visit. Please leave a review: {{review_link}}',
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

  if (!canManage) {
    return (
      <Page title="SMS Templates">
        <Alert variant="error">
          You do not have permission to manage SMS templates.
        </Alert>
      </Page>
    );
  }

  if (loading) {
    return (
      <Page title="SMS Templates">
        <div className="flex items-center justify-center min-h-[400px]">
          <Spinner size="lg" />
        </div>
      </Page>
    );
  }

  return (
    <Page 
      title="SMS Templates"
      description="Customize SMS messages for table bookings and reminders"
    >
      <BackButton label="Back to Settings" onBack={() => router.push('/table-bookings/settings')} />

      {error && (
        <Alert variant="error" className="mt-4">
          {error}
        </Alert>
      )}

      {testResult && (
        <Alert variant={testResult.success ? 'success' : 'error'} className="mt-4">
          {testResult.message}
          {testResult.preview && (
            <div className="mt-2 p-2 bg-white rounded border">
              <p className="text-sm font-mono">{testResult.preview}</p>
            </div>
          )}
        </Alert>
      )}

      <Alert variant="info" className="mt-4">
        <h3 className="font-medium mb-2">Template Variables</h3>
        <p className="text-sm">
          The <code className="px-1 py-0.5 bg-gray-100 rounded">{'{{date}}'}</code> variable will display as the full
          date format: &quot;Sunday, March 10&quot; (day name, month name, day number)
        </p>
      </Alert>

      <Card className="mt-6">
        <div className="p-4 border-b">
          <div className="flex items-start gap-3">
            <DevicePhoneMobileIcon className="h-5 w-5 text-blue-600 mt-0.5" />
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

      <Section title="SMS Templates" className="mt-8">
        <Card>
          <div className="divide-y">
            {templates.map((template) => (
              <div key={template.id} className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-medium text-lg">
                      {getTemplateDisplayName(template)}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
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
                  <p className="text-sm font-mono whitespace-pre-wrap">{template.template_text}</p>
                  <div className="flex items-center justify-between mt-2">
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
              <div className="flex justify-end text-xs text-gray-600 mt-1">
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
    </Page>
  );
}
