import { useEffect, useId, useState, type FormEvent } from 'react';

interface Props {
  title: string;
  initial: string;
  submitLabel: string;
  /** Hata mesajı döndürürse pencere açık kalır ve mesaj gösterilir. */
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}

/** Klasör oluşturma ve yeniden adlandırma penceresi. */
export function KlasorAdi({ title, initial, submitLabel, onSubmit, onCancel }: Props) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '') return setError('Klasör adı gerekli');
    setBusy(true);
    const failure = await onSubmit(name.trim());
    setBusy(false);
    setError(failure);
  }

  return (
    <div className="perde">
      <form role="dialog" aria-modal="true" aria-labelledby={`${id}-baslik`} className="diyalog" onSubmit={submit} noValidate>
        <h2 id={`${id}-baslik`}>{title}</h2>
        <div className="alan">
          <label htmlFor={`${id}-ad`}>Klasör adı</label>
          <input
            id={`${id}-ad`}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-hata` : undefined}
          />
          {error && (
            <span id={`${id}-hata`} className="alan-hatasi">
              {error}
            </span>
          )}
        </div>
        <footer className="form-alt">
          <span className="bosluk" />
          <button type="button" onClick={onCancel}>
            Vazgeç
          </button>
          <button type="submit" className="birincil" disabled={busy}>
            {submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
