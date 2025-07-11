'use client'

import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { PlusIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import Link from 'next/link';

interface AttachmentCategory {
  category_id: string;
  category_name: string;
  created_at: string;
  updated_at: string;
}

export default function CategoriesPage() {
  const supabase = useSupabase();
  const [categories, setCategories] = useState<AttachmentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const loadCategories = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('attachment_categories')
        .select('*')
        .order('category_name');

      if (error) throw error;
      setCategories(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    try {
      const { error } = await supabase
        .from('attachment_categories')
        .insert({ category_name: newCategoryName.trim() });

      if (error) throw error;
      
      setNewCategoryName('');
      await loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add category');
    }
  }

  async function handleUpdateCategory(categoryId: string) {
    if (!editingName.trim()) return;

    try {
      const { error } = await supabase
        .from('attachment_categories')
        .update({ category_name: editingName.trim() })
        .eq('category_id', categoryId);

      if (error) throw error;
      
      setEditingId(null);
      setEditingName('');
      await loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update category');
    }
  }

  async function handleDeleteCategory(categoryId: string) {
    if (!confirm('Are you sure you want to delete this category? Any attachments using this category will need to be updated.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('attachment_categories')
        .delete()
        .eq('category_id', categoryId);

      if (error) throw error;
      
      await loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete category');
    }
  }

  if (loading) {
    return <LoadingSpinner text="Loading categories..." />;
  }

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">Attachment Categories</h1>
          <p className="mt-2 text-sm text-gray-700">
            Manage categories for employee attachment files.
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <Link
            href="/employees"
            className="inline-flex items-center rounded-md bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-100"
          >
            Back to Employees
          </Link>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="mt-8">
        <form onSubmit={handleAddCategory} className="mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name"
              className="block flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
            />
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500"
            >
              <PlusIcon className="h-4 w-4 mr-1" />
              Add Category
            </button>
          </div>
        </form>

        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {categories.length === 0 ? (
              <li className="px-4 py-4 text-sm text-gray-500">No categories defined yet.</li>
            ) : (
              categories.map((category) => (
                <li key={category.category_id} className="px-4 py-4">
                  {editingId === category.category_id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="block flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                        autoFocus
                      />
                      <button
                        onClick={() => handleUpdateCategory(category.category_id)}
                        className="text-green-600 hover:text-green-900"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEditingName('');
                        }}
                        className="text-gray-600 hover:text-gray-900"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        {category.category_name}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setEditingId(category.category_id);
                            setEditingName(category.category_name);
                          }}
                          className="text-gray-600 hover:text-gray-900"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(category.category_id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}