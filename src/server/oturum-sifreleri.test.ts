import { describe, expect, it } from 'vitest';
import { createSessionPasswords } from './oturum-sifreleri';

describe('oturumluk şifreler', () => {
  it('reddedilen şifre unutulur', () => {
    const passwords = createSessionPasswords();
    passwords.remember('b1', 'yanlis');
    passwords.forgetRejected('b1', 'yanlis');
    expect(passwords.get('b1')).toBeUndefined();
  });

  it('geç gelen ret arada girilen yeni şifreyi silmez', () => {
    const passwords = createSessionPasswords();
    passwords.remember('b1', 'yanlis');
    passwords.remember('b1', 'gizli');
    passwords.forgetRejected('b1', 'yanlis');
    expect(passwords.get('b1')).toBe('gizli');
  });

  it('şifresiz denemeye gelen ret hiçbir şeyi silmez', () => {
    const passwords = createSessionPasswords();
    passwords.remember('b1', 'gizli');
    passwords.forgetRejected('b1', undefined);
    expect(passwords.get('b1')).toBe('gizli');
  });
});
