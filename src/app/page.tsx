import { HomeScreen } from '@/components/home/home-screen';
import { HomeShell } from '@/components/shell/home-shell';

export default function HomePage() {
  return (
    <HomeShell>
      <HomeScreen />
    </HomeShell>
  );
}
