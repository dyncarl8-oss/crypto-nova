import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Whop from '@whop/sdk';
import { connectDB, User, Analysis, Conversation } from './server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
// Use 3001 for backend to avoid conflict with Vite (3000)
const PORT = process.env.PORT || 3001;

// Parse JSON bodies
app.use(express.json());

// Initialize Whop SDK with API key and App ID
const whopClient = new Whop({
    apiKey: process.env.WHOP_API_KEY || '',
    appID: process.env.WHOP_APP_ID || ''
});

// Connect to Database
connectDB();

console.log('[SERVER] Whop client initialized');

// Serve static files from dist
app.use(express.static(join(__dirname, 'dist')));

// API endpoint to get current Whop user and sync with DB
app.get('/api/whop/me', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];

    if (!userToken) {
        return res.json({
            authenticated: false,
            error: 'No x-whop-user-token header'
        });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));

        // Verify the token
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        // Retrieve full user profile
        const whopUser = await whopClient.users.retrieve(userId);

        // Sync with MongoDB
        let dbUser = await User.findOne({ whopUserId: userId });

        if (!dbUser) {
            console.log(`[DB] Creating new user: ${whopUser.username}`);
            dbUser = await User.create({
                whopUserId: userId,
                username: whopUser.username,
                credits: 10, // Increased free credits for new users
                isPro: false
            });
        } else {
            // Update last login
            dbUser.lastLogin = new Date();
            await dbUser.save();
        }

        // Get experience ID and check access
        const referer = req.headers['referer'] || req.headers['x-whop-experience-id'] || '';
        const expMatch = String(referer).match(/experiences\/(exp_[A-Za-z0-9]+)/);
        const experienceId = expMatch ? expMatch[1] : null;

        let access = { has_access: true, access_level: 'customer' };
        if (experienceId) {
            try {
                access = await whopClient.users.checkAccess(experienceId, { id: userId });
            } catch (e) {
                console.log('[SERVER] Access check error:', e.message);
            }
        }

        // --- ROBUST PRO SYNC (Multi-Path Verification with Plan ID) ---
        const companyId = process.env.WHOP_COMPANY_ID;
        const planIdEnv = process.env.WHOP_PLAN_ID;
        const apiKey = process.env.WHOP_API_KEY;

        console.log(`[SYNC] --- START --- User: ${whopUser.username} (${userId})`);
        console.log(`[SYNC] Config: CompanyID=${companyId || 'MISSING'}, PlanID=${planIdEnv || 'MISSING'}`);

        try {
            let hasProAccess = false;

            if (apiKey && companyId) {
                // 1. DYNAMICALLY FIND PLANS & VERIFY CONFIG
                console.log(`[SYNC] Step 1: Checking Plans...`);
                const plansRes = await fetch(`https://api.whop.com/api/v1/plans?company_id=${companyId}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });

                if (plansRes.ok) {
                    const plansData = await plansRes.json();
                    const allPlans = plansData.data || [];
                    console.log(`[SYNC] Total Plans for Company: ${allPlans.length}`);
                    allPlans.forEach(p => {
                        console.log(`[SYNC] Found Plan: ID=${p.id}, Name=${p.name}`);
                    });
                }

                // 2. CHECK MEMBERSHIPS (Exhaustive Trace)
                console.log(`[SYNC] Step 2: Checking Memberships for User...`);
                const mUrl = new URL('https://api.whop.com/api/v1/memberships');
                mUrl.searchParams.append('user_id', userId);
                mUrl.searchParams.append('company_id', companyId);
                // We'll fetch all memberships (not just active) to see what's happening

                const mRes = await fetch(mUrl, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });

                if (mRes.ok) {
                    const mData = await mRes.json();
                    const memberships = mData.data || [];
                    console.log(`[SYNC] Total Memberships Found: ${memberships.length}`);

                    memberships.forEach(m => {
                        const isActive = (m.status === 'active' || m.status === 'trialing' || m.status === 'completed');
                        const isTargetPlan = (m.plan_id === planIdEnv);
                        console.log(`[SYNC] Memb: ID=${m.id}, Plan=${m.plan_id}, Status=${m.status}, Active=${isActive}, TargetMatched=${isTargetPlan}`);

                        if (isActive && (isTargetPlan || !planIdEnv)) {
                            hasProAccess = true;
                        }
                    });
                } else {
                    console.error(`[SYNC] Membership API Error: ${mRes.status} ${await mRes.text()}`);
                }

                // 3. CHECK MEMBER STATUS (CRM Fallback)
                if (!hasProAccess) {
                    console.log(`[SYNC] Step 3: Checking Member CRM...`);
                    const membersRes = await fetch(`https://api.whop.com/api/v1/companies/${companyId}/members?user_ids[]=${userId}`, {
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                    });

                    if (membersRes.ok) {
                        const membersData = await membersRes.json();
                        const memberNodes = membersData.data || [];
                        if (memberNodes.length > 0) {
                            const member = memberNodes[0];
                            console.log(`[SYNC] CRM Match Found: Status=${member.status}, Action=${member.most_recent_action}`);
                            if (member.most_recent_action === 'paid_subscriber' || member.most_recent_action === 'paid_once') {
                                hasProAccess = true;
                            }
                        }
                    }
                }
            }

            // FINAL SYNC TO DATABASE
            if (hasProAccess) {
                if (!dbUser.isPro) {
                    console.log(`[DB] SUCCESS: Upgrading ${whopUser.username} to Pro.`);
                    dbUser.isPro = true;
                    await dbUser.save();
                } else {
                    console.log(`[DB] User ${whopUser.username} verified as Pro.`);
                }
            } else {
                console.log(`[SYNC] FAILED: No active Pro status detected for ${whopUser.username}.`);
            }
        } catch (err) {
            console.error(`[SYNC] CRITICAL ERROR:`, err);
        }
        console.log(`[SYNC] --- END ---`);

        res.json({
            authenticated: true,
            user: {
                id: whopUser.id,
                username: whopUser.username,
                name: whopUser.name || whopUser.username,
                profile_picture: whopUser.profile_picture?.url,
                credits: dbUser.credits,
                isPro: dbUser.isPro
            },
            access,
            experienceId
        });
    } catch (error) {
        console.error('[SERVER] Auth error:', error.message);
        res.status(500).json({
            authenticated: false,
            error: error.message
        });
    }
});

