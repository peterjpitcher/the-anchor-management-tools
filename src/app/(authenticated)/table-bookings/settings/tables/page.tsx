'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { PlusIcon, PencilIcon, TrashIcon, TableCellsIcon } from '@heroicons/react/24/outline';
import { 
  getTables, 
  createTable, 
  updateTable, 
  deleteTable,
  getTableCombinations,
  createTableCombination,
  deleteTableCombination 
} from '@/app/actions/table-configuration';
import { TableConfiguration, TableCombination } from '@/types/table-bookings';

// UI v2 Components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';
import { Modal } from '@/components/ui-v2/overlay/Modal';
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog';
import { Badge } from '@/components/ui-v2/display/Badge';
import { toast } from '@/components/ui-v2/feedback/Toast';

export default function TableConfigurationPage() {
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [tables, setTables] = useState<TableConfiguration[]>([]);
  const [combinations, setCombinations] = useState<TableCombination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddTable, setShowAddTable] = useState(false);
  const [showAddCombination, setShowAddCombination] = useState(false);
  const [editingTable, setEditingTable] = useState<TableConfiguration | null>(null);
  const [processing, setProcessing] = useState(false);
  const [tableToDelete, setTableToDelete] = useState<string | null>(null);
  const [combinationToDelete, setCombinationToDelete] = useState<string | null>(null);

  // Form state
  const [tableName, setTableName] = useState('');
  const [tableCapacity, setTableCapacity] = useState(2);
  const [isOutdoor, setIsOutdoor] = useState(false);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);

  const canManage = hasPermission('table_bookings', 'manage');

  useEffect(() => {
    if (canManage) {
      loadData();
    }
  }, [canManage]);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);

      const [tablesResult, combinationsResult] = await Promise.all([
        getTables(),
        getTableCombinations()
      ]);

      if (tablesResult.error) throw new Error(tablesResult.error);
      if (combinationsResult.error) throw new Error(combinationsResult.error);

      setTables(tablesResult.data || []);
      setCombinations(combinationsResult.data || []);
    } catch (err: any) {
      console.error('Error loading data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddTable(e: React.FormEvent) {
    e.preventDefault();
    
    try {
      setProcessing(true);
      setError(null);

      const formData = new FormData();
      formData.append('table_number', tableName);
      formData.append('capacity', tableCapacity.toString());
      formData.append('is_active', 'true');
      formData.append('notes', isOutdoor ? 'Outdoor table' : '');

      const result = await createTable(formData);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        await loadData();
        setShowAddTable(false);
        setTableName('');
        setTableCapacity(2);
        setIsOutdoor(false);
        toast.success('Table created successfully');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleUpdateTable(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTable) return;
    
    try {
      setProcessing(true);
      setError(null);

      const formData = new FormData();
      formData.append('table_number', tableName);
      formData.append('capacity', tableCapacity.toString());
      formData.append('is_active', editingTable.is_active.toString());
      formData.append('notes', isOutdoor ? 'Outdoor table' : '');

      const result = await updateTable(editingTable.id, formData);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        await loadData();
        setEditingTable(null);
        setTableName('');
        setTableCapacity(2);
        setIsOutdoor(false);
        toast.success('Table updated successfully');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleDeleteTable(tableId: string) {
    try {
      setProcessing(true);
      setError(null);

      const result = await deleteTable(tableId);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        await loadData();
        toast.success('Table deleted successfully');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
      setTableToDelete(null);
    }
  }

  async function handleAddCombination(e: React.FormEvent) {
    e.preventDefault();
    
    if (selectedTables.length < 2) {
      toast.error('Please select at least 2 tables to combine');
      return;
    }
    
    try {
      setProcessing(true);
      setError(null);

      const formData = new FormData();
      formData.append('table_ids', JSON.stringify(selectedTables));
      formData.append('name', selectedTables.map(id => 
        tables.find(t => t.id === id)?.table_number || ''
      ).join(' + '));
      formData.append('is_active', 'true');

      const result = await createTableCombination(formData);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        await loadData();
        setShowAddCombination(false);
        setSelectedTables([]);
        toast.success('Table combination created successfully');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
    }
  }

  async function handleDeleteCombination(combinationId: string) {
    try {
      setProcessing(true);
      setError(null);

      const result = await deleteTableCombination(combinationId);
      
      if (result.error) {
        toast.error(result.error);
      } else {
        await loadData();
        toast.success('Table combination deleted successfully');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
      setCombinationToDelete(null);
    }
  }

  if (!canManage) {
    return (
      <Page title="Table Configuration">
        <Alert variant="error">
          You do not have permission to manage table configuration.
        </Alert>
      </Page>
    );
  }

  if (loading) {
    return (
      <Page title="Table Configuration">
        <div className="flex items-center justify-center min-h-[400px]">
          <Spinner size="lg" />
        </div>
      </Page>
    );
  }

  return (
    <Page 
      title="Table Configuration"
      description="Manage restaurant tables, capacities, and combinations"
      actions={
        <Button
          onClick={() => setShowAddTable(true)}
          leftIcon={<PlusIcon className="h-5 w-5" />}
        >
          Add Table
        </Button>
      }
    >
      <LinkButton href="/table-bookings/settings" variant="secondary">Back to Settings</LinkButton>

      {error && (
        <Alert variant="error" className="mt-4">
          {error}
        </Alert>
      )}

      {/* Tables Section */}
      <Section title="Restaurant Tables" className="mt-6">
        <Card>
          {tables.length === 0 ? (
            <EmptyState icon={<TableCellsIcon className="h-12 w-12" />}
              title="No tables configured"
              description="Add your first table to get started"
              action={
                <Button
                  onClick={() => setShowAddTable(true)}
                  leftIcon={<PlusIcon className="h-5 w-5" />}
                >
                  Add Table
                </Button>
              }
            />
          ) : (
            <div className="divide-y">
              {tables.map((table) => (
                <div key={table.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <TableCellsIcon className="h-6 w-6 text-gray-400" />
                    <div>
                      <p className="font-medium">{table.table_number}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm text-gray-600">
                          Capacity: {table.capacity}
                        </span>
                        {table.notes?.includes('Outdoor') && (
                          <Badge variant="info">Outdoor</Badge>
                        )}
                        {!table.is_active && (
                          <Badge variant="error">Inactive</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditingTable(table);
                        setTableName(table.table_number);
                        setTableCapacity(table.capacity);
                        setIsOutdoor(table.notes?.includes('Outdoor') || false);
                      }}
                      leftIcon={<PencilIcon className="h-4 w-4" />}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setTableToDelete(table.id)}
                      disabled={processing}
                      leftIcon={<TrashIcon className="h-4 w-4" />}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      {/* Table Combinations Section */}
      <Section 
        title="Table Combinations" 
        className="mt-8"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAddCombination(true)}
            leftIcon={<PlusIcon className="h-4 w-4" />}
          >
            Add Combination
          </Button>
        }
      >
        <Card>
          {combinations.length === 0 ? (
            <EmptyState
              title="No table combinations configured"
              description="Create combinations for joining tables together"
            />
          ) : (
            <div className="divide-y">
              {combinations.map((combination) => (
                <div key={combination.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{combination.name}</p>
                    <p className="text-sm text-gray-600">
                      Total capacity: {combination.total_capacity}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setCombinationToDelete(combination.id)}
                    disabled={processing}
                    leftIcon={<TrashIcon className="h-4 w-4" />}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      {/* Add Table Modal */}
      <Modal
        open={showAddTable}
        onClose={() => {
          setShowAddTable(false);
          setTableName('');
          setTableCapacity(2);
          setIsOutdoor(false);
        }}
        title="Add New Table"
      >
        <form onSubmit={handleAddTable} className="space-y-4">
          <FormGroup label="Table Name" required>
            <Input
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="e.g., Table 1, Window Table"
              required
            />
          </FormGroup>

          <FormGroup label="Capacity" required>
            <Input
              type="number"
              value={tableCapacity}
              onChange={(e) => setTableCapacity(parseInt(e.target.value))}
              min={1}
              max={20}
              required
            />
          </FormGroup>

          <Checkbox
            checked={isOutdoor}
            onChange={(e) => setIsOutdoor(e.target.checked)}
            label="Outdoor table"
          />

          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={processing}
              loading={processing}
              fullWidth
            >
              Create Table
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowAddTable(false);
                setTableName('');
                setTableCapacity(2);
                setIsOutdoor(false);
              }}
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Table Modal */}
      <Modal
        open={!!editingTable}
        onClose={() => {
          setEditingTable(null);
          setTableName('');
          setTableCapacity(2);
          setIsOutdoor(false);
        }}
        title="Edit Table"
      >
        <form onSubmit={handleUpdateTable} className="space-y-4">
          <FormGroup label="Table Name" required>
            <Input
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              required
            />
          </FormGroup>

          <FormGroup label="Capacity" required>
            <Input
              type="number"
              value={tableCapacity}
              onChange={(e) => setTableCapacity(parseInt(e.target.value))}
              min={1}
              max={20}
              required
            />
          </FormGroup>

          <Checkbox
            checked={isOutdoor}
            onChange={(e) => setIsOutdoor(e.target.checked)}
            label="Outdoor table"
          />

          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={processing}
              loading={processing}
              fullWidth
            >
              Update Table
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditingTable(null);
                setTableName('');
                setTableCapacity(2);
                setIsOutdoor(false);
              }}
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add Combination Modal */}
      <Modal
        open={showAddCombination}
        onClose={() => {
          setShowAddCombination(false);
          setSelectedTables([]);
        }}
        title="Create Table Combination"
      >
        <form onSubmit={handleAddCombination} className="space-y-4">
          <FormGroup label="Select Tables to Combine" required>
            <div className="space-y-2 max-h-60 overflow-y-auto border rounded-lg p-3">
              {tables.filter(t => t.is_active).map((table) => (
                <Checkbox
                  key={table.id}
                  checked={selectedTables.includes(table.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedTables([...selectedTables, table.id]);
                    } else {
                      setSelectedTables(selectedTables.filter(id => id !== table.id));
                    }
                  }}
                  label={`${table.table_number} (Capacity: ${table.capacity})`}
                />
              ))}
            </div>
          </FormGroup>

          {selectedTables.length >= 2 && (
            <Alert variant="info">
              Combined capacity: {
                selectedTables.reduce((sum, id) => {
                  const table = tables.find(t => t.id === id);
                  return sum + (table?.capacity || 0);
                }, 0)
              }
            </Alert>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={processing || selectedTables.length < 2}
              loading={processing}
              fullWidth
            >
              Create Combination
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowAddCombination(false);
                setSelectedTables([]);
              }}
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Table Confirmation */}
      <ConfirmDialog
        open={!!tableToDelete}
        onClose={() => setTableToDelete(null)}
        onConfirm={() => tableToDelete && handleDeleteTable(tableToDelete)}
        title="Delete Table"
        message="Are you sure you want to delete this table? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
      />

      {/* Delete Combination Confirmation */}
      <ConfirmDialog
        open={!!combinationToDelete}
        onClose={() => setCombinationToDelete(null)}
        onConfirm={() => combinationToDelete && handleDeleteCombination(combinationToDelete)}
        title="Delete Table Combination"
        message="Are you sure you want to delete this combination? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
      />
    </Page>
  );
}