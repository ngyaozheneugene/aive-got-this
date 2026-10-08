import { redirect } from 'next/navigation';

/** The tool opens on the dispatch board. */
export default function Home() {
  redirect('/desk');
}
