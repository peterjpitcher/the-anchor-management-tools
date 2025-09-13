'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { LinkIcon, ChartBarIcon, TrashIcon, ClipboardDocumentIcon, PencilIcon, CalendarDaysIcon, DevicePhoneMobileIcon, ComputerDesktopIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper';
import { Section } from '@/components/ui-v2/layout/Section';
import { Card } from '@/components/ui-v2/layout/Card';
import { Button, IconButton } from '@/components/ui-v2/forms/Button';
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal';
import { NavLink } from '@/components/ui-v2/navigation/NavLink';
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { DataTable } from '@/components/ui-v2/display/DataTable';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';
import toast from 'react-hot-toast';
import { createShortLink, getShortLinkAnalytics } from '@/app/actions/short-links';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import { useRouter } from 'next/navigation';
interface ShortLink {
  id: string;
  short_code: string;
  destination_url: string;
  link_type: string;
  click_count: number;
  created_at: string;
  expires_at: string | null;
  last_clicked_at: string | null;
}

export default function ShortLinksPage() {
  const router = useRouter();
const supabase = useSupabase();
  const [links, setLinks] = useState<ShortLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [showVolumeChart, setShowVolumeChart] = useState(false);
  const [selectedLink, setSelectedLink] = useState<ShortLink | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [volumeData, setVolumeData] = useState<any>(null);
  const [volumePeriod, setVolumePeriod] = useState('30');
  const [loadingVolume, setLoadingVolume] = useState(false);
  const [volumeChartType, setVolumeChartType] = useState<'clicks' | 'unique'>('clicks');
  
  // Form states
  const [destinationUrl, setDestinationUrl] = useState('');
  const [linkType, setLinkType] = useState('custom');
  const [customCode, setCustomCode] = useState('');
  const [expiresIn, setExpiresIn] = useState('never');
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    loadLinks();
  }, []);

  const loadLinks = async () => {
    try {
      const { data, error } = await supabase
        .from('short_links')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setLinks(data || []);
    } catch (error) {
      console.error('Error loading links:', error);
      toast.error('Failed to load short links');
    } finally {
      setLoading(false);
    }
  };

  const loadVolumeData = async (days: string) => {
    setLoadingVolume(true);
    try {
      const { data, error } = await (supabase as any).rpc('get_all_links_analytics', {
        p_days: parseInt(days)
      });

      if (error) throw error;

      // Transform data for chart display
      const chartData = data?.map((link: any) => {
        const dataPoints = link.click_dates.map((date: string, index: number) => ({
          date,
          value: link.click_counts[index]
        }));
        
        return {
          shortCode: link.short_code,
          linkType: link.link_type,
          destinationUrl: link.destination_url,
          totalClicks: link.total_clicks,
          uniqueVisitors: link.unique_visitors,
          data: dataPoints
        };
      }) || [];

      setVolumeData(chartData);
    } catch (error) {
      console.error('Error loading volume data:', error);
      toast.error('Failed to load analytics data');
    } finally {
      setLoadingVolume(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      let expiresAt: string | undefined;
      if (expiresIn !== 'never') {
        const date = new Date();
        if (expiresIn === '1d') date.setDate(date.getDate() + 1);
        else if (expiresIn === '7d') date.setDate(date.getDate() + 7);
        else if (expiresIn === '30d') date.setDate(date.getDate() + 30);
        expiresAt = date.toISOString();
      }

      const result = await createShortLink({
        destination_url: destinationUrl,
        link_type: linkType as any,
        custom_code: customCode || undefined,
        expires_at: expiresAt
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      if (result.success && result.data) {
        toast.success(`Short link created: ${result.data.full_url}`);
        
        // Copy to clipboard
        await navigator.clipboard.writeText(result.data.full_url);
        toast.success('Copied to clipboard!');
        
        setShowCreateModal(false);
        resetForm();
        loadLinks();
      }
    } catch (error) {
      toast.error('Failed to create short link');
    } finally {
      setCreating(false);
    }
  };

  const handleViewAnalytics = async (link: ShortLink) => {
    setSelectedLink(link);
    setShowAnalyticsModal(true);
    
    try {
      // Get basic analytics from action
      const result = await getShortLinkAnalytics(link.short_code);
      
      // Get enhanced analytics with demographics
      const { data: enhancedData, error } = await (supabase as any).rpc('get_short_link_analytics', {
        p_short_code: link.short_code,
        p_days: 30
      });

      if (error) throw error;

      // Process demographic data
      const demographics = {
        devices: { mobile: 0, desktop: 0, tablet: 0 },
        countries: {} as Record<string, number>,
        browsers: {} as Record<string, number>,
        referrers: {} as Record<string, number>,
        dailyData: enhancedData || []
      };

      enhancedData?.forEach((day: any) => {
        demographics.devices.mobile += day.mobile_clicks;
        demographics.devices.desktop += day.desktop_clicks;
        demographics.devices.tablet += day.tablet_clicks;

        // Aggregate country data
        if (day.top_countries) {
          Object.entries(day.top_countries).forEach(([country, count]) => {
            demographics.countries[country] = (demographics.countries[country] || 0) + Number(count);
          });
        }

        // Aggregate browser data
        if (day.top_browsers) {
          Object.entries(day.top_browsers).forEach(([browser, count]) => {
            demographics.browsers[browser] = (demographics.browsers[browser] || 0) + Number(count);
          });
        }

        // Aggregate referrer data
        if (day.top_referrers) {
          Object.entries(day.top_referrers).forEach(([referrer, count]) => {
            demographics.referrers[referrer] = (demographics.referrers[referrer] || 0) + Number(count);
          });
        }
      });

      setAnalytics({
        ...result.data,
        demographics,
        chartData: enhancedData?.map((day: any) => ({
          date: day.click_date,
          value: day.total_clicks
        })) || []
      });
    } catch (error) {
      console.error('Error loading analytics:', error);
      toast.error('Failed to load analytics');
    }
  };

  const handleCopyLink = async (link: ShortLink) => {
    const fullUrl = `https://vip-club.uk/${link.short_code}`;
    await navigator.clipboard.writeText(fullUrl);
    toast.success('Link copied to clipboard!');
  };

  const handleEdit = (link: ShortLink) => {
    setSelectedLink(link);
    setDestinationUrl(link.destination_url);
    setLinkType(link.link_type);
    setCustomCode(link.short_code);
    
    // Calculate expiry
    if (link.expires_at) {
      const expiryDate = new Date(link.expires_at);
      const now = new Date();
      const diffDays = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays <= 1) setExpiresIn('1d');
      else if (diffDays <= 7) setExpiresIn('7d');
      else if (diffDays <= 30) setExpiresIn('30d');
      else setExpiresIn('never');
    } else {
      setExpiresIn('never');
    }
    
    setShowEditModal(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLink) return;
    
    setUpdating(true);

    try {
      let expiresAt: string | null = null;
      if (expiresIn !== 'never') {
        const date = new Date();
        if (expiresIn === '1d') date.setDate(date.getDate() + 1);
        else if (expiresIn === '7d') date.setDate(date.getDate() + 7);
        else if (expiresIn === '30d') date.setDate(date.getDate() + 30);
        expiresAt = date.toISOString();
      }

      const { error } = await (supabase
        .from('short_links') as any)
        .update({
          destination_url: destinationUrl,
          link_type: linkType,
          expires_at: expiresAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedLink.id);

      if (error) {
        toast.error('Failed to update short link');
        return;
      }

      toast.success('Short link updated');
      setShowEditModal(false);
      resetForm();
      loadLinks();
    } catch (error) {
      toast.error('Failed to update short link');
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async (linkId: string) => {
    const link = links.find(l => l.id === linkId);
    if (!link) return;
    
    const message = `Are you sure you want to delete this short link?\n\nvip-club.uk/${link.short_code}\n\nAnyone clicking this link will be redirected to the-anchor.pub`;
    
    if (!confirm(message)) return;

    try {
      const { error } = await supabase
        .from('short_links')
        .delete()
        .eq('id', linkId);
      
      if (error) throw error;
      
      toast.success('Short link deleted');
      loadLinks();
    } catch (error) {
      toast.error('Failed to delete short link');
    }
  };

  const resetForm = () => {
    setDestinationUrl('');
    setCustomCode('');
    setLinkType('custom');
    setExpiresIn('never');
    setSelectedLink(null);
  };

  return (
    <PageWrapper>
      <PageHeader
        title="Short Links"
        subtitle="Create and manage vip-club.uk short links"
        backButton={{
          label: "Back to Settings",
          href: "/settings"
        }}
        actions={
          <NavGroup>
            <NavLink 
              onClick={() => {
                setShowVolumeChart(true);
                loadVolumeData(volumePeriod);
              }}
            >
              View Volume Chart
            </NavLink>
            <NavLink 
              onClick={() => {
                setShowCreateModal(true);
              }}
            >
              Create Short Link
            </NavLink>
          </NavGroup>
        }
      />
      <PageContent>
        <Section>
        <DataTable
          data={links}
          getRowKey={(link) => link.id}
          emptyMessage="No short links"
          emptyDescription="Get started by creating a new short link."
          columns={[
            {
              key: 'short_code',
              header: 'Short Link',
              cell: (link) => (
                <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                  vip-club.uk/{link.short_code}
                </code>
              ),
            },
            {
              key: 'destination_url',
              header: 'Destination',
              cell: (link) => (
                <div className="text-sm text-gray-900 truncate max-w-xs" title={link.destination_url}>
                  {link.destination_url}
                </div>
              ),
            },
            {
              key: 'link_type',
              header: 'Type',
              cell: (link) => (
                <Badge variant="info" size="sm">
                  {link.link_type}
                </Badge>
              ),
            },
            {
              key: 'click_count',
              header: 'Clicks',
              cell: (link) => link.click_count || 0,
              sortable: true,
            },
            {
              key: 'created_at',
              header: 'Created',
              cell: (link) => new Date(link.created_at).toLocaleDateString(),
              sortable: true,
            },
            {
              key: 'actions',
              header: 'Actions',
              align: 'right',
              cell: (link) => (
                <div className="flex items-center justify-end gap-1">
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleCopyLink(link)}
                    title="Copy link"
                  >
                    <ClipboardDocumentIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleViewAnalytics(link)}
                    title="View analytics"
                  >
                    <ChartBarIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleEdit(link)}
                    title="Edit"
                  >
                    <PencilIcon className="h-4 w-4 text-gray-600" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="secondary"
                    onClick={() => handleDelete(link.id)}
                    title="Delete"
                  >
                    <TrashIcon className="h-4 w-4 text-red-600" />
                  </IconButton>
                </div>
              ),
            },
          ]}
          renderMobileCard={(link) => (
            <Card padding="sm">
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1 min-w-0 mr-4">
                  <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded inline-block mb-2">
                    vip-club.uk/{link.short_code}
                  </code>
                  <p className="text-xs text-gray-600 truncate">{link.destination_url}</p>
                </div>
                <Badge variant="info" size="sm">
                  {link.link_type}
                </Badge>
              </div>
              
              <div className="flex justify-between items-center text-sm text-gray-500 mb-3">
                <span>{link.click_count || 0} clicks</span>
                <span>{new Date(link.created_at).toLocaleDateString()}</span>
              </div>
              
              <div className="flex justify-between border-t pt-3">
                <IconButton
                  size="sm"
                  variant="secondary"
                  onClick={() => handleCopyLink(link)}
                  title="Copy link"
                >
                  <ClipboardDocumentIcon className="h-4 w-4 text-gray-600" />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="secondary"
                  onClick={() => handleViewAnalytics(link)}
                  title="View analytics"
                >
                  <ChartBarIcon className="h-4 w-4 text-gray-600" />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="secondary"
                  onClick={() => handleEdit(link)}
                  title="Edit"
                >
                  <PencilIcon className="h-4 w-4 text-gray-600" />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="secondary"
                  onClick={() => handleDelete(link.id)}
                  title="Delete"
                >
                  <TrashIcon className="h-4 w-4 text-red-600" />
                </IconButton>
              </div>
            </Card>
          )}
        />
      </Section>
      </PageContent>

      {/* Create Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Short Link"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <FormGroup label="Destination URL" required>
            <Input
              id="destination"
              type="url"
              value={destinationUrl}
              onChange={(e) => setDestinationUrl(e.target.value)}
              placeholder="https://example.com/page"
              required
            />
          </FormGroup>

          <FormGroup label="Link Type">
            <Select
              id="type"
              value={linkType}
              onChange={(e) => setLinkType(e.target.value)}
              options={[
                { value: 'custom', label: 'Custom' },
                { value: 'loyalty_portal', label: 'Loyalty Portal' },
                { value: 'event_checkin', label: 'Event Check-in' },
                { value: 'promotion', label: 'Promotion' },
                { value: 'reward_redemption', label: 'Reward Redemption' }
              ]}
            />
          </FormGroup>

          <FormGroup 
            label="Custom Code (optional)"
            help="Leave blank to auto-generate. Only lowercase letters, numbers, and hyphens."
          >
            <Input
              id="customCode"
              type="text"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="summer-special"
              pattern="[a-z0-9-]*"
            />
          </FormGroup>

          <FormGroup label="Expires">
            <Select
              id="expires"
              value={expiresIn}
              onChange={(e) => setExpiresIn(e.target.value)}
              options={[
                { value: 'never', label: 'Never' },
                { value: '1d', label: 'In 1 day' },
                { value: '7d', label: 'In 7 days' },
                { value: '30d', label: 'In 30 days' }
              ]}
            />
          </FormGroup>

          <ModalActions>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCreateModal(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={creating}>
              Create Link
            </Button>
          </ModalActions>
        </form>
      </Modal>

      {/* Analytics Modal */}
      <Modal
        open={showAnalyticsModal}
        onClose={() => {
          setShowAnalyticsModal(false);
          setAnalytics(null);
        }}
        title="Link Analytics"
        size="xl"
      >
        {selectedLink && analytics && (
          <div className="space-y-4">
            <Card variant="bordered" padding="sm">
              <p className="text-xs sm:text-sm text-gray-600">Short Link</p>
              <p className="font-mono text-sm sm:text-base">vip-club.uk/{selectedLink.short_code}</p>
            </Card>
            
            <div className="grid grid-cols-2 gap-4">
              <Card variant="bordered" padding="sm" className="bg-blue-50">
                <p className="text-sm text-blue-600">Total Clicks</p>
                <p className="text-2xl font-bold text-blue-900">{analytics.click_count || 0}</p>
              </Card>
              
              <Card variant="bordered" padding="sm" className="bg-green-50">
                <p className="text-sm text-green-600">Last Clicked</p>
                <p className="text-sm font-medium text-green-900">
                  {analytics.last_clicked_at 
                    ? new Date(analytics.last_clicked_at).toLocaleString()
                    : 'Never'}
                </p>
              </Card>
            </div>

            {/* Click Trends Chart */}
            {analytics.chartData && analytics.chartData.length > 0 && (
              <Section title="Click Trends (Last 30 Days)" variant="gray" padding="sm">
                <LineChart 
                  data={analytics.chartData}
                  height={200}
                  color="#3B82F6"
                  label="Daily Clicks"
                />
              </Section>
            )}

            {/* Demographics Section */}
            {analytics.demographics && (
              <>
                {/* Device Types */}
                <Section title="Device Types" variant="gray" padding="sm">
                  <div className="grid grid-cols-3 gap-3">
                    <Card variant="bordered" padding="sm" className="text-center">
                      <DevicePhoneMobileIcon className="h-6 w-6 mx-auto mb-1 text-gray-600" />
                      <p className="text-xs text-gray-600">Mobile</p>
                      <p className="text-lg font-semibold">{analytics.demographics.devices.mobile || 0}</p>
                    </Card>
                    <Card variant="bordered" padding="sm" className="text-center">
                      <ComputerDesktopIcon className="h-6 w-6 mx-auto mb-1 text-gray-600" />
                      <p className="text-xs text-gray-600">Desktop</p>
                      <p className="text-lg font-semibold">{analytics.demographics.devices.desktop || 0}</p>
                    </Card>
                    <Card variant="bordered" padding="sm" className="text-center">
                      <GlobeAltIcon className="h-6 w-6 mx-auto mb-1 text-gray-600" />
                      <p className="text-xs text-gray-600">Tablet</p>
                      <p className="text-lg font-semibold">{analytics.demographics.devices.tablet || 0}</p>
                    </Card>
                  </div>
                </Section>

                {/* Top Countries */}
                {Object.keys(analytics.demographics.countries).length > 0 && (
                  <Section title="Top Countries" variant="gray" padding="sm">
                    <div className="space-y-2">
                      {Object.entries(analytics.demographics.countries)
                        .sort(([, a], [, b]) => Number(b) - Number(a))
                        .slice(0, 5)
                        .map(([country, count]) => (
                          <Card key={country} variant="bordered" padding="sm">
                            <div className="flex justify-between items-center">
                              <span className="text-sm">{country || 'Unknown'}</span>
                              <Badge variant="secondary" size="sm">{String(count)}</Badge>
                            </div>
                          </Card>
                        ))}
                    </div>
                  </Section>
                )}

                {/* Top Browsers */}
                {Object.keys(analytics.demographics.browsers).length > 0 && (
                  <Section title="Top Browsers" variant="gray" padding="sm">
                    <div className="space-y-2">
                      {Object.entries(analytics.demographics.browsers)
                        .sort(([, a], [, b]) => Number(b) - Number(a))
                        .slice(0, 5)
                        .map(([browser, count]) => (
                          <Card key={browser} variant="bordered" padding="sm">
                            <div className="flex justify-between items-center">
                              <span className="text-sm">{browser}</span>
                              <Badge variant="secondary" size="sm">{String(count)}</Badge>
                            </div>
                          </Card>
                        ))}
                    </div>
                  </Section>
                )}
              </>
            )}

            {analytics.short_link_clicks && analytics.short_link_clicks.length > 0 && (
              <Section 
                title={`All Clicks (${analytics.short_link_clicks.length})`}
                variant="gray" 
                padding="none"
              >
                <div className="max-h-96 overflow-y-auto">
                  <DataTable
                    data={analytics.short_link_clicks.sort((a: any, b: any) => 
                      new Date(b.clicked_at).getTime() - new Date(a.clicked_at).getTime()
                    )}
                    getRowKey={(click: any) => click.id || Math.random()}
                    size="sm"
                    stickyHeader
                    columns={[
                      {
                        key: 'clicked_at',
                        header: 'Time',
                        cell: (click) => (
                          <div>
                            <div className="font-medium">{new Date(click.clicked_at).toLocaleDateString()}</div>
                            <div className="text-gray-500 text-xs">{new Date(click.clicked_at).toLocaleTimeString()}</div>
                          </div>
                        ),
                      },
                      {
                        key: 'device_type',
                        header: 'Device',
                        hideOnMobile: true,
                        cell: (click) => (
                          <Badge 
                            variant={
                              click.device_type === 'mobile' ? 'success' :
                              click.device_type === 'desktop' ? 'info' :
                              'default'
                            }
                            size="sm"
                          >
                            {click.device_type || 'Unknown'}
                          </Badge>
                        ),
                      },
                      {
                        key: 'location',
                        header: 'Location',
                        cell: (click) => (
                          <div>
                            <div>{click.country || 'Unknown'}</div>
                            {click.city && <div className="text-gray-500 text-xs">{click.city}</div>}
                          </div>
                        ),
                      },
                      {
                        key: 'browser',
                        header: 'Browser',
                        hideOnMobile: true,
                        cell: (click) => click.browser || 'Unknown',
                      },
                    ]}
                  />
                </div>
              </Section>
            )}
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          resetForm();
        }}
        title="Edit Short Link"
      >
        <form onSubmit={handleUpdate} className="space-y-4">
          <Card variant="bordered" padding="sm">
            <p className="text-sm text-gray-600">Short Link</p>
            <p className="font-mono">vip-club.uk/{selectedLink?.short_code}</p>
          </Card>

          <FormGroup label="Destination URL" required>
            <Input
              id="edit-destination"
              type="url"
              value={destinationUrl}
              onChange={(e) => setDestinationUrl(e.target.value)}
              placeholder="https://example.com/page"
              required
            />
          </FormGroup>

          <FormGroup label="Link Type">
            <Select
              id="edit-type"
              value={linkType}
              onChange={(e) => setLinkType(e.target.value)}
              options={[
                { value: 'custom', label: 'Custom' },
                { value: 'loyalty_portal', label: 'Loyalty Portal' },
                { value: 'event_checkin', label: 'Event Check-in' },
                { value: 'promotion', label: 'Promotion' },
                { value: 'reward_redemption', label: 'Reward Redemption' }
              ]}
            />
          </FormGroup>

          <FormGroup label="Expires">
            <Select
              id="edit-expires"
              value={expiresIn}
              onChange={(e) => setExpiresIn(e.target.value)}
              options={[
                { value: 'never', label: 'Never' },
                { value: '1d', label: 'In 1 day' },
                { value: '7d', label: 'In 7 days' },
                { value: '30d', label: 'In 30 days' }
              ]}
            />
          </FormGroup>

          <ModalActions>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowEditModal(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={updating}>
              Update Link
            </Button>
          </ModalActions>
        </form>
      </Modal>

      {/* Volume Chart Modal */}
      <Modal
        open={showVolumeChart}
        onClose={() => {
          setShowVolumeChart(false);
          setVolumeData(null);
        }}
        title="Short Link Volume Analytics"
        size="full"
      >
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={volumeChartType === 'clicks' ? 'primary' : 'secondary'}
                  onClick={() => setVolumeChartType('clicks')}
                >
                  Total Clicks
                </Button>
                <Button
                  size="sm"
                  variant={volumeChartType === 'unique' ? 'primary' : 'secondary'}
                  onClick={() => setVolumeChartType('unique')}
                >
                  Unique Visitors
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Period:</span>
              {['30', '60', '90'].map((days) => (
                <Button
                  key={days}
                  size="sm"
                  variant={volumePeriod === days ? 'primary' : 'secondary'}
                  onClick={() => {
                    setVolumePeriod(days);
                    loadVolumeData(days);
                  }}
                >
                  {days} Days
                </Button>
              ))}
            </div>
          </div>

          {loadingVolume ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : volumeData && volumeData.length > 0 ? (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <Card variant="bordered" className="bg-blue-50 text-center">
                  <p className="text-sm text-blue-600">Active Links</p>
                  <p className="text-2xl font-bold text-blue-900">{volumeData.length}</p>
                </Card>
                <Card variant="bordered" className="bg-green-50 text-center">
                  <p className="text-sm text-green-600">Total Clicks</p>
                  <p className="text-2xl font-bold text-green-900">
                    {volumeData.reduce((sum: number, link: any) => sum + link.totalClicks, 0)}
                  </p>
                </Card>
                <Card variant="bordered" className="bg-purple-50 text-center">
                  <p className="text-sm text-purple-600">Unique Visitors</p>
                  <p className="text-2xl font-bold text-purple-900">
                    {volumeData.reduce((sum: number, link: any) => sum + link.uniqueVisitors, 0)}
                  </p>
                </Card>
              </div>

              {/* Overall Volume Bar Chart */}
              <Section 
                title={`${volumeChartType === 'clicks' ? 'Total Clicks' : 'Unique Visitors'} by Link`} 
                variant="gray" 
                padding="sm"
              >
                <BarChart
                  data={volumeData
                    .sort((a: any, b: any) => 
                      volumeChartType === 'clicks' 
                        ? b.totalClicks - a.totalClicks 
                        : b.uniqueVisitors - a.uniqueVisitors
                    )
                    .slice(0, 10)
                    .map((link: any) => ({
                      label: link.shortCode,
                      value: volumeChartType === 'clicks' ? link.totalClicks : link.uniqueVisitors,
                      color: volumeChartType === 'clicks' ? '#3B82F6' : '#10B981'
                    }))}
                  height={300}
                  showValues={true}
                />
              </Section>

              {/* Individual Link Charts */}
              <Section title="Top Links Performance Over Time" variant="gray" padding="sm">
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {volumeData
                    .sort((a: any, b: any) => b.totalClicks - a.totalClicks)
                    .slice(0, 5)
                    .map((link: any) => (
                      <Card key={link.shortCode} variant="bordered" padding="sm">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <p className="font-mono text-sm text-blue-600">vip-club.uk/{link.shortCode}</p>
                            <p className="text-xs text-gray-500 truncate max-w-md">{link.destinationUrl}</p>
                          </div>
                          <div className="text-right">
                            <Badge variant="info" size="sm">{link.totalClicks} clicks</Badge>
                            <p className="text-xs text-gray-500 mt-1">{link.uniqueVisitors} unique</p>
                          </div>
                        </div>
                        <LineChart
                          data={link.data}
                          height={150}
                          color="#3B82F6"
                          showGrid={false}
                        />
                      </Card>
                    ))}
                </div>
              </Section>

              {/* Export Button */}
              <div className="pt-4 border-t">
                <Button
                  variant="secondary"
                  onClick={() => {
                    // Create CSV export
                    const csv = [
                      ['Short Code', 'Destination', 'Total Clicks', 'Unique Visitors'],
                      ...volumeData.map((link: any) => [
                        link.shortCode,
                        link.destinationUrl,
                        link.totalClicks,
                        link.uniqueVisitors
                      ])
                    ].map(row => row.join(',')).join('\n');
                    
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `short-links-analytics-${volumePeriod}-days.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    
                    toast.success('Analytics exported');
                  }}
                >
                  Export Analytics
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState icon="chart"
              title="No click data available"
              description="No clicks have been recorded for this time period"
            />
          )}
        </div>
      </Modal>
    </PageWrapper>
  );
}