'use client'

import { useState, useEffect } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { 
  Page, 
  Section, 
  Card, 
  Alert, 
  Button, 
  FormGroup, 
  Input,
  Spinner
} from '@/components/ui-v2'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'

export default function WebhookTestPage() {
  const [testResult, setTestResult] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const supabase = useSupabase()
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  
  const webhookUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/api/webhooks/twilio`
    : ''

  useEffect(() => {
    // Only super admins can access this page
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setCheckingAuth(false)
        return
      }

      const { data: userRole } = await supabase
        .from('user_roles')
        .select('roles(name)')
        .eq('user_id', user.id)
        .single()

      if (userRole && userRole.roles && typeof userRole.roles === 'object' && 'name' in userRole.roles) {
        setIsAuthorized(userRole.roles.name === 'super_admin')
      } else {
        setIsAuthorized(false)
      }
      setCheckingAuth(false)
    }
    checkAuth()
  }, [supabase])

  if (checkingAuth) {
    return (
      <Page
        title="Webhook Test Tool"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Settings', href: '/settings' },
          { label: 'Webhook Test' }
        ]}
      >
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      </Page>
    )
  }

  if (!isAuthorized) {
    return (
      <Page
        title="Webhook Test Tool"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Settings', href: '/settings' },
          { label: 'Webhook Test' }
        ]}
      >
        <Alert
          variant="error"
          title="Access Denied"
          
          actions={
            <LinkButton
              href="/dashboard"
              variant="secondary"
              size="sm"
            >
              Return to Dashboard
            </LinkButton>
          }
        />
      </Page>
    )
  }
  
  async function testWebhook() {
    setLoading(true)
    setTestResult('Testing webhook...')
    
    try {
      // Note: This will fail in production due to signature validation
      const response = await fetch('/api/webhooks/twilio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          MessageSid: 'TEST' + Date.now(),
          AccountSid: 'TEST_ACCOUNT',
          From: '+15551234567',
          To: '+447990587315',
          Body: 'Test message from webhook test page',
          NumMedia: '0',
          NumSegments: '1',
          MessageStatus: 'received',
          ApiVersion: '2010-04-01',
        }).toString(),
      })
      
      const result = await response.json()
      
      if (response.ok) {
        setTestResult(`✅ Success! Response: ${JSON.stringify(result, null, 2)}`)
      } else {
        setTestResult(`❌ Error ${response.status}: ${JSON.stringify(result, null, 2)}`)
      }
    } catch (error) {
      setTestResult(`❌ Network error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <Page
      title="Webhook Test Tool"
      breadcrumbs={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Settings', href: '/settings' },
        { label: 'Webhook Test' }
      ]}
    >
      <div className="space-y-6">
        <Alert variant="warning"
          title="Production Security Notice"
          description="This test will fail in production due to Twilio signature validation. To properly test webhooks in production, use Twilio's webhook debugger or configure a proper test number."
        />

        <Section>
          <Card header={<h3 className="text-lg font-medium leading-6 text-gray-900">Webhook Configuration</h3>}>
            <div className="space-y-4">
              <FormGroup
                label="Webhook URL"
                help="Configure this URL in your Twilio console for SMS webhooks."
              >
                <Input
                  value={webhookUrl}
                  readOnly
                />
              </FormGroup>
              
              <div className="pt-4">
                <Button
                  onClick={testWebhook}
                  disabled={loading}
                  loading={loading}
                >
                  {loading ? 'Testing...' : 'Test Webhook'}
                </Button>
              </div>
              
              {testResult && (
                <FormGroup label="Test Result">
                  <pre className="bg-gray-100 p-4 rounded-md text-sm overflow-x-auto whitespace-pre-wrap">
                    {testResult}
                  </pre>
                </FormGroup>
              )}
            </div>
          </Card>
        </Section>

        <Section>
          <Alert variant="info"
            title="Testing in Development"
            description="For local development testing, you can use ngrok to expose your local server:"
          >
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Install ngrok: <code className="bg-blue-100 px-1 py-0.5 rounded">brew install ngrok</code></li>
              <li>Start your dev server: <code className="bg-blue-100 px-1 py-0.5 rounded">npm run dev</code></li>
              <li>In another terminal: <code className="bg-blue-100 px-1 py-0.5 rounded">ngrok http 3000</code></li>
              <li>Use the ngrok URL + <code className="bg-blue-100 px-1 py-0.5 rounded">/api/webhooks/twilio</code> in Twilio</li>
            </ol>
          
            This page is restricted to super administrators only.</Alert>
        </Section>
      </div>
    </Page>
  )
}