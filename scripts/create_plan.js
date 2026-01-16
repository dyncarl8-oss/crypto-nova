import Whop from '@whop/sdk';
import 'dotenv/config'; // Make sure to npm install dotenv if not present, or run with --env-file

// Initialize Whop SDK
const client = new Whop({
    apiKey: process.env.WHOP_API_KEY,
});

async function createPlan() {
    if (!process.env.WHOP_API_KEY) {
        console.error('Error: WHOP_API_KEY is not defined in environment.');
        process.exit(1);
    }

    if (!process.env.WHOP_COMPANY_ID) {
        console.error('Error: WHOP_COMPANY_ID is not defined. Please add it to .env');
        process.exit(1);
    }

    try {
        console.log('Creating "Nova Unlimited" plan...');

        const plan = await client.plans.create({
            company_id: process.env.WHOP_COMPANY_ID,
            title: 'Nova Unlimited',
            description: 'Unlimited AI Market Analysis + Deep Logic Access',
            initial_price: 99.00,
            renewal_price: 99.00,
            billing_period: 30, // Days
            plan_type: 'renewal',
            stock: 0, // Unlimited stock (0 usually means unlimited or check docs, docs said 'unlimited_stock' field exists)
            unlimited_stock: true,
            visibility: 'visible'
        });

        console.log('------------------------------------------------');
        console.log('✅ Plan Created Successfully!');
        console.log(`Plan ID: ${plan.id}`);
        console.log(`Purchase Page: ${plan.purchase_url || 'N/A'}`); // direct_link or similar?
        console.log('------------------------------------------------');
        console.log('Copy the Plan ID or Purchase Link for your frontend integration.');

    } catch (error) {
        console.error('Failed to create plan:', error);
    }
}

createPlan();
