import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function setupSundayLunchMenu() {
  console.log('Setting up Sunday lunch menu...');
  
  try {
    
    // First, insert the initial menu items using server action
    const menuItems = [
      {
        name: 'Roasted Chicken',
        description: 'Oven-roasted chicken breast with sage & onion stuffing balls, herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy',
        price: 14.99,
        category: 'main',
        display_order: 1,
        allergens: ['Gluten'],
        dietary_info: []
      },
      {
        name: 'Slow-Cooked Lamb Shank',
        description: 'Tender slow-braised lamb shank in rich red wine gravy, served with herb and garlic-crusted roast potatoes, seasonal vegetables, and a Yorkshire pudding',
        price: 15.49,
        category: 'main',
        display_order: 2,
        allergens: [],
        dietary_info: []
      },
      {
        name: 'Crispy Pork Belly',
        description: 'Crispy crackling and tender slow-roasted pork belly with Bramley apple sauce, herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy',
        price: 15.99,
        category: 'main',
        display_order: 3,
        allergens: [],
        dietary_info: []
      },
      {
        name: 'Beetroot & Butternut Squash Wellington',
        description: 'Golden puff pastry filled with beetroot & butternut squash, served with herb and garlic-crusted roast potatoes, seasonal vegetables, and vegetarian gravy',
        price: 15.49,
        category: 'main',
        display_order: 4,
        allergens: ['Gluten'],
        dietary_info: ['Vegan']
      },
      {
        name: 'Kids Roasted Chicken',
        description: 'A smaller portion of our roasted chicken with herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy',
        price: 9.99,
        category: 'main',
        display_order: 5,
        allergens: ['Gluten'],
        dietary_info: []
      },
      {
        name: 'Herb & Garlic Roast Potatoes',
        description: 'Crispy roast potatoes with herbs and garlic',
        price: 0.00,
        category: 'side',
        display_order: 1,
        allergens: [],
        dietary_info: ['Vegan', 'Gluten-free']
      },
      {
        name: 'Yorkshire Pudding',
        description: 'Traditional Yorkshire pudding',
        price: 0.00,
        category: 'side',
        display_order: 2,
        allergens: ['Gluten', 'Eggs', 'Milk'],
        dietary_info: ['Vegetarian']
      },
      {
        name: 'Seasonal Vegetables',
        description: 'Selection of fresh seasonal vegetables',
        price: 0.00,
        category: 'side',
        display_order: 3,
        allergens: [],
        dietary_info: ['Vegan', 'Gluten-free']
      },
      {
        name: 'Cauliflower Cheese',
        description: 'Creamy mature cheddar sauce, baked until golden and bubbling',
        price: 3.99,
        category: 'extra',
        display_order: 4,
        allergens: ['Milk'],
        dietary_info: ['Vegetarian', 'Gluten-free']
      }
    ];
    
    console.log('Inserting menu items...');
    
    for (const item of menuItems) {
      const { data, error } = await supabase
        .from('sunday_lunch_menu_items')
        .insert({
          ...item,
          is_active: true
        })
        .select()
        .single();
        
      if (error) {
        if (error.message?.includes('duplicate key')) {
          console.log(`Item "${item.name}" already exists, skipping...`);
        } else if (error.code === '42P01') {
          console.error('Table does not exist. Please run the migration first.');
          return;
        } else {
          console.error(`Error inserting ${item.name}:`, error.message || error);
        }
      } else {
        console.log(`✓ Inserted: ${item.name}`);
      }
    }
    
    console.log('\nSetup complete!');
    
    // Show current menu items
    const { data: allItems, error: fetchError } = await supabase
      .from('sunday_lunch_menu_items')
      .select('*')
      .order('category')
      .order('display_order');
      
    if (fetchError) {
      console.error('Error fetching items:', fetchError);
    } else {
      console.log('\nCurrent menu items:');
      console.log('==================');
      let currentCategory = '';
      allItems?.forEach(item => {
        if (item.category !== currentCategory) {
          currentCategory = item.category;
          console.log(`\n${currentCategory.toUpperCase()}:`);
        }
        console.log(`- ${item.name}: £${item.price.toFixed(2)} ${item.is_active ? '✓' : '✗'}`);
      });
    }
    
  } catch (error) {
    console.error('Setup error:', error);
  }
}

setupSundayLunchMenu().catch(console.error);