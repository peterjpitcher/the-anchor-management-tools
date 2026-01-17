import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export async function verifyApiKey(
  apiKey: string,
  requiredScope?: string
): Promise<{ valid: boolean; error?: string; apiKeyData?: any }> {
  try {
    const supabase = await createClient();
    
    // Hash the API key
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    // Get API key by hash
    const { data: apiKeyData, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single();
      
    if (error || !apiKeyData) {
      return { valid: false, error: 'Invalid API key' };
    }
    
    // Check if key is expired
    if (apiKeyData.expires_at && new Date(apiKeyData.expires_at) < new Date()) {
      return { valid: false, error: 'API key expired' };
    }
    
    // Check permissions if required
    if (requiredScope) {
      const permissions = apiKeyData.permissions || [];
      const hasPermission = permissions.includes(requiredScope) || 
                           permissions.includes('*');
                       
      if (!hasPermission) {
        return { valid: false, error: 'Insufficient permissions' };
      }
    }
    
    // Update last used
    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', apiKeyData.id);
    
    // Log API usage
    await supabase
      .from('api_usage')
      .insert({
        api_key_id: apiKeyData.id,
        endpoint: requiredScope || 'unknown',
        method: 'GET',
        status_code: 200,
      });
    
    return { valid: true, apiKeyData };
  } catch (error) {
    console.error('API key verification error:', error);
    return { valid: false, error: 'Internal server error' };
  }
}
