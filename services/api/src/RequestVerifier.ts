
import crypto from 'crypto';

export class RequestVerifier {
    private seenNonces: Set<string> = new Set();
    private readonly WINDOW_MS = 5 * 60 * 1000; // 5 minutes

    constructor(private readonly secret: string) {
        if (!secret) throw new Error('API Secret is required for RequestVerifier');

        // Cleanup nonces periodically
        setInterval(() => {
            this.seenNonces.clear(); // Simple cleanup for MVP. Real impl needs expiration map.
        }, this.WINDOW_MS);
    }

    /**
     * Verifies the authenticity of a control plane request.
     * @param payload The raw request body string
     * @param signature The hex signature provided in headers
     * @param timestamp The timestamp provided in headers
     * @param nonce The nonce provided in headers
     */
    verify(payload: string, signature: string, timestamp: string, nonce: string): boolean {
        const now = Date.now();
        const ts = parseInt(timestamp, 10);

        // 1. Timestamp Check (Replay Protection Window)
        if (isNaN(ts) || Math.abs(now - ts) > this.WINDOW_MS) {
            console.warn('Request timestamp out of window');
            return false;
        }

        // 2. Nonce Check (Replay Protection)
        if (this.seenNonces.has(nonce)) {
            console.warn('Nonce reused');
            return false;
        }
        this.seenNonces.add(nonce);

        // 3. Signature Construction
        // Format: timestamp + nonce + payload
        const data = `${timestamp}${nonce}${payload}`;

        // 4. HMAC Verification
        const expectedSig = crypto
            .createHmac('sha256', this.secret)
            .update(data)
            .digest('hex');

        // Timing-safe comparison recommended, though strictly equality is done here usually
        // crypto.timingSafeEqual works on buffers
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expectedSig);

        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            console.warn('Invalid signature');
            return false;
        }

        return true;
    }
}
