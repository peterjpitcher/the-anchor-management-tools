'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { revalidatePath } from 'next/cache';

// Check and update member tier based on lifetime events
export async function checkAndUpdateMemberTier(memberId: string) {
  try {
    const adminSupabase = await createAdminClient();
    
    // Get member details
    const { data: member, error: memberError } = await adminSupabase
      .from('loyalty_members')
      .select(`
        *,
        tier:loyalty_tiers(*),
        program:loyalty_programs(*)
      `)
      .eq('id', memberId)
      .single();
    
    if (memberError || !member) {
      return { error: 'Member not found' };
    }
    
    // Get all tiers for the program
    const { data: tiers, error: tiersError } = await adminSupabase
      .from('loyalty_tiers')
      .select('*')
      .eq('program_id', member.program_id)
      .order('min_events', { ascending: false });
    
    if (tiersError || !tiers) {
      return { error: 'Failed to load tiers' };
    }
    
    // Find the appropriate tier based on lifetime events
    const newTier = tiers.find(tier => member.lifetime_events >= tier.min_events);
    
    if (!newTier) {
      return { error: 'No suitable tier found' };
    }
    
    // Check if tier needs updating
    if (newTier.id !== member.tier_id) {
      const oldTier = member.tier;
      
      // Update member tier
      const { error: updateError } = await adminSupabase
        .from('loyalty_members')
        .update({ 
          tier_id: newTier.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', memberId);
      
      if (updateError) {
        return { error: 'Failed to update tier' };
      }
      
      // Record tier progression in point transactions (for history)
      await adminSupabase
        .from('loyalty_point_transactions')
        .insert({
          member_id: memberId,
          points: 0, // No points change, just recording tier change
          balance_after: member.available_points,
          transaction_type: 'adjusted',
          description: `Tier upgraded from ${oldTier?.name || 'None'} to ${newTier.name}`,
          reference_type: 'tier_change',
          reference_id: newTier.id
        });
      
      // Log audit event
      await logAuditEvent({
        operation_type: 'update',
        resource_type: 'loyalty_member_tier',
        resource_id: memberId,
        operation_status: 'success',
        old_values: { tier_id: oldTier?.id, tier_name: oldTier?.name },
        new_values: { tier_id: newTier.id, tier_name: newTier.name }
      });
      
      return { 
        success: true, 
        upgraded: true,
        oldTier: oldTier?.name,
        newTier: newTier.name,
        newTierBenefits: newTier.benefits
      };
    }
    
    return { success: true, upgraded: false };
  } catch (error) {
    console.error('Tier check error:', error);
    return { error: 'Failed to check tier progression' };
  }
}

// Get tier progression info for a member
export async function getMemberTierProgress(memberId: string) {
  try {
    const supabase = await createClient();
    
    // Get member with current tier
    const { data: member, error: memberError } = await supabase
      .from('loyalty_members')
      .select(`
        *,
        tier:loyalty_tiers(*),
        program:loyalty_programs(*)
      `)
      .eq('id', memberId)
      .single();
    
    if (memberError || !member) {
      return { error: 'Member not found' };
    }
    
    // Get all tiers for comparison
    const { data: allTiers, error: tiersError } = await supabase
      .from('loyalty_tiers')
      .select('*')
      .eq('program_id', member.program_id)
      .order('min_events', { ascending: true });
    
    if (tiersError || !allTiers) {
      return { error: 'Failed to load tiers' };
    }
    
    // Find current tier index and next tier
    const currentTierIndex = allTiers.findIndex(t => t.id === member.tier_id);
    const nextTier = currentTierIndex < allTiers.length - 1 
      ? allTiers[currentTierIndex + 1] 
      : null;
    
    // Calculate progress
    const progress = {
      currentTier: member.tier,
      nextTier: nextTier,
      currentEvents: member.lifetime_events,
      eventsToNextTier: nextTier ? nextTier.min_events - member.lifetime_events : 0,
      progressPercentage: nextTier 
        ? Math.min(100, Math.floor((member.lifetime_events / nextTier.min_events) * 100))
        : 100,
      allTiers: allTiers.map(tier => ({
        ...tier,
        isActive: tier.id === member.tier_id,
        isUnlocked: member.lifetime_events >= tier.min_events,
        eventsRequired: Math.max(0, tier.min_events - member.lifetime_events)
      }))
    };
    
    return { data: progress };
  } catch (error) {
    console.error('Error loading tier progress:', error);
    return { error: 'Failed to load tier progress' };
  }
}

// Batch check and update all members' tiers
export async function batchUpdateMemberTiers() {
  try {
    const adminSupabase = await createAdminClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to update tiers' };
    }
    
    // Get all active members
    const { data: members, error: membersError } = await adminSupabase
      .from('loyalty_members')
      .select('id, lifetime_events')
      .eq('status', 'active');
    
    if (membersError || !members) {
      return { error: 'Failed to load members' };
    }
    
    let updatedCount = 0;
    const results = [];
    
    // Process each member
    for (const member of members) {
      const result = await checkAndUpdateMemberTier(member.id);
      if (result.upgraded) {
        updatedCount++;
        results.push({
          memberId: member.id,
          oldTier: result.oldTier,
          newTier: result.newTier
        });
      }
    }
    
    // Log batch operation
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'loyalty_tiers_batch',
      resource_id: 'batch_update',
      operation_status: 'success',
      new_values: {
        totalMembers: members.length,
        updatedMembers: updatedCount,
        results: results
      }
    });
    
    revalidatePath('/loyalty/admin');
    
    return { 
      success: true, 
      totalMembers: members.length,
      updatedMembers: updatedCount,
      results: results
    };
  } catch (error) {
    console.error('Batch update error:', error);
    return { error: 'Failed to update member tiers' };
  }
}

