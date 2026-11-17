import type { Metadata } from 'next';
import GiftGenie from '@/components/GiftGenie';

export const metadata: Metadata = {
  title: 'Gift Genie — Emporika',
  description:
    'Save the people you buy gifts for and get gift ideas matched from a built-in index across every retailer you search.',
};

/**
 * Gift Genie. Recipient profiles are stored in the browser
 * (`lib/gift-recipients.ts`); only the compiled searches reach the server.
 */
export default function GiftPage() {
  return <GiftGenie />;
}
