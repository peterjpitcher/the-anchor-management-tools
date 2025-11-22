import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import type { BusinessHours, SpecialHours, ServiceStatus, ServiceStatusOverride } from '@/types/business-hours';
import { getTodayIsoDate } from '@/lib/dateUtils';

// Helper to validate time format
const timeSchema = z.preprocess(
  (val) => {
    if (val === '' || val === null || val === undefined) return null;
    if (typeof val === 'string' && val.match(/^\d{1,2}:\d{2}:\d{2}$/)) {
      return val.substring(0, 5);
    }
    return val;
  },
  z.union([
    z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    z.null()
  ])
);

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const businessHoursSchema = z
  .object({
    day_of_week: z.number().min(0).max(6),
    opens: timeSchema,
    closes: timeSchema,
    kitchen_opens: timeSchema,
    kitchen_closes: timeSchema,
    is_closed: z.boolean(),
    is_kitchen_closed: z.boolean(),
    schedule_config: z.array(z.any()).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.is_closed) {
      if (!value.opens) {
        ctx.addIssue({
          code: 'custom',
          message: 'Opening time is required when the venue is open',
          path: ['opens'],
        });
      }

      if (!value.closes) {
        ctx.addIssue({
          code: 'custom',
          message: 'Closing time is required when the venue is open',
          path: ['closes'],
        });
      }

        if (value.opens && value.closes) {
          const opens = toMinutes(value.opens);
          const closes = toMinutes(value.closes);

          // Allow closing at 00:00 (midnight) which is numerically 0 but semantically end of day
          if (closes <= opens && value.closes !== '00:00' && value.closes !== '00:00:00') {
            ctx.addIssue({
              code: 'custom',
              message: 'Closing time must be after opening time',
              path: ['closes'],
            });
          }
        }
    }

    if (value.is_closed) {
      if (value.opens !== null || value.closes !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Opening hours must be blank when the venue is marked closed',
          path: ['opens'],
        });
      }
      if (value.kitchen_opens !== null || value.kitchen_closes !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Kitchen hours must be blank when the venue is marked closed',
          path: ['kitchen_opens'],
        });
      }
    }

    if (value.is_kitchen_closed) {
      if (value.kitchen_opens !== null || value.kitchen_closes !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Kitchen times must be blank when the kitchen is closed',
          path: ['kitchen_opens'],
        });
      }
    }

    if (!value.is_closed && !value.is_kitchen_closed) {
      if (value.kitchen_opens && value.kitchen_closes) {
        const kitchenOpens = toMinutes(value.kitchen_opens);
        const kitchenCloses = toMinutes(value.kitchen_closes);

        if (kitchenCloses <= kitchenOpens) {
          ctx.addIssue({
            code: 'custom',
            message: 'Kitchen closing time must be after kitchen opening time',
            path: ['kitchen_closes'],
          });
        }

        if (value.opens && value.closes) {
          const opens = toMinutes(value.opens);
          let closes = toMinutes(value.closes);

          // Adjust for midnight closing
          if (value.closes === '00:00' || value.closes === '00:00:00') {
            closes = 24 * 60;
          }

          if (kitchenOpens < opens || kitchenCloses > closes) {
            ctx.addIssue({
              code: 'custom',
              message: 'Kitchen hours must sit inside the main business hours',
              path: ['kitchen_opens'],
            });
          }
        }
      }
    }
  });

const specialHoursSchema = z.object({
  date: isoDateSchema,
  opens: timeSchema,
  closes: timeSchema,
  kitchen_opens: timeSchema,
  kitchen_closes: timeSchema,
  is_closed: z.boolean(),
  is_kitchen_closed: z.boolean(),
  note: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? null : val,
    z.union([z.string().max(500), z.null()])
  )
});

const serviceStatusUpdateSchema = z.object({
  is_enabled: z.boolean(),
  message: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? null : val,
    z.union([z.string().max(500), z.null()])
  ),
});

const serviceStatusOverrideSchema = z.object({
  start_date: isoDateSchema,
  end_date: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? null : val,
    z.union([isoDateSchema, z.null()])
  ),
  is_enabled: z.boolean().default(false),
  message: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? null : val,
    z.union([z.string().max(500), z.null()])
  ),
});

export class BusinessHoursService {
  static async getBusinessHours(): Promise<BusinessHours[]> {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('business_hours')
      .select('*')
      .order('day_of_week', { ascending: true });

    if (error) throw new Error('Failed to fetch business hours');
    return (data || []) as BusinessHours[];
  }

  static async getBusinessHoursByDay(dayOfWeek: number): Promise<BusinessHours | null> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('business_hours')
      .select('*')
      .eq('day_of_week', dayOfWeek)
      .single();

