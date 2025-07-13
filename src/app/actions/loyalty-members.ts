'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { 
  LoyaltyMember, 
  LoyaltyPointTransaction, 
  EventCheckIn,
  LoyaltyMemberFormData 
} from '@/types/loyalty';

// Validation schemas
const EnrollMemberSchema = z.object({
  customer_id: z.string().uuid('Invalid customer ID'),
  join_date: z.string().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional()
});

const UpdateMemberSchema = z.object({
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  notes: z.string().optional()
});

const AdjustPointsSchema = z.object({
  member_id: z.string().uuid('Invalid member ID'),
  points: z.number().int('Points must be a whole number'),
  description: z.string().min(1, 'Description is required'),
  transaction_type: z.enum(['adjusted', 'bonus'])
});

// Get all loyalty members with filters
export async function getLoyaltyMembers(filters?: {
  status?: string;
  tier_id?: string;
  search?: string;
}) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view loyalty members' };
    }
    
    let query = supabase
      .from('loyalty_members')
      .select(`
        *,
        customer:customers(id, name, email_address, phone_number),
        tier:loyalty_tiers(*)
      `)
      .order('created_at', { ascending: false });
    
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    
    if (filters?.tier_id) {
      query = query.eq('tier_id', filters.tier_id);
    }
    
    if (filters?.search) {
      // This requires a join with customers table for name/phone search
      query = query.or(`customer.name.ilike.%${filters.search}%,customer.phone_number.ilike.%${filters.search}%`);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load loyalty members' };
    }
    
    return { data: data as LoyaltyMember[] };
  } catch (error) {
    console.error('Error loading loyalty members:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get a single loyalty member by ID
export async function getLoyaltyMember(memberId: string) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view loyalty members' };
    }
    
    const { data, error } = await supabase
      .from('loyalty_members')
      .select(`
        *,
        customer:customers(id, name, email_address, phone_number),
        tier:loyalty_tiers(*)
      `)
      .eq('id', memberId)
      .single();
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load loyalty member' };
    }
    
    return { data: data as LoyaltyMember };
  } catch (error) {
    console.error('Error loading loyalty member:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get loyalty member by customer ID
export async function getLoyaltyMemberByCustomer(customerId: string) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view loyalty members' };
    }
    
    const { data, error } = await supabase
      .from('loyalty_members')
      .select(`
        *,
        customer:customers(id, name, email_address, phone_number),
        tier:loyalty_tiers(*)
      `)
      .eq('customer_id', customerId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        // No member found
        return { data: null };
      }
      console.error('Database error:', error);
      return { error: 'Failed to load loyalty member' };
    }
    
    return { data: data as LoyaltyMember };
  } catch (error) {
    console.error('Error loading loyalty member:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Enroll a customer in the loyalty program
export async function enrollLoyaltyMember(formData: LoyaltyMemberFormData) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to enroll loyalty members' };
    }
    
    // Validate input
    const validatedData = EnrollMemberSchema.parse(formData);
    
    // Check if customer is already enrolled
    const { data: existingMember } = await supabase
      .from('loyalty_members')
      .select('id')
      .eq('customer_id', validatedData.customer_id)
      .single();
    
    if (existingMember) {
      return { error: 'Customer is already enrolled in the loyalty program' };
    }
    
    // Get the default program (The Anchor VIP Club)
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('name', 'The Anchor VIP Club')
      .single();
    
    if (!program) {
      return { error: 'Loyalty program not configured' };
    }
    
    // Get the default tier (VIP Member - level 1)
    const { data: defaultTier } = await supabase
      .from('loyalty_tiers')
      .select('id')
      .eq('program_id', program.id)
      .eq('level', 1)
      .single();
    
    if (!defaultTier) {
      return { error: 'Default tier not configured' };
    }
    
    // Create the member
    const { data: member, error: memberError } = await supabase
      .from('loyalty_members')
      .insert({
        customer_id: validatedData.customer_id,
        program_id: program.id,
        tier_id: defaultTier.id,
        status: validatedData.status || 'active',
        join_date: validatedData.join_date || new Date().toISOString().split('T')[0]
      })
      .select()
      .single();
    
    if (memberError) {
      console.error('Database error:', memberError);
      return { error: 'Failed to enroll member' };
    }
    
    // Award welcome bonus points (50 points)
    const welcomeBonus = 50;
    await supabase.from('loyalty_point_transactions').insert({
      member_id: member.id,
      points: welcomeBonus,
      balance_after: welcomeBonus,
      transaction_type: 'bonus',
      description: 'Welcome bonus',
      reference_type: 'enrollment',
      reference_id: member.id
    });
    
    // Update member points
    await supabase
      .from('loyalty_members')
      .update({
        available_points: welcomeBonus,
        total_points: welcomeBonus,
        lifetime_points: welcomeBonus
      })
      .eq('id', member.id);
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'loyalty_member',
      resource_id: member.id,
      operation_status: 'success',
      new_values: { 
        customer_id: validatedData.customer_id,
        status: member.status,
        welcome_bonus: welcomeBonus
      }
    });
    
    // Add a small delay to ensure database propagation
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Fetch the complete member data with relations before sending notification
    const { data: completeMember } = await supabase
      .from('loyalty_members')
      .select(`
        *,
        customer:customers(
          id,
          name,
          phone_number
        )
      `)
      .eq('id', member.id)
      .single();
    
    if (completeMember) {
      // Send welcome SMS notification (using internal function that doesn't require permission check)
      const { sendLoyaltyNotificationInternal } = await import('./loyalty-notifications');
      const notificationResult = await sendLoyaltyNotificationInternal({
        member_id: member.id,
        type: 'welcome',
        data: {
          welcome_points: welcomeBonus
        }
      });
      
      if (notificationResult.error) {
        console.error('Failed to send welcome SMS:', notificationResult.error);
        console.error('Member data:', completeMember);
        // Don't fail the enrollment if SMS fails
      }
    } else {
      console.error('Could not fetch complete member data for notification');
    }
    
    revalidatePath('/loyalty/admin/members');
    revalidatePath('/loyalty/admin');
    
    return { success: true, data: member };
  } catch (error) {
    console.error('Server action error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Update loyalty member status
export async function updateLoyaltyMember(memberId: string, updates: { status?: string; notes?: string }) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to update loyalty members' };
    }
    
    // Validate input
    const validatedData = UpdateMemberSchema.parse(updates);
    
    const { data, error } = await supabase
      .from('loyalty_members')
      .update(validatedData)
      .eq('id', memberId)
      .select()
      .single();
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to update member' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'loyalty_member',
      resource_id: memberId,
      operation_status: 'success',
      new_values: validatedData
    });
    
    revalidatePath('/loyalty/admin/members');
    revalidatePath(`/loyalty/admin/members/${memberId}`);
    
    return { success: true, data };
  } catch (error) {
    console.error('Server action error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Manually adjust member points
export async function adjustMemberPoints(adjustmentData: {
  member_id: string;
  points: number;
  description: string;
  transaction_type: 'adjusted' | 'bonus';
}) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to adjust member points' };
    }
    
    // Validate input
    const validatedData = AdjustPointsSchema.parse(adjustmentData);
    
    // Get current member data
    const { data: member, error: memberError } = await supabase
      .from('loyalty_members')
      .select('available_points, total_points, lifetime_points')
      .eq('id', validatedData.member_id)
      .single();
    
    if (memberError || !member) {
      return { error: 'Member not found' };
    }
    
    // Calculate new balances
    const newAvailable = member.available_points + validatedData.points;
    const newTotal = validatedData.points > 0 ? member.total_points + validatedData.points : member.total_points;
    const newLifetime = validatedData.points > 0 ? member.lifetime_points + validatedData.points : member.lifetime_points;
    
    // Prevent negative balance
    if (newAvailable < 0) {
      return { error: 'Insufficient points for this adjustment' };
    }
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    
    // Create transaction
    const { error: txError } = await supabase
      .from('loyalty_point_transactions')
      .insert({
        member_id: validatedData.member_id,
        points: validatedData.points,
        balance_after: newAvailable,
        transaction_type: validatedData.transaction_type,
        description: validatedData.description,
        reference_type: 'manual_adjustment',
        created_by: user?.id
      });
    
    if (txError) {
      console.error('Transaction error:', txError);
      return { error: 'Failed to create transaction' };
    }
    
    // Update member points
    const { error: updateError } = await supabase
      .from('loyalty_members')
      .update({
        available_points: newAvailable,
        total_points: newTotal,
        lifetime_points: newLifetime,
        last_activity_date: new Date().toISOString().split('T')[0]
      })
      .eq('id', validatedData.member_id);
    
    if (updateError) {
      console.error('Update error:', updateError);
      return { error: 'Failed to update member points' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'loyalty_points',
      resource_id: validatedData.member_id,
      operation_status: 'success',
      new_values: {
        adjustment: validatedData.points,
        description: validatedData.description,
        new_balance: newAvailable
      }
    });
    
    revalidatePath('/loyalty/admin/members');
    revalidatePath(`/loyalty/admin/members/${validatedData.member_id}`);
    
    return { success: true, newBalance: newAvailable };
  } catch (error) {
    console.error('Server action error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get member's point transaction history
export async function getMemberPointTransactions(memberId: string, limit = 50) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view point transactions' };
    }
    
    const { data, error } = await supabase
      .from('loyalty_point_transactions')
      .select('*')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load point transactions' };
    }
    
    return { data: data as LoyaltyPointTransaction[] };
  } catch (error) {
    console.error('Error loading point transactions:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get member's check-in history
export async function getMemberCheckIns(memberId: string, limit = 50) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view check-ins' };
    }
    
    const { data, error } = await supabase
      .from('event_check_ins')
      .select(`
        *,
        event:events(id, title, start_time),
        customer:customers(name)
      `)
      .eq('member_id', memberId)
      .order('check_in_time', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load check-ins' };
    }
    
    return { data: data as EventCheckIn[] };
  } catch (error) {
    console.error('Error loading check-ins:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get loyalty tiers
export async function getLoyaltyTiers() {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('loyalty_tiers')
      .select('*')
      .order('level', { ascending: true });
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to load loyalty tiers' };
    }
    
    return { data };
  } catch (error) {
    console.error('Error loading loyalty tiers:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get member statistics
export async function getLoyaltyMemberStats() {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view loyalty statistics' };
    }
    
    // Get total members by status
    const { data: statusCounts } = await supabase
      .from('loyalty_members')
      .select('status')
      .then(result => {
        const counts = { active: 0, inactive: 0, suspended: 0 };
        result.data?.forEach(member => {
          counts[member.status as keyof typeof counts]++;
        });
        return { data: counts };
      });
    
    // Get members by tier
    const { data: tierCounts } = await supabase
      .from('loyalty_members')
      .select('tier_id, loyalty_tiers!inner(name)')
      .then(result => {
        const counts: Record<string, number> = {};
        result.data?.forEach(member => {
          const tierName = (member as any).loyalty_tiers.name;
          counts[tierName] = (counts[tierName] || 0) + 1;
        });
        return { data: counts };
      });
    
    // Get total points issued
    const { data: pointStats } = await supabase
      .from('loyalty_members')
      .select('lifetime_points')
      .then(result => {
        const totalPoints = result.data?.reduce((sum, member) => sum + member.lifetime_points, 0) || 0;
        return { data: { totalPointsIssued: totalPoints } };
      });
    
    return {
      data: {
        statusCounts: statusCounts || { active: 0, inactive: 0, suspended: 0 },
        tierCounts: tierCounts || {},
        ...pointStats
      }
    };
  } catch (error) {
    console.error('Error loading member statistics:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Bulk import loyalty members from CSV data
export async function bulkImportLoyaltyMembers(csvData: Array<{
  customer_id?: string;
  name?: string;
  phone_number?: string;
  email?: string;
  join_date?: string;
  lifetime_events?: number;
}>) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to import loyalty members' };
    }
    
    // Get the default program
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('name', 'The Anchor VIP Club')
      .single();
    
    if (!program) {
      return { error: 'Loyalty program not configured' };
    }
    
    // Get all tiers for tier calculation
    const { data: tiers } = await supabase
      .from('loyalty_tiers')
      .select('*')
      .eq('program_id', program.id)
      .order('min_events', { ascending: true });
    
    if (!tiers || tiers.length === 0) {
      return { error: 'Loyalty tiers not configured' };
    }
    
    const results = {
      imported: 0,
      skipped: 0,
      errors: [] as string[]
    };
    
    // Process each row
    for (const row of csvData) {
      try {
        let customerId = row.customer_id;
        
        // If no customer_id, try to find by phone or create new customer
        if (!customerId && (row.phone_number || row.name)) {
          // Try to find existing customer
          if (row.phone_number) {
            const { data: existingCustomer } = await supabase
              .from('customers')
              .select('id')
              .eq('phone_number', row.phone_number)
              .single();
            
            if (existingCustomer) {
              customerId = existingCustomer.id;
            }
          }
          
          // Create new customer if not found
          if (!customerId && row.name && row.phone_number) {
            const { data: newCustomer, error: customerError } = await supabase
              .from('customers')
              .insert({
                name: row.name,
                phone_number: row.phone_number,
                email_address: row.email || null
              })
              .select()
              .single();
            
            if (customerError) {
              results.errors.push(`Failed to create customer ${row.name}: ${customerError.message}`);
              results.skipped++;
              continue;
            }
            
            customerId = newCustomer.id;
          }
        }
        
        if (!customerId) {
          results.errors.push(`No customer found or created for row: ${JSON.stringify(row)}`);
          results.skipped++;
          continue;
        }
        
        // Check if already enrolled
        const { data: existingMember } = await supabase
          .from('loyalty_members')
          .select('id')
          .eq('customer_id', customerId)
          .single();
        
        if (existingMember) {
          results.errors.push(`Customer already enrolled: ${row.name || row.phone_number}`);
          results.skipped++;
          continue;
        }
        
        // Calculate appropriate tier based on lifetime events
        const lifetimeEvents = row.lifetime_events || 0;
        const appropriateTier = tiers.reverse().find(tier => lifetimeEvents >= tier.min_events) || tiers[0];
        
        // Create loyalty member
        const { data: member, error: memberError } = await supabase
          .from('loyalty_members')
          .insert({
            customer_id: customerId,
            program_id: program.id,
            tier_id: appropriateTier.id,
            lifetime_events: lifetimeEvents,
            join_date: row.join_date || new Date().toISOString().split('T')[0],
            status: 'active',
            available_points: 50, // Welcome bonus
            total_points: 50,
            lifetime_points: 50
          })
          .select()
          .single();
        
        if (memberError) {
          results.errors.push(`Failed to enroll ${row.name || customerId}: ${memberError.message}`);
          results.skipped++;
          continue;
        }
        
        // Award welcome bonus
        await supabase.from('loyalty_point_transactions').insert({
          member_id: member.id,
          points: 50,
          balance_after: 50,
          transaction_type: 'bonus',
          description: 'Welcome bonus (bulk import)',
          reference_type: 'enrollment',
          reference_id: member.id
        });
        
        results.imported++;
      } catch (error: any) {
        results.errors.push(`Error processing row: ${error.message}`);
        results.skipped++;
      }
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'loyalty_bulk_import',
      resource_id: program.id,
      operation_status: 'success',
      new_values: {
        imported: results.imported,
        skipped: results.skipped,
        total: csvData.length
      }
    });
    
    revalidatePath('/loyalty/admin/members');
    revalidatePath('/loyalty/admin');
    
    return { success: true, ...results };
  } catch (error) {
    console.error('Bulk import error:', error);
    return { error: 'An unexpected error occurred during import' };
  }
}

