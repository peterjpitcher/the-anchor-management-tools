'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { LinkIcon, ChartBarIcon, TrashIcon, ClipboardDocumentIcon, PencilIcon, CalendarDaysIcon, DevicePhoneMobileIcon, ComputerDesktopIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormInput } from '@/components/ui/FormInput';
import { FormSelect } from '@/components/ui/FormSelect';
import toast from 'react-hot-toast';
import { createShortLink, getShortLinkAnalytics } from '@/app/actions/short-links';
import { Loader2 } from 'lucide-react';
import { LineChart } from '@/components/ui/LineChart';

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
      const { data, error } = await supabase.rpc('get_all_links_analytics', {
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
      const { data: enhancedData, error } = await supabase.rpc('get_short_link_analytics', {
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

      const { error } = await supabase
        .from('short_links')
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Short Links</h1>
          <p className="text-gray-600 mt-2">Create and manage vip-club.uk short links</p>
        </div>
        <div className="flex gap-3">
          <Button 
            variant="secondary"
            onClick={() => {
              setShowVolumeChart(true);
              loadVolumeData(volumePeriod);
            }}
          >
            <ChartBarIcon className="h-5 w-5 mr-2" />
            View Volume Chart
          </Button>
          <Button onClick={() => setShowCreateModal(true)}>
            <LinkIcon className="h-5 w-5 mr-2" />
            Create Short Link
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Short Link
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Destination
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Clicks
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {links.map((link) => (
              <tr key={link.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                      vip-club.uk/{link.short_code}
                    </code>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-900 truncate max-w-xs" title={link.destination_url}>
                    {link.destination_url}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                    {link.link_type}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {link.click_count || 0}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(link.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => handleCopyLink(link)}
                    className="text-blue-600 hover:text-blue-900 mr-3"
                    title="Copy link"
                  >
                    <ClipboardDocumentIcon className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleViewAnalytics(link)}
                    className="text-green-600 hover:text-green-900 mr-3"
                    title="View analytics"
                  >
                    <ChartBarIcon className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleEdit(link)}
                    className="text-indigo-600 hover:text-indigo-900 mr-3"
                    title="Edit"
                  >
                    <PencilIcon className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDelete(link.id)}
                    className="text-red-600 hover:text-red-900"
                    title="Delete"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {links.length === 0 && (
          <div className="text-center py-8">
            <LinkIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No short links</h3>
            <p className="mt-1 text-sm text-gray-500">Get started by creating a new short link.</p>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Short Link"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label htmlFor="destination" className="block text-sm font-medium text-gray-700">
              Destination URL
            </label>
            <FormInput
              id="destination"
              type="url"
              value={destinationUrl}
              onChange={(e) => setDestinationUrl(e.target.value)}
              placeholder="https://example.com/page"
              required
            />
          </div>

          <div>
            <label htmlFor="type" className="block text-sm font-medium text-gray-700">
              Link Type
            </label>
            <FormSelect
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
          </div>

          <div>
            <label htmlFor="customCode" className="block text-sm font-medium text-gray-700">
              Custom Code (optional)
            </label>
            <FormInput
              id="customCode"
              type="text"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="summer-special"
              pattern="[a-z0-9-]*"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave blank to auto-generate. Only lowercase letters, numbers, and hyphens.
            </p>
          </div>

          <div>
            <label htmlFor="expires" className="block text-sm font-medium text-gray-700">
              Expires
            </label>
            <FormSelect
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
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCreateModal(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                  Creating...
                </>
              ) : (
                'Create Link'
              )}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Analytics Modal */}
      <Modal
        isOpen={showAnalyticsModal}
        onClose={() => {
          setShowAnalyticsModal(false);
          setAnalytics(null);
        }}
        title="Link Analytics"
      >
        {selectedLink && analytics && (
          <div className="space-y-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600">Short Link</p>
              <p className="font-mono">vip-club.uk/{selectedLink.short_code}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-blue-600">Total Clicks</p>
                <p className="text-2xl font-bold text-blue-900">{analytics.click_count || 0}</p>
              </div>
              
              <div className="bg-green-50 rounded-lg p-4">
                <p className="text-sm text-green-600">Last Clicked</p>
                <p className="text-sm font-medium text-green-900">
                  {analytics.last_clicked_at 
                    ? new Date(analytics.last_clicked_at).toLocaleString()
                    : 'Never'}
                </p>
              </div>
            </div>

            {/* Click Trends Chart */}
            {analytics.chartData && analytics.chartData.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Click Trends (Last 30 Days)</h4>
                <LineChart 
                  data={analytics.chartData}
                  height={200}
                  color="#3B82F6"
                  label="Daily Clicks"
                />
              </div>
            )}

            {/* Demographics Section */}
            {analytics.demographics && (
              <>
                {/* Device Types */}
                <div>
                  <h4 className="font-medium mb-3">Device Types</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <DevicePhoneMobileIcon className="h-6 w-6 mx-auto mb-1 text-gray-600" />
                      <p className="text-xs text-gray-600">Mobile</p>
                      <p className="text-lg font-semibold">{analytics.demographics.devices.mobile || 0}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <ComputerDesktopIcon className="h-6 w-6 mx-auto mb-1 text-gray-600" />
                      <p className="text-xs text-gray-600">Desktop</p>
                      <p className="text-lg font-semibold">{analytics.demographics.devices.desktop || 0}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <GlobeAltIcon className="h-6 w-6 mx-auto mb-1 text-gray-600" />
                      <p className="text-xs text-gray-600">Tablet</p>
                      <p className="text-lg font-semibold">{analytics.demographics.devices.tablet || 0}</p>
                    </div>
                  </div>
                </div>

                {/* Top Countries */}
                {Object.keys(analytics.demographics.countries).length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Top Countries</h4>
                    <div className="space-y-2">
                      {Object.entries(analytics.demographics.countries)
                        .sort(([, a], [, b]) => Number(b) - Number(a))
                        .slice(0, 5)
                        .map(([country, count]) => (
                          <div key={country} className="flex justify-between items-center bg-gray-50 rounded px-3 py-2">
                            <span className="text-sm">{country || 'Unknown'}</span>
                            <span className="text-sm font-medium">{String(count)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Top Browsers */}
                {Object.keys(analytics.demographics.browsers).length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Top Browsers</h4>
                    <div className="space-y-2">
                      {Object.entries(analytics.demographics.browsers)
                        .sort(([, a], [, b]) => Number(b) - Number(a))
                        .slice(0, 5)
                        .map(([browser, count]) => (
                          <div key={browser} className="flex justify-between items-center bg-gray-50 rounded px-3 py-2">
                            <span className="text-sm">{browser}</span>
                            <span className="text-sm font-medium">{String(count)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {analytics.short_link_clicks && analytics.short_link_clicks.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Recent Clicks</h4>
                <div className="max-h-40 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Time</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Device</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Location</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {analytics.short_link_clicks.slice(0, 10).map((click: any, idx: number) => (
                        <tr key={idx}>
                          <td className="px-4 py-2 text-sm">
                            {new Date(click.clicked_at).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            {click.device_type || 'Unknown'}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            {click.country || 'Unknown'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          resetForm();
        }}
        title="Edit Short Link"
      >
        <form onSubmit={handleUpdate} className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-600">Short Link</p>
            <p className="font-mono">vip-club.uk/{selectedLink?.short_code}</p>
          </div>

          <div>
            <label htmlFor="edit-destination" className="block text-sm font-medium text-gray-700">
              Destination URL
            </label>
            <FormInput
              id="edit-destination"
              type="url"
              value={destinationUrl}
              onChange={(e) => setDestinationUrl(e.target.value)}
              placeholder="https://example.com/page"
              required
            />
          </div>

          <div>
            <label htmlFor="edit-type" className="block text-sm font-medium text-gray-700">
              Link Type
            </label>
            <FormSelect
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
          </div>

          <div>
            <label htmlFor="edit-expires" className="block text-sm font-medium text-gray-700">
              Expires
            </label>
            <FormSelect
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
          </div>

          <div className="flex justify-end space-x-3 pt-4">
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
            <Button type="submit" disabled={updating}>
              {updating ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                  Updating...
                </>
              ) : (
                'Update Link'
              )}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Volume Chart Modal */}
      <Modal
        isOpen={showVolumeChart}
        onClose={() => {
          setShowVolumeChart(false);
          setVolumeData(null);
        }}
        title="Short Link Volume Analytics"
      >
        <div className="space-y-4">
          {/* Period Selector */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-700">Time Period</h3>
            <div className="flex gap-2">
              {['30', '60', '90'].map((days) => (
                <button
                  key={days}
                  onClick={() => {
                    setVolumePeriod(days);
                    loadVolumeData(days);
                  }}
                  className={`px-3 py-1 text-sm rounded-md ${
                    volumePeriod === days
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {days} Days
                </button>
              ))}
            </div>
          </div>

          {loadingVolume ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : volumeData && volumeData.length > 0 ? (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <p className="text-sm text-blue-600">Active Links</p>
                  <p className="text-2xl font-bold text-blue-900">{volumeData.length}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <p className="text-sm text-green-600">Total Clicks</p>
                  <p className="text-2xl font-bold text-green-900">
                    {volumeData.reduce((sum: number, link: any) => sum + link.totalClicks, 0)}
                  </p>
                </div>
                <div className="bg-purple-50 rounded-lg p-4 text-center">
                  <p className="text-sm text-purple-600">Unique Visitors</p>
                  <p className="text-2xl font-bold text-purple-900">
                    {volumeData.reduce((sum: number, link: any) => sum + link.uniqueVisitors, 0)}
                  </p>
                </div>
              </div>

              {/* Individual Link Charts */}
              <div className="space-y-6 max-h-96 overflow-y-auto">
                {volumeData.map((link: any) => (
                  <div key={link.shortCode} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-mono text-sm text-blue-600">vip-club.uk/{link.shortCode}</p>
                        <p className="text-xs text-gray-500 truncate max-w-md">{link.destinationUrl}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{link.totalClicks} clicks</p>
                        <p className="text-xs text-gray-500">{link.uniqueVisitors} unique</p>
                      </div>
                    </div>
                    <LineChart
                      data={link.data}
                      height={150}
                      color="#3B82F6"
                      showGrid={false}
                    />
                  </div>
                ))}
              </div>

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
            <div className="text-center py-12">
              <ChartBarIcon className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-500">No click data available for this period</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}