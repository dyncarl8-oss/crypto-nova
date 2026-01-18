import Whop from "@whop/sdk";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const client = new Whop({ apiKey: process.env.WHOP_API_KEY });

async function listProducts() {
    try {
        console.log("Fetching products for company:", process.env.WHOP_COMPANY_ID);
        const products = await client.products.list({ companyId: process.env.WHOP_COMPANY_ID });
        console.log("Products found:", products.length);
        for (const p of products) {
            console.log(`- Product: ${p.name} (ID: ${p.id})`);
            // List plans for each product
            const plans = await client.plans.list({ productId: p.id });
            plans.forEach(plan => {
                console.log(`  - Plan: ${plan.name} (ID: ${plan.id}) - ${plan.renewal_period} days, ${plan.initial_price} ${plan.currency}`);
            });
        }

        // Also check if there's a more direct way to see passes/plans
        // The SDK might have client.plans.list or client.passes.list
    } catch (e) {
        console.error("Error:", e.message);
    }
}

listProducts();
