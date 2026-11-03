# Script çalıştırma ekranının yerleşimi

Type: prototype
Status: resolved
Blocked by: 21, 22

## Question

Script çalıştırma ekranı nasıl yerleşir: editör, hedef seçici, çalıştırma modu rozeti (Transaction / Autocommit), ifade başına canlı log, hatalı satır işareti, commit/rollback çubuğu, prod kırmızı çerçevesi ve yazma kilidi, autocommit onayı, deneme modu uyarı şeridi? [Deneme modunda ne gösterilir](16-deneme-modu.md)'daki Değişiklikler/Log sekmeleri normal çalıştırmada da kullanılır mı? Commit beklerken zaman aşımı göstergesi ve "Çalıştırma kayıtları klasörünü aç" bağlantısı ([Çalıştırma geçmişi ve denetim kaydı](22-calistirma-gecmisi.md)) nereye oturur?

## Answer

**Varyant B: sağ sütunda ifade zaman çizelgesi.**

- **Üst başlık**: hedef büyük başlık olarak (renk noktası, `bağlantı / veritabanı`, "hedefi değiştir ▾"), yanında ortam etiketi rozeti ve prod'da yazma kilidi rozeti; sağ uçta "Çalıştırma kayıtları klasörünü aç" bağlantısı. prod'da başlık zemini kırmızımsı, uygulama ince kırmızı çerçeveli.
- **Sol**: editör; satır numarasının solunda ifade başına durum işareti (✓ / ✗ / ● çalışıyor / ○ sırada / – çalıştırılmadı); hatalı satır kırmızı zemin + dalgalı alt çizgi; Karışık script'te transaction dışı ifade turuncu zemin + ⚠. Editörün altındaki çubukta Çalıştırma modu rozeti (Transaction / Autocommit turuncu / Karışık kırmızı) ve sağda `▶ Çalıştır`, `⟲ Dene`, çalışırken `■ İptal`.
- **Sağ sütun (≈400px)**: tepede karar kartı (commit/rollback, Karar süresi, son 1 dk geri sayım + "Uzat"; bitmiş çalıştırmada sonuç özeti: commit edildi / süre doldu / deneme geri alındı / autocommit özeti / karışık script mesajı). Altında sekmeler ve ifade kartları: her ifade için komut etiketi, satır, süre, etkilenen satır ya da hata (SQLSTATE + mesaj), SELECT için 100 satırlık önizleme; karta tıklayınca editör o satıra gider.
- **Sekmeler**: deneme modunda *Değişiklikler* (varsayılan) + *Log*; normal çalıştırmada yalnızca *Log*. Normal çalıştırmada önce/sonra farkı yok.
- **Uyarı şeritleri** (başlığın altında, tam genişlik): Autocommit script'te "N ifade anında kalıcı uygulanır, geri alınamaz"; prod'da denemede [prod hedefinde deneme modu](20-prod-deneme-modu.md)'ndaki yan etki şeridi.
- **Hata sonrası (Transaction modu)**: yalnızca Rollback sunulur; Commit düğmesi yok (Postgres hatalı transaction'ı commit etmez; ifade başına savepoint yok). Karar süresi yine işler.

**Onay akışı sadeleştirildi** (kullanıcı kararı; önceki kararları geçersiz kılar):
- prod'da yazma modu araç çubuğundaki düğmeyle **tek tıkla** açılır/kapanır; bağlantı adı yazdırılmaz, onay penceresi, tema değişimi veya ek şerit yok. Durum yalnızca 🔒 Salt okunur / 🔓 Yazma açık rozetiyle görünür. Kilit yine editör/hedef başına, oturum boyunca. Postgres katmanı (`default_transaction_read_only` + `BEGIN READ ONLY`) değişmez.
- Çalıştırmadan önce **hiçbir onay yok**: ne prod'da ad yazdırma ne Autocommit'te tek tıklık onay; Autocommit için yalnızca kalıcı uyarı şeridi.
- Güncellenenler: [prod salt okunurluğu ve onay akışı](07-prod-salt-okunurluk.md), [Transaction dışı komutlar ve karışık script](15-transaction-disi-komutlar.md), `CLAUDE.md` değişmez kuralı.

Prototip: atılabilir `prototype/23-script-ekrani` dalı, `.scratch/ilk-dilim/prototypes/23-script-ekrani-PROTOTYPE.html` (varyantlar `?variant=A|B|C`, `?senaryo=...`, `?hedef=dev|prod`).

Prototip oturumunda (2026-11-03) kararlaştırıldı.
