'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { 
  PlusIcon,
  TrashIcon,
  PencilIcon
} from '@heroicons/react/24/outline';

// UI v2 Components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { DataTable } from '@/components/ui-v2/display/DataTable';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Modal } from '@/components/ui-v2/overlay/Modal';
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog';
import { toast } from '@/components/ui-v2/feedback/Toast';

interface SundayLunchMenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category: 'main' | 'side';
  is_active: boolean;
  display_order: number;
  allergens?: string[];
  dietary_info?: string[];
}

export default function SundayLunchMenuPage() {
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuItems, setMenuItems] = useState<SundayLunchMenuItem[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<SundayLunchMenuItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: 25.95,
    category: 'main' as 'main' | 'side',
    is_active: true,
    allergens: '',
    dietary_info: ''
  });

  const canManage = hasPermission('table_bookings', 'manage');

  useEffect(() => {
    if (canManage) {
      loadMenuItems();
    }
  }, [canManage]);

  async function loadMenuItems() {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('sunday_lunch_menu_items')
        .select('*')
        .order('display_order', { ascending: true });
      
      if (error) throw error;
      
      setMenuItems(data || []);
    } catch (err: any) {
      console.error('Error loading menu items:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(item: SundayLunchMenuItem) {
    setEditingItem(item);
    setFormData({
      name: item.name,
      description: item.description || '',
      price: item.price,
      category: item.category,
      is_active: item.is_active,
      allergens: item.allergens?.join(', ') || '',
      dietary_info: item.dietary_info?.join(', ') || ''
    });
    setShowAddModal(true);
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      
      const itemData = {
        name: formData.name,
        description: formData.description || null,
        price: formData.price,
        category: formData.category,
        is_active: formData.is_active,
        display_order: editingItem?.display_order || menuItems.length + 1,
        allergens: formData.allergens ? formData.allergens.split(',').map(a => a.trim()).filter(Boolean) : [],
        dietary_info: formData.dietary_info ? formData.dietary_info.split(',').map(d => d.trim()).filter(Boolean) : []
      };
      
      if (editingItem) {
        // Update existing item
        const { error } = await (supabase
          .from('sunday_lunch_menu_items') as any)
          .update(itemData)
          .eq('id', editingItem.id);
        
        if (error) throw error;
        toast.success('Menu item updated successfully');
      } else {
        // Add new item
        const { error } = await (supabase
          .from('sunday_lunch_menu_items') as any)
          .insert(itemData);
        
        if (error) throw error;
        toast.success('Menu item added successfully');
      }
      
      // Reload menu items to get the latest data
      await loadMenuItems();
      
      // Reset form
      setShowAddModal(false);
      setEditingItem(null);
      setFormData({
        name: '',
        description: '',
        price: 25.95,
        category: 'main',
        is_active: true,
        allergens: '',
        dietary_info: ''
      });
    } catch (err: any) {
      console.error('Save error:', err);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase
        .from('sunday_lunch_menu_items')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      toast.success('Menu item deleted successfully');
      await loadMenuItems();
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error(err.message);
    } finally {
      setItemToDelete(null);
    }
  }

  const layoutProps = {
    title: 'Sunday Lunch Menu Configuration',
    subtitle: 'Manage Sunday lunch menu items and pricing',
    backButton: { label: 'Back to Settings', href: '/table-bookings/settings' },
  };

  if (!canManage) {
    return (
      <PageLayout {...layoutProps}>
        <Alert variant="error" description="You do not have permission to manage the Sunday lunch menu." />
      </PageLayout>
    );
  }

  if (loading) {
    return (
      <PageLayout {...layoutProps} loading loadingLabel="Loading Sunday lunch menu...">
        {null}
      </PageLayout>
    );
  }

  const mainCourses = menuItems.filter(item => item.category === 'main');
  const sides = menuItems.filter(item => item.category === 'side');

  // Define columns for DataTable
  const mainCourseColumns = [
    { key: 'name', header: 'Name', className: 'font-medium', cell: (item: SundayLunchMenuItem) => item.name },
    { key: 'description', header: 'Description', className: 'text-sm text-gray-600', cell: (item: SundayLunchMenuItem) => item.description || '' },
    { 
      key: 'price', 
      header: 'Price',
      cell: (item: SundayLunchMenuItem) => `£${item.price.toFixed(2)}`
    },
    { 
      key: 'allergens', 
      header: 'Allergens',
      cell: (item: SundayLunchMenuItem) => item.allergens?.join(', ') || '-',
      className: 'text-sm'
    },
    { 
      key: 'is_active', 
      header: 'Status',
      cell: (item: SundayLunchMenuItem) => (
        <Badge variant={item.is_active ? 'success' : 'error'}>
          {item.is_active ? 'Active' : 'Inactive'}
        </Badge>
      )
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right' as const,
      cell: (item: SundayLunchMenuItem) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleEdit(item)}
            leftIcon={<PencilIcon className="h-4 w-4" />}
          >
            Edit
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setItemToDelete(item.id)}
            leftIcon={<TrashIcon className="h-4 w-4" />}
          >
            Delete
          </Button>
        </div>
      )
    }
  ];

  const sideColumns = [
    { key: 'name', header: 'Name', className: 'font-medium', cell: (item: SundayLunchMenuItem) => item.name },
    { key: 'description', header: 'Description', className: 'text-sm text-gray-600', cell: (item: SundayLunchMenuItem) => item.description || '' },
    { 
      key: 'allergens', 
      header: 'Allergens',
      cell: (item: SundayLunchMenuItem) => item.allergens?.join(', ') || '-',
      className: 'text-sm'
    },
    { 
      key: 'dietary_info', 
      header: 'Dietary Info',
      cell: (item: SundayLunchMenuItem) => item.dietary_info?.join(', ') || '-',
      className: 'text-sm'
    },
    { 
      key: 'is_active', 
      header: 'Status',
      cell: (item: SundayLunchMenuItem) => (
        <Badge variant={item.is_active ? 'success' : 'error'}>
          {item.is_active ? 'Active' : 'Inactive'}
        </Badge>
      )
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right' as const,
      cell: (item: SundayLunchMenuItem) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleEdit(item)}
            leftIcon={<PencilIcon className="h-4 w-4" />}
          >
            Edit
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setItemToDelete(item.id)}
            leftIcon={<TrashIcon className="h-4 w-4" />}
          >
            Delete
          </Button>
        </div>
      )
    }
  ];

  const headerActions = (
    <Button
      onClick={() => {
        setEditingItem(null);
        setFormData({
          name: '',
          description: '',
          price: 15.49,
          category: 'main',
          is_active: true,
          allergens: '',
          dietary_info: ''
        });
        setShowAddModal(true);
      }}
      leftIcon={<PlusIcon className="h-5 w-5" />}
    >
      Add Menu Item
    </Button>
  );

  return (
    <PageLayout
      {...layoutProps}
      headerActions={headerActions}
    >
      <div className="space-y-6">
        {error && (
          <Alert variant="error" description={error} />
        )}

        {/* Main Courses */}
        <Section title="Main Courses">
          <Card>
            <DataTable
              data={mainCourses}
              columns={mainCourseColumns}
              getRowKey={(item) => item.id}
              emptyMessage="No main courses configured"
            />
          </Card>
        </Section>

        {/* Sides */}
        <Section title="Sides">
          <Card>
            <DataTable
              data={sides}
              columns={sideColumns}
              getRowKey={(item) => item.id}
              emptyMessage="No sides configured"
            />
          </Card>
        </Section>

        {/* Notes */}
        <Alert variant="info">
          <h3 className="mb-2 font-medium">Sunday Lunch Configuration Notes:</h3>
          <ul className="space-y-1 text-sm">
            <li>• Main courses are individually priced (typically £9.99 - £15.99)</li>
            <li>• Each main course includes herb & garlic roast potatoes, seasonal vegetables, Yorkshire pudding and gravy</li>
            <li>• Sides with price £0 are included with main courses</li>
            <li>• Sides with a price (e.g., Cauliflower cheese £3.99) are optional extras</li>
            <li>• Vegetarian gravy available on request</li>
            <li>• Pre-orders must be placed at the bar by 1pm on Saturday</li>
            <li>• Sunday dinners are made from scratch and to order</li>
            <li>• Allergen and dietary information is displayed to customers during booking</li>
          </ul>
        </Alert>
      </div>

      {/* Add/Edit Modal */}
      <Modal
        open={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setEditingItem(null);
        }}
        title={editingItem ? 'Edit Menu Item' : 'Add Menu Item'}
      >
        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-4">
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
              rows={2}
            />
          </FormGroup>
          
          <FormGroup label="Category" required>
            <Select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value as 'main' | 'side' })}
            >
              <option value="main">Main Course</option>
              <option value="side">Side</option>
            </Select>
          </FormGroup>
          
          <FormGroup label="Price" required help="Set to 0 for sides included with main courses">
            <Input
              type="number"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) })}
              step="0.01"
              min="0"
              required
            />
          </FormGroup>
          
          <FormGroup label="Allergens" help="Comma separated list">
            <Input
              value={formData.allergens}
              onChange={(e) => setFormData({ ...formData, allergens: e.target.value })}
              placeholder="Gluten, Nuts, Dairy"
            />
          </FormGroup>
          
          <FormGroup label="Dietary Info" help="Comma separated list">
            <Input
              value={formData.dietary_info}
              onChange={(e) => setFormData({ ...formData, dietary_info: e.target.value })}
              placeholder="Vegan, Gluten-free, Vegetarian"
            />
          </FormGroup>
          
          <Checkbox
            checked={formData.is_active}
            onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
            label="Active"
          />
          
          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={saving || !formData.name}
              loading={saving}
              fullWidth
            >
              Save
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowAddModal(false);
                setEditingItem(null);
              }}
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!itemToDelete}
        onClose={() => setItemToDelete(null)}
        onConfirm={() => itemToDelete && handleDelete(itemToDelete)}
        title="Delete Menu Item"
        message="Are you sure you want to delete this menu item? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
      />
    </PageLayout>
  );
}