// Export loyalty members data
export async function exportLoyaltyMembers(options?: {
  status?: string;
  tier_id?: string;
  format?: 'csv' | 'json';
}) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to export loyalty data' };
    }
    
    let query = supabase
      .from('loyalty_members')
      .select(`
        id,
        customer_id,
        status,
        available_points,
        lifetime_points,
        lifetime_events,
        join_date,
        last_activity_date,
        created_at,
        customer:customers!inner(
          name,
          email_address,
          phone_number
        ),
        tier:loyalty_tiers!inner(
          name,
          level
        )
      `)
      .order('created_at', { ascending: false });
    
    if (options?.status) {
      query = query.eq('status', options.status);
    }
    
    if (options?.tier_id) {
      query = query.eq('tier_id', options.tier_id);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to export data' };
    }
    
    // Format data for export
    const exportData = data?.map((member: any) => ({
      member_id: member.id,
      customer_id: member.customer_id,
      name: member.customer?.name || '',
      email: member.customer?.email_address || '',
      phone_number: member.customer?.phone_number || '',
      tier: member.tier?.name || '',
      tier_level: member.tier?.level || 0,
      status: member.status,
      available_points: member.available_points,
      lifetime_points: member.lifetime_points,
      lifetime_events: member.lifetime_events,
      join_date: member.join_date,
      last_activity_date: member.last_activity_date || '',
      created_at: member.created_at
    })) || [];
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'read',
      resource_type: 'loyalty_export',
      resource_id: 'bulk_export',
      operation_status: 'success',
      new_values: {
        record_count: exportData.length,
        filters: options
      }
    });
    
    return { data: exportData };
  } catch (error) {
    console.error('Export error:', error);
    return { error: 'An unexpected error occurred during export' };
  }
}