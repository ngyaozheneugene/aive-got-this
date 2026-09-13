import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Dispatch Coordinator</h1>
      <p>Eastwind Aircon control tower. Demo role is the desk — not Cognito.</p>
      <p>
        <Link href="/desk">Open coordinator desk</Link>
      </p>
    </main>
  );
}