// Endpoint to deduct credits
app.post('/api/credits/deduct', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Verify User again to be safe
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        const user = await User.findOne({ whopUserId: userId });

        if (!user) {
            return res.status(404).json({ error: 'User not found in database' });
        }

        if (user.isPro) {
            return res.json({ success: true, remaining: 'UNLIMITED', isPro: true });
        }

        if (user.credits > 0) {
            user.credits -= 1;
            await user.save();
            console.log(`[DB] Deducted credit for ${user.username}. Remaining: ${user.credits}`);
            return res.json({ success: true, remaining: user.credits, isPro: false });
        } else {
            return res.status(403).json({ error: 'Insufficient credits', remaining: 0, isPro: false });
        }

    } catch (error) {
        console.error('[SERVER] Credit deduction error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to save analysis history
app.post('/api/analysis/save', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];
    const { symbol, price, verdict, technicals, thought_process } = req.body;

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        const analysis = await Analysis.create({
            whopUserId: userId,
            symbol,
            price,
            verdict,
            technicals,
            thought_process
        });

        res.json({ success: true, analysisId: analysis._id });
    } catch (error) {
        console.error('[SERVER] Analysis save error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to fetch analysis history
app.get('/api/analysis/history', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        const history = await Analysis.find({ whopUserId: userId }).sort({ createdAt: -1 }).limit(50);
        res.json({ success: true, history });
    } catch (error) {
        console.error('[SERVER] Analysis history fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to save chat messages
app.post('/api/chat/save', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];
    const { message, conversationId } = req.body; // message: { role, content }

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        let conversation;
        if (conversationId) {
            conversation = await Conversation.findOne({ _id: conversationId, whopUserId: userId });
        }

        if (!conversation) {
            // Create new conversation
            conversation = await Conversation.create({
                whopUserId: userId,
                title: message.content.slice(0, 50) + (message.content.length > 50 ? '...' : ''),
                messages: [message],
                lastMessageAt: new Date()
            });
        } else {
            // Append to existing
            conversation.messages.push(message);
            conversation.lastMessageAt = new Date();
            await conversation.save();
        }

        res.json({ success: true, conversationId: conversation._id });
    } catch (error) {
        console.error('[SERVER] Chat save error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to fetch chat history
app.get('/api/chat/history', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        // Verify if user is Pro in DB
        const dbUser = await User.findOne({ whopUserId: userId });
        if (!dbUser?.isPro) {
            return res.status(403).json({ error: 'Premium subscription required for history.' });
        }

        const history = await Conversation.find({ whopUserId: userId }).sort({ lastMessageAt: -1 }).limit(20);
        res.json({ success: true, history });
    } catch (error) {
        console.error('[SERVER] Chat history fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to create a checkout session
app.post('/api/checkout/session', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        const planId = process.env.WHOP_PLAN_ID;
        if (!planId) {
            return res.status(400).json({
                error: 'Configuration Error: WHOP_PLAN_ID is missing in environment variables. Please add it to Render.'
            });
        }

        // Create a checkout configuration using a pre-defined Plan ID
        const checkoutConfig = await whopClient.checkoutConfigurations.create({
            plan_id: planId,
            metadata: {
                whop_user_id: userId,
                source: 'nova_app_upgrade_button'
            }
        });

        res.json({ success: true, sessionId: checkoutConfig.id });
    } catch (error) {
        console.error('[SERVER] Checkout session error:', error);
        res.status(500).json({
            error: 'Failed to initialize checkout. Please ensure WHOP_PLAN_ID and WHOP_COMPANY_ID are correct.',
            details: error.message
        });
    }
});

app.get('/api/debug/headers', (req, res) => {
    res.json({ headers: req.headers });
});

app.get('/{*path}', (req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Nova running on port ${PORT}`);
});
