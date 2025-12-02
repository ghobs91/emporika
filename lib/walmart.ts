import { WalmartSearchParams, WalmartSearchResponse } from '@/types/walmart';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const WALMART_API_BASE = 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2/search';

export class WalmartAPI {
  private consumerId: string;
  private privateKey: string;
  private keyVersion: string;

  constructor(consumerId: string, keyVersion: string) {
    this.consumerId = consumerId;
    // Read private key from file
    const keyPath = path.join(process.cwd(), 'WM_IO_private_key.pem');
    this.privateKey = fs.readFileSync(keyPath, 'utf8');
    this.keyVersion = keyVersion;
  }



  private generateSignature(consumerId: string, timestamp: string, keyVersion: string): string {
    try {
      // Create the string to sign: consumerId + timestamp + keyVersion
      const stringToSign = consumerId + '\n' + timestamp + '\n' + keyVersion + '\n';
      
      // Sign using RSA-SHA256
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(stringToSign);
      sign.end();
      
      const signature = sign.sign(this.privateKey, 'base64');
      return signature;
    } catch (error) {
      console.error('Error generating signature:', error);
      console.error('Private key:', this.privateKey.substring(0, 50) + '...');
      throw error;
    }
  }

  async searchProducts(params: WalmartSearchParams): Promise<WalmartSearchResponse> {
    const timestamp = Date.now().toString();
    const signature = this.generateSignature(this.consumerId, timestamp, this.keyVersion);

    const searchParams = new URLSearchParams({
      query: params.query,
      ...(params.sort && { sort: params.sort }),
      ...(params.order && { order: params.order }),
      ...(params.start !== undefined && { start: params.start.toString() }),
      ...(params.numItems && { numItems: params.numItems.toString() }),
      ...(params.categoryId && { categoryId: params.categoryId }),
    });

    const url = `${WALMART_API_BASE}?${searchParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'WM_CONSUMER.ID': this.consumerId,
        'WM_CONSUMER.INTIMESTAMP': timestamp,
        'WM_SEC.KEY_VERSION': this.keyVersion,
        'WM_SEC.AUTH_SIGNATURE': signature,
        'WM_QOS.CORRELATION_ID': `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Walmart API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }
}

export const walmartAPI = new WalmartAPI(
  process.env.WALMART_CONSUMER_ID || '',
  process.env.WALMART_KEY_VERSION || '1'
);
