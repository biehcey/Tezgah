import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** Listedeki bağlantının formunu bağlantı menüsündeki "Düzenle" ile açar. */
export async function editConnection(user: UserEvent, name: RegExp) {
  const nav = screen.getByRole('navigation', { name: 'Bağlantılar' });
  const row = await within(nav).findByRole('button', { name });
  await user.click(within(row.closest('li')!).getByRole('button', { name: 'Bağlantı menüsü' }));
  await user.click(screen.getByRole('menuitem', { name: 'Düzenle' }));
}
