import Whop from '@whop/sdk';
import { WhopUser, WhopAccess } from '../types';
import { serverLog } from './logger';

const WHOP_API_KEY = process.env.WHOP_API_KEY || '';
const WHOP_RESOURCE_ID = process.env.WHOP_RESOURCE_ID || '';

class WhopService {
    private client: Whop;

    constructor() {
        console.log('[WHOP SERVICE] Initializing...');
        console.log('[WHOP SERVICE] API Key present:', !!WHOP_API_KEY);
        console.log('[WHOP SERVICE] Resource ID:', WHOP_RESOURCE_ID || 'NOT SET');
        this.client = new Whop({ apiKey: WHOP_API_KEY });
    }

    /**
     * Retrieves the current user from Whop.
     * In a real app view, you'd extract the user token from headers or URL params.
     * For this implementation, we'll provide a way to pass the token.
     */
    async retrieveUser(userId: string): Promise<WhopUser | null> {
        try {
            const logMsg = `Retrieving profile for user: ${userId}`;
            console.log(`[WHOP AUTH] ${logMsg}`);
            serverLog('info', `[WHOP AUTH] ${logMsg}`);
            const user = await this.client.users.retrieve(userId);
            serverLog('info', `[WHOP AUTH] Success: ${user.name} (@${user.username}) identified.`);
            return {
                id: user.id,
                username: user.username,
                name: user.name ?? user.username,
                profile_picture: user.profile_picture?.url,
            };
        } catch (error) {
            console.error('WhopService: Error retrieving user:', error);
            return null;
        }
    }

    /**
     * Checks if a user has access to the specified resource (product/experience/company).
     */
    async checkAccess(userId: string): Promise<WhopAccess> {
        if (!WHOP_RESOURCE_ID) {
            console.warn('WhopService: WHOP_RESOURCE_ID not configured. Defaulting to no access.');
            return { has_access: false, access_level: 'no_access' };
        }

        try {
            const logMsg = `Checking resource access: ${WHOP_RESOURCE_ID} for user: ${userId}`;
            console.log(`[WHOP ACCESS] ${logMsg}`);
            serverLog('info', `[WHOP ACCESS] ${logMsg}`);
            const response = await this.client.users.checkAccess(WHOP_RESOURCE_ID, { id: userId });
            serverLog('info', `[WHOP ACCESS] Result: has_access=${response.has_access}, level=${response.access_level}`);
            return {
                has_access: response.has_access,
                access_level: response.access_level as any,
            };
        } catch (error) {
            console.error('WhopService: Error checking access:', error);
            return { has_access: false, access_level: 'no_access' };
        }
    }

    /**
     * Helper to parse the user ID from the Whop Experience View environment.
     * Whop often passes contextual information via URL parameters or headers.
     */
    getUserIdFromParams(): string | null {
        const params = new URLSearchParams(window.location.search);
        console.log('[WHOP SERVICE] Current URL:', window.location.href);
        console.log('[WHOP SERVICE] All URL params:', Object.fromEntries(params.entries()));

        // Try multiple possible param names
        const userId = params.get('user_id') || params.get('userId') || params.get('whop_user_id');
        console.log('[WHOP SERVICE] Extracted user_id:', userId || 'NOT FOUND');
        return userId;
    }
}

export const whopService = new WhopService();
