export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getSessionInfo } from '@/lib/auth';
import { CardsClient } from './CardsClient';

export default async function CardsPage() {
  const session = await getSessionInfo();
  if (!session.signedIn) redirect('/login?from=/cards');
  if (session.role !== 'owner') redirect('/');

  // Minting happens in a POST server action (generateCardsAction) triggered by an
  // explicit button click in CardsClient — never on this GET render or a prefetch.
  return <CardsClient />;
}
