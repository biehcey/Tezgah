# 12: Satır ekleme/silme, NULL ve yapıştırma

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q20, Q21; [02 Grid davranış ayrıntıları](../../ikinci-dilim/issues/02-grid-davranis-ayrintilari.md) Q2, Q7, Q9

**What to build:** Tablo sekmesinde satır eklenir ve silinir, hücreler NULL yapılır, çok hücreli TSV yapıştırılır; hepsi Bekleyen değişiklik olarak birikir ve üretilen SQL'e yansır.

**Blocked by:** 11

**Status:** done (bd76b42)

- [x] Satır ekleme: yeni satırda dokunulmayan kolonlar INSERT'te yok (DEFAULT); hiçbiri dokunulmadıysa `DEFAULT VALUES`.
- [x] Satır silme ve silmeyi geri alma; eklenip silinen satır SQL üretmiyor; silinen satırdaki düzenlemeler düşüyor.
- [x] Sıra DELETE → UPDATE → INSERT.
- [x] NULL: Ctrl/Cmd+Shift+N (düzenleyicide de) ve sağ tık; NULL ≠ boş metin.
- [x] `bytea` ve generated kolonlar salt okunur.
- [x] TSV yapıştırma (yalnızca Tablo sekmesi): sol üst köşeden başlıyor; boş hücre NULL, `NULL` metni düz metin, tırnaklı hücreler kopyalama kuralına simetrik çözülüyor; taşan satır yeni satır; kolon taşması ya da salt okunur kolon tüm yapıştırmayı hatayla reddediyor.
- [x] Grid işaretleri: eklendi / silinecek / değişti.
- [x] Testler: core depo (ekle/sil kombinasyonları, sıra, çok kolonlu PK, yapıştırma ve ret); web'de ekleme/silme, NULL kısayolu, yapıştırma ve reddi.
