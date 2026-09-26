import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from './_components/ui/button';

export default function Home() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Dispatch Coordinator</h1>
        <p className="mt-2 text-muted-foreground">
          Eastwind Aircon control tower. Demo role is the desk — not Cognito.
        </p>
        <Button asChild className="mt-6">
          <Link href="/desk">
            Open coordinator desk
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </main>
  );
}
