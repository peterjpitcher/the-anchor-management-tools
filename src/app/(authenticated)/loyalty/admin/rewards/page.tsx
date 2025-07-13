'use client';

import { useState, useEffect } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import { LoyaltySettingsService } from '@/lib/config/loyalty-settings';
import { LOYALTY_CONFIG } from '@/lib/config/loyalty';
import Link from 'next/link';
import { 
  GiftIcon, 
  PlusIcon, 
  PencilIcon, 
  TrashIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ChartBarIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { LoyaltyReward, RewardFormData } from '@/types/loyalty';
import { 
  getRewards, 
  getRewardStats, 
  createReward, 
  updateReward, 
  deleteReward,
  updateRewardInventory 
} from '@/app/actions/loyalty-rewards';

export default function RewardManagementPage() {
  const { hasPermission } = usePermissions();
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingReward, setEditingReward] = useState<LoyaltyReward | null>(null);
  const [programOperational, setProgramOperational] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');
  const [stats, setStats] = useState<any>(null);

  // Form state
  const [formData, setFormData] = useState<RewardFormData>({
    name: '',
    description: '',
    category: 'snacks',
    points_cost: 100,
    tier_required: undefined,
    icon: undefined,
    inventory: undefined,
    daily_limit: undefined,
    active: true
  });

  useEffect(() => {
    // Check operational status (but always allow configuration)
    const operational = LoyaltySettingsService.isOperationalEnabled();
    setProgramOperational(operational);
    
    // Always load rewards for configuration
    loadRewards();

    // Listen for settings changes
    const handleSettingsChange = (event: CustomEvent) => {
      setProgramOperational(event.detail.operationalEnabled);
    };

    window.addEventListener('loyalty-settings-changed' as any, handleSettingsChange);
    return () => {
      window.removeEventListener('loyalty-settings-changed' as any, handleSettingsChange);
    };
  }, []);

  const loadRewards = async () => {
    setLoading(true);
    try {
      const [rewardsResult, statsResult] = await Promise.all([
        getRewards(),
        getRewardStats()
      ]);
      
      if (rewardsResult.error) {
        toast.error(rewardsResult.error);
      } else if (rewardsResult.data) {
        setRewards(rewardsResult.data);
      }
      
      if (statsResult.data) {
        setStats(statsResult.data);
      }
    } catch (error) {
      console.error('Error loading rewards:', error);
      toast.error('Failed to load rewards');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (editingReward) {
        // Update existing reward
        const result = await updateReward(editingReward.id, formData);
        if (result.error) {
          toast.error(result.error);
        } else if (result.success) {
          toast.success('Reward updated successfully');
          resetForm();
          loadRewards();
        }
      } else {
        // Create new reward
        const result = await createReward(formData);
        if (result.error) {
          toast.error(result.error);
        } else if (result.success) {
          toast.success('Reward created successfully');
          resetForm();
          loadRewards();
        }
      }
    } catch (error) {
      toast.error('Failed to save reward');
    }
  };

  const handleDelete = async (rewardId: string) => {
    if (!window.confirm('Are you sure you want to delete this reward?')) {
      return;
    }
    
    try {
      const result = await deleteReward(rewardId);
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success('Reward deleted successfully');
        loadRewards();
      }
    } catch (error) {
      toast.error('Failed to delete reward');
    }
  };

  const toggleActive = async (reward: LoyaltyReward) => {
    try {
      const result = await updateReward(reward.id, {
        ...reward,
        active: !reward.active
      });
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success('Reward status updated');
        loadRewards();
      }
    } catch (error) {
      toast.error('Failed to update reward status');
    }
  };

  const handleRestockReward = async (rewardId: string, newInventory: number) => {
    try {
      const result = await updateRewardInventory(rewardId, newInventory);
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success('Inventory updated successfully');
        loadRewards();
      }
    } catch (error) {
      toast.error('Failed to update inventory');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      category: 'snacks',
      points_cost: 100,
      tier_required: undefined,
      icon: undefined,
      inventory: undefined,
      daily_limit: undefined,
      active: true
    });
    setEditingReward(null);
    setShowForm(false);
  };

  const startEdit = (reward: LoyaltyReward) => {
    setFormData({
      name: reward.name,
      description: reward.description || '',
      category: reward.category,
      points_cost: reward.points_cost,
      tier_required: reward.tier_required,
      icon: reward.icon,
      inventory: reward.inventory,
      daily_limit: reward.daily_limit,
      active: reward.active
    });
    setEditingReward(reward);
    setShowForm(true);
  };

  if (!hasPermission('loyalty', 'manage')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">You don&apos;t have permission to manage rewards.</p>
      </div>
    );
  }


  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading rewards...</p>
        </div>
      </div>
    );
  }

  // Filter rewards
  const filteredRewards = rewards.filter(reward => {
    if (filter === 'active' && !reward.active) return false;
    if (filter === 'inactive' && reward.active) return false;
    if (categoryFilter !== 'all' && reward.category !== categoryFilter) return false;
    return true;
  });

  const categories = {
    snacks: { name: 'Snacks', icon: '🍿', color: 'bg-orange-100 text-orange-800' },
    drinks: { name: 'Drinks', icon: '🍺', color: 'bg-blue-100 text-blue-800' },
    desserts: { name: 'Desserts', icon: '🍰', color: 'bg-pink-100 text-pink-800' },
    experiences: { name: 'Experiences', icon: '🎉', color: 'bg-purple-100 text-purple-800' }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Operational Status Banner */}
      {!programOperational && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 mr-2" />
            <div>
              <p className="text-yellow-800 font-medium">Configuration Mode</p>
              <p className="text-sm text-yellow-700">
                The loyalty program is not operational. You can configure rewards, but customers won&apos;t earn points until you 
                <Link href="/settings/loyalty" className="ml-1 text-yellow-900 underline">enable operations</Link>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Reward Management</h1>
            <p className="mt-1 text-sm sm:text-base text-gray-500">
              Manage loyalty program rewards and inventory
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <Link
              href="/loyalty/admin"
              className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 min-h-[40px]"
            >
              Back to Dashboard
            </Link>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 min-h-[40px]"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add Reward
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Status:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 text-sm min-h-[38px]"
          >
            <option value="all">All Rewards</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>
        
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Category:</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 text-sm min-h-[38px]"
          >
            <option value="all">All Categories</option>
            {Object.entries(categories).map(([key, cat]) => (
              <option key={key} value={key}>
                {cat.icon} {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          <div className="flex items-center">
            <GiftIcon className="h-6 w-6 sm:h-8 sm:w-8 text-amber-600 mr-2 sm:mr-3 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm text-gray-500">Total Rewards</p>
              <p className="text-lg sm:text-xl font-semibold">{stats?.totalRewards || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          <div className="flex items-center">
            <CheckCircleIcon className="h-6 w-6 sm:h-8 sm:w-8 text-green-600 mr-2 sm:mr-3 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm text-gray-500">Active</p>
              <p className="text-lg sm:text-xl font-semibold">{stats?.activeRewards || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          <div className="flex items-center">
            <ExclamationTriangleIcon className="h-6 w-6 sm:h-8 sm:w-8 text-yellow-600 mr-2 sm:mr-3 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm text-gray-500">Low Stock</p>
              <p className="text-lg sm:text-xl font-semibold">{stats?.lowStockCount || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          <div className="flex items-center">
            <ChartBarIcon className="h-6 w-6 sm:h-8 sm:w-8 text-purple-600 mr-2 sm:mr-3 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm text-gray-500">Total Redemptions</p>
              <p className="text-lg sm:text-xl font-semibold">{stats?.totalRedemptions || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Rewards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {filteredRewards.map(reward => {
          const category = categories[reward.category as keyof typeof categories] || {
            name: reward.category,
            icon: '📦',
            color: 'bg-gray-100 text-gray-800'
          };
          const tier = reward.tier;
          
          return (
            <div 
              key={reward.id}
              className={`bg-white rounded-lg shadow-sm border ${
                reward.active ? 'border-gray-200' : 'border-gray-300 opacity-75'
              }`}
            >
              <div className="p-4 sm:p-6">
                <div className="flex items-start justify-between mb-3 sm:mb-4">
                  <div className="min-w-0 flex-1 mr-2">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${category.color}`}>
                        {category.icon} {category.name}
                      </span>
                      {!reward.active && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          Inactive
                        </span>
                      )}
                    </div>
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 line-clamp-2">{reward.name}</h3>
                    <p className="text-xs sm:text-sm text-gray-500 mt-1 line-clamp-2">{reward.description}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => startEdit(reward)}
                      className="p-1.5 sm:p-1 text-gray-400 hover:text-gray-600 touch-target"
                      aria-label="Edit reward"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(reward.id)}
                      className="p-1.5 sm:p-1 text-gray-400 hover:text-red-600 touch-target"
                      aria-label="Delete reward"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Points Cost:</span>
                    <span className="font-semibold text-amber-600">{reward.points_cost} pts</span>
                  </div>
                  
                  {tier && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Required Tier:</span>
                      <span className="font-medium" style={{ color: tier.color }}>
                        {tier.icon} {tier.name}+
                      </span>
                    </div>
                  )}
                  
                  {reward.inventory !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Inventory:</span>
                      <span className={`font-medium ${
                        reward.inventory < 10 ? 'text-red-600' : 'text-gray-900'
                      }`}>
                        {reward.inventory} left
                      </span>
                    </div>
                  )}
                  
                  {reward.daily_limit && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Daily Limit:</span>
                      <span className="font-medium">{reward.daily_limit}/day</span>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="text-gray-500">Redemptions:</span>
                    <span className="font-medium">0</span>
                  </div>
                </div>

                <div className="mt-3 sm:mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <button
                    onClick={() => toggleActive(reward)}
                    className={`inline-flex items-center justify-center px-3 py-1.5 sm:py-1 border rounded-md text-xs font-medium min-h-[32px] ${
                      reward.active
                        ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                        : 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100'
                    }`}
                  >
                    {reward.active ? 'Deactivate' : 'Activate'}
                  </button>
                  
                  {reward.inventory !== undefined && reward.inventory < 10 && (
                    <button 
                      onClick={() => {
                        const newInventory = window.prompt('Enter new inventory level:', '100');
                        if (newInventory && !isNaN(parseInt(newInventory))) {
                          handleRestockReward(reward.id, parseInt(newInventory));
                        }
                      }}
                      className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                    >
                      Restock →
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {filteredRewards.length === 0 && (
        <div className="text-center py-12">
          <GiftIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No rewards found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {filter !== 'all' || categoryFilter !== 'all' 
              ? 'Try adjusting your filters'
              : 'Get started by creating a new reward'
            }
          </p>
          {filter === 'all' && categoryFilter === 'all' && (
            <div className="mt-6">
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                Add First Reward
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-4 sm:px-6 py-4 border-b flex-shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-lg sm:text-xl font-semibold">
                  {editingReward ? 'Edit Reward' : 'Add New Reward'}
                </h2>
                <button onClick={resetForm} className="text-gray-400 hover:text-gray-600 p-1">
                  <XMarkIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                </button>
              </div>
            </div>
            
            <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 min-h-[40px]"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 min-h-[40px]"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category *
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 min-h-[40px]"
                  >
                    {Object.entries(categories).map(([key, cat]) => (
                      <option key={key} value={key}>
                        {cat.icon} {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Points Cost *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.points_cost}
                    onChange={(e) => setFormData({ ...formData, points_cost: parseInt(e.target.value) })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 min-h-[40px]"
                    required
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Inventory (optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.inventory || ''}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      inventory: e.target.value ? parseInt(e.target.value) : undefined 
                    })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 min-h-[40px]"
                    placeholder="Unlimited"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Daily Limit (optional)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.daily_limit || ''}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      daily_limit: e.target.value ? parseInt(e.target.value) : undefined 
                    })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 min-h-[40px]"
                    placeholder="No limit"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Required Tier (optional)
                </label>
                <select
                  value={formData.tier_required || ''}
                  onChange={(e) => setFormData({ ...formData, tier_required: e.target.value || undefined })}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 min-h-[40px]"
                >
                  <option value="">Available to all tiers</option>
                  {Object.entries(LOYALTY_CONFIG.tiers).map(([key, tier]) => (
                    <option key={key} value={key}>
                      {tier.icon} {tier.name} and above
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="active"
                  checked={formData.active}
                  onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  className="h-5 w-5 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
                />
                <label htmlFor="active" className="ml-2 block text-sm text-gray-900">
                  Active (available for redemption)
                </label>
              </div>
              
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={resetForm}
                  className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 min-h-[40px]"
                >
                  {editingReward ? 'Update Reward' : 'Create Reward'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}