// ============================================================
// SoriKyo Tier 3 — Web Push Health Check
// Validates VAPID environment variables for Omni-Stack integrations.
// ============================================================

import 'dotenv/config';

console.log('\n[SoriKyo] Running web-push Pre-Flight Check...');

const pubKey = process.env.VAPID_PUBLIC_KEY;
const privKey = process.env.VAPID_PRIVATE_KEY;

if (!pubKey || !privKey) {
    console.log('⚠️  WARNING: VAPID keys not found in .env');
    console.log('   Push notifications for New Bookings will be disabled.');
    console.log('   To fix: Generate keys using `npx web-push generate-vapid-keys` and add to .env\n');
    process.exit(0); // Soft failure. Core app still boots.
} else {
    console.log('✅ VAPID Keys Detected.');
    if (pubKey === 'dummy_public' || privKey === 'dummy_private') {
        console.log('⚠️  WARNING: Using "dummy" VAPID keys. Actual pushes will fail.');
    } else {
        console.log('🟢 Push Notification system ready for action.\n');
    }
}
