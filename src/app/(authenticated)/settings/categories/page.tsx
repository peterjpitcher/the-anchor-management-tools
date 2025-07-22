'use client'

import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { PlusIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline';
// New UI components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Form } from '@/components/ui-v2/forms/Form';
import { Input } from '@/components/ui-v2/forms/Input';
import { Button } from '@/components/ui-v2/forms/Button';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';

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
    return (
      <Page title="Attachment Categories" breadcrumbs={[
        { label: 'Settings', href: '/settings' },
        { label: 'Categories' }
      ]}>
        <div className="flex items-center justify-center p-8">
          <Spinner />
        </div>
      </Page>
    );
  }

  return (
    <Page 
      title="Attachment Categories"
      breadcrumbs={[
        { label: 'Settings', href: '/settings' },
        { label: 'Categories' }
      ]}
      actions={
        <LinkButton
          href="/employees"
          variant="secondary"
        >
          Back to Employees
        </LinkButton>
      }
    >
      <p className="text-sm text-gray-700 mb-6">
        Manage categories for employee attachment files.
      </p>

      {error && (
        <Alert variant="error"
          title="Error"
          description={error}
          className="mb-6"
        />
      )}

      <Section title="Add New Category">
        <Card>
          <Form onSubmit={handleAddCategory}>
            <div className="flex gap-2">
              <Input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category name"
                className="flex-1"
              />
              <Button type="submit"
                leftIcon={<PlusIcon className="h-4 w-4" />}
              >
                Add Category
              </Button>
            </div>
          </Form>
        </Card>
      </Section>

      <Section title="Categories">
        <Card>
          {categories.length === 0 ? (
            <EmptyState
              title="No categories defined"
              description="Add your first category above to get started."
            />
          ) : (
            <div className="divide-y divide-gray-200">
              {categories.map((category) => (
                <div key={category.category_id} className="px-4 py-4">
                  {editingId === category.category_id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="flex-1"
                        autoFocus
                      />
                      <Button
                        onClick={() => handleUpdateCategory(category.category_id)}
                        variant="primary"
                        size="sm"
                      >
                        Save
                      </Button>
                      <Button
                        onClick={() => {
                          setEditingId(null);
                          setEditingName('');
                        }}
                        variant="secondary"
                        size="sm"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        {category.category_name}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => {
                            setEditingId(category.category_id);
                            setEditingName(category.category_name);
                          }}
                          variant="secondary"
                          size="sm"
                          iconOnly
                        >
                          <PencilIcon className="h-4 w-4" />
                        </Button>
                        <Button
                          onClick={() => handleDeleteCategory(category.category_id)}
                          variant="secondary"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          iconOnly
                        >
                          <TrashIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>
    </Page>
  );
}