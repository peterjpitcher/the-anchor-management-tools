'use client'

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { BackButton } from '@/components/ui-v2/navigation/BackButton';
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper';
import { 
  TrophyIcon, 
  PlusIcon, 
  PencilIcon, 
  TrashIcon,
  XMarkIcon,
  CheckCircleIcon,
  UserGroupIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { LoyaltyAchievement, AchievementFormData } from '@/types/loyalty';
import { 
  getAchievements, 
  getAchievementStats, 
  createAchievement, 
  updateAchievement, 
  deleteAchievement,
  getAchievementCategories
} from '@/app/actions/loyalty-achievements';

export default function AchievementManagementPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [achievements, setAchievements] = useState<LoyaltyAchievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAchievement, setEditingAchievement] = useState<LoyaltyAchievement | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');
  const [stats, setStats] = useState<any>(null);
  const [categories, setCategories] = useState<string[]>([]);

  // Form state
  const [formData, setFormData] = useState<AchievementFormData>({
    name: '',
    description: '',
    category: '',
    points_value: 50,
    criteria: {},
    icon: undefined,
    sort_order: undefined,
    active: true
  });

  useEffect(() => {
    loadAchievements();
  }, []);

  const loadAchievements = async () => {
    setLoading(true);
    try {
      const [achievementsResult, statsResult, categoriesResult] = await Promise.all([
        getAchievements(),
        getAchievementStats(),
        getAchievementCategories()
      ]);
      
      if (achievementsResult.error) {
        toast.error(achievementsResult.error);
      } else if (achievementsResult.data) {
        setAchievements(achievementsResult.data);
      }
      
      if (statsResult.data) {
        setStats(statsResult.data);
      }

      if (categoriesResult.data) {
        setCategories(categoriesResult.data.map(c => c.name));
      }
    } catch (error) {
      console.error('Error loading achievements:', error);
      toast.error('Failed to load achievements');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (editingAchievement) {
        // Update existing achievement
        const result = await updateAchievement(editingAchievement.id, formData);
        if (result.error) {
          toast.error(result.error);
        } else if (result.success) {
          toast.success('Achievement updated successfully');
          resetForm();
          loadAchievements();
        }
      } else {
        // Create new achievement
        const result = await createAchievement(formData);
        if (result.error) {
          toast.error(result.error);
        } else if (result.success) {
          toast.success('Achievement created successfully');
          resetForm();
          loadAchievements();
        }
      }
    } catch (error) {
      toast.error('Failed to save achievement');
    }
  };

  const handleDelete = async (achievementId: string) => {
    if (!window.confirm('Are you sure you want to delete this achievement?')) {
      return;
    }
    
    try {
      const result = await deleteAchievement(achievementId);
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success('Achievement deleted successfully');
        loadAchievements();
      }
    } catch (error) {
      toast.error('Failed to delete achievement');
    }
  };

  const toggleActive = async (achievement: LoyaltyAchievement) => {
    try {
      const result = await updateAchievement(achievement.id, {
        ...achievement,
        active: !achievement.active
      });
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success('Achievement status updated');
        loadAchievements();
      }
    } catch (error) {
      toast.error('Failed to update achievement status');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      category: '',
      points_value: 50,
      criteria: {},
      icon: undefined,
      sort_order: undefined,
      active: true
    });
    setEditingAchievement(null);
    setShowForm(false);
  };

  const startEdit = (achievement: LoyaltyAchievement) => {
    setFormData({
      name: achievement.name,
      description: achievement.description || '',
      category: achievement.category || '',
      points_value: achievement.points_value,
      criteria: achievement.criteria,
      icon: achievement.icon,
      sort_order: achievement.sort_order,
      active: achievement.active
    });
    setEditingAchievement(achievement);
    setShowForm(true);
  };

  if (!hasPermission('loyalty', 'manage')) {
    return (
      <PageWrapper>
        <PageHeader
          title="Achievement Management"
          subtitle="Create and manage loyalty program achievements"
          backButton={{ label: "Back to Dashboard", href: "/loyalty/admin" }}
        />
        <PageContent>
          <div className="flex items-center justify-center min-h-screen">
            <p className="text-gray-500">You don&apos;t have permission to manage achievements.</p>
          </div>
        </PageContent>
      </PageWrapper>
    );
  }

  if (loading) {
    return (
      <PageWrapper>
        <PageHeader
          title="Achievement Management"
          subtitle="Create and manage loyalty program achievements"
          backButton={{ label: "Back to Dashboard", href: "/loyalty/admin" }}
        />
        <PageContent>
          <div className="flex items-center justify-center min-h-screen">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading achievements...</p>
            </div>
          </div>
        </PageContent>
      </PageWrapper>
    );
  }

  // Filter achievements
  const filteredAchievements = achievements.filter(achievement => {
    if (filter === 'active' && !achievement.active) return false;
    if (filter === 'inactive' && achievement.active) return false;
    if (categoryFilter !== 'all' && achievement.category !== categoryFilter) return false;
    return true;
  });

  // Group achievements by category
  const groupedAchievements = filteredAchievements.reduce((acc, achievement) => {
    const category = achievement.category || 'Uncategorized';
    if (!acc[category]) acc[category] = [];
    acc[category].push(achievement);
    return acc;
  }, {} as Record<string, LoyaltyAchievement[]>);

  return (
    <PageWrapper>
      <PageHeader
        title="Achievement Management"
        subtitle="Create and manage loyalty program achievements"
        backButton={{ label: "Back to Dashboard", href: "/loyalty/admin" }}
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Add Achievement
          </button>
        }
      />
      <PageContent>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">Status:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 sm:text-sm"
          >
            <option value="all">All Achievements</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>
        
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">Category:</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 sm:text-sm"
          >
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <TrophyIcon className="h-8 w-8 text-amber-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Total Achievements</p>
              <p className="text-xl font-semibold">{stats?.totalAchievements || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <CheckCircleIcon className="h-8 w-8 text-green-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Active</p>
              <p className="text-xl font-semibold">{stats?.activeAchievements || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <SparklesIcon className="h-8 w-8 text-purple-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Total Unlocks</p>
              <p className="text-xl font-semibold">{stats?.totalUnlocks || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <UserGroupIcon className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Members with Achievements</p>
              <p className="text-xl font-semibold">{stats?.membersWithAchievements || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Achievements by Category */}
      <div className="space-y-8">
        {Object.entries(groupedAchievements).map(([category, categoryAchievements]) => (
          <div key={category}>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {category} ({categoryAchievements.length})
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {categoryAchievements.map(achievement => (
                <div 
                  key={achievement.id}
                  className={`bg-white rounded-lg shadow-sm border ${
                    achievement.active ? 'border-gray-200' : 'border-gray-300 opacity-75'
                  }`}
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          {achievement.icon && (
                            <span className="text-2xl">{achievement.icon}</span>
                          )}
                          <h3 className="text-lg font-semibold text-gray-900">{achievement.name}</h3>
                        </div>
                        <p className="text-sm text-gray-500">{achievement.description}</p>
                        {!achievement.active && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 mt-2">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-1 ml-4">
                        <button
                          onClick={() => startEdit(achievement)}
                          className="p-1 text-gray-400 hover:text-gray-600"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(achievement.id)}
                          className="p-1 text-gray-400 hover:text-red-600"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Points Value:</span>
                        <span className="font-semibold text-amber-600">{achievement.points_value} pts</span>
                      </div>
                      
                      <div className="flex items-center justify-between pt-2 border-t">
                        <span className="text-gray-500">Criteria Type:</span>
                        <span className="font-medium">{achievement.criteria.type || 'Custom'}</span>
                      </div>
                    </div>

                    <div className="mt-4">
                      <button
                        onClick={() => toggleActive(achievement)}
                        className={`w-full inline-flex justify-center items-center px-3 py-1 border rounded-md text-xs font-medium ${
                          achievement.active
                            ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                            : 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100'
                        }`}
                      >
                        {achievement.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredAchievements.length === 0 && (
        <div className="text-center py-12">
          <TrophyIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No achievements found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {filter !== 'all' || categoryFilter !== 'all' 
              ? 'Try adjusting your filters'
              : 'Get started by creating a new achievement'
            }
          </p>
          {filter === 'all' && categoryFilter === 'all' && (
            <div className="mt-6">
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                Add First Achievement
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b sticky top-0 bg-white">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">
                  {editingAchievement ? 'Edit Achievement' : 'Add New Achievement'}
                </h2>
                <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Icon (Emoji)
                  </label>
                  <input
                    type="text"
                    value={formData.icon || ''}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value || undefined })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    placeholder="🏆"
                    maxLength={2}
                  />
                </div>
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
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category *
                  </label>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    placeholder="e.g., Quiz Master, Event Explorer"
                    required
                    list="category-suggestions"
                  />
                  <datalist id="category-suggestions">
                    {categories.map(cat => (
                      <option key={cat} value={cat} />
                    ))}
                  </datalist>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Points Value *
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.points_value}
                    onChange={(e) => setFormData({ ...formData, points_value: parseInt(e.target.value) })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    required
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Criteria Type *
                </label>
                <select
                  value={formData.criteria.type || ''}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    criteria: { ...formData.criteria, type: e.target.value }
                  })}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                  required
                >
                  <option value="">Select criteria type</option>
                  <option value="event_attendance">Event Attendance</option>
                  <option value="event_count">Event Count</option>
                  <option value="category_attendance">Category Attendance</option>
                  <option value="consecutive_months">Consecutive Months</option>
                  <option value="referrals">Referrals</option>
                  <option value="manual">Manual Award</option>
                </select>
              </div>

              {/* Dynamic criteria fields based on type */}
              {formData.criteria.type === 'event_count' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Required Event Count
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.criteria.count || ''}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      criteria: { ...formData.criteria, badge: parseInt(e.target.value) }
                    })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    required
                  />
                </div>
              )}

              {formData.criteria.type === 'category_attendance' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Event Category
                  </label>
                  <input
                    type="text"
                    value={formData.criteria.category || ''}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      criteria: { ...formData.criteria, category: e.target.value }
                    })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    placeholder="e.g., Quiz Night, Bingo"
                    required
                  />
                </div>
              )}

              {formData.criteria.type === 'consecutive_months' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Required Consecutive Months
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.criteria.months || ''}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      criteria: { ...formData.criteria, months: parseInt(e.target.value) }
                    })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    required
                  />
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Sort Order (optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.sort_order || ''}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      sort_order: e.target.value ? parseInt(e.target.value) : undefined 
                    })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                    placeholder="0"
                  />
                </div>
                
                <div className="flex items-end">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="active"
                      checked={formData.active}
                      onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                      className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
                    />
                    <label htmlFor="active" className="ml-2 block text-sm text-gray-900">
                      Active (can be earned)
                    </label>
                  </div>
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
                  {editingAchievement ? 'Update Achievement' : 'Create Achievement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </PageContent>
    </PageWrapper>
  );
}