// Get tier statistics
export async function getTierStatistics() {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('loyalty', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view tier statistics' };
    }
    
    // Get the default program
    const { data: program } = await supabase
      .from('loyalty_programs')
      .select('id')
      .eq('name', 'The Anchor VIP Club')
      .single();
    
    if (!program) {
      return { error: 'Loyalty program not found' };
    }
    
    // Get all tiers with member counts
    const { data: tiers, error: tiersError } = await supabase
      .from('loyalty_tiers')
      .select(`
        *,
        loyalty_members(count)
      `)
      .eq('program_id', program.id)
      .order('min_events', { ascending: true });
    
    if (tiersError) {
      return { error: 'Failed to load tier statistics' };
    }
    
    // Get members close to tier upgrade (within 2 events)
    const { data: membersNearUpgrade } = await supabase
      .from('loyalty_members')
      .select(`
        *,
        tier:loyalty_tiers(name, min_events),
        customer:customers(first_name, last_name, mobile_number)
      `)
      .eq('program_id', program.id)
      .eq('status', 'active');
    
    const nearUpgrades = [];
    
    if (membersNearUpgrade && tiers) {
      for (const member of membersNearUpgrade) {
        const currentTierIndex = tiers.findIndex(t => t.id === member.tier_id);
        const nextTier = currentTierIndex < tiers.length - 1 
          ? tiers[currentTierIndex + 1] 
          : null;
        
        if (nextTier && (nextTier.min_events - member.lifetime_events) <= 2) {
          nearUpgrades.push({
            memberId: member.id,
            memberName: member.customer?.name,
            currentTier: member.tier?.name,
            nextTier: nextTier.name,
            eventsNeeded: nextTier.min_events - member.lifetime_events
          });
        }
      }
    }
    
    return {
      data: {
        tiers: tiers?.map(tier => ({
          ...tier,
          memberCount: tier.loyalty_members?.[0]?.count || 0
        })) || [],
        membersNearUpgrade: nearUpgrades
      }
    };
  } catch (error) {
    console.error('Error loading tier statistics:', error);
    return { error: 'Failed to load tier statistics' };
  }
}