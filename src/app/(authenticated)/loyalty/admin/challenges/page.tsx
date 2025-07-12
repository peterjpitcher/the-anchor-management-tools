'use client';

import { useState, useEffect } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { 
  CalendarDaysIcon, 
  PlusIcon, 
  PencilIcon, 
  TrashIcon,
  XMarkIcon,
  CheckCircleIcon,
  ClockIcon,
  UserGroupIcon,
  DocumentDuplicateIcon,
  FireIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { LoyaltyChallenge, ChallengeFormData } from '@/types/loyalty';
import { 
  getChallenges, 
  getChallengeStats, 
  createChallenge, 
  updateChallenge, 
  deleteChallenge,
  duplicateChallenge
} from '@/app/actions/loyalty-challenges';

export default function ChallengeManagementPage() {
  const { hasPermission } = usePermissions();
  const [challenges, setChallenges] = useState<LoyaltyChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingChallenge, setEditingChallenge] = useState<LoyaltyChallenge | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'upcoming' | 'past'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'monthly' | 'seasonal' | 'special'>('all');
  const [stats, setStats] = useState<any>(null);

  // Form state
  const [formData, setFormData] = useState<ChallengeFormData>({
    name: '',
    description: '',
    category: 'monthly',
    points_value: 100,
    criteria: {},
    start_date: '',
    end_date: '',
    max_completions: 1,
    icon: undefined,
    sort_order: undefined,
    active: true
  });

  useEffect(() => {
    loadChallenges();
  }, []);

  const loadChallenges = async () => {
    setLoading(true);
    try {
      const [challengesResult, statsResult] = await Promise.all([
        getChallenges(),
        getChallengeStats()
      ]);
      
      if (challengesResult.error) {
        toast.error(challengesResult.error);
      } else if (challengesResult.data) {
        setChallenges(challengesResult.data);
      }
      
      if (statsResult.data) {
        setStats(statsResult.data);
      }
    } catch (error) {
      console.error('Error loading challenges:', error);
      toast.error('Failed to load challenges');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (editingChallenge) {
        // Update existing challenge
        const result = await updateChallenge(editingChallenge.id, formData);
        if (result.error) {
          toast.error(result.error);
        } else if (result.success) {
          toast.success('Challenge updated successfully');
          resetForm();
          loadChallenges();
        }
      } else {
        // Create new challenge
        const result = await createChallenge(formData);
        if (result.error) {
          toast.error(result.error);
        } else if (result.success) {
          toast.success('Challenge created successfully');
          resetForm();
          loadChallenges();
        }
      }
    } catch (error) {
      toast.error('Failed to save challenge');
    }
  };

  const handleDelete = async (challengeId: string) => {
    if (!window.confirm('Are you sure you want to delete this challenge?')) {
      return;
    }
    
    try {
      const result = await deleteChallenge(challengeId);
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success('Challenge deleted successfully');
        loadChallenges();
      }
    } catch (error) {
      toast.error('Failed to delete challenge');
    }
  };

  const handleDuplicate = async (challengeId: string) => {
    try {
      const result = await duplicateChallenge(challengeId);
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success('Challenge duplicated successfully');
        loadChallenges();
      }
    } catch (error) {
      toast.error('Failed to duplicate challenge');
    }
  };

  const toggleActive = async (challenge: LoyaltyChallenge) => {
    try {
      const result = await updateChallenge(challenge.id, {
        ...challenge,
        active: !challenge.active
      });
      if (result.error) {
        toast.error(result.error);
      } else if (result.success) {
        toast.success('Challenge status updated');
        loadChallenges();
      }
    } catch (error) {
      toast.error('Failed to update challenge status');
    }
  };

  const resetForm = () => {
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
    
    setFormData({
      name: '',
      description: '',
      category: 'monthly',
      points_value: 100,
      criteria: {},
      start_date: today.toISOString().split('T')[0],
      end_date: nextMonth.toISOString().split('T')[0],
      max_completions: 1,
      icon: undefined,
      sort_order: undefined,
      active: true
    });
    setEditingChallenge(null);
    setShowForm(false);
  };

  const startEdit = (challenge: LoyaltyChallenge) => {
    setFormData({
      name: challenge.name,
      description: challenge.description || '',
      category: challenge.category,
      points_value: challenge.points_value,
      criteria: challenge.criteria,
      start_date: challenge.start_date.split('T')[0],
      end_date: challenge.end_date.split('T')[0],
      max_completions: challenge.max_completions,
      icon: challenge.icon,
      sort_order: challenge.sort_order,
      active: challenge.active
    });
    setEditingChallenge(challenge);
    setShowForm(true);
  };

  const getChallengeStatus = (challenge: LoyaltyChallenge) => {
    const now = new Date();
    const start = new Date(challenge.start_date);
    const end = new Date(challenge.end_date);
    
    if (!challenge.active) return 'inactive';
    if (now < start) return 'upcoming';
    if (now > end) return 'past';
    return 'active';
  };

  if (!hasPermission('loyalty', 'manage')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">You don&apos;t have permission to manage challenges.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading challenges...</p>
        </div>
      </div>
    );
  }

  // Filter challenges
  const filteredChallenges = challenges.filter(challenge => {
    const status = getChallengeStatus(challenge);
    
    if (filter === 'active' && status !== 'active') return false;
    if (filter === 'upcoming' && status !== 'upcoming') return false;
    if (filter === 'past' && status !== 'past') return false;
    if (categoryFilter !== 'all' && challenge.category !== categoryFilter) return false;
    return true;
  });

  const categoryInfo = {
    monthly: { name: 'Monthly', icon: '📅', color: 'bg-blue-100 text-blue-800' },
    seasonal: { name: 'Seasonal', icon: '🌸', color: 'bg-green-100 text-green-800' },
    special: { name: 'Special', icon: '⭐', color: 'bg-purple-100 text-purple-800' }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Challenge Management</h1>
            <p className="mt-1 text-gray-500">
              Create and manage time-limited loyalty challenges
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
              Add Challenge
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">Status:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 sm:text-sm"
          >
            <option value="all">All Challenges</option>
            <option value="active">Active</option>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
          </select>
        </div>
        
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">Category:</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as any)}
            className="rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500 sm:text-sm"
          >
            <option value="all">All Categories</option>
            <option value="monthly">Monthly</option>
            <option value="seasonal">Seasonal</option>
            <option value="special">Special</option>
          </select>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <CalendarDaysIcon className="h-8 w-8 text-amber-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Total Challenges</p>
              <p className="text-xl font-semibold">{stats?.totalChallenges || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <FireIcon className="h-8 w-8 text-red-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Active Now</p>
              <p className="text-xl font-semibold">{stats?.activeChallenges || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <ClockIcon className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Upcoming</p>
              <p className="text-xl font-semibold">{stats?.upcomingChallenges || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <UserGroupIcon className="h-8 w-8 text-green-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Participants</p>
              <p className="text-xl font-semibold">{stats?.totalParticipants || 0}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <CheckCircleIcon className="h-8 w-8 text-purple-600 mr-3" />
            <div>
              <p className="text-sm text-gray-500">Completions</p>
              <p className="text-xl font-semibold">{stats?.totalCompletions || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Challenges Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredChallenges.map(challenge => {
          const status = getChallengeStatus(challenge);
          const category = categoryInfo[challenge.category];
          const start = new Date(challenge.start_date);
          const end = new Date(challenge.end_date);
          const now = new Date();
          const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          
          return (
            <div 
              key={challenge.id}
              className={`bg-white rounded-lg shadow-sm border ${
                status === 'inactive' ? 'border-gray-300 opacity-75' : 
                status === 'active' ? 'border-amber-400' : 
                'border-gray-200'
              }`}
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${category.color}`}>
                        {category.icon} {category.name}
                      </span>
                      {status === 'active' && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Active
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
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      {challenge.icon && (
                        <span className="text-2xl">{challenge.icon}</span>
                      )}
                      <h3 className="text-lg font-semibold text-gray-900">{challenge.name}</h3>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{challenge.description}</p>
                  </div>
                  <div className="flex items-center space-x-1 ml-4">
                    <button
                      onClick={() => startEdit(challenge)}
                      className="p-1 text-gray-400 hover:text-gray-600"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDuplicate(challenge.id)}
                      className="p-1 text-gray-400 hover:text-gray-600"
                      title="Duplicate challenge"
                    >
                      <DocumentDuplicateIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(challenge.id)}
                      className="p-1 text-gray-400 hover:text-red-600"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Points Value:</span>
                    <span className="font-semibold text-amber-600">{challenge.points_value} pts</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Date Range:</span>
                    <span className="font-medium text-xs">
                      {start.toLocaleDateString()} - {end.toLocaleDateString()}
                    </span>
                  </div>

                  {status === 'active' && daysLeft > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Time Left:</span>
                      <span className="font-medium text-red-600">
                        {daysLeft} day{daysLeft !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}

                  {challenge.max_completions > 1 && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Max Completions:</span>
                      <span className="font-medium">{challenge.max_completions}</span>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="text-gray-500">Criteria Type:</span>
                    <span className="font-medium">{challenge.criteria.type || 'Custom'}</span>
                  </div>
                </div>

                <div className="mt-4">
                  <button
                    onClick={() => toggleActive(challenge)}
                    className={`w-full inline-flex justify-center items-center px-3 py-1 border rounded-md text-xs font-medium ${
                      challenge.active
                        ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
                        : 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100'
                    }`}
                  >
                    {challenge.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {filteredChallenges.length === 0 && (
        <div className="text-center py-12">
          <CalendarDaysIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No challenges found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {filter !== 'all' || categoryFilter !== 'all' 
              ? 'Try adjusting your filters'
              : 'Get started by creating a new challenge'
            }
          </p>
          {filter === 'all' && categoryFilter === 'all' && (
            <div className="mt-6">
              <button
                onClick={() => {
                  resetForm();
                  setShowForm(true);
                }}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                Add First Challenge
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
                  {editingChallenge ? 'Edit Challenge' : 'Add New Challenge'}
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
                    placeholder="🎯"
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
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category *
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="seasonal">Seasonal</option>
                    <option value="special">Special</option>
                  </select>
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Completions
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.max_completions || 1}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      max_completions: parseInt(e.target.value) || 1
                    })}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                  />
                </div>
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
                  <option value="event_attendance">Event Attendance During Period</option>
                  <option value="event_count">Total Event Count</option>
                  <option value="category_attendance">Category Attendance</option>
                  <option value="bring_friends">Bring New Friends</option>
                  <option value="try_new_event">Try New Event Type</option>
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
                      criteria: { ...formData.criteria, count: parseInt(e.target.value) }
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

              {formData.criteria.type === 'bring_friends' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Number of New Friends Required
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.criteria.friends_count || ''}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      criteria: { ...formData.criteria, friends_count: parseInt(e.target.value) }
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
                      Active (visible to members)
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
                  {editingChallenge ? 'Update Challenge' : 'Create Challenge'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}