    if (error) throw new Error('Failed to fetch business hours');
    return data;
  }

  static async updateBusinessHours(formData: FormData) {
    const updates = [];
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      const dayData = {
        day_of_week: dayOfWeek,
        opens: formData.get(`opens_${dayOfWeek}`) as string || '',
        closes: formData.get(`closes_${dayOfWeek}`) as string || '',
        kitchen_opens: formData.get(`kitchen_opens_${dayOfWeek}`) as string || '',
        kitchen_closes: formData.get(`kitchen_closes_${dayOfWeek}`) as string || '',
        is_closed: formData.get(`is_closed_${dayOfWeek}`) === 'true',
        is_kitchen_closed: formData.get(`is_kitchen_closed_${dayOfWeek}`) === 'true',
        schedule_config: formData.get(`schedule_config_${dayOfWeek}`)
          ? JSON.parse(formData.get(`schedule_config_${dayOfWeek}`) as string)
          : undefined,
      };

      // Allow schedule_config to pass through even if validation schema doesn't explicitly check it deeply yet
      // We modify the schema locally or assume it passes if not in schema (Zod strips unknown keys by default!)
      // WAIT: Zod .parse() STRIPS unknown keys. I MUST update the schema first.
      const validationResult = businessHoursSchema.safeParse(dayData);
      if (!validationResult.success) {
        throw new Error(`Invalid data for ${
          ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]
        }: ${validationResult.error.errors[0]?.message || 'Unknown error'}`);
      }

      updates.push(validationResult.data);
    }

    const updatedData = updates.map((update) => ({
      ...update,
      opens: update.is_closed ? null : update.opens,
      closes: update.is_closed ? null : update.closes,
      kitchen_opens: update.is_closed || update.is_kitchen_closed ? null : update.kitchen_opens,
      kitchen_closes: update.is_closed || update.is_kitchen_closed ? null : update.kitchen_closes,
      is_kitchen_closed: update.is_closed ? true : update.is_kitchen_closed,
      updated_at: new Date().toISOString(),
    }));

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('business_hours')
      .upsert(updatedData, { onConflict: 'day_of_week' });

    if (error) throw new Error('Failed to update business hours');

    // Trigger slot regeneration
    await supabase.rpc('auto_generate_weekly_slots');
    
    return { success: true, updatedCount: updates.length };
  }

  static async getServiceStatuses(serviceCodes?: string[]): Promise<ServiceStatus[]> {
    const supabase = createAdminClient();
    let query = supabase.from('service_statuses').select('*').order('display_name', { ascending: true });

    if (serviceCodes && serviceCodes.length > 0) {
      query = query.in('service_code', serviceCodes);
    }

    const { data, error } = await query;
    if (error) throw new Error('Failed to fetch service statuses');

    return (data || []) as ServiceStatus[];
  }

  static async getServiceStatusOverrides(
    serviceCode: string,
    startDate?: string,
    endDate?: string
  ): Promise<ServiceStatusOverride[]> {
    const supabase = createAdminClient();
    let query = supabase
      .from('service_status_overrides')
      .select('*')
      .eq('service_code', serviceCode)
      .order('start_date', { ascending: true });

    if (startDate) {
      query = query.gte('end_date', startDate);
    }
    if (endDate) {
      query = query.lte('start_date', endDate);
    }

    const { data, error } = await query;
    if (error) throw new Error('Failed to fetch service status overrides');

    return (data || []) as ServiceStatusOverride[];
  }

  static async createServiceStatusOverride(serviceCode: string, formData: FormData, userId: string) {
    const parsed = serviceStatusOverrideSchema.safeParse({
      start_date: formData.get('start_date'),
      end_date: formData.get('end_date'),
      is_enabled: formData.get('is_enabled') === 'true',
      message: formData.get('message'),
    });

    if (!parsed.success) {
      throw new Error(parsed.error.errors[0]?.message || 'Invalid override data');
    }

    const startDate = parsed.data.start_date;
    const endDate = parsed.data.end_date ?? parsed.data.start_date;

    if (endDate < startDate) {
      throw new Error('End date cannot be before start date');
    }

    const supabase = createAdminClient();
    const insertPayload = {
      service_code: serviceCode,
      start_date: startDate,
      end_date: endDate,
      is_enabled: parsed.data.is_enabled,
      message: parsed.data.message,
      created_by: userId,
    };

    const { data, error: insertError } = await supabase
      .from('service_status_overrides')
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      throw new Error('Failed to create override');
    }

    const { error: slotUpdateError } = await supabase
      .from('service_slots')
      .update({
        is_active: parsed.data.is_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('booking_type', 'sunday_lunch')
      .gte('service_date', startDate)
      .lte('service_date', endDate);

    if (slotUpdateError) {
      console.error('Failed to update service slots for override:', slotUpdateError);
    }

    const { error: regenError } = await supabase.rpc('auto_generate_weekly_slots');
    if (regenError) {
      console.error('Failed to regenerate service slots after override creation:', regenError);
    }

    return { data: data as ServiceStatusOverride, input: parsed.data };
  }

  static async deleteServiceStatusOverride(overrideId: string) {
    const supabase = createAdminClient();

    const { data: existing, error: fetchError } = await supabase
      .from('service_status_overrides')
      .select('*')
      .eq('id', overrideId)
      .single();

    if (fetchError || !existing) {
      throw new Error('Override not found');
    }

    const override = existing as ServiceStatusOverride;

    const { error: deleteError } = await supabase
      .from('service_status_overrides')
      .delete()
      .eq('id', overrideId);

    if (deleteError) {
      throw new Error('Failed to delete override');
    }

    const { data: globalStatus } = await supabase
      .from('service_statuses')
      .select('is_enabled')
      .eq('service_code', override.service_code)
      .single();

    const globalEnabled = globalStatus?.is_enabled !== false;

    const { error: slotUpdateError } = await supabase
      .from('service_slots')
      .update({
        is_active: globalEnabled,
        updated_at: new Date().toISOString(),
      })
      .eq('booking_type', 'sunday_lunch')
      .gte('service_date', override.start_date)
      .lte('service_date', override.end_date);

    if (slotUpdateError) {
      console.error('Failed to update service slots after override deletion:', slotUpdateError);
    }

    const { error: regenError } = await supabase.rpc('auto_generate_weekly_slots');
    if (regenError) {
      console.error('Failed to regenerate service slots after override deletion:', regenError);
    }

    return override;
  }

  static async updateServiceStatus(serviceCode: string, payload: { is_enabled: boolean; message?: string | null }, userId: string) {
    const validationResult = serviceStatusUpdateSchema.safeParse(payload);
    if (!validationResult.success) {
      throw new Error(validationResult.error.errors[0]?.message || 'Invalid service status data');
    }

    const supabase = createAdminClient();
    const { data: existing, error: fetchError } = await supabase
      .from('service_statuses')
      .select('*')
      .eq('service_code', serviceCode)
      .single();

    if (fetchError) {
      throw new Error('Service status not found');
    }

    const updatePayload = {
      is_enabled: validationResult.data.is_enabled,
      message: validationResult.data.message,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: updateError } = await supabase
      .from('service_statuses')
      .update(updatePayload)
      .eq('service_code', serviceCode)
      .select()
      .single();

    if (updateError) {
      throw new Error('Failed to update service status');
    }

    const todayIso = getTodayIsoDate();

    if (serviceCode === 'sunday_lunch') {
      if (!validationResult.data.is_enabled) {
        await supabase
          .from('service_slots')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('booking_type', 'sunday_lunch')
          .gte('service_date', todayIso);
      } else {
        await supabase
          .from('service_slots')
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq('booking_type', 'sunday_lunch')
          .gte('service_date', todayIso);

        const { data: disabledOverrides } = await supabase
          .from('service_status_overrides')
          .select('start_date, end_date, is_enabled')
          .eq('service_code', 'sunday_lunch')
          .eq('is_enabled', false);

        if (disabledOverrides && disabledOverrides.length > 0) {
          for (const override of disabledOverrides) {
            await supabase
              .from('service_slots')
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq('booking_type', 'sunday_lunch')
              .gte('service_date', override.start_date)
              .lte('service_date', override.end_date);
          }
        }

        await supabase.rpc('auto_generate_weekly_slots');
      }
    }

    return { updated, existing };
  }

  static async getSpecialHours(startDate?: string, endDate?: string): Promise<SpecialHours[]> {
    const supabase = createAdminClient();
    let query = supabase.from('special_hours').select('*').order('date', { ascending: true });

    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lte('date', endDate);

    const { data, error } = await query;
    if (error) throw new Error('Failed to fetch special hours');

    return (data || []) as SpecialHours[];
  }

  static async createSpecialHours(formData: FormData) {
    const startDateInput = (formData.get('date') as string) || '';
    const endDateInputRaw = (formData.get('end_date') as string) || startDateInput;

    const startDateResult = isoDateSchema.safeParse(startDateInput);
    const endDateResult = isoDateSchema.safeParse(endDateInputRaw);

    if (!startDateResult.success) throw new Error('Invalid start date format');
    if (!endDateResult.success) throw new Error('Invalid end date format');

    const startDate = startDateResult.data;
    const endDate = endDateResult.data;

    if (endDate < startDate) throw new Error('End date cannot be before start date');

    const rawData = {
      date: startDate,
      opens: (formData.get('opens') as string) || '',
      closes: (formData.get('closes') as string) || '',
      kitchen_opens: (formData.get('kitchen_opens') as string) || '',
      kitchen_closes: (formData.get('kitchen_closes') as string) || '',
      is_closed: formData.get('is_closed') === 'true',
      is_kitchen_closed: formData.get('is_kitchen_closed') === 'true',
      note: (formData.get('note') as string) || ''
    };

    const validationResult = specialHoursSchema.safeParse(rawData);
    if (!validationResult.success) throw new Error(validationResult.error.errors[0].message);

    const validatedData = validationResult.data;
    const basePayload = {
      opens: validatedData.is_closed ? null : validatedData.opens,
      closes: validatedData.is_closed ? null : validatedData.closes,
      kitchen_opens: validatedData.is_closed || validatedData.is_kitchen_closed ? null : validatedData.kitchen_opens,
      kitchen_closes: validatedData.is_closed || validatedData.is_kitchen_closed ? null : validatedData.kitchen_closes,
      is_closed: validatedData.is_closed,
      is_kitchen_closed: validatedData.is_kitchen_closed,
      note: validatedData.note
    };

    const formatDate = (dateObj: Date) => {
      const year = dateObj.getFullYear();
      const month = `${dateObj.getMonth() + 1}`.padStart(2, '0');
      const day = `${dateObj.getDate()}`.padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const startDateObj = new Date(`${startDate}T00:00:00`);
    const endDateObj = new Date(`${endDate}T00:00:00`);

    const datesToCreate: string[] = [];
    for (let current = new Date(startDateObj.getTime()); current <= endDateObj; current.setDate(current.getDate() + 1)) {
      datesToCreate.push(formatDate(current));
    }

    const supabase = createAdminClient();
    const { data: existingDates } = await supabase.from('special_hours').select('date').in('date', datesToCreate);

    if (existingDates && existingDates.length > 0) {
      throw new Error(`Special hours already exist for ${existingDates.map(d => d.date).join(', ')}`);
    }

    const payloads = datesToCreate.map((date) => ({ ...basePayload, date }));
    const { data, error } = await supabase.from('special_hours').insert(payloads).select();

    if (error) throw new Error('Failed to create special hours');

    // Trigger slot regeneration
    await supabase.rpc('auto_generate_weekly_slots');

    return { data: data || [], datesToCreate };
  }

  static async updateSpecialHours(id: string, formData: FormData) {
    const supabase = createAdminClient();
    const { data: oldData, error: loadError } = await supabase.from('special_hours').select('*').eq('id', id).single();

    if (loadError) throw new Error('Failed to load special hours');

    const rawData = {
      date: formData.get('date') as string,
      opens: formData.get('opens') as string || '',
      closes: formData.get('closes') as string || '',
      kitchen_opens: formData.get('kitchen_opens') as string || '',
      kitchen_closes: formData.get('kitchen_closes') as string || '',
      is_closed: formData.get('is_closed') === 'true',
      is_kitchen_closed: formData.get('is_kitchen_closed') === 'true',
      note: formData.get('note') as string || ''
    };

    const validationResult = specialHoursSchema.safeParse(rawData);
    if (!validationResult.success) throw new Error(validationResult.error.errors[0].message);

    const validatedData = validationResult.data;
    const payload = {
      ...validatedData,
      opens: validatedData.is_closed ? null : validatedData.opens,
      closes: validatedData.is_closed ? null : validatedData.closes,
      kitchen_opens: validatedData.is_closed || validatedData.is_kitchen_closed ? null : validatedData.kitchen_opens,
      kitchen_closes: validatedData.is_closed || validatedData.is_kitchen_closed ? null : validatedData.kitchen_closes,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from('special_hours').update(payload).eq('id', id).select().single();

    if (error) {
      if (error.code === '23505') throw new Error('Special hours already exist for this date');
      throw new Error('Failed to update special hours');
    }

    // Trigger slot regeneration
    await supabase.rpc('auto_generate_weekly_slots');

    return { updated: data, oldData };
  }

  static async deleteSpecialHours(id: string) {
    const supabase = createAdminClient();
    const { data: oldData } = await supabase.from('special_hours').select('*').eq('id', id).single();
    
    if (!oldData) throw new Error('Special hours not found');

    const { error } = await supabase.from('special_hours').delete().eq('id', id);
    if (error) throw new Error('Failed to delete special hours');

    // Trigger slot regeneration
    await supabase.rpc('auto_generate_weekly_slots');

    return oldData;
  }
}
