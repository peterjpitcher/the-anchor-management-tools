'use client'

import { useRouter } from 'next/navigation';

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
import { LoyaltyReward, RewardFormData } from '@/types/loyalty';
import { 
  getRewards, 
  getRewardStats, 
  createReward, 
  updateReward, 
  deleteReward,
  updateRewardInventory 
} from '@/app/actions/loyalty-rewards';
import { Page } from '@/components/ui-v2/layout/Page';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Button } from '@/components/ui-v2/forms/Button';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { BackButton } from '@/components/ui-v2/navigation/BackButton';
import { Select } from '@/components/ui-v2/forms/Select';
import { Input } from '@/components/ui-v2/forms/Input';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Stat } from '@/components/ui-v2/display/Stat';
import { Modal } from '@/components/ui-v2/overlay/Modal';
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog';
import { toast } from '@/components/ui-v2/feedback/Toast';

export default function RewardManagementPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingReward, setEditingReward] = useState<LoyaltyReward | null>(null);
  const [programOperational, setProgramOperational] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');
  const [stats, setStats] = useState<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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
    setDeleteConfirmId(null);
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
      <Page title="Reward Management" error="You don't have permission to manage rewards." />
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
    <Page
      title="Reward Management"
      description="Manage loyalty program rewards and inventory"
      loading={loading}
      actions={
        <div className="flex gap-3">
          <BackButton label="Back to Dashboard" onBack={() => router.push('/loyalty/admin')} />
          <Button onClick={() => setShowForm(true)} leftIcon={<PlusIcon className="h-4 w-4" />}>
            Add Reward
          </Button>
        </div>
      }
    >
      {/* Operational Status Banner */}
      {!programOperational && (
        <Alert
          variant="warning"
          title="Configuration Mode"
          className="mb-6"
        >
          The loyalty program is not operational. You can configure rewards, but customers won&apos;t earn points until you
          <Link href="/settings/loyalty" className="ml-1 text-yellow-900 underline">enable operations</Link>.
        </Alert>
      )}

      {/* Filters */}
      <Section className="mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <FormGroup label="Status:">
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              options={[
                { value: 'all', label: 'All Rewards' },
                { value: 'active', label: 'Active Only' },
                { value: 'inactive', label: 'Inactive Only' }
              ]}
            />
          </FormGroup>
          
          <FormGroup label="Category:">
            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              options={[
                { value: 'all', label: 'All Categories' },
                ...Object.entries(categories).map(([key, cat]) => ({
                  value: key,
                  label: `${cat.icon} ${cat.name}`
                }))
              ]}
            />
          </FormGroup>
        </div>
      </Section>

      {/* Summary Stats */}
      <Section className="mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <Stat label="Total Rewards"
            value={stats?.totalRewards || 0}
            icon={<GiftIcon />}
          />
          <Stat label="Active"
            value={stats?.activeRewards || 0}
            icon={<CheckCircleIcon />}
          />
          <Stat label="Low Stock"
            value={stats?.lowStockCount || 0}
            icon={<ExclamationTriangleIcon />}
          />
          <Stat label="Total Redemptions"
            value={stats?.totalRedemptions || 0}
            icon={<ChartBarIcon />}
          />
        </div>
      </Section>

      {/* Rewards Grid */}
      {filteredRewards.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredRewards.map(reward => {
            const category = categories[reward.category as keyof typeof categories] || {
              name: reward.category,
              icon: '📦',
              color: 'bg-gray-100 text-gray-800'
            };
            const tier = reward.tier;
            
            return (
              <Card
                key={reward.id}
                className={!reward.active ? 'opacity-75' : ''}
              >
                <div className="flex items-start justify-between mb-3 sm:mb-4">
                  <div className="min-w-0 flex-1 mr-2">
                    <div className="flex items-center space-x-2 mb-2">
                      <Badge variant="secondary" className={category.color}>
                        {category.icon} {category.name}
                      </Badge>
                      {!reward.active && (
                        <Badge variant="secondary">
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <CardTitle className="text-base sm:text-lg line-clamp-2">{reward.name}</CardTitle>
                    <CardDescription className="line-clamp-2">{reward.description}</CardDescription>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => startEdit(reward)}
                      leftIcon={<PencilIcon className="h-4 w-4" />}
                      iconOnly
                      aria-label="Edit reward"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDeleteConfirmId(reward.id)}
                      leftIcon={<TrashIcon className="h-4 w-4" />}
                      iconOnly
                      className="text-red-600 hover:text-red-700"
                      aria-label="Delete reward"
                    />
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
                  <Button
                    size="sm"
                    variant={reward.active ? "secondary" : "primary"}
                    onClick={() => toggleActive(reward)}
                  >
                    {reward.active ? 'Deactivate' : 'Activate'}
                  </Button>
                  
                  {reward.inventory !== undefined && reward.inventory < 10 && (
                    <Button
                      size="sm"
                      variant="link"
                      onClick={() => {
                        const newInventory = window.prompt('Enter new inventory level:', '100');
                        if (newInventory && !isNaN(parseInt(newInventory))) {
                          handleRestockReward(reward.id, parseInt(newInventory));
                        }
                      }}
                    >
                      Restock →
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<GiftIcon className="h-12 w-12" />}
          title="No rewards found"
          description={
            filter !== 'all' || categoryFilter !== 'all' 
              ? 'Try adjusting your filters'
              : 'Get started by creating a new reward'
          }
          action={
            filter === 'all' && categoryFilter === 'all' && (
              <Button onClick={() => setShowForm(true)} leftIcon={<PlusIcon className="h-4 w-4" />}>
                Add First Reward
              </Button>
            )
          }
        />
      )}

      {/* Add/Edit Form Modal */}
      <Modal
        open={showForm}
        onClose={resetForm}
        title={editingReward ? 'Edit Reward' : 'Add New Reward'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormGroup label="Name" required>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </FormGroup>
          
          <FormGroup label="Description">
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
            />
          </FormGroup>
          
          <div className="grid grid-cols-2 gap-4">
            <FormGroup label="Category" required>
              <Select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                options={Object.entries(categories).map(([key, cat]) => ({
                  value: key,
                  label: `${cat.icon} ${cat.name}`
                }))}
              />
            </FormGroup>
            
            <FormGroup label="Points Cost" required>
              <Input
                type="number"
                min="1"
                value={formData.points_cost}
                onChange={(e) => setFormData({ ...formData, points_cost: parseInt(e.target.value) })}
                required
              />
            </FormGroup>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <FormGroup label="Inventory" help="Leave blank for unlimited">
              <Input
                type="number"
                min="0"
                value={formData.inventory || ''}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  inventory: e.target.value ? parseInt(e.target.value) : undefined 
                })}
                placeholder="Unlimited"
              />
            </FormGroup>
            
            <FormGroup label="Daily Limit" help="Per customer">
              <Input
                type="number"
                min="1"
                value={formData.daily_limit || ''}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  daily_limit: e.target.value ? parseInt(e.target.value) : undefined 
                })}
                placeholder="No limit"
              />
            </FormGroup>
          </div>
          
          <FormGroup label="Required Tier" help="Minimum tier to redeem">
            <Select
              value={formData.tier_required || ''}
              onChange={(e) => setFormData({ ...formData, tier_required: e.target.value || undefined })}
              options={[
                { value: '', label: 'Available to all tiers' },
                ...Object.entries(LOYALTY_CONFIG.tiers).map(([key, tier]) => ({
                  value: key,
                  label: `${tier.icon} ${tier.name} and above`
                }))
              ]}
            />
          </FormGroup>
          
          <Checkbox
            id="active"
            checked={formData.active}
            onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
            label="Active (available for redemption)"
          />
          
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={resetForm}>
              Cancel
            </Button>
            <Button type="submit">
              {editingReward ? 'Update Reward' : 'Create Reward'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
        title="Delete Reward"
        message="Are you sure you want to delete this reward? This action cannot be undone."
        confirmText="Delete"
        type="danger"
      />
    </Page>
  );
}