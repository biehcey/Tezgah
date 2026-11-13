# 01: Sekmeli konsol

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: ADR-0003, harita Q3, Q4, Q9

**What to build:** Script ekranı, hedef başlığının üstünde bir sekme şeridi olan konsola dönüşür. Her konsol sekmesi bugünkü Script editörünün aynısıdır: kendi hedefi, Çalıştırma modu rozeti, ifade kartları, karar kartı, Deneme modu ve kendi çalıştırma oturumu (ADR-0002, sekme başına tek client). Sekmeler diske yazılır ve Tezgah açılınca geri gelir, ama hiçbir sunucuya bağlanmaz. Yazma kilidi sekme ve hedef başınadır.

**Blocked by:** None (can start immediately)

**Status:** done (3f0e453)

- [x] Sekme şeridi: yeni sekme, kapatma, sekmeler arası geçiş; sekme başlığında hedefin ortam rengi. Hedef başlığı ve prod kırmızı çerçevesi aktif sekmeye göre değişiyor.
- [x] Veritabanı panelinden ya da Cmd/Ctrl+K'dan seçilen hedef aktif sekmenin hedefi oluyor; karar bekleyen sekmede hedef değiştirme kapalı.
- [x] Her sekme kendi `runScript` tutamacını tutuyor; iki sekme aynı anda farklı hedeflerde çalıştırabiliyor. Karar bekleyen sekmeyi kapatmak tutamacı kapatıyor ve transaction geri alınıyor.
- [x] core sekme kalıcılığı: sürümlü biçim (sıra, aktif sekme, sekme kimliği, tür `konsol` | `tablo`, hedef (bağlantı id, veritabanı, şema; boş olabilir), konsol metni; Tablo sekmesi alanları ticket 09/10 için biçimde tanımlı). Bozuk sekme atlanıyor, kalanlar geri geliyor. Yazma kilidi, sonuçlar ve Bekleyen değişiklikler biçimde yok. Birim testli.
- [x] server sekme deposu: OS yapılandırma dizininde `tezgah.json` dışında bir konsol dizini, atomik yazma (geçici dosya + rename), POSIX'te `0600`; oku/yaz REST uçları. Arayüz değişiklikleri debounce ile yazıyor.
- [x] Açılışta sekmeler geri geliyor ve hiçbir bağlantı, katalog ya da veritabanı isteği gitmiyor. Silinmiş bağlantıya işaret eden sekme hedefsiz açılıyor, metni korunuyor.
- [x] Yazma kilidi sekme + hedef başına: bir prod sekmesinde 🔓 başka prod sekmesini etkilemiyor; hedef değişince kapanıyor; geri gelen sekmede her zaman 🔒.
- [x] Şema seçimi `search_path`'i değiştirmiyor.
- [x] Testler: core biçim gidiş-dönüşü; server deposu (atomik yazma, gidiş-dönüş); web (sekme açma/kapama, hedefin sekmeye göre değişmesi, geri gelen sekmede kilidin kapalı olması ve API çağrısı yapılmaması, iki sekmede bağımsız çalıştırma).
