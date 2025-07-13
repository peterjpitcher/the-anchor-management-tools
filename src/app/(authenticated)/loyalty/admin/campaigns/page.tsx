'use client';

import { useState, useEffect } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { 
  MegaphoneIcon, 
  PlusIcon, 
  PencilIcon, 
  TrashIcon,
  XMarkIcon,
  CalendarIcon,
  SparklesIcon,
  ChartBarIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { LoyaltyCampaign } from '@/types/loyalty';
import { 
  getCampaigns, 
  getCampaignStats, 
  createCampaign, 
  updateCampaign, 
  deleteCampaign,
  toggleCampaignStatus
} from '@/app/actions/loyalty-campaigns';
import { Loader2 } from 'lucide-react';

interface CampaignFormData {
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  bonus_type: 'multiplier' | 'fixed' | 'percentage';
  bonus_value: number;
  criteria: {
    event_types?: string[];
    min_events?: number;
    target_tiers?: string[];
  };
  active: boolean;
}

export default function CampaignManagementPage() {
  const { hasPermission } = usePermissions();
  const [campaigns, setCampaigns] = useState<LoyaltyCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<LoyaltyCampaign | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'current' | 'past'>('all');
  const [stats, setStats] = useState<any>(null);

  // Form state
  const [formData, setFormData] = useState<CampaignFormData>({
    name: '',
    description: '',
    start_date: '',
    end_date: '',
    bonus_type: 'multiplier',
    bonus_value: 2,
    criteria: {},
    active: true
  });

  useEffect(() => {
    loadCampaigns();
  }, []);

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const [campaignsResult, statsResult] = await Promise.all([
        getCampaigns(),
        getCampaignStats()
      ]);
      
      if (campaignsResult.error) {
        toast.error(campaignsResult.error);
      } else if (campaignsResult.data) {
        setCampaigns(campaignsResult.data);
      }
      
      if (statsResult.data) {
        setStats(statsResult.data);
      }
    } catch (error) {
      console.error('Error loading campaigns:', error);
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (editingCampaign) {
        // Update existing campaign
        const result = await updateCampaign(editingCampaign.id, formData);
        if (result.error) {
          toast.error(result.error);
        } else if (result.success) {
          toast.success('Campaign updated successfully');
          resetForm();
          loadCampaigns();
        }
      } else {
        // Create new campaign
        const result = await createCampaign(formData);
        if (result.error) {
          toast.error(result.error);
        } else if (result.success) {
          toast.success('Campaign created successfully');
          resetForm();
          loadCampaigns();
        }
      }
    } catch (error) {
      toast.error('Failed to save campaign');
    }
  };

  const handleDelete = async (campaignId: string) => {
    if (!window.confirm('Are you sure you want to delete this campaign?')) {
      return;
    }
    
    try {
      const result = await deleteCampaign(campaignId);
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success('Campaign deleted successfully');
        loadCampaigns();
      }
    } catch (error) {
      toast.error('Failed to delete campaign');
    }
  };

  const toggleActive = async (campaign: LoyaltyCampaign) => {
    try {
      const result = await toggleCampaignStatus(campaign.id, !campaign.active);
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success('Campaign status updated');
        loadCampaigns();
      }
    } catch (error) {
      toast.error('Failed to update campaign status');
    }
  };

  const resetForm = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    
    setFormData({
      name: '',
      description: '',
      start_date: tomorrow.toISOString().split('T')[0],
      end_date: nextMonth.toISOString().split('T')[0],
      bonus_type: 'multiplier',
      bonus_value: 2,
      criteria: {},
      active: true
    });
    setEditingCampaign(null);
    setShowForm(false);
  };

  const startEdit = (campaign: LoyaltyCampaign) => {
    setFormData({
      name: campaign.name,
      description: campaign.description || '',
      start_date: campaign.start_date.split('T')[0],
      end_date: campaign.end_date.split('T')[0],
      bonus_type: campaign.bonus_type,
      bonus_value: campaign.bonus_value,
      criteria: campaign.criteria || {},
      active: campaign.active
    });
    setEditingCampaign(campaign);
    setShowForm(true);
  };

  const getCampaignStatus = (campaign: LoyaltyCampaign) => {
    const now = new Date();
    const start = new Date(campaign.start_date);
    const end = new Date(campaign.end_date);
    
    if (!campaign.active) return 'inactive';
    if (now < start) return 'upcoming';
    if (now > end) return 'past';
    return 'current';
  };

  if (!hasPermission('loyalty', 'manage')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">You don&apos;t have permission to manage campaigns.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading campaigns...</p>
        </div>
      </div>
    );
  }

  // Filter campaigns
  const filteredCampaigns = campaigns.filter(campaign => {
    const status = getCampaignStatus(campaign);
    
    if (filter === 'active' && !campaign.active) return false;
    if (filter === 'current' && status !== 'current') return false;
    if (filter === 'past' && status !== 'past') return false;
    
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Campaign Management</h1>
            <p className="mt-1 text-gray-500">
              Create and manage bonus point campaigns
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <Link
              href="/loyalty/admin"
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Back to Dashboard
            </Link>
            <button
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add Campaign
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">Filter:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 sm:text-sm"
          >
            <option value="all">All Campaigns</option>
            <option value="active">Active Only</option>
            <option value="current">Currently Running</option>
            <option value="past">Past Campaigns</option>
          </select>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <MegaphoneIcon className="h-8 w-8 text-amber-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Total Campaigns</p>
              <p className="text-xl font-semibold">{stats?.totalCampaigns || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <SparklesIcon className="h-8 w-8 text-green-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Active Campaigns</p>
              <p className="text-xl font-semibold">{stats?.activeCampaigns || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <ChartBarIcon className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Currently Running</p>
              <p className="text-xl font-semibold">{stats?.currentCampaigns || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Campaigns List */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {filteredCampaigns.length > 0 ? (
          <div className="divide-y divide-gray-200">
            {filteredCampaigns.map(campaign => {
              const status = getCampaignStatus(campaign);
              const start = new Date(campaign.start_date);
              const end = new Date(campaign.end_date);
              const now = new Date();
              const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              
              return (
                <div key={campaign.id} className="p-6 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {campaign.name}
                        </h3>
                        {status === 'current' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Active Now
                          </span>
                        )}
                        {status === 'upcoming' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            Upcoming
                          </span>
                        )}
                        {status === 'past' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                            Ended
                          </span>
                        )}
                        {status === 'inactive' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="text-gray-600 mt-1">{campaign.description}</p>
                      
                      <div className="mt-3 flex items-center space-x-6 text-sm">
                        <div className="flex items-center text-gray-500">
                          <CalendarIcon className="h-4 w-4 mr-1" />
                          {start.toLocaleDateString()} - {end.toLocaleDateString()}
                        </div>
                        
                        <div className="flex items-center">
                          <span className="text-gray-500 mr-2">Bonus:</span>
                          <span className="font-semibold text-amber-600">
                            {campaign.bonus_type === 'multiplier' 
                              ? `${campaign.bonus_value}x points` 
                              : campaign.bonus_type === 'fixed'
                              ? `+${campaign.bonus_value} points`
                              : `+${campaign.bonus_value}%`
                            }
                          </span>
                        </div>
                        
                        {status === 'current' && daysLeft > 0 && (
                          <span className="text-red-600 font-medium">
                            {daysLeft} day{daysLeft !== 1 ? 's' : ''} left
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2 ml-4">
                      <button
                        onClick={() => toggleActive(campaign)}
                        className={`px-3 py-1 text-xs font-medium rounded-md ${
                          campaign.active
                            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                      >
                        {campaign.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => startEdit(campaign)}
                        className="p-1 text-gray-400 hover:text-gray-600"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(campaign.id)}
                        className="p-1 text-gray-400 hover:text-red-600"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <MegaphoneIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No campaigns found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {filter !== 'all' 
                ? 'Try adjusting your filter'
                : 'Get started by creating a new campaign'
              }
            </p>
            {filter === 'all' && (
              <div className="mt-6">
                <button
                  onClick={() => {
                    resetForm();
                    setShowForm(true);
                  }}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
                >
                  <PlusIcon className="h-4 w-4 mr-2" />
                  Add First Campaign
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">
                  {editingCampaign ? 'Edit Campaign' : 'Add New Campaign'}
                </h2>
                <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Campaign Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                  placeholder="e.g., Double Points Weekend"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description *
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                  placeholder="Describe the campaign and its benefits..."
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Date *
                  </label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    min={formData.start_date}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    required
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Bonus Type *
                  </label>
                  <select
                    value={formData.bonus_type}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      bonus_type: e.target.value as any,
                      bonus_value: e.target.value === 'multiplier' ? 2 : 
                                   e.target.value === 'fixed' ? 50 : 25
                    })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                  >
                    <option value="multiplier">Points Multiplier</option>
                    <option value="fixed">Fixed Bonus Points</option>
                    <option value="percentage">Percentage Bonus</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Bonus Value *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step={formData.bonus_type === 'multiplier' ? '0.5' : '1'}
                    value={formData.bonus_value}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      bonus_value: parseFloat(e.target.value) 
                    })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.bonus_type === 'multiplier' && 'e.g., 2 = double points'}
                    {formData.bonus_type === 'fixed' && 'Extra points per check-in'}
                    {formData.bonus_type === 'percentage' && 'Percentage increase'}
                  </p>
                </div>
              </div>
              
              <div className="pt-2">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="active"
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
                  />
                  <label htmlFor="active" className="ml-2 block text-sm text-gray-900">
                    Active (campaign will run during the specified dates)
                  </label>
                </div>
              </div>
              
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
                >
                  {editingCampaign ? 'Update Campaign' : 'Create Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}