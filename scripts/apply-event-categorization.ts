import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function applyEventCategorization() {
    console.log('🚀 Starting event categorization...')

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Ensure New Categories Exist
    const newCategories = [
        {
            name: 'Celebrations',
            slug: 'celebrations',
            description: 'Special occasions and seasonal celebrations at The Anchor.',
            color: '#F59E0B', // Amber
            icon: 'StarIcon',
            is_active: true,
            default_event_status: 'scheduled',
            default_reminder_hours: 24,
            default_price: 0,
            default_is_free: false,
            sort_order: 20
        },
        {
            name: 'World Cup 2026',
            slug: 'world-cup-2026',
            description: 'Live screenings of the 2026 World Cup matches.',
            color: '#3B82F6', // Blue
            icon: 'GlobeAltIcon',
            is_active: true,
            default_event_status: 'scheduled',
            default_reminder_hours: 1,
            default_price: 0,
            default_is_free: true,
            sort_order: 21
        },
        {
            name: 'Sport',
            slug: 'sport',
            description: 'Live sports events and screenings.',
            color: '#16A34A', // Green
            icon: 'TrophyIcon',
            is_active: true,
            default_event_status: 'scheduled',
            default_reminder_hours: 1,
            default_price: 0,
            default_is_free: true,
            sort_order: 22
        }
    ]

    const categoryMap: Record<string, string> = {}

    // Fetch existing categories first
    const { data: existingCats, error: fetchError } = await supabase
        .from('event_categories')
        .select('id, name, slug')

    if (fetchError) {
        console.error('Error fetching categories:', fetchError)
        process.exit(1)
    }

    // Populate map with existing
    existingCats?.forEach(cat => {
        categoryMap[cat.name] = cat.id
        // Also map by partial match keywords if needed, but for now we rely on exact "Target Category" names
        if (cat.name === 'Quiz') categoryMap['Quiz'] = cat.id // Already there
        if (cat.name === 'Tastings') categoryMap['Tastings'] = cat.id
    })

    // Create or Update New Categories
    for (const cat of newCategories) {
        const existing = existingCats?.find(c => c.slug === cat.slug)
        if (existing) {
            console.log(`✅ Category '${cat.name}' already exists. Using ID: ${existing.id}`)
            categoryMap[cat.name] = existing.id
        } else {
            console.log(`✨ Creating category '${cat.name}'...`)
            const { data: created, error: createError } = await supabase
                .from('event_categories')
                .insert(cat)
                .select('id')
                .single()

            if (createError) {
                console.error(`Error creating category ${cat.name}:`, createError)
            } else if (created) {
                categoryMap[cat.name] = created.id
                console.log(`   -> Created with ID: ${created.id}`)
            }
        }
    }

    // Define Mapping Rules
    // Priority: Check specific matches first
    const rules = [
        { pattern: /quiz night/i, target: 'Quiz' },
        { pattern: /bingo/i, target: 'Bingo' },
        { pattern: /live at the anchor/i, target: 'Live Music' },
        { pattern: /karaoke/i, target: 'Karaoke' },
        { pattern: /tasting night/i, target: 'Tastings' },
        { pattern: /mother's day/i, target: 'Celebrations' },
        { pattern: /st patrick's day/i, target: 'Celebrations' },
        { pattern: /free mixer/i, target: 'Celebrations' },
        { pattern: /world cup 2026/i, target: 'World Cup 2026' },
        { pattern: /wimbledon/i, target: 'Sport' },
        { pattern: /mama mia/i, target: 'Parties' },
        { pattern: /halloween party/i, target: 'Parties' },
        { pattern: /movie night/i, target: 'Parties' }, // Matches "Nikki / Christmas Movie Night" too
    ]

    // Fetch Events to Update
    const today = new Date().toISOString().split('T')[0]
    const { data: events, error: eventError } = await supabase
        .from('events')
        .select('id, name, category_id')
        .gte('date', today)
        .neq('event_status', 'cancelled')

    if (eventError) {
        console.error('Error fetching events:', eventError)
        process.exit(1)
    }

    console.log(`\n📋 Processing ${events.length} events...`)
    let updateCount = 0

    for (const event of events) {
        let targetCategoryName: string | null = null

        for (const rule of rules) {
            if (rule.pattern.test(event.name)) {
                targetCategoryName = rule.target
                break
            }
        }

        if (targetCategoryName) {
            const categoryId = categoryMap[targetCategoryName]
            if (categoryId) {
                // Only update if changed
                if (event.category_id !== categoryId) {
                    console.log(`✏️ Updating '${event.name}':`)
                    console.log(`   Old Cat ID: ${event.category_id || 'null'}`)
                    console.log(`   New Cat: ${targetCategoryName}`)

                    const { error: updateErr } = await supabase
                        .from('events')
                        .update({ category_id: categoryId })
                        .eq('id', event.id)

                    if (updateErr) {
                        console.error(`   ❌ Failed to update: ${updateErr.message}`)
                    } else {
                        console.log(`   ✅ Updated`)
                        updateCount++
                    }
                } else {
                    // console.log(`   (Skipping '${event.name}', already correct)`)
                }
            } else {
                console.warn(`   ⚠️ Pattern matched '${targetCategoryName}' but no ID found for that category.`)
            }
        }
    }

    console.log(`\n🎉 Done! Updated ${updateCount} events.`)
}

applyEventCategorization().catch(console.error)
