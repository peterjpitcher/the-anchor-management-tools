import { testCalendarConnection } from '../src/lib/google-calendar';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function run() {
    console.log('Running Google Calendar Connection Test...');
    try {
        const result = await testCalendarConnection();
        console.log('Result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Unhandled error during test:', error);
    }
}

run();
