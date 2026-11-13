# 02: Hedef başına 5 oturum ve havuzDolu

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q8

**What to build:** Bir hedefte aynı anda en fazla 5 oturum açık olabilir. Sınırı aşan çalıştırma kuyrukta beklemez; hemen "Bu hedefte N açık oturum var: Sekme X, Y…" hatası gösterilir ve sekme adlarına tıklanınca o sekmeye geçilir. Kısa süreli sorgular sınırı doldurmaz.

**Blocked by:** 01

**Status:** done (07d9d95)

- [x] Pool hedef başına en fazla 5 client (3'ten).
- [x] Script çalıştırma client alamazsa beklemeden `bitti` olayında yapısal `havuzDolu` kodu dönüyor.
- [x] Arayüz mesajı kendi bildiği, o hedefte açık oturumu olan sekmelerden kuruyor; sekme adları tıklanabilir ve o sekmeye geçiriyor.
- [x] Kısa süreli sorgular (veritabanı/şema listesi; ileride katalog, tablo sayfası, izleme) client'ı hemen bırakıyor.
- [x] Testler: server'da 6. açık çalıştırmada `havuzDolu`, bir oturum kapanınca yeni çalıştırmanın başlaması; web'de mesaj ve sekme bağlantısı.
