import { config } from 'dotenv';
import path from 'path';
import { parseIngredientWithAI } from '../src/app/actions/ai-menu-parsing';

// Load environment variables from .env.local
config({ path: path.resolve(process.cwd(), '.env.local') });

const TESCO_GRAVY_HTML = `
    Tesco Free From Gravy Granules For Beef 170g
    £1.45
    Highlights
    Gluten Free
    Wheat Free
    Milk Free
    Suitable for vegans
    Description
    Beef flavour gravy granules.
    Ingredients: Potato Starch, Palm Oil, Salt, Caramelised Sugar, Maltodextrin, Flavourings, Dried Onion, Emulsifier (Lecithins).
`;

async function runTest() {
  console.log('Testing AI Menu Parsing...');
  console.log('Input:', TESCO_GRAVY_HTML.trim().substring(0, 100) + '...');

  try {
    const result = await parseIngredientWithAI(TESCO_GRAVY_HTML);
    console.log('\n--- Result ---');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n--- Error ---');
    console.error(error);
  }
}

runTest